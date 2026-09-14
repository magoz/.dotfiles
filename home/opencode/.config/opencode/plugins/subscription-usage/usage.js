// Provider payload conventions mirror the Pi footer; no Pi imports, auth files,
// account switching or inference calls. Only sanitized quota data leaves here.
const record = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v) => typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const left = (used) => Math.max(0, Math.min(100, 100 - used));
const date = (v) => typeof v === 'string' ? number(Date.parse(v)) : undefined;
export function windows(provider, payload, now = Date.now()) {
  if (!record(payload)) return [];
  if (provider === 'anthropic') return [['five_hour', '5h'], ['seven_day', '7d']].flatMap(([key, label]) => {
    const w = payload[key];
    return record(w) && number(w.utilization) !== undefined ? [{ label, left: left(w.utilization), reset: date(w.resets_at) }] : [];
  });
  if (provider === 'openai' && record(payload.rate_limit)) return [['primary_window', '5h'], ['secondary_window', '7d']].flatMap(([key, label]) => {
    const w = payload.rate_limit[key];
    if (!record(w) || number(w.used_percent) === undefined) return [];
    const absolute = number(w.reset_at), relative = number(w.reset_after_seconds);
    return [{ label, left: left(w.used_percent), reset: absolute !== undefined ? absolute * 1000 : relative !== undefined ? now + Math.max(0, relative) * 1000 : undefined }];
  });
  if (provider === 'xai' && record(payload.config) && number(payload.config.creditUsagePercent) !== undefined) {
    const period = payload.config.currentPeriod;
    const label = period?.type === 'USAGE_PERIOD_TYPE_WEEKLY' ? '7d' : period?.type === 'USAGE_PERIOD_TYPE_MONTHLY' ? 'month' : 'usage';
    return [{ label, left: left(payload.config.creditUsagePercent), reset: date(period?.end) }];
  }
  return [];
}
export function format(items, now = Date.now()) {
  return items.map((w) => {
    const minutes = w.reset === undefined ? undefined : Math.ceil((w.reset - now) / 60000);
    const reset = minutes === undefined ? 'reset unknown' : minutes <= 0 ? 'reset pending' : `resets in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    return `${w.label}: ${Math.round(w.left)}% left · ${reset}`;
  }).join('\n');
}
const providers = {
  openai: { url: 'https://chatgpt.com/backend-api/wham/usage', origins: ['https://api.openai.com', 'https://chatgpt.com'], ttl: 300000 },
  anthropic: { url: 'https://api.anthropic.com/api/oauth/usage', origins: ['https://api.anthropic.com'], ttl: 600000 },
  xai: { url: 'https://cli-chat-proxy.grok.com/v1/billing?format=credits', origins: ['https://api.x.ai', 'https://cli-chat-proxy.grok.com'], ttl: 300000 },
};
export function allowedOrigin(provider, definition, credential) {
  const config = providers[provider];
  if (!config) return false;
  const url = definition?.settings?.baseURL ?? definition?.api?.url;
  if (!url) return true;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return false;
    return config.origins.includes(parsed.origin) || (provider === 'anthropic' && credential.methodID === 'claude-pro-max' && parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1');
  } catch { return false; }
}
// Hard retention from the last successful sample; failures never extend it.
export const STALE_RETENTION_MS = 86400000;
export const MAX_RESPONSE_BYTES = 65536;

function cancellable(promise, signal) {
  if (signal.aborted) {
    void Promise.resolve(promise).catch(() => {});
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function cancelBody(body) { if (body) void body.cancel().catch(() => {}); }
export async function readBounded(response, signal) {
  if (!response.body) throw new Error('Missing quota body');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await cancellable(reader.read(), signal);
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Quota response too large');
      chunks.push(value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size));
  } catch (error) { cancel(); throw error; }
  finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}
export function makeUsage(ctx, { fetcher = fetch, now = Date.now, timeoutMs = 15000 } = {}) {
  const cache = new Map(), requests = new Map(), lifetime = new AbortController();
  const unavailable = { status: 'unavailable', text: 'Subscription quota unavailable (requires a supported official OAuth connection).' };
  const fallback = (entry) => entry?.snapshot && now() - entry.snapshot.at < STALE_RETENTION_MS
    ? { status: 'stale', text: `${entry.snapshot.value.text}\n(stale)` } : unavailable;
  return {
    dispose() { lifetime.abort(); cache.clear(); requests.clear(); },
    async get(sessionID, requestSignal) {
      if (lifetime.signal.aborted || requestSignal?.aborted) return unavailable;
      // A new request for this session supersedes its old request, including auth
      // resolution. Different sessions can overlap; only the current cache entry
      // can publish a result, so older completions cannot overwrite newer data.
      requests.get(sessionID)?.abort();
      const owner = new AbortController();
      requests.set(sessionID, owner);
      const signal = AbortSignal.any([lifetime.signal, owner.signal, ...(requestSignal ? [requestSignal] : [])]);
      const wait = (promise) => cancellable(promise, signal);
      try {
        const session = await wait(ctx.session.get({ sessionID }));
        if (session.id !== sessionID || session.location.directory !== ctx.location.directory || session.location.workspaceID !== ctx.location.workspaceID) return unavailable;
        const providerID = session.model?.providerID, config = providers[providerID];
        if (!config) return unavailable;
        const { data: provider } = await wait(ctx.catalog.provider.get({ providerID }));
        if (provider?.id !== providerID || provider.integrationID !== providerID) return unavailable;
        const connection = await wait(ctx.integration.connection.active(provider.integrationID));
        if (!connection || connection.type !== 'credential' || typeof connection.id !== 'string' || !connection.id) return unavailable;
        const credential = await wait(ctx.integration.connection.resolve(connection));
        if (credential?.type !== 'oauth' || typeof credential.access !== 'string' || !credential.access || !allowedOrigin(providerID, provider, credential)) return unavailable;
        const { data: models } = await wait(ctx.catalog.model.list());
        const model = models.find((m) => m.providerID === providerID && m.id === session.model.id);
        if (!model || !allowedOrigin(providerID, model, credential)) return unavailable;
        const account = credential.metadata?.accountID;
        const accountID = typeof account === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(account) ? account : undefined;
        if (account !== undefined && !accountID) return unavailable;
        signal.throwIfAborted();
        const key = JSON.stringify([providerID, connection.id, accountID]), previous = cache.get(key);
        if (previous && now() < previous.until) {
          return previous.fresh && previous.snapshot ? previous.snapshot.value : fallback(previous);
        }
        const entry = { until: 0, fresh: false, snapshot: previous?.snapshot };
        if (entry.snapshot && now() - entry.snapshot.at >= STALE_RETENTION_MS) entry.snapshot = undefined;
        cache.set(key, entry);
        if (cache.size > 128) cache.delete(cache.keys().next().value);
        const current = () => !signal.aborted && cache.get(key) === entry;
        const headers = { Authorization: `Bearer ${credential.access}`, Accept: 'application/json' };
        if (providerID === 'openai' && accountID) headers['ChatGPT-Account-Id'] = accountID;
        if (providerID === 'anthropic') headers['anthropic-beta'] = 'oauth-2025-04-20';
        if (providerID === 'xai') headers['X-XAI-Token-Auth'] = 'xai-grok-cli';
        const fetchSignal = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
        let until = now() + config.ttl;
        try {
          const pending = Promise.resolve(fetcher(config.url, { headers, redirect: 'error', signal: fetchSignal }));
          // Also close a late response from a transport that ignored cancellation.
          void pending.then((response) => { if (fetchSignal.aborted) cancelBody(response.body); }, () => {});
          const response = await cancellable(pending, fetchSignal);
          if (!response.ok) {
            cancelBody(response.body);
            if (response.status === 429) {
              const raw = response.headers.get('retry-after'), seconds = Number(raw);
              const retry = raw && Number.isFinite(seconds) ? now() + Math.max(0, seconds) * 1000 : date(raw);
              if (retry) until = Math.max(until, Math.min(retry, now() + 86400000));
            }
            throw new Error('Quota HTTP failure');
          }
          const text = await readBounded(response, fetchSignal);
          const items = windows(providerID, JSON.parse(text), now());
          if (!items.length) throw new Error('Unknown quota payload');
          if (!current()) return unavailable;
          const value = { status: 'available', text: format(items, now()) };
          entry.snapshot = { at: now(), value };
          entry.fresh = true;
          entry.until = now() + config.ttl;
          return value;
        } catch {
          // Provider failures (including timeout/body/parse) share one fallback.
          // Auth failures are outside this scope; caller/unload cancellation must
          // neither publish a result nor install a failure backoff.
          if (!current()) return unavailable;
          entry.until = until;
          return fallback(entry);
        }
      } catch { return unavailable; }
      finally { if (requests.get(sessionID) === owner) requests.delete(sessionID); }
    },
  };
}
