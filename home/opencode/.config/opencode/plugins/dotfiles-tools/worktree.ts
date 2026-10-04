// Pure `create_worktree` helpers shared by the server (tool) and the TUI (confirmation, pane run).
import type { ResolvedInput, WorktreeInput } from "./contract.ts"

export const LINK_GUIDANCE =
  "Investigate repository instructions, configured app directory, Git remote, and authenticated Vercel projects/teams. Verify connected repository and rootDirectory; never select by name alone. Link only an unambiguous existing project/team with explicit verified arguments. Keep .vercel ignored/untracked; do not follow symlinks, expose credentials, create a remote project, deploy, or change remote settings. Ask the user if selection or authentication is uncertain. Then retry identical create_worktree arguments; never blindly retry a failed allocation."
export const BASE_GUIDANCE =
  "Omit base for freshly fetched origin default-branch commit. Only specify base when explicitly requested or a freshly verified immutable SHA; never bypass a failed fetch with a local base."

/** Uses an explicit branch, else infers a conventional one from the kickoff prompt. Throws when neither yields one. */
export function resolveInput(value: WorktreeInput): ResolvedInput {
  let branch = value.branch?.trim()
  if (!branch && value.prompt?.trim()) {
    const task = value.prompt.trim()
    const prefix = /\b(fix|bug|broken|error|repair|regression)\b/i.test(task) ? "fix" : "feat"
    const slug = task
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/^(?:please\s+)?(?:create|start|make|open)\s+(?:a\s+)?(?:new\s+)?worktree\s+(?:to|for)\s+/i, "")
      .replace(/^(?:add|build|create|fix|implement|repair)\s+(?:a\s+|an\s+|the\s+)?/i, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 52)
      .replace(/-+$/g, "")
    if (slug) branch = `${prefix}/${slug}`
  }
  if (!branch) throw new Error("Provide a branch or a kickoff prompt")
  return { ...value, branch }
}

/** `worktree` argv for the resolved input; always OpenCode, JSON, and the server-resolved repo. */
export function buildArgs(input: WorktreeInput, cwd: string): string[] {
  const resolved = resolveInput(input)
  const args = ["create", "--agent", "opencode", "--json", "--repo", cwd, "--branch", resolved.branch]
  for (const name of ["base", "path", "label", "ttl", "prompt"] as const) {
    const value = resolved[name]
    if (value) args.push(`--${name}`, value)
  }
  for (const command of resolved.setup ?? []) args.push("--setup", command)
  return args
}
