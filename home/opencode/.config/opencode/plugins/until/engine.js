// Server-side watch engine for one plugin location. Owns timers, checks, wake delivery and
// persistence. Every state change is written to plugin storage, so watches survive Esc,
// plugin reloads and server restarts; wakes carry a persisted message ID, so a retried or
// replayed wake is admitted at most once by OpenCode's inbox.
import {
  MAX_ACTIVE_PER_SESSION, MAX_FINISHED_PER_SESSION, advanceAfterTick, coalescePastDue, hashCondition,
  initialFacts, messageID, notifyToast, recurringWake, terminalWake, wakeOf, watchID,
} from './domain.js';

export const STORAGE_PREFIX = 'watch/';
const STORAGE_VERSION = 1;
const MAX_TIMER_MS = 2 ** 31 - 1;
/** Wake admission retries. Safe: the message ID is fixed, so a duplicate is the same inbox item. */
const RETRY_DELAYS_MS = [0, 1000, 5000, 30000];
const EXECUTION_END = new Set(['session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted']);

const keyOf = (sessionID, id) => `${STORAGE_PREFIX}${sessionID}/${id}`;
const sameLocation = (a, b) => a?.directory === b?.directory && (a?.workspaceID ?? undefined) === (b?.workspaceID ?? undefined);
const message = (error) => (error instanceof Error ? error.message : String(error));

const STATUSES = new Set(['running', 'succeeded', 'timedOut', 'completed', 'expired', 'cancelled', 'failed']);
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.length > 0;
const isTime = (value) => Number.isFinite(value) && value >= 0;
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const isGate = (gate) => isObject(gate) && isText(gate.command) && isText(gate.cwd) && isTime(gate.checkTimeoutMs) && gate.checkTimeoutMs > 0;
const isWake = (wake) => isObject(wake) && isText(wake.messageID) && isText(wake.text) && typeof wake.description === 'string';

/** Parses a stored record at the boundary; anything malformed is dropped rather than half-run. */
function isStoredWatch(value) {
  if (!isObject(value) || value.v !== STORAGE_VERSION || !isText(value.id) || !isText(value.sessionID)) return false;
  if (!isObject(value.location) || !isText(value.location.directory)) return false;
  if (value.origin !== undefined && !(isObject(value.origin) && isText(value.origin.sessionID) && (value.origin.title === undefined || typeof value.origin.title === 'string'))) return false;
  const d = value.definition, f = value.facts;
  if (!isObject(d) || !isText(d.label) || !isTime(d.intervalMs) || d.intervalMs < 1000) return false;
  if (d.expiresAt !== undefined && !isTime(d.expiresAt)) return false;
  if (d.kind === 'until') {
    if (!isGate(d.gate) || (d.wake !== 'agent' && d.wake !== 'notify')) return false;
  } else if (d.kind === 'recurring') {
    if ((d.gate !== undefined && !isGate(d.gate)) || !isTime(d.expiresAt) || (d.first !== 'now' && d.first !== 'afterInterval')) return false;
    const s = d.snapshot;
    if (!isObject(s) || !isText(s.instruction) || !isText(s.quickRef) || !Array.isArray(s.contextRefs)
      || !s.contextRefs.every((ref) => isObject(ref) && isText(ref.label) && isText(ref.target))) return false;
  } else return false;
  if (!isObject(f) || !STATUSES.has(f.status) || !isTime(f.startedAt) || !isTime(f.nextDueAt)) return false;
  if (![f.attempts, f.deliveries, f.missedTicks, f.reloads].every(isCount)) return false;
  if (value.delivery !== undefined && !(isWake(value.delivery) && (value.delivery.state === 'queued' || value.delivery.state === 'delivering'))) return false;
  if (value.notice !== undefined && !(isObject(value.notice) && isText(value.notice.messageID) && ['pending', 'sent', 'failed'].includes(value.notice.state))) return false;
  return value.notice?.state !== 'pending' || isWake(value.notice);
}

