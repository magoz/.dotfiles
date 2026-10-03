// The launcher (DESIGN.md "Launcher and worktrees"), in OpenCode's own dialogs: pick a repository
// or worktree (fuzzy select over `GET /api/fleet/launcher`) to open its latest root session, or
// `+ New worktree in <repo>…` → task → editable suggested branch → `POST /api/fleet/launches`.
// The launch's progress shows in the sidebar; `createLaunchWatch` lands in its session when ready.
import { launcherOptions } from './fleet.js';

/** Route identity for "has the user navigated since". */
export const routeKey = (route) => route.type === 'session' ? `session:${route.sessionID}`
  : route.type === 'plugin' ? `plugin:${route.name}` : route.type;

/**
 * Runs the launcher once. `openSession(id)` navigates; `onLaunched({ launchID, branch, repoName })`
 * hands a started launch to the watch; `alive()` is false once the plugin is disposed.
 */
export async function runLauncher({ ctx, api, openSession, onLaunched, alive = () => true }) {
  const toast = (variant, message) => { if (alive()) ctx.ui.toast.show({ variant, message }); };
  const list = await api.launcher();
  if (!alive()) return;
  if (!list.ok) return toast('error', `Fleet launcher unavailable: ${list.error}`);
  if (!list.value.length) return toast('info', 'Fleet lists no repositories');
  const choice = await ctx.ui.dialog.select({
    title: 'Fleet: New / open', placeholder: 'Repositories and worktrees',
    options: launcherOptions(list.value, (p) => ctx.ui.format?.path?.(p) ?? p),
  });
  if (!alive() || !choice) return;

  if (choice.kind === 'open') {
    const opened = await api.openCheckout(choice.directory);
    if (!alive()) return;
    if (opened.ok) {
      if (opened.value.created) toast('info', `New session in ${choice.name}`);
      return openSession(opened.value.sessionID);
    }
    // A Fleet without the open route: resume the checkout's latest root session from the list.
    if (opened.missing && choice.latestSession) return openSession(choice.latestSession);
    return toast('error', `Could not open ${choice.name}: ${opened.error}`);
  }

  const task = (await ctx.ui.dialog.prompt({
    title: `New worktree in ${choice.repoName}`, description: 'Describe the task; Fleet suggests a branch next', placeholder: 'Task',
  }))?.trim();
  if (!alive() || !task) return;
  toast('info', 'Suggesting a branch…');
  const suggestion = await api.suggestBranch(task);
  if (!alive()) return;
  const branch = (await ctx.ui.dialog.prompt({
    title: `Branch in ${choice.repoName}`,
    description: suggestion.ok
      ? `${suggestion.value.source === 'model' ? 'Suggested' : 'Fallback name'}; edit if needed (type/short-name)`
      : `No suggestion (${suggestion.error}); type/short-name`,
    placeholder: 'feat/short-name', value: suggestion.ok ? suggestion.value.branch : '',
  }))?.trim();
  if (!alive() || !branch) return;
  const started = await api.launch({ repoDir: choice.repoDir, branch, task });
  if (!alive()) return;
  if (!started.ok) return toast('error', `Could not launch ${branch}: ${started.error}`);
  toast('info', `Provisioning ${branch} in ${choice.repoName}…`);
  onLaunched({ launchID: started.value.launchID, branch, repoName: choice.repoName });
}

/**
 * Follows the launches started here through Fleet's `launches`: when one is ready, opens its
 * session if the user is still on the route they launched from, else offers it in a toast (with
 * OpenCode's Open action); a failure toasts.
 */
export function createLaunchWatch({ ctx, openSession }) {
  const watched = new Map();
  const check = (live, launchID) => {
    const watch = watched.get(launchID);
    const launch = live.launches.find((l) => l.id === launchID);
    if (!launch) {
      // Listed once, then gone: dismissed (or Fleet restarted). Never seen yet: not arrived.
      if (watch.seen) watched.delete(launchID);
      return;
    }
    watch.seen = true;
    if (launch.status === 'failed') {
      watched.delete(launchID);
      ctx.ui.toast.show({ variant: 'error', message: `Launch of ${launch.branch} failed: ${launch.error ?? 'unknown error'}` });
      return;
    }
    if (launch.status !== 'ready' || !launch.sessionID) return;
    watched.delete(launchID);
    if (routeKey(ctx.ui.router.current()) === watch.route) openSession(launch.sessionID);
    else ctx.ui.toast.show({ variant: 'success', message: `${launch.branch} is ready`, sessionID: launch.sessionID });
  };
  return {
    start({ launchID }) { watched.set(launchID, { route: routeKey(ctx.ui.router.current()), seen: false }); },
    get size() { return watched.size; },
    check(live) { if (live) for (const launchID of [...watched.keys()]) check(live, launchID); },
    stop() { watched.clear(); },
  };
}
