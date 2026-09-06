# Worktree handoff and manager

This Pi extension provides the structured `create_worktree` handoff tool and the
interactive `/worktrees` dashboard. The dashboard combines Git worktree state
with Herdr workspaces, Pi agents, provisioned environments, and sandbox database
leases without reading or displaying secret environment values.

## Agent-owned Vercel linking

Before allocating a worktree, `create_worktree` runs
`provision-env --check-vercel-link --non-interactive` against the source checkout.
This only validates/reuses local app identity; it does not install dependencies,
pull env files, allocate databases, query Vercel, or choose a remote project.

An absent or ambiguous link returns `vercel_link_required`, the app directory,
and the original retry arguments to the **current Pi agent**, without terminating
its turn or creating a partial worktree. The agent inspects repository guidance,
Git and Vercel project/team evidence, links an unambiguous existing project, and
retries `create_worktree` automatically. It asks only when selection is uncertain
or authentication/access requires the user. Linking must not create a remote
project, deploy, change project settings, or expose secrets.

Unknown preflight failures remain errors. Source shutdown still happens only
after the destination Pi has launched successfully. Direct CLI and dashboard
provisioning remain deterministic; they do not spawn agents for discovery.

## Dashboard keybindings

```text
↑↓/jk  select                     Enter  focus workspace
 a     create through the handoff  o      open/focus in Herdr
 p     start or focus Pi            m      prompt a selected Pi
 n     renew both database leases   v      provision missing environment
 f     fetch and prune origin       d      coordinated retirement
 c     load path into Pi's editor   r      refresh
 q/Esc close
```

## Coordinated retirement

Retirement is lifecycle-aware rather than a raw `git worktree remove`. Before
removing anything, it refuses the current or primary checkout, dirty Git state,
and working, blocked, or unknown Pi agents. It then rechecks the worktree and
both authoritative sandbox database slots (`default` and `test`).

For every recorded sandbox database, retirement runs `sandbox-db release`
**before** removing the Herdr workspace and Git worktree. A release deletes the
provisioned Neon branch, removes its leased database URL keys from the worktree's
environment file, and removes the local lease record. If database cleanup cannot
be authenticated or safely completed, retirement stops and preserves the
worktree.

`sandbox-db` independently refuses to delete a project default branch, a
protected branch, a branch in another project, or a branch without its guarded
`agent/` prefix. Expiration remains a cleanup backstop for an inaccessible lease.

Optional local branch deletion uses only `git branch -d`; neither worktrees nor
branches are ever force-deleted.
