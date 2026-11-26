const personal = { tasks: [], missions: [], busy: new Set(), selectedId: null };
async function loadPersonalTasks() {
  try {
    const [taskResponse, missionResponse] = await Promise.all([fetch('/api/tasks'), fetch('/api/missions')]);
    if (!taskResponse.ok || !missionResponse.ok) throw new Error('Unable to load missions. Please sign in again.');
    personal.tasks = (await taskResponse.json()).tasks || [];
    personal.missions = (await missionResponse.json()).missions || [];
    if (personal.selectedId && !personal.missions.some(m => m.id === personal.selectedId)) personal.selectedId = null;
    $('taskError').textContent = '';
    drawPersonalDashboard();
  } catch (err) { $('taskError').textContent = err.message; }
}
function missionStats(m) {
  const tasks = personal.tasks.filter(t => t.runId === m.id);
  const done = tasks.filter(t => t.status === 'completed').length;
  return { tasks, done, active: tasks.filter(t => t.status === 'in_progress').length, pending: tasks.filter(t => t.status === 'pending').length, pct: tasks.length ? Math.round(done * 100 / tasks.length) : 0 };
}
function drawPersonalDashboard() {
  $('missionCount').textContent = `(${personal.missions.length})`;
  $('missionColumns').innerHTML = personal.missions.length ? personal.missions.map(m => {
    const s = missionStats(m);
    const selected = personal.selectedId === m.id;
    return `<button type="button" class="mission-choice ${selected ? 'selected' : ''}" data-mission-id="${esc(m.id)}" aria-pressed="${selected}"><span class="mission-choice-icon">▦</span><span class="mission-choice-name">${esc(m.title || 'Untitled mission')}</span><span class="task-pill">${esc(m.state || 'saved')}</span><span class="mission-choice-progress"><strong>${s.pct}%</strong><small>${s.done} of ${s.tasks.length} tasks completed</small></span><span class="progress-track"><span style="display:block;height:100%;width:${s.pct}%;background:linear-gradient(90deg,#4F7DF0,#6bd7b3);border-radius:99px"></span></span><span class="mission-choice-open">View tasks →</span></button>`;
  }).join('') : '<p class="empty">No missions yet. Create one in Mission Control to see it here.</p>';
  const m = personal.missions.find(m => m.id === personal.selectedId);
  $('selectedMission').hidden = !m;
  if (!m) return;
  const s = missionStats(m);
  $('selectedMissionTitle').textContent = m.title || 'Untitled mission';
  $('selectedMissionMeta').textContent = `Mission ${m.id.slice(0, 8)} · ${m.state || 'saved'}`;
  $('sTotal').textContent = s.tasks.length;
  $('sDone').textContent = s.done;
  $('sProgress').textContent = s.active;
  $('sPending').textContent = s.pending;
  $('completionPct').textContent = `${s.pct}%`;
  $('progressFill').style.width = `${s.pct}%`;
  $('progressTrack').setAttribute('aria-valuenow', String(s.pct));
  $('progressSummary').textContent = `${s.done} of ${s.tasks.length} tasks completed in this mission`;
  const filter = $('taskFilter').value;
  const visible = s.tasks.filter(t => filter === 'all' || t.status === filter);
  $('selectedTaskList').innerHTML = visible.length ? visible.map(t => `<div class="task-row"><div class="task-details"><b>${esc(t.name)}</b><small>${t.mode === 'manual' ? 'Manual update' : 'Managed by integration'}</small></div><div class="task-controls">${t.mode === 'manual' ? `<select aria-label="Status for ${esc(t.name)}" data-task-id="${esc(t.id)}" ${personal.busy.has(t.id) ? 'disabled' : ''}><option value="pending" ${t.status === 'pending' ? 'selected' : ''}>Pending</option><option value="in_progress" ${t.status === 'in_progress' ? 'selected' : ''}>In progress</option><option value="completed" ${t.status === 'completed' ? 'selected' : ''}>Completed</option></select>` : `<span class="task-pill">${esc(t.status.replace('_', ' '))} · Automated</span>`}<button type="button" class="task-delete" data-delete-task-id="${esc(t.id)}" aria-label="Delete ${esc(t.name)}" title="Delete task" ${personal.busy.has(t.id) ? 'disabled' : ''}>✕ Delete</button></div></div>`).join('') : `<p class="empty">${s.tasks.length ? 'No tasks match this filter.' : 'Waiting for AI-generated tasks.'}</p>`;
}
$('missionColumns').addEventListener('click', event => {
  const btn = event.target.closest('[data-mission-id]');
  if (!btn) return;
  personal.selectedId = btn.dataset.missionId;
  $('taskFilter').value = 'all';
  drawPersonalDashboard();
  $('selectedMission').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('backToMissions').onclick = () => {
  personal.selectedId = null;
  drawPersonalDashboard();
  $('missionColumns').scrollIntoView({ behavior: 'smooth', block: 'start' });
};
$('deleteSelectedMission').addEventListener('click', async () => {
  const id = personal.selectedId;
  const mission = personal.missions.find(m => m.id === id);
  if (!mission || personal.busy.has(`mission:${id}`)) return;
  const count = missionStats(mission).tasks.length;
  if (!window.confirm(`Permanently delete mission "${mission.title || 'Untitled mission'}" and its ${count} tracked task${count === 1 ? '' : 's'}?\n\nThis cannot be undone. It does not undo any external actions.`)) return;
  personal.busy.add(`mission:${id}`);
  $('deleteSelectedMission').disabled = true;
  try {
    const response = await fetch(`/api/missions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not delete mission.');
    personal.missions = personal.missions.filter(m => m.id !== id);
    personal.tasks = personal.tasks.filter(t => t.runId !== id);
    personal.selectedId = null;
    $('taskError').textContent = '';
  } catch (err) { $('taskError').textContent = err.message; }
  finally {
    personal.busy.delete(`mission:${id}`);
    $('deleteSelectedMission').disabled = false;
    drawPersonalDashboard();
  }
});
$('selectedTaskList').addEventListener('change', async event => {
  const select = event.target.closest('select[data-task-id]'); if (!select) return;
  const id = select.dataset.taskId;
  if (personal.busy.has(id)) return;
  personal.busy.add(id); select.disabled = true;
  try {
    const response = await fetch(`/api/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: select.value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not update task.');
    const task = personal.tasks.find(t => t.id === id);
    if (task) task.status = result.task.status;
    $('taskError').textContent = '';
  } catch (err) { $('taskError').textContent = err.message; await loadPersonalTasks(); }
  finally { personal.busy.delete(id); drawPersonalDashboard(); }
});
$('selectedTaskList').addEventListener('click', async event => {
  const button = event.target.closest('button[data-delete-task-id]');
  if (!button) return;
  const id = button.dataset.deleteTaskId;
  const task = personal.tasks.find(t => t.id === id && t.runId === personal.selectedId);
  if (!task || personal.busy.has(id)) return;
  if (!window.confirm(`Delete "${task.name}" from this mission? This cannot be undone.\n\nThis removes the task from tracking; it does not cancel any external automation.`)) return;
  personal.busy.add(id);
  button.disabled = true;
  try {
    const response = await fetch(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not delete task.');
    personal.tasks = personal.tasks.filter(t => t.id !== id);
    $('taskError').textContent = '';
  } catch (err) {
    $('taskError').textContent = err.message;
    await loadPersonalTasks();
  } finally {
    personal.busy.delete(id);
    drawPersonalDashboard();
  }
});
$('reloadTasks').onclick = loadPersonalTasks;
$('taskFilter').onchange = drawPersonalDashboard;
loadPersonalTasks();
