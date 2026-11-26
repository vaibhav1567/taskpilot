const Scene3D = (() => {
  if (!window.THREE) return { sync(){} };
  let renderer; try { renderer = new THREE.WebGLRenderer({ canvas: $('scene'), antialias:true, alpha:true }); } catch { return { sync(){} }; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(50, 1, .1, 100); cam.position.set(0, 1.6, 8);
  const group = new THREE.Group(); scene.add(group);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color:0xC28B5C, wireframe:true }));
  const glow = new THREE.Mesh(new THREE.SphereGeometry(.62, 24, 24), new THREE.MeshBasicMaterial({ color:0xC28B5C, transparent:true, opacity:.35 }));
  group.add(core, glow);
  const sp = new Float32Array(900); for (let i = 0; i < 900; i++) sp[i] = (Math.random() - .5) * 40;
  const stars = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(sp, 3)), new THREE.PointsMaterial({ size:.04, color:0xBDAA98 }));
  scene.add(stars);
  const COLORS = { queued:0xA48B77, running:0xDCA56B, done:0x9FB68A };
  const nodes = new Map(); let mx = 0, my = 0, n = 0;
  addEventListener('mousemove', (e) => { mx = e.clientX / innerWidth - .5; my = e.clientY / innerHeight - .5; });

  function ensure(id, state){
    let o = nodes.get(id);
    if (!o){
      const i = n++, ring = i % 3, mesh = new THREE.Mesh(new THREE.SphereGeometry(.17, 16, 16), new THREE.MeshBasicMaterial({ color:COLORS[state] }));
      const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color:COLORS[state], transparent:true, opacity:.45 }));
      group.add(mesh, line);
      o = { mesh, line, a:i * 1.05, r:2.2 + ring * .85, y:Math.sin(i * 1.7) * 1.1, sp:(.25 - ring * .05) * (i % 2 ? 1 : -1), state };
      nodes.set(id, o);
    }
    if (o.state !== state){ o.state = state; o.mesh.material.color.setHex(COLORS[state]); o.line.material.color.setHex(COLORS[state]); }
  }
  function sync(){
    S.tasks.forEach(t => ensure(t.id, 'queued'));
    if (S.current) ensure(S.current.id, 'running');
    S.results.forEach(r => ensure(r.id, 'done'));
  }
  function reset(){ nodes.forEach(o => group.remove(o.mesh, o.line)); nodes.clear(); n = 0; }

  const clock = new THREE.Clock();
  (function loop(){
    requestAnimationFrame(loop);
    const dt = clock.getDelta(), t = clock.elapsedTime, run = S.status === 'running';
    const W = innerWidth, H = innerHeight; renderer.setSize(W, H, false); cam.aspect = W / H;
    const st = document.querySelector('.view.on .stage');
    const r = st ? st.getBoundingClientRect() : { left:W * .55, width:W * .4, top:H * .4, height:0 };
    cam.setViewOffset(W, H, W / 2 - (r.left + r.width / 2), H / 2 - (r.top + r.height / 2), W, H);
    cam.updateProjectionMatrix();
    group.rotation.y += dt * (run ? .45 : .15);
    group.rotation.x += ((my * .5) - group.rotation.x) * .04; group.position.x += (mx * .6 - group.position.x) * .04;
    core.rotation.x += dt * .3; core.rotation.z += dt * .2;
    const s = 1 + Math.sin(t * (run ? 5 : 1.5)) * (run ? .09 : .04); glow.scale.setScalar(s);
    core.material.color.setHex(run ? 0xDCA56B : S.status === 'finished' ? 0x9FB68A : 0xC28B5C); glow.material.color.copy(core.material.color);
    nodes.forEach(o => {
      o.a += dt * o.sp; o.mesh.position.set(Math.cos(o.a) * o.r, o.y, Math.sin(o.a) * o.r);
      const p = o.line.geometry.attributes.position; p.setXYZ(1, o.mesh.position.x, o.mesh.position.y, o.mesh.position.z); p.needsUpdate = true;
      o.mesh.scale.setScalar(o.state === 'running' ? 1.4 + Math.sin(t * 6) * .3 : 1);
    });
    stars.rotation.y += dt * .01;
    renderer.render(scene, cam);
  })();
  return { sync, reset };
})();
