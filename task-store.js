import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const file = path.join(process.cwd(), 'data', 'tasks.json');
let tasks = [];
let missions = [];
const missionsFile = path.join(process.cwd(), 'data', 'missions.json');
let writing = Promise.resolve();
const statuses = new Set(['pending', 'in_progress', 'completed']);

// Infer a concise mission title from saved task descriptions without asking the user.
// Existing descriptive mission titles are never overwritten.
const placeholderTitle = (title, id) => !title || title === `Mission ${String(id).slice(0, 8)}` || /^Mission [a-f0-9]{8}$/i.test(title);
function suggestMissionTitle(taskNames) {
  const names = taskNames.map(clean).filter(Boolean);
  if (!names.length) return null;
  const corpus = names.join(' ').toLowerCase();
  // Recognize common themes when several tasks describe a coherent feature.
  const themes = [
    [/authenticat|login|log.?out|password|signup|sign.?up|jwt|user profile|user account/, 'User Authentication & Accounts'],
    [/dashboard|analytics|chart|metrics|visualiz/, 'Dashboard & Analytics'],
    [/payment|checkout|billing|invoice|stripe/, 'Payments & Billing'],
    [/calendar|schedule|appointment|meeting|reminder/, 'Scheduling & Calendar'],
    [/deploy|hosting|production|domain|render\b/, 'Website Deployment'],
    [/database|schema|sql|migration|mongodb/, 'Database Development'],
    [/email|notification|messaging|sms/, 'Notifications & Messaging'],
    [/travel|flight|hotel|itinerary|booking/, 'Travel Planning'],
    [/marketing|campaign|social media|promotion|content/, 'Marketing Campaign'],
  ];
  const ranked = themes.map(([pattern, title]) => ({ title, score: names.filter(n => pattern.test(n.toLowerCase())).length })).sort((a,b) => b.score-a.score);
  if (ranked[0].score >= Math.max(2, Math.ceil(names.length * 0.22))) return ranked[0].title;
  // Fallback: choose meaningful repeated terms rather than an opaque run ID.
  const stop = new Set('the a an and or to for with from into of in on at by is are be as using use create implement add build make set up test check verify update ensure develop configure integrate handle support endpoint api task system feature function user users new all each that this'.split(' '));
  const counts = new Map();
  for (const n of names) {
    const unique = new Set((n.toLowerCase().match(/[a-z][a-z0-9]+/g) || []).filter(w => w.length > 2 && !stop.has(w)));
    for (const w of unique) counts.set(w, (counts.get(w) || 0) + 1);
  }
  const terms = [...counts].sort((a,b) => b[1]-a[1]).slice(0, 2).map(([w]) => w[0].toUpperCase()+w.slice(1));
  if (terms.length && (counts.get(terms[0].toLowerCase()) || 0) >= 2) return terms.join(' & ') + ' Project';
  return names[0].replace(/^(implement|create|build|develop|add|test|configure|set up)\s+/i, '').replace(/[.!?]+$/, '').slice(0, 65);
}

