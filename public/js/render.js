function setStatus(state, text){
  S.status = state; $('dot').className = 'dot ' + state; $('sideText').textContent = text;
}
function log(html){
  const f = $('feed'); if (f.firstChild?.textContent === 'Waiting for a mission.') f.innerHTML = '';
  const d = document.createElement('div'); d.innerHTML = `<em>${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</em> ${html}`;
  f.prepend(d);
}
function drawQueue(){
  const items = (S.current ? [`<li class="now">${esc(S.current.name)}</li>`] : []).concat(S.tasks.map(t => `<li>${esc(t.name)}</li>`));
  $('queue').innerHTML = items.join(''); $('qEmpty').hidden = items.length > 0;
  $('qEmpty').textContent = S.status === 'idle' ? 'Tasks appear here once the agent starts.' : 'Queue is empty.';
}
function drawResults(list, objective){
  $('resList').innerHTML = list.length ? list.map((r, i) => `<div class="res"><h3><span>${i + 1}. ${esc(r.name)}</span><small>${words(r.result)} words</small></h3><div class="body">${fmt(r.result)}</div></div>`).join('') : '<p class="empty">Results show up here as each task finishes.</p>';
  $('dlMd').disabled = $('dlJson').disabled = !list.length;
}
function tickTime(){
  const s = Math.floor((Date.now() - S.t0) / 1000); // Mission timer is no longer shown on the personal dashboard.
}
function refresh(){ drawQueue(); Scene3D.sync(); }
