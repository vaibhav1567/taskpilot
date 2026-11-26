import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BabyAGI } from './src/babyagi.js';
import { initCalendar, mountCalendar } from './calendar.js';
import { initAuth, mountAuth, requireAuth, currentUser, sameOrigin } from './auth.js';
import { initTasks, listTasks, addAgentTask, updateTask, deleteTask, listMissions, createMission, setMissionState, renameMission, deleteMission } from './task-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MODELS = (process.env.ALLOWED_MODELS || 'llama3.2:3b').split(',').map((s) => s.trim());
const MAX_ITER = Number(process.env.MAX_ITERATIONS) || 15;
const MAX_ACTIVE_RUNS = 3;


const app = express();
app.use(express.json({ limit: '10kb' }));
app.disable('x-powered-by');
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'no-referrer'); res.set('Cache-Control', 'no-store'); next(); });
app.use(sameOrigin);
mountAuth(app);
mountCalendar(app);
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.use((req, res, next) => {
  if (req.path === '/login.html' || req.path === '/js/auth-page.js' || ['/css/auth.css', '/css/auth-normal.css', '/css/auth-cosmos.css', '/css/auth-glass.css'].includes(req.path)) return next();
  if (req.path.startsWith('/api/')) return requireAuth(req, res, next);
  if (!currentUser(req)) return res.redirect('/login');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

/** runId -> { agent, events: [], clients: Set<res>, objective, model, done } */
const runs = new Map();

function publish(run, event, data) {
  // Persist planned tasks as they appear. AI-generated text is not proof of real-world completion.
  const incoming = event === 'tasks' && Array.isArray(data?.tasks) ? data.tasks
    : (event === 'start' && data?.task ? [data.task] : []);
  for (const task of incoming) {
    addAgentTask(run.userId, run.id, task).catch(err => console.error('Task save failed:', err));
  }
  const entry = { event, data };
  run.events.push(entry);
  if (event === 'status' && ['finished', 'stopped', 'error'].includes(data.state)) { run.done = true; setMissionState(run.userId, run.id, data.state).catch(err => console.error('Mission save failed:', err)); }
  for (const res of run.clients) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

app.get('/api/missions', (req, res) => res.json({ missions: listMissions(req.user.id) }));
app.get('/api/tasks', (req, res) => res.json({ tasks: listTasks(req.user.id) }));
app.patch('/api/missions/:id', async (req, res) => {
  try {
    const result = await renameMission(req.user.id, req.params.id, req.body?.title);
    if (result.error) return res.status(result.code).json({ error: result.error });
    res.json(result);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Unable to rename mission.' }); }
});

app.delete('/api/missions/:id', async (req, res) => {
  try {
    const result = await deleteMission(req.user.id, req.params.id);
    if (result.error) return res.status(result.code).json({ error: result.error });
    // Remove cached results and streams for a deleted run.
    const run = runs.get(req.params.id);
    if (run && run.userId === req.user.id) {
      for (const client of run.clients) client.end();
      runs.delete(req.params.id);
    }
    res.json(result);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Unable to delete mission.' }); }
});

app.patch('/api/tasks/:id', async (req, res) => {
  try {
    const result = await updateTask(req.user.id, req.params.id, req.body?.status);
    if (result.error) return res.status(result.code).json({ error: result.error });
    res.json({ task: result.task });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Unable to save task status.' }); }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const result = await deleteTask(req.user.id, req.params.id);
    if (result.error) return res.status(result.code).json({ error: result.error });
    res.json(result);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Unable to delete task.' }); }
});

app.get('/api/config', (_req, res) => res.json({ models: MODELS, maxIterations: MAX_ITER }));

app.post('/api/start', async (req, res) => {
  const objective = String(req.body?.objective ?? '').trim();
  const model = String(req.body?.model ?? MODELS[0]);
  const iterations = Math.floor(Number(req.body?.maxIterations) || 5);

  if (objective.length < 5 || objective.length > 300)
    return res.status(400).json({ error: 'Objective must be 5 to 300 characters.' });
  if (!MODELS.includes(model))
    return res.status(400).json({ error: 'Model not allowed.' });
  const active = [...runs.values()].filter((r) => !r.done).length;
  if (active >= MAX_ACTIVE_RUNS)
    return res.status(429).json({ error: 'Too many agents running. Try again shortly.' });

  const runId = crypto.randomUUID();
  const run = { id: runId, events: [], clients: new Set(), objective, model, done: false, agent: null, userId: req.user.id };
  try { await createMission(req.user.id, runId, objective); } catch (err) { console.error(err); return res.status(500).json({ error: 'Could not save mission.' }); }
  run.agent = new BabyAGI({
    objective,
    model,
    maxIterations: Math.min(Math.max(iterations, 1), MAX_ITER),
    apiKey: "ollama",
    emit: (event, data) => publish(run, event, data),
  });
  runs.set(runId, run);
  Promise.resolve().then(() => run.agent.run()).catch(err => { console.error(err); publish(run, 'status', { state: 'error', message: 'Mission execution failed.' }); }); // fire and forget
  res.status(201).json({ runId });
});

app.get('/api/stream/:id', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run || run.userId !== req.user.id) return res.status(404).end();
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  for (const { event, data } of run.events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  if (run.done) return res.end();
  run.clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { clearInterval(ping); run.clients.delete(res); });
});

app.post('/api/stop/:id', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run || run.userId !== req.user.id) return res.status(404).json({ error: 'Run not found.' });
  run.agent.stop();
  res.json({ ok: true });
});

app.get('/api/download/:id', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run || run.userId !== req.user.id) return res.status(404).json({ error: 'Run not found.' });
  const results = run.agent.results;
  if (req.query.format === 'json') {
    res.set('Content-Disposition', 'attachment; filename="taskpilot-results.json"');
    return res.json({ objective: run.objective, model: run.model, results });
  }
  const md = [`# ${run.objective}`, `Model: ${run.model}`, '']
    .concat(results.map((r, i) => `## ${i + 1}. ${r.name}\n\n${r.result}\n`))
    .join('\n');
  res.set({ 'Content-Type': 'text/markdown', 'Content-Disposition': 'attachment; filename="taskpilot-results.md"' });
  res.send(md);
});

// Drop finished runs after an hour
setInterval(() => {
  for (const [id, run] of runs) if (run.done && run.clients.size === 0 && Date.now() - (run.finishedAt ??= Date.now()) > 3600e3) runs.delete(id);
}, 600e3).unref();

await initAuth();
await initTasks();
await initCalendar();
app.listen(PORT, '0.0.0.0', () => console.log(`TaskPilot running at http://localhost:${PORT}`));
