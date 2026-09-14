import { randomUUID } from 'node:crypto';
import { untilInput, validate } from './schema.js';
import { withoutPaneEnv } from './process.js';

export function untilOptions(input) {
  validate(untilInput, input);
  if (input.action !== 'start' || !input.command?.trim()) throw new Error('start requires a shell condition');
  if (input.id !== undefined) throw new Error('start assigns its own ID');
  const options = { ...input, intervalMs: input.intervalMs ?? 5000, timeoutMs: input.timeoutMs ?? 10000, runtimeMs: input.runtimeMs ?? 3600000 };
  if (options.timeoutMs > options.runtimeMs) throw new Error('timeoutMs must not exceed runtimeMs');
  return options;
}

export class UntilJobs {
  constructor({ run, synthetic, env, now = Date.now, schedule = setTimeout, unschedule = clearTimeout }) {
    this.run = run; this.synthetic = synthetic; this.env = withoutPaneEnv(env);
    this.now = now; this.schedule = schedule; this.unschedule = unschedule;
    this.jobs = new Map(); this.running = new Set(); this.closed = false;
  }
  view(job) {
    // Commands, cwd, stdout and stderr are deliberately absent from status/wakes.
    return { id: job.id, state: job.state, checks: job.checks, created: job.created, deadline: job.deadline };
  }
  owned(sessionID, id) {
    const job = this.jobs.get(id);
    if (!job || job.sessionID !== sessionID) throw new Error('Unknown until job in this session');
    return job;
  }
  list(sessionID) { return [...this.jobs.values()].filter((job) => job.sessionID === sessionID).map((job) => this.view(job)); }
  start(sessionID, cwd, input) {
    if (this.closed) throw new Error('Until unavailable');
    const options = untilOptions(input);
    const owned = [...this.jobs.values()].filter((job) => job.sessionID === sessionID);
    if (owned.filter((job) => ['running', 'waking'].includes(job.state)).length >= 8) throw new Error('At most 8 active until jobs per session');
    // Bound retained terminal history, without evicting live or waking jobs.
    for (const job of owned.filter((job) => !['running', 'waking'].includes(job.state)).slice(0, Math.max(0, owned.length - 63))) this.jobs.delete(job.id);
    if (this.jobs.size >= 1024) throw new Error('Until job capacity reached');
    const job = {
      id: randomUUID(), sessionID, cwd, options, created: this.now(), deadline: this.now() + options.runtimeMs,
      state: 'running', checks: 0, controller: new AbortController(), wakeAttempted: false,
    };
    this.jobs.set(job.id, job);
    job.expiry = this.schedule(() => this.stop(job, 'expired'), options.runtimeMs);
    job.timer = this.schedule(() => { void this.check(job); }, 0);
    return this.view(job);
  }
  stop(job, state = 'cancelled') {
    if (!['running', 'waking'].includes(job.state)) return;
    job.state = state;
    this.unschedule(job.timer); this.unschedule(job.expiry);
    job.controller.abort();
  }
  cancel(sessionID, id) { const job = this.owned(sessionID, id); this.stop(job); return this.view(job); }
  cancelSession(sessionID, created = Infinity) {
    for (const job of this.jobs.values()) if (job.sessionID === sessionID && job.created <= created) this.stop(job);
  }
  deleteSession(sessionID) {
    this.cancelSession(sessionID);
    for (const job of this.jobs.values()) if (job.sessionID === sessionID) this.jobs.delete(job.id);
  }
  async track(promise) {
    this.running.add(promise);
    try { return await promise; } finally { this.running.delete(promise); }
  }
  async check(job) {
    if (job.state !== 'running') return;
    if (this.now() >= job.deadline) { this.stop(job, 'expired'); return; }
    try {
      job.checks++;
      const result = await this.track(this.run('/bin/sh', ['-c', job.options.command], {
        cwd: job.cwd, env: this.env, signal: job.controller.signal,
        timeoutMs: Math.min(job.options.timeoutMs, job.deadline - this.now()), capture: 'none',
      }));
      if (job.state !== 'running') return;
      if (this.now() >= job.deadline) { this.stop(job, 'expired'); return; }
      if (result.code === 0) {
        job.state = 'waking'; job.wakeAttempted = true;
        // One enqueue attempt with a stable message ID. No retry on ambiguous
        // transport failure; this prevents duplicate synthetic resumptions.
        await this.track(this.synthetic({
          sessionID: job.sessionID, id: `msg_${job.id.replaceAll('-', '')}`,
          text: `until condition satisfied (job ${job.id}). Continue the task.`,
          description: 'until condition satisfied', delivery: 'queue', resume: true,
          metadata: { dotfilesUntilID: job.id },
        }, { signal: AbortSignal.any([job.controller.signal, AbortSignal.timeout(10000)]) }));
        if (job.state === 'waking') { job.state = 'succeeded'; this.unschedule(job.expiry); }
        return;
      }
      job.timer = this.schedule(() => { void this.check(job); }, job.options.intervalMs);
    } catch {
      if (['running', 'waking'].includes(job.state)) this.stop(job, job.wakeAttempted ? 'wake_failed' : 'failed');
    }
  }
  async dispose() {
    this.closed = true;
    for (const job of this.jobs.values()) this.stop(job);
    this.jobs.clear();
    await Promise.allSettled([...this.running]);
  }
}
