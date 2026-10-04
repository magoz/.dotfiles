// Runs one condition check in its own process group. Output is discarded at the OS level.
// A check that runs past its timeout, or is aborted, is terminated and counts as false
// (`killed: true`); only a spawn failure rejects.
import { spawn } from 'node:child_process';
import { withoutPaneEnv } from '../dotfiles-tools/process.js';

const FORCE_KILL_DELAY_MS = 1000;

export function createCheckRunner({ env = process.env, shell = env.SHELL || '/bin/sh' } = {}) {
  // The server's inherited Herdr pane identity is never the user's pane; conditions never see it.
  const childEnv = withoutPaneEnv(env);
  const active = new Set();
  const run = ({ command, cwd, checkTimeoutMs }, signal) => {
    const task = new Promise((resolve, reject) => {
      const child = spawn(shell, ['-c', command], { cwd, env: childEnv, detached: true, stdio: 'ignore' });
      let killed = false, settled = false, forceKill;
      const signalGroup = (sig) => { try { if (child.pid) process.kill(-child.pid, sig); } catch { /* group already gone */ } };
      const finish = (result, error) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline); clearTimeout(forceKill);
        signal?.removeEventListener('abort', terminate);
        if (error) reject(error); else resolve(result);
      };
      function terminate() {
        if (settled || killed) return;
        killed = true;
        signalGroup('SIGTERM');
        forceKill = setTimeout(() => { signalGroup('SIGKILL'); finish({ code: 1, killed: true }); }, FORCE_KILL_DELAY_MS);
      }
      const deadline = setTimeout(terminate, checkTimeoutMs);
      signal?.addEventListener('abort', terminate, { once: true });
      if (signal?.aborted) terminate();
      child.once('error', (error) => finish(undefined, new Error(`could not start condition: ${error.message}`)));
      child.once('exit', (code) => {
        if (killed) return;
        // Reap descendants that outlived the leader; the condition's verdict is the leader's.
        signalGroup('SIGKILL');
        finish({ code: code ?? 1, killed: false });
      });
    });
    active.add(task);
    const forget = () => active.delete(task);
    task.then(forget, forget);
    return task;
  };
  return { run, drain: () => Promise.allSettled([...active]) };
}
