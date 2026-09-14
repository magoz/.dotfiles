import { randomUUID } from 'node:crypto';
import { bridgeDefinition, validate, outcome } from './schema.js';

export class Bridge {
  constructor({ now = Date.now, leaseMs = 6000 } = {}) {
    this.now = now; this.leaseMs = leaseMs;
    this.clients = new Map(); this.requests = new Map(); this.closed = false;
    this.timer = setInterval(() => this.sweep(), 1000);
  }
  live(rootID) {
    return [...this.clients.values()].filter((client) => client.rootID === rootID && this.now() - client.seen < this.leaseMs);
  }
  sweep() {
    for (const [id, client] of this.clients) if (this.now() - client.seen >= this.leaseMs) this.clients.delete(id);
    for (const request of this.requests.values()) {
      const live = this.live(request.rootID);
      if (live.length !== 1 || live[0].clientID !== request.clientID || this.now() >= request.deadline) {
        this.fail(request, 'Client absent, ambiguous, or request expired; inspect partial resources before retrying');
      }
    }
  }
  fail(request, reason) {
    this.requests.delete(request.id);
    clearTimeout(request.timer);
    request.detach?.();
    request.reject(new Error(reason));
  }
  request({ sessionID, rootID, cwd, kind, input }, timeoutMs, signal) {
    if (signal?.aborted) return Promise.reject(new Error('Operation cancelled'));
    if (this.closed) return Promise.reject(new Error('Bridge unavailable'));
    this.sweep();
    const clients = this.live(rootID);
    if (clients.length !== 1) return Promise.reject(new Error('Exactly one live TUI on the root session is required'));
    if ([...this.requests.values()].some((request) => request.rootID === rootID)) return Promise.reject(new Error('Another pane operation is pending'));
    return new Promise((resolve, reject) => {
      const request = {
        id: randomUUID(), sessionID, rootID, cwd, kind, input,
        clientID: clients[0].clientID, created: this.now(), deadline: this.now() + timeoutMs,
        claimed: false, resolve, reject,
      };
      request.timer = setTimeout(() => this.fail(request, 'Request expired; inspect partial resources before retrying'), timeoutMs);
      this.requests.set(request.id, request);
      const abort = () => this.fail(request, 'Operation cancelled; inspect partial resources');
      request.detach = () => signal?.removeEventListener('abort', abort);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
  pulse(input) {
    validate(bridgeDefinition.methods.pulse.input, input);
    if (this.closed) throw new Error('Bridge unavailable');
    this.sweep();
    const old = this.clients.get(input.clientID);
    if (old && old.rootID !== input.rootID) this.release(old);
    this.clients.set(input.clientID, { ...input, seen: this.now() });
    this.sweep();
    const requests = [...this.requests.values()].filter((request) => request.clientID === input.clientID && request.rootID === input.rootID);
    const next = requests.find((request) => !request.claimed);
    if (next) next.claimed = true; // Claim is atomic before returning, never reissued.
    return {
      request: next ? {
        id: next.id, sessionID: next.sessionID, rootID: next.rootID, cwd: next.cwd, kind: next.kind, input: next.input,
      } : null,
      active: requests.map((request) => request.id),
    };
  }
  authorize(input) {
    validate(bridgeDefinition.methods.authorize.input, input);
    this.sweep();
    const request = this.requests.get(input.id);
    return { authorized: !this.closed && !!request && request.claimed && request.clientID === input.clientID && request.rootID === input.rootID };
  }
  complete(input) {
    validate(bridgeDefinition.methods.complete.input, input);
    outcome(input.outcome);
    this.sweep();
    const request = this.requests.get(input.id);
    if (!request || !request.claimed || request.clientID !== input.clientID || request.rootID !== input.rootID) return { acknowledged: false };
    const status = input.outcome.status;
    if (status === 'ready' && input.outcome.destination.branch !== request.input.branch) throw new Error('Destination branch mismatch');
    if ((request.kind === 'until' && !['approved', 'failed'].includes(status)) ||
        (request.kind === 'worktree' && status === 'approved')) throw new Error('Wrong outcome kind');
    this.requests.delete(request.id); clearTimeout(request.timer); request.detach?.();
    request.resolve(input.outcome);
    return { acknowledged: true };
  }
  release(input) {
    validate(bridgeDefinition.methods.release.input, { clientID: input.clientID, rootID: input.rootID });
    const client = this.clients.get(input.clientID);
    if (!client || client.rootID !== input.rootID) return { released: false };
    this.clients.delete(input.clientID);
    for (const request of this.requests.values()) if (request.clientID === input.clientID) this.fail(request, 'TUI disposed or route changed; inspect partial resources');
    return { released: true };
  }
  cancelSession(sessionID, created = Infinity) {
    // No sticky abort controller: an old interruption cannot poison a later run.
    for (const request of this.requests.values()) if (request.sessionID === sessionID && request.created <= created) {
      this.fail(request, 'Session interrupted or deleted; inspect partial resources before retrying');
    }
  }
  dispose() {
    this.closed = true; clearInterval(this.timer);
    for (const request of this.requests.values()) this.fail(request, 'Plugin unloaded; inspect partial resources');
    this.clients.clear();
  }
}
