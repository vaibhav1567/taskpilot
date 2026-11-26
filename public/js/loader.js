// Load all four views before initializing scripts that access their elements.
(async () => {
  try {
    const me = await fetch('/api/auth/me');
    if (!me.ok) { location.replace('/login'); return; }
    const { user } = await me.json();
    document.getElementById('accountEmail').textContent = user.email;
    window.TASKPILOT_USER_ID = user.id;
    document.getElementById('logoutBtn').onclick = async () => { await fetch('/api/auth/logout', { method: 'POST' }); location.replace('/login'); };
    const names = ['mission', 'dashboard', 'results', 'history'];
    const html = await Promise.all(names.map(async name => {
      const response = await fetch(`/tabs/${name}.html`);
      if (!response.ok) throw new Error(`Could not load ${name} tab (${response.status})`);
      return response.text();
    }));
    document.getElementById('tabContent').innerHTML = html.join('\n');
    for (const file of ['shared', 'scene', 'render', 'history', 'results', 'mission', 'dashboard', 'suggestions', 'calendar']) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `/js/${file}.js`;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Could not load ${file}.js`));
        document.body.appendChild(script);
      });
    }
  } catch (error) {
    document.getElementById('tabContent').textContent = `Failed to initialize TaskPilot: ${error.message}`;
    console.error(error);
  }
})();
