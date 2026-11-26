fetch('/api/config').then(r => r.json()).then(c => { $('model').innerHTML = c.models.map(m => `<option>${esc(m)}</option>`).join(''); $('iters').max = c.maxIterations; });

function running(on){ $('start').disabled = on; $('stop').disabled = !on; ['objective','model','iters'].forEach(i => $(i).disabled = on); }
const friendly = (m) => /401|api key/i.test(m) ? 'OpenAI rejected the API key. Check OPENAI_API_KEY in .env (it should start with sk-) and restart the server.' : m;

$('start').onclick = async () => {
  $('err').textContent = '';
  const body = { objective:$('objective').value, model:$('model').value, maxIterations:Number($('iters').value) };
  const res = await fetch('/api/start', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok){ $('err').textContent = data.error; return; }
  Object.assign(S, { runId:data.runId, objective:body.objective.trim(), model:body.model, max:body.maxIterations, tasks:[], current:null, results:[], t0:Date.now(), viewing:null });
  Scene3D.reset?.(); $('feed').innerHTML = ''; drawResults([]); $('resSub').textContent = S.objective;
  running(true); setStatus('running', 'Starting…'); clearInterval(S.timer); S.timer = setInterval(tickTime, 1000); refresh();

  S.es = new EventSource('/api/stream/' + S.runId);
  S.es.addEventListener('tasks', e => { S.tasks = JSON.parse(e.data).tasks; refresh(); if (typeof loadPersonalTasks === 'function') loadPersonalTasks(); });
  S.es.addEventListener('start', e => {
    const d = JSON.parse(e.data); S.current = d.task; setStatus('running', `Step ${d.iteration} of ${S.max}`);
    log(`Started: ${esc(d.task.name)}`); refresh(); if (typeof loadPersonalTasks === 'function') loadPersonalTasks();
  });
  S.es.addEventListener('result', e => {
    const d = JSON.parse(e.data); S.results.push({ id:d.task.id, name:d.task.name, result:d.result }); S.current = null;
    log(`Finished step ${d.iteration}: ${esc(d.task.name)}`); drawResults(S.results); refresh();
  });
  S.es.addEventListener('status', e => {
    const s = JSON.parse(e.data); if (s.state === 'running') return;
    const text = { finished:`Finished: ${s.completed} tasks`, stopped:'Stopped', error:'Error' }[s.state];
    setStatus(s.state, text); S.current = null; running(false); clearInterval(S.timer); S.es.close();
    if (s.state === 'error'){ const m = friendly(s.message || 'Something went wrong.'); $('err').textContent = m; log(esc(m)); }
    else log(text); saveH(); refresh();
  });
};
$('stop').onclick = () => { fetch('/api/stop/' + S.runId, { method:'POST' }); setStatus('running', 'Stopping after this step…'); };
refresh();
