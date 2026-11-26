/* Rotating, curated mission ideas. Never changes a user's typed objective. */
(() => {
  const suggestions = [
    'Build a personal portfolio website', 'Plan a product launch',
    'Create a weekly study schedule', 'Organize a community event',
    'Design a habit tracking app', 'Prepare for a job interview',
    'Create a small business budget', 'Plan a weekend trip',
    'Build a REST API with authentication', 'Design a customer feedback survey',
    'Create a marketing content calendar', 'Plan a fitness routine',
    'Research competitors for a startup', 'Create a project timeline',
    'Build a simple expense tracker', 'Plan a college presentation',
    'Design an online store', 'Create an email newsletter',
    'Organize a reading challenge', 'Plan a fundraising campaign',
    'Build a task management dashboard', 'Create a social media strategy',
    'Plan a team workshop', 'Prepare a research report',
    'Set up a personal knowledge base', 'Develop a mobile app prototype',
    'Plan a home renovation', 'Create a customer onboarding process',
    'Organize an online webinar', 'Build a study flashcard app'
  ];
  const container = document.getElementById('missionSuggestions');
  const refresh = document.getElementById('refreshSuggestions');
  const objective = document.getElementById('objective');
  if (!container || !objective) return;

  let deck = [];
  let last = [];
  const shuffle = array => {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  };
  const refill = () => {
    deck = shuffle(suggestions.filter(item => !last.includes(item)));
    // The next batch must not repeat the previous one.
    if (deck.length < 3) deck.push(...shuffle(suggestions.filter(item => !deck.includes(item))));
  };
  const showSuggestions = () => {
    if (deck.length < 3) refill();
    const next = deck.splice(0, 3);
    last = next;
    container.replaceChildren(...next.map(value => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chip';
      button.textContent = value;
      button.addEventListener('click', () => {
        if (objective.disabled) return;
        objective.value = value;
        objective.focus();
      });
      return button;
    }));
  };
  refresh?.addEventListener('click', showSuggestions);
  showSuggestions();
  // Cycle suggestions while the user is on Mission Control; pause on hover/focus.
  const timer = window.setInterval(() => {
    const mission = document.getElementById('mission');
    if (document.hidden || !mission?.classList.contains('on')) return;
    if (container.matches(':hover') || container.contains(document.activeElement)) return;
    showSuggestions();
  }, 15000);
  window.addEventListener('pagehide', () => window.clearInterval(timer), { once: true });
})();
