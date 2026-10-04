// Server <-> TUI contract. Portable JSON schemas; the server validates session ownership.
const string = { type: 'string', minLength: 1, maxLength: 16384 };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const session = { sessionID: string };
const count = { type: 'integer', minimum: 0 };
const time = { type: 'number', minimum: 0 };

export const watchView = object({
  id: string, kind: { enum: ['until', 'recurring'] }, label: string,
  status: { enum: ['running', 'succeeded', 'timedOut', 'completed', 'expired', 'cancelled', 'failed'] },
  phase: { enum: ['checking', 'sleeping', 'queued', 'delivering'] }, wake: { enum: ['agent', 'notify'] },
  attempts: count, deliveries: count, missedTicks: count, startedAt: time, nextDueAt: time,
  finishedAt: time, expiresAt: time, failure: string, wakeFailed: { type: 'boolean' },
}, ['id', 'kind', 'label', 'status', 'wake', 'attempts', 'deliveries', 'missedTicks', 'startedAt', 'nextDueAt']);

// Expected failures (unknown ID, bad condition) come back as `error`: undeclared RPC handler
// errors reach the TUI only as a generic internal failure.
const outcome = object({ id: string, label: string, status: string, text: string, error: string }, []);

export const definition = {
  id: 'dotfiles-until',
  methods: {
    list: { input: object(session), output: object({ watches: { type: 'array', items: watchView } }) },
    start: { input: object({ ...session, condition: string }), output: outcome },
    cancel: { input: object({ ...session, id: string }), output: outcome },
    complete: { input: object({ ...session, id: string }), output: outcome },
    status: { input: object({ ...session, id: string }), output: outcome },
    stats: { input: object({}), output: outcome },
  },
  events: {
    changed: { schema: object(session) },
    notify: { schema: object({ ...session, title: string, message: string, variant: { enum: ['success', 'warning', 'error', 'info'] } }) },
  },
};

/** Compact UI view of a stored watch (timestamps in ms; no condition, cwd or task text). */
export function view(watch, phase) {
  const { definition: d, facts: f } = watch;
  return {
    id: watch.id, kind: d.kind, label: d.label, status: f.status, wake: d.kind === 'until' ? d.wake : 'agent',
    attempts: f.attempts, deliveries: f.deliveries, missedTicks: f.missedTicks, startedAt: f.startedAt, nextDueAt: f.nextDueAt,
    ...(phase ? { phase } : {}),
    ...(f.finishedAt === undefined ? {} : { finishedAt: f.finishedAt }),
    ...(d.expiresAt === undefined ? {} : { expiresAt: d.expiresAt }),
    ...(f.failure ? { failure: f.failure.slice(0, 500) } : {}),
    ...(watch.notice?.state === 'failed' ? { wakeFailed: true } : {}),
  };
}