export class Watches {
  /**
   * @param {object} deps
   * @param {{ directory: string, workspaceID?: string }} deps.location this plugin instance's location
   * @param {(gate: object, signal: AbortSignal) => Promise<{ code: number, killed: boolean }>} deps.run
   * @param {(input: object) => Promise<unknown>} deps.synthetic `ctx.session.synthetic`
   * @param {(sessionID: string) => Promise<unknown>} [deps.waitIdle] `ctx.session.wait`
   * @param {(sessionID: string) => Promise<boolean | undefined>} [deps.sessionExists] undefined when unknown
   * @param {{ get, set, remove, scan }} deps.storage plugin storage
   * @param {(name: 'changed' | 'notify', data: object) => void} [deps.emit] UI events
   */
  constructor({ location, run, synthetic, waitIdle = async () => {}, sessionExists = async () => undefined, storage, telemetry, emit = () => {}, now = Date.now, timers = globalThis, retryDelays = RETRY_DELAYS_MS }) {
    Object.assign(this, { location, run, synthetic, waitIdle, sessionExists, storage, telemetry, emit, now, timers, retryDelays });
    this.entries = new Map();
    /** `closed`: no new work. `drained`: unload finished; storage is no longer written. */
    this.closed = false;
    this.drained = false;
    this.lifetime = new AbortController();
    this.pending = new Set();
  }

  // ---- persistence and notification -------------------------------------------------------

  track(promise) {
    this.pending.add(promise);
    const forget = () => this.pending.delete(promise);
    promise.then(forget, forget);
    return promise;
  }

  save(entry) {
    // Writes continue while unloading drains, so a wake admitted during the drain is recorded as sent.
    if (this.drained) return;
    const { watch } = entry, value = JSON.parse(JSON.stringify(watch));
    entry.saving = this.track((entry.saving ?? Promise.resolve()).then(() => this.storage.set(keyOf(watch.sessionID, watch.id), value)).catch(() => {}));
  }

  forget(entry) {
    const { watch } = entry;
    this.entries.delete(keyOf(watch.sessionID, watch.id));
    entry.saving = this.track((entry.saving ?? Promise.resolve()).then(() => this.storage.remove(keyOf(watch.sessionID, watch.id))).catch(() => {}));
  }

  changed(entry, persist = true) {
    if (persist) this.save(entry);
    for (const waiter of entry.waiters.splice(0)) waiter();
    if (!this.closed) {
      try { this.emit('changed', { sessionID: entry.watch.sessionID }); } catch { /* UI is optional */ }
    }
  }

  record(sessionID, event) { this.telemetry?.record(sessionID, event); }

  startedEvent(watch, resumed) {
    const d = watch.definition;
    return {
      event: 'started', id: watch.id, kind: d.kind, label: d.label, wake: wakeOf(d), resumed, fromSubagent: watch.origin !== undefined,
      intervalMs: d.intervalMs, checkTimeoutMs: d.gate?.checkTimeoutMs ?? 0, conditionHash: hashCondition(d.gate?.command ?? ''),
      ...(d.expiresAt === undefined ? {} : { timeoutMs: d.expiresAt - watch.facts.startedAt }),
    };
  }

  // ---- lifecycle --------------------------------------------------------------------------

