// Discovery and project selection belong to the current Pi agent, not to a
// provider-specific resolver hidden inside provisioning or a nested agent.
export const VERCEL_LINK_GUIDANCE =
  "For create_worktree, proactively resolve a missing Vercel link using the current Pi agent: " +
  "inspect repository instructions, the configured app directory, Git remote, and authenticated Vercel projects/teams. " +
  "Check authentication non-interactively and verify the project's connected repository and rootDirectory against the app; " +
  "do not infer identity from names alone. " +
  "When the existing project and team are unambiguous, link the reported app directory without asking for permission " +
  "(use explicit verified project/team arguments, not blind `vercel link --yes`). " +
  "Keep .vercel ignored and untracked; never follow symlinks, print credentials/env values, create a remote project, " +
  "deploy, or change remote project settings as part of linking. " +
  "Ask the user only when project/team selection is genuinely uncertain or Vercel authentication/access is needed. " +
  "After linking, retry create_worktree with the same arguments; do not stop at reporting the missing link.";

export interface VercelLinkRequired {
  readonly status: "vercel_link_required";
  readonly directory: string;
  readonly reason: string;
}

export function parseVercelLinkRequired(stderr: string): VercelLinkRequired | undefined {
  try {
    const value: unknown = JSON.parse(stderr.trim());
    if (
      typeof value === "object" && value !== null &&
      "status" in value && value.status === "vercel_link_required" &&
      "directory" in value && typeof value.directory === "string" && value.directory.length > 0 &&
      "reason" in value && typeof value.reason === "string" && value.reason.length > 0
    ) {
      return { status: value.status, directory: value.directory, reason: value.reason };
    }
  } catch {
    // Unknown failures are ordinary errors, never instructions to link a project.
  }
  return undefined;
}
