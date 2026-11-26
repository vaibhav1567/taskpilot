import OpenAI from 'openai';

/**
 * BabyAGI: three chains in a loop.
 *   1. creation      -> new tasks from the objective + latest result
 *   2. prioritization -> reorder the whole list
 *   3. execution     -> do the top task, feed result into next cycle
 */
export class BabyAGI {
  /**
   * @param {object} opts
   * @param {string} opts.objective
   * @param {string} opts.model
   * @param {number} opts.maxIterations
   * @param {string} opts.apiKey
   * @param {(event: string, data: object) => void} opts.emit
   */
  constructor({ objective, model, maxIterations, apiKey, emit }) {
    this.objective = objective;
    this.model = model;
    this.maxIterations = maxIterations;
    this.emit = emit;
    this.client = new OpenAI({
      apiKey: apiKey || "ollama",
      baseURL: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434/v1",
      maxRetries: 0,
      timeout: 200000,
    });
    this.tasks = [];      // [{ id, name }]
    this.results = [];    // [{ id, name, result }]
    this.nextId = 1;
    this.stopped = false;
  }

  stop() { this.stopped = true; }

  async #ask(system, user, { json = false } = {}) {
    const res = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0.4,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    return res.choices[0].message.content?.trim() ?? '';
  }

  #recentContext(n = 3) {
    return this.results
      .slice(-n)
      .map((r) => `Task: ${r.name}\nResult: ${r.result.slice(0, 1200)}`)
      .join('\n\n') || 'Nothing done yet.';
  }

  // Chain 1: task creation
  async createTasks(lastTask, lastResult) {
    const raw = await this.#ask(
      'You are a task creation AI. Respond ONLY with JSON: {"tasks": ["task", ...]}.',
      `Objective: ${this.objective}
Last completed task: ${lastTask}
Its result: ${lastResult.slice(0, 1500)}
Incomplete tasks: ${JSON.stringify(this.tasks.map((t) => t.name))}
All completed tasks: ${JSON.stringify(this.results.map((r) => r.name))}

Create at most 4 NEW tasks that move the objective forward. Do not repeat completed or incomplete tasks. Return {"tasks": []} if the objective is met.`,
      { json: true }
    );
    try {
      const list = JSON.parse(raw).tasks;
      return Array.isArray(list) ? list.filter((t) => typeof t === 'string' && t.trim()) : [];
    } catch { return []; }
  }

  // Chain 2: task prioritization
  async prioritizeTasks() {
    if (this.tasks.length < 2) return;
    const raw = await this.#ask(
      'You are a task prioritization AI. Respond ONLY with JSON: {"order": [ids]}.',
      `Objective: ${this.objective}
Tasks: ${JSON.stringify(this.tasks)}

Return every task id exactly once, most important and relevant to the objective first.`,
      { json: true }
    );
    try {
      const order = JSON.parse(raw).order;
      const byId = new Map(this.tasks.map((t) => [t.id, t]));
      const sorted = order.map((id) => byId.get(Number(id))).filter(Boolean);
      const missing = this.tasks.filter((t) => !sorted.includes(t));
      this.tasks = [...sorted, ...missing];
    } catch { /* keep the existing order if the model returns bad JSON */ }
  }

  // Chain 3: execution
  async execute(task) {
    return this.#ask(
      'You are an AI that completes one task at a time as part of a larger objective. Be concrete and practical; include code when useful. Keep answers under 400 words.',
      `Objective: ${this.objective}
Earlier work:
${this.#recentContext()}

Your task: ${task.name}`
    );
  }

  #publishTasks() {
    this.emit('tasks', { tasks: this.tasks });
  }

  async run() {
    this.tasks = [{ id: this.nextId++, name: `Make a plan for: ${this.objective}` }];
    this.emit('status', { state: 'running' });
    this.#publishTasks();

    try {
      for (let i = 1; i <= this.maxIterations && !this.stopped; i++) {
        if (!this.tasks.length) break;

        const task = this.tasks.shift();
        this.emit('start', { iteration: i, task });
        this.#publishTasks();

        const result = await this.execute(task);
        if (this.stopped) break;
        this.results.push({ id: task.id, name: task.name, result });
        this.emit('result', { iteration: i, task, result });

        const created = await this.createTasks(task.name, result);
        for (const name of created) this.tasks.push({ id: this.nextId++, name });
        await this.prioritizeTasks();
        this.#publishTasks();
      }
      this.emit('status', {
        state: this.stopped ? 'stopped' : 'finished',
        completed: this.results.length,
      });
    } catch (err) {
      this.emit('status', { state: 'error', message: err?.message || 'Unknown error' });
    }
  }
}
