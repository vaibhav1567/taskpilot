const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = (s) => esc(s).replace(/```[\w-]*\n([\s\S]*?)```/g, (_, c) => `</div><pre>${c}</pre><div class="body">`);
const words = (s) => s.trim().split(/\s+/).length;

/* ---------- state ---------- */
const S = { runId:null, es:null, objective:'', model:'', max:5, tasks:[], current:null, results:[], t0:0, status:'idle', timer:null };

/* ---------- navigation ---------- */
function show(v){
  document.querySelectorAll('.view').forEach(e => e.classList.toggle('on', e.id === v));
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  if (v === 'history') drawHistory();
  if (v === 'dash' && typeof loadPersonalTasks === 'function') loadPersonalTasks();
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => show(b.dataset.view));
// Suggestion click handlers are managed by suggestions.js after the views load.

document.addEventListener('mousemove', (e) => {
  const p = e.target.closest?.('[data-tilt]');
  document.querySelectorAll('[data-tilt]').forEach(el => { if (el !== p) el.style.transform = ''; });
  if (!p || matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  const r = p.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
  p.style.transform = `perspective(900px) rotateX(${(-y*4).toFixed(2)}deg) rotateY(${(x*5).toFixed(2)}deg) translateZ(4px)`;
});
