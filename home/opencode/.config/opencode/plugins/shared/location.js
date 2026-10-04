// RPC call location for a session's `location` (TUI side): the native query key is `workspace`.
export function rpcLocation(location) {
  return { directory: location.directory, ...(location.workspaceID ? { workspace: location.workspaceID } : {}) };
}