  /**
   * Loads this location's watches. Running ones resume, in-flight recurring wakes are resent with
   * their own ID (admitted at most once), and pending wakes are resent. A `start` watch whose
   * deadline passed while nothing owned it wakes the agent as timed out; a recurrence that expired
   * meanwhile finishes silently (its packet only says to stop). Throws only if storage cannot be read.
   */
  async restore() {
    const stored = [];
    let after;
    do {
      const page = await this.storage.scan({ prefix: STORAGE_PREFIX, ...(after ? { after } : {}), limit: 500 });
      for (const { value } of page.entries) if (isStoredWatch(value) && sameLocation(value.location, this.location)) stored.push(value);
      after = page.next;
    } while (after && !this.closed);
    const gone = new Set();
    for (const sessionID of new Set(stored.filter((w) => w.facts.status === 'running' || w.notice?.state === 'pending').map((w) => w.sessionID))) {
      if ((await this.sessionExists(sessionID).catch(() => undefined)) === false) gone.add(sessionID);
    }
    const resumed = new Map();
    const now = this.now();
    for (const watch of stored) {
      if (this.closed) return;
      const key = keyOf(watch.sessionID, watch.id);
      if (this.entries.has(key)) continue;
      const entry = { watch, waiters: [] };
      this.entries.set(key, entry);
      if (gone.has(watch.sessionID)) { this.forget(entry); continue; }
      if (watch.facts.status !== 'running') {
        if (watch.notice?.state === 'pending') void this.sendNotice(entry);
        continue;
      }
      const d = watch.definition;
      if (d.expiresAt !== undefined && d.expiresAt <= now) {
        if (d.kind === 'until') { this.finish(entry, 'timedOut'); continue; }
        delete watch.delivery;
        watch.facts = { ...watch.facts, status: 'expired', finishedAt: d.expiresAt };
        this.save(entry);
        this.finishedEvent(watch);
        continue;
      }
      watch.facts = { ...watch.facts, reloads: watch.facts.reloads + 1 };
      this.save(entry);
      this.record(watch.sessionID, this.startedEvent(watch, true));
      resumed.set(watch.sessionID, (resumed.get(watch.sessionID) ?? 0) + 1);
      if (watch.delivery) void this.resendTick(entry);
      this.schedule(entry);
    }
    for (const [sessionID, count] of resumed) {
      this.record(sessionID, { event: 'resumed', count });
      try { this.emit('changed', { sessionID }); } catch { /* UI is optional */ }
    }
  }

  async dispose() {
    this.closed = true;
    this.lifetime.abort();
    for (const entry of this.entries.values()) this.stop(entry);
    // Settled work may queue more writes (a wake admitted mid-drain is saved as sent).
    while (this.pending.size) await Promise.allSettled([...this.pending]);
    this.drained = true;
  }

  stop(entry) {
    this.timers.clearTimeout(entry.timer); entry.timer = undefined;
    this.timers.clearTimeout(entry.expiry); entry.expiry = undefined;
    entry.controller?.abort();
    for (const waiter of entry.waiters.splice(0)) waiter();
  }

  // ---- public operations ------------------------------------------------------------------

  /**
   * Starts a watch owned by (and waking) `sessionID`. `inline` defers its terminal wake while the
   * starting tool call is still waiting; `origin` names the subagent session that armed it.
   */
  start(sessionID, definition, { inline = false, origin } = {}) {
    if (this.closed) throw new Error('until is reloading; retry in a moment');
    const running = this.list(sessionID).filter((w) => w.facts.status === 'running');
    if (running.length >= MAX_ACTIVE_PER_SESSION) throw new Error(`At most ${MAX_ACTIVE_PER_SESSION} active until watches per session; cancel one first`);
    let id;
    do id = watchID(); while (this.entries.has(keyOf(sessionID, id)));
    const now = this.now();
    const watch = { v: STORAGE_VERSION, id, sessionID, location: { ...this.location }, ...(origin ? { origin } : {}), definition, facts: initialFacts(definition, now) };
    const entry = { watch, waiters: [], inline };
    this.entries.set(keyOf(sessionID, id), entry);
    this.save(entry);
    this.record(sessionID, this.startedEvent(watch, false));
    this.schedule(entry);
    this.changed(entry, false);
    return watch;
  }

