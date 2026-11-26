const HK = 'taskpilot.history.' + window.TASKPILOT_USER_ID;
const loadH = () => { try { return JSON.parse(localStorage.getItem(HK)) || []; } catch { return []; } };
function saveH(){
  if (!S.results.length) return;
  try { localStorage.setItem(HK, JSON.stringify([{ id:S.runId, objective:S.objective, model:S.model, date:new Date().toISOString(), results:S.results }, ...loadH()].slice(0, 20))); } catch {}
}
function drawHistory(){
  const h = loadH();
  $('histList').innerHTML = h.length ? h.map((m, i) => `<div class="hist"><div><b>${esc(m.objective)}</b><small>${new Date(m.date).toLocaleString()} · ${esc(m.model)} · ${m.results.length} tasks</small></div>
    <div class="actions" style="margin:0"><button class="btn" data-a="view" data-i="${i}">View</button><button class="btn" data-a="md" data-i="${i}">Markdown</button><button class="btn" data-a="re" data-i="${i}">Run again</button></div></div>`).join('') : '<p class="empty">No saved missions yet.</p>';
}
$('histList').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return; const m = loadH()[b.dataset.i];
  if (b.dataset.a === 'view'){ drawResults(m.results); $('resSub').textContent = m.objective; show('results'); S.viewing = m; }
  if (b.dataset.a === 'md') download(toMd(m.objective, m.model, m.results), 'taskpilot-results.md', 'text/markdown');
  if (b.dataset.a === 're'){ $('objective').value = m.objective; show('mission'); }
};
