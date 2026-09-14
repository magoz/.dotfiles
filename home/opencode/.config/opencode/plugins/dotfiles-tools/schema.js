// Portable JSON schemas: accepted directly by V2 Tool.Info and Rpc.PortableDefinition.
export const text = { type: 'string', minLength: 1, maxLength: 16384 };
export const object = (properties, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false,
});
export const array = (items, maxItems = 64) => ({ type: 'array', items, maxItems });
export const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
export const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
export const worktreeInput = object({
  branch: text, base: text, path: text, label: text, ttl: text, prompt: text,
  setup: array(text, 16),
}, []);
export const untilInput = object({
  action: { enum: ['start', 'list', 'status', 'cancel'] },
  id: text, command: text, intervalMs: integer(1000, 60000),
  timeoutMs: integer(100, 60000), runtimeMs: integer(1000, 86400000),
}, ['action']);
export const destinationSchema = object({
  source: text, branch: text, base: text, path: text, workspaceId: text,
  paneId: text, agentName: text, agentKind: { enum: ['opencode'] }, warnings: array(text),
});
export const linkSchema = object({
  status: { enum: ['vercel_link_required'] }, directory: text, reason: text,
});
export const outcomeSchema = object({
  status: { enum: ['ready', 'vercel_link_required', 'approved', 'failed'] },
  destination: destinationSchema, link: linkSchema, reason: text,
  sourceRetained: { enum: [true] },
}, ['status']);
export const worktreeOutputSchema = object({ ...outcomeSchema.properties, retry: worktreeInput }, ['status']);
export const jobSchema = object({
  id: text, state: { enum: ['running', 'waking', 'succeeded', 'cancelled', 'expired', 'failed', 'wake_failed'] },
  checks: integer(0, Number.MAX_SAFE_INTEGER), created: integer(0, Number.MAX_SAFE_INTEGER), deadline: integer(0, Number.MAX_SAFE_INTEGER),
});
export const untilOutputSchema = { anyOf: [jobSchema, array(jobSchema)] };
export const requestSchema = object({
  id: text, sessionID: text, rootID: text, cwd: text,
  kind: { enum: ['worktree', 'until'] }, input: { anyOf: [worktreeInput, untilInput] },
});
const identity = { clientID: text, rootID: text };
export const bridgeDefinition = {
  id: 'dotfiles-tools',
  methods: {
    pulse: {
      input: object(identity),
      output: object({ request: nullable(requestSchema), active: array(text) }),
    },
    authorize: {
      input: object({ ...identity, id: text }),
      output: object({ authorized: { type: 'boolean' } }),
    },
    complete: {
      input: object({ ...identity, id: text, outcome: outcomeSchema }),
      output: object({ acknowledged: { type: 'boolean' } }),
    },
    release: { input: object(identity), output: object({ released: { type: 'boolean' } }) },
  },
  events: {},
};

// Deliberately small validator for the JSON-schema subset above, also used on RPC
// responses: the Promise RPC client does not itself decode portable JSON output.
export function validate(schema, value, path = 'input') {
  if (schema.anyOf) {
    if (schema.anyOf.some((candidate) => {
      try { validate(candidate, value, path); return true; } catch { return false; }
    })) return value;
    throw new Error(`${path}: invalid variant`);
  }
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path}: invalid value`);
  if (schema.type === 'null' && value !== null) throw new Error(`${path}: expected null`);
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}: expected object`);
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) throw new Error(`${path}.${key}: required`);
    }
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, key)) throw new Error(`${path}: unknown field`);
      validate(schema.properties[key], item, `${path}.${key}`);
    }
  }
  if (schema.type === 'string' && (typeof value !== 'string' || value.length < (schema.minLength ?? 0) ||
      value.length > (schema.maxLength ?? Infinity) || value.includes('\0'))) throw new Error(`${path}: invalid string`);
  if (schema.type === 'boolean' && typeof value !== 'boolean') throw new Error(`${path}: expected boolean`);
  if (schema.type === 'integer' && (!Number.isSafeInteger(value) || value < schema.minimum || value > schema.maximum)) {
    throw new Error(`${path}: integer outside bounds`);
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > schema.maxItems) throw new Error(`${path}: invalid array`);
    value.forEach((item, index) => validate(schema.items, item, `${path}[${index}]`));
  }
  return value;
}

export function outcome(value) {
  validate(outcomeSchema, value);
  if (value.status === 'ready' && (!value.destination || value.sourceRetained !== true)) throw new Error('Missing ready destination');
  if (value.status === 'vercel_link_required' && !value.link) throw new Error('Missing link details');
  if (value.status === 'failed' && !value.reason) throw new Error('Missing failure reason');
  return value;
}
