import { spawn } from 'node:child_process';

export function withoutPaneEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('HERDR_')));
}

// Never use shell:true. CLI arguments are argv; only an explicitly approved
// until condition uses /bin/sh -c. No detached process group survives cancellation.
export function runProcess(command, args, { cwd, env, signal, timeoutMs, capture = 'none', maxBytes = 65536, cleanupGraceMs = 250 }) {
  if (process.platform === 'win32') return Promise.reject(new Error('POSIX process groups required'));
  signal?.throwIfAborted();
  if (!Number.isInteger(cleanupGraceMs) || cleanupGraceMs < 250 || cleanupGraceMs > 10000) throw new Error('Invalid cleanup grace');
  return new Promise((resolve, reject) => {
    let stdout = '', stderr = '', bytes = 0, code = null, failure;
    let ended = false, cleaning = false, cleanupTimer;
    const child = spawn(command, args, {
      cwd, env, detached: true,
      stdio: ['ignore', capture === 'stdout' || capture === 'both' ? 'pipe' : 'ignore', capture === 'both' ? 'pipe' : 'ignore'],
    });
    const killGroup = (sig) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, sig); } catch (error) {
        if (error.code !== 'ESRCH') failure ??= new Error('Process group cleanup failed');
      }
    };
    const settle = () => {
      clearTimeout(deadline);
      signal?.removeEventListener('abort', abort);
      child.stdout?.destroy(); child.stderr?.destroy();
      if (failure) reject(failure);
      else resolve({ code, stdout, stderr });
    };
    const cleanup = () => {
      if (cleaning) return;
      cleaning = true;
      killGroup('SIGTERM');
      // Keep this timer referenced, even if the leader exits before its resistant
      // descendants. Wait the full grace period before a final group SIGKILL.
      cleanupTimer = setTimeout(() => { killGroup('SIGKILL'); settle(); }, cleanupGraceMs);
    };
    const abort = () => { failure ??= new Error('Process cancelled; inspect partial resources before retrying'); cleanup(); };
    const deadline = setTimeout(() => {
      failure ??= new Error('Process timed out; inspect partial resources before retrying'); cleanup();
    }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const collect = (channel, data) => {
      bytes += data.length;
      if (bytes > maxBytes) { failure ??= new Error('Process output exceeded limit'); cleanup(); return; }
      if (channel === 'stdout') stdout += data.toString(); else stderr += data.toString();
    };
    child.stdout?.on('data', (data) => collect('stdout', data));
    child.stderr?.on('data', (data) => collect('stderr', data));
    child.on('error', () => {
      failure ??= new Error('Unable to start process');
      if (!child.pid) { clearTimeout(cleanupTimer); clearTimeout(deadline); signal?.removeEventListener('abort', abort); reject(failure); }
      else cleanup();
    });
    child.on('close', (exitCode) => { if (ended) return; ended = true; code = exitCode; cleanup(); });
  });
}