export async function initTasks() {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    const loaded = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!Array.isArray(loaded)) throw new Error('Invalid tasks database');
    tasks = loaded;
  } catch (err) { if (err.code !== 'ENOENT') throw err; }
  try {
    const loaded = JSON.parse(await fs.readFile(missionsFile, 'utf8'));
    if (!Array.isArray(loaded)) throw new Error('Invalid missions database');
    missions = loaded;
  } catch (err) { if (err.code !== 'ENOENT') throw err; }
  // Preserve older task records by grouping them under their original run IDs.
  const existing = new Set(missions.map(m => `${m.userId}:${m.id}`));
  for (const t of tasks) {
    if (!t.runId || !t.userId || existing.has(`${t.userId}:${t.runId}`)) continue;
    missions.push({ id: t.runId, userId: t.userId, title: `Mission ${t.runId.slice(0, 8)}`, state: 'finished', createdAt: t.createdAt || new Date().toISOString(), updatedAt: t.updatedAt || new Date().toISOString() });
    existing.add(`${t.userId}:${t.runId}`);
  }
  // Auto-name older missions from their actual tasks, scoped to the same account and run.
  for (const m of missions) {
    if (!placeholderTitle(m.title, m.id)) continue;
    const suggestion = suggestMissionTitle(tasks.filter(t => t.userId === m.userId && t.runId === m.id).map(t => t.name));
    if (suggestion) { m.title = suggestion; m.updatedAt = new Date().toISOString(); }
  }
  if (missions.length) await persistMissions();
}
function persist() {
  writing = writing.catch(() => {}).then(async () => {
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(tasks, null, 2), { flag: 'wx', mode: 0o600 });
    await fs.rename(temp, file);
  });
  return writing;
}
const clean = value => String(value ?? '').trim().slice(0, 300);
export function listTasks(userId) {
  return tasks.filter(t => t.userId === userId).map(({ userId, ...t }) => t).reverse();
}
export function addAgentTask(userId, runId, agentTask, fallbackName = '') {
  const name = clean(agentTask?.name || fallbackName);
  if (!name) return Promise.resolve();
  const externalId = agentTask?.id == null ? null : clean(agentTask.id);
  // Only deduplicate by agent-provided ID within the same mission.
  if (externalId && tasks.some(t => t.userId === userId && t.runId === runId && t.externalId === externalId)) return Promise.resolve();
  if (!externalId && tasks.some(t => t.userId === userId && t.runId === runId && t.name === name)) return Promise.resolve();
  const now = new Date().toISOString();
  tasks.push({ id: crypto.randomUUID(), userId, runId, externalId, name, status: 'pending', mode: 'manual', createdAt: now, updatedAt: now });
  const mission = missions.find(m => m.id === runId && m.userId === userId);
  if (mission && placeholderTitle(mission.title, mission.id)) {
    const suggestion = suggestMissionTitle(tasks.filter(t => t.userId === userId && t.runId === runId).map(t => t.name));
    if (suggestion) { mission.title = suggestion; mission.updatedAt = now; persistMissions().catch(err => console.error('Auto-name save failed:', err)); }
  }
  return persist();
}
export function updateTask(userId, id, status) {
  if (!statuses.has(status)) return Promise.resolve({ error: 'Invalid task status.', code: 400 });
  const task = tasks.find(t => t.id === id && t.userId === userId);
  if (!task) return Promise.resolve({ error: 'Task not found.', code: 404 });
  if (task.mode !== 'manual') return Promise.resolve({ error: 'This task is controlled by an integration.', code: 403 });
  task.status = status;
  task.updatedAt = new Date().toISOString();
  return persist().then(() => { const { userId: _userId, ...publicTask } = task; return { task: publicTask }; });
}

export function deleteTask(userId, id) {
  const index = tasks.findIndex(t => t.id === id && t.userId === userId);
  if (index < 0) return Promise.resolve({ error: 'Task not found.', code: 404 });
  const [removed] = tasks.splice(index, 1);
  return persist().then(() => ({ deletedId: removed.id, runId: removed.runId }));
}

let missionWriting = Promise.resolve();
function persistMissions() {
  missionWriting = missionWriting.catch(() => {}).then(async () => {
    const temp = `${missionsFile}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(missions, null, 2), { flag: 'wx', mode: 0o600 });
    await fs.rename(temp, missionsFile);
  });
  return missionWriting;
}
export function listMissions(userId) {
  return missions.filter(m => m.userId === userId).map(({userId, ...m}) => m).reverse();
}
export async function createMission(userId, id, title) {
  if (missions.some(m => m.id === id && m.userId === userId)) throw new Error('Duplicate mission');
  const now = new Date().toISOString();
  missions.push({ id, userId, title: clean(title), state: 'running', createdAt: now, updatedAt: now });
  await persistMissions();
}
export function setMissionState(userId, id, state) {
  const m = missions.find(m => m.id === id && m.userId === userId);
  if (!m || !['finished', 'stopped', 'error'].includes(state)) return Promise.resolve();
  m.state = state; m.updatedAt = new Date().toISOString();
  return persistMissions();
}

// Delete the mission and all of its tracked tasks for the authenticated owner.
// This is intentionally not a cancellation of external third-party actions.
export async function deleteMission(userId, id) {
  const index = missions.findIndex(m => m.id === id && m.userId === userId);
  if (index < 0) return { error: 'Mission not found.', code: 404 };
  const mission = missions[index];
  if (mission.state === 'running') return { error: 'Stop this mission before deleting it.', code: 409 };
  const removedCount = tasks.filter(t => t.userId === userId && t.runId === id).length;
  missions.splice(index, 1);
  tasks = tasks.filter(t => !(t.userId === userId && t.runId === id));
  // Write tasks first so a restart cannot recreate the deleted mission from orphaned tasks.
  await persist();
  await persistMissions();
  return { deletedId: id, deletedTasks: removedCount };
}

export function renameMission(userId, id, title) {
  const m = missions.find(m => m.id === id && m.userId === userId);
  if (!m) return Promise.resolve({ error: 'Mission not found.', code: 404 });
  const name = clean(title);
  if (name.length < 3) return Promise.resolve({ error: 'Mission name must be at least 3 characters.', code: 400 });
  m.title = name;
  m.updatedAt = new Date().toISOString();
  return persistMissions().then(() => ({ mission: { id: m.id, title: m.title } }));
}