  /** Resolves once the first check has run, the watch finished, or `ms` passed; then wakes are normal again. */
  async settleInline(sessionID, id, ms, signal) {
    const entry = this.entries.get(keyOf(sessionID, id));
    if (!entry) return undefined;
    const done = () => this.closed || entry.watch.facts.status !== 'running' || (entry.watch.facts.attempts > 0 && !entry.checking);
    await new Promise((resolve) => {
      let timer;
      const finish = () => { this.timers.clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
      timer = this.timers.setTimeout(finish, ms);
      signal?.addEventListener('abort', finish, { once: true });
      const check = () => { if (done()) finish(); else entry.waiters.push(check); };
      check();
    });
    entry.inline = false;
    return { watch: entry.watch, answered: entry.watch.facts.status !== 'running' };
  }

  list(sessionID) {
    return [...this.entries.values()].map((e) => e.watch).filter((w) => w.sessionID === sessionID)
      .sort((a, b) => Number(b.facts.status === 'running') - Number(a.facts.status === 'running') || b.facts.startedAt - a.facts.startedAt);
  }

  get(sessionID, id) {
    const entry = this.entries.get(keyOf(sessionID, id));
    if (!entry) throw new Error(`Unknown until watch in this session: ${id}. Run until action=list to see watch IDs.`);
    return entry;
  }

  phase(sessionID, id) {
    const entry = this.entries.get(keyOf(sessionID, id));
    if (!entry || entry.watch.facts.status !== 'running') return undefined;
    if (entry.checking) return 'checking';
    if (entry.watch.delivery) return entry.watch.delivery.state === 'queued' ? 'queued' : 'delivering';
    return 'sleeping';
  }

  cancel(sessionID, id) {
    const entry = this.get(sessionID, id);
    this.finish(entry, 'cancelled');
    return entry.watch;
  }

  complete(sessionID, id) {
    const entry = this.get(sessionID, id);
    if (entry.watch.definition.kind !== 'recurring') throw new Error(`Watch ${id} is not recurring; use action=cancel to stop it`);
    this.finish(entry, 'completed');
    return entry.watch;
  }

  /** Session events: deletion forgets watches; inbox and execution events settle recurring wakes. */
  handleEvent(event) {
    const sessionID = event?.data?.sessionID;
    if (typeof sessionID !== 'string') return;
    const owned = [...this.entries.values()].filter((e) => e.watch.sessionID === sessionID);
    if (!owned.length) return;
    if (event.type === 'session.deleted') {
      for (const entry of owned) { this.stop(entry); this.forget(entry); }
      return;
    }
    const inboxID = event.data.inboxID;
    for (const entry of owned) {
      const delivery = entry.watch.delivery;
      if (!delivery || entry.watch.facts.status !== 'running') continue;
      if (event.type === 'session.inbox.delivered' && delivery.messageID === inboxID && delivery.state === 'queued') {
        entry.watch.delivery = { ...delivery, state: 'delivering' };
        this.changed(entry);
        // Belt and braces for a missed execution-end event: settle once the loop is idle.
        this.settleWhenIdle(entry);
      } else if (event.type === 'session.inbox.cancelled' && delivery.messageID === inboxID) {
        this.settle(entry, delivery.messageID);
      } else if (EXECUTION_END.has(event.type) && delivery.state === 'delivering') {
        this.settle(entry, delivery.messageID);
      }
    }
  }

  /** After an event-stream gap, in-flight recurring wakes settle when their session is idle. */
  resync() {
    for (const entry of this.entries.values()) if (entry.watch.delivery && entry.watch.facts.status === 'running') this.settleWhenIdle(entry);
  }

  /** Settles the current recurring wake once the session's loop is idle; one wait per wake. */
  settleWhenIdle(entry) {
    const messageID = entry.watch.delivery?.messageID;
    if (!messageID || entry.idleWait === messageID || this.closed) return;
    entry.idleWait = messageID;
    const done = () => { if (entry.idleWait === messageID) entry.idleWait = undefined; };
    this.waitIdle(entry.watch.sessionID, this.lifetime.signal)
      .then(() => this.settle(entry, messageID), () => {})
      .finally(done);
  }

  // ---- scheduling -------------------------------------------------------------------------

  schedule(entry) {
    if (this.closed) return;
    const { watch } = entry, now = this.now();
    this.timers.clearTimeout(entry.timer); entry.timer = undefined;
    if (watch.facts.status !== 'running') return;
    const expiresAt = watch.definition.expiresAt;
    if (expiresAt !== undefined && entry.expiry === undefined) {
      entry.expiry = this.timers.setTimeout(() => {
        entry.expiry = undefined;
        if (this.now() >= expiresAt) this.expire(entry); else this.schedule(entry);
      }, Math.min(MAX_TIMER_MS, Math.max(0, expiresAt - now)));
    }
    if (watch.delivery) return; // A recurring wake is in flight; settlement reschedules.
    entry.timer = this.timers.setTimeout(() => { entry.timer = undefined; void this.tick(entry); }, Math.min(MAX_TIMER_MS, Math.max(0, watch.facts.nextDueAt - now)));
  }

  async tick(entry) {
    const { watch } = entry, d = watch.definition;
    if (this.closed || watch.facts.status !== 'running' || entry.checking || watch.delivery) return;
    if (d.expiresAt !== undefined && this.now() >= d.expiresAt) return this.expire(entry);
    if (watch.facts.nextDueAt > this.now()) return this.schedule(entry);
    if (!d.gate) return this.deliverTick(entry);
    entry.checking = true;
    entry.controller = new AbortController();
    watch.facts = { ...watch.facts, attempts: watch.facts.attempts + 1 };
    this.changed(entry, false);
    let result;
    try {
      result = await this.run(d.gate, entry.controller.signal);
    } catch (error) {
      entry.checking = false;
      if (watch.facts.status === 'running' && !this.closed) this.finish(entry, 'failed', message(error));
      return;
    }
    entry.checking = false;
    if (watch.facts.status !== 'running' || this.closed) return;
    const at = this.now(), passed = result.code === 0 && !result.killed;
    watch.facts = { ...watch.facts, lastCheckedAt: at, lastResult: { code: result.code, killed: result.killed } };
    if (d.kind === 'until') {
      if (passed) return this.finish(entry, 'succeeded');
      watch.facts = { ...watch.facts, nextDueAt: at + d.intervalMs };
    } else if (passed) {
      return this.deliverTick(entry);
    } else {
      watch.facts = advanceAfterTick(watch.facts, d.intervalMs, at);
    }
    this.changed(entry);
    this.schedule(entry);
  }

  async deliverTick(entry) {
    const { watch } = entry, now = this.now();
    watch.facts = advanceAfterTick({ ...watch.facts, deliveries: watch.facts.deliveries + 1 }, watch.definition.intervalMs, now);
    // The payload is persisted, so a restart resends this exact wake instead of skipping or stacking it.
    watch.delivery = { messageID: messageID(now), state: 'queued', ...recurringWake(watch, now) };
    this.changed(entry);
    await this.sendTick(entry);
  }

  async sendTick(entry) {
    const { watch } = entry, delivery = watch.delivery;
    if (!delivery) return;
    const admitted = await this.deliver(watch, {
      id: delivery.messageID, text: delivery.text, description: delivery.description,
      metadata: { source: 'until', watchID: watch.id, kind: 'recurring', delivery: watch.facts.deliveries },
    });
    if (admitted === false && watch.delivery?.messageID === delivery.messageID && watch.facts.status === 'running') {
      this.finish(entry, 'failed', 'could not queue the recurring wake');
    }
    return admitted;
  }

  /** After a restart: re-admit the in-flight wake (a no-op if OpenCode already has it), then settle when idle. */
  async resendTick(entry) {
    if ((await this.sendTick(entry)) === true) this.settleWhenIdle(entry);
  }

  settle(entry, messageID) {
    const { watch } = entry;
    if (watch.delivery?.messageID !== messageID || watch.facts.status !== 'running') return;
    delete watch.delivery;
    watch.facts = coalescePastDue(watch.facts, watch.definition.intervalMs, this.now());
    this.changed(entry);
    this.schedule(entry);
  }

  expire(entry) {
    this.finish(entry, entry.watch.definition.kind === 'until' ? 'timedOut' : 'expired');
  }

  finish(entry, status, failure) {
    const { watch } = entry, d = watch.definition, now = this.now();
    if (watch.facts.status !== 'running') return;
    this.stop(entry);
    entry.checking = false;
    let facts = { ...watch.facts, status, finishedAt: now, ...(failure ? { failure } : {}) };
    if (status === 'expired') facts = coalescePastDue(facts, d.intervalMs, d.expiresAt ?? now);
    watch.facts = facts;
    delete watch.delivery;
    // A result the starting tool call is still waiting for is answered inline, never woken.
    const wake = entry.inline ? undefined : terminalWake(watch, now);
    if (wake) watch.notice = { messageID: messageID(now), state: 'pending', ...wake };
    this.changed(entry);
    this.finishedEvent(watch);
    const toast = entry.inline ? undefined : notifyToast(watch);
    if (toast && !this.closed) {
      try { this.emit('notify', { sessionID: watch.sessionID, ...toast }); } catch { /* UI is optional */ }
    }
    if (wake) void this.sendNotice(entry);
    this.prune(watch.sessionID);
  }

  finishedEvent(watch) {
    const { definition: d, facts: f } = watch;
    this.record(watch.sessionID, {
      event: 'finished', id: watch.id, kind: d.kind, status: f.status, wake: wakeOf(d), attempts: f.attempts,
      deliveries: f.deliveries, missedTicks: f.missedTicks, reloads: f.reloads, durationMs: (f.finishedAt ?? this.now()) - f.startedAt,
      conditionHash: hashCondition(d.gate?.command ?? ''),
      ...(f.lastResult ? { lastExitCode: f.lastResult.code, lastCheckKilled: f.lastResult.killed } : {}),
    });
  }

  prune(sessionID) {
    const finished = this.list(sessionID).filter((w) => w.facts.status !== 'running' && w.notice?.state !== 'pending')
      .sort((a, b) => (b.facts.finishedAt ?? 0) - (a.facts.finishedAt ?? 0));
    for (const watch of finished.slice(MAX_FINISHED_PER_SESSION)) this.forget(this.entries.get(keyOf(sessionID, watch.id)));
  }

  // ---- wake delivery ----------------------------------------------------------------------

  async sendNotice(entry) {
    const { watch } = entry, notice = watch.notice;
    if (!notice || notice.state !== 'pending') return;
    const admitted = await this.deliver(watch, {
      id: notice.messageID, text: notice.text, description: notice.description,
      metadata: { source: 'until', watchID: watch.id, kind: watch.definition.kind, status: watch.facts.status },
    });
    if (admitted === undefined || watch.notice !== notice) return; // Unloading: the next generation resends it.
    watch.notice = admitted ? { messageID: notice.messageID, state: 'sent' } : { ...notice, state: 'failed' };
    this.changed(entry);
  }

  /** Resolves true after `ms`, or false as soon as the engine unloads. */
  sleep(ms) {
    const signal = this.lifetime.signal;
    if (signal.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
      const abort = () => { this.timers.clearTimeout(timer); resolve(false); };
      const timer = this.timers.setTimeout(() => { signal.removeEventListener('abort', abort); resolve(true); }, ms);
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  /** Queues a synthetic wake with retries. Resolves true/false, or undefined when unloading. */
  async deliver(watch, { id, text, description, metadata }) {
    for (const delay of this.retryDelays) {
      if (delay && !(await this.sleep(delay))) return undefined;
      if (this.closed) return undefined;
      try {
        await this.track(this.synthetic({ sessionID: watch.sessionID, id, text, description, metadata, delivery: 'queue', resume: true }));
        return true;
      } catch { /* retried below with the same ID */ }
    }
    return this.closed ? undefined : false;
  }
}
