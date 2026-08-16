# sandbox-db

`sandbox-db` provisions short-lived Neon PostgreSQL branches for local Git
worktrees. `provision-env` combines it with dependency installation and pulls
from Vercel's Development and `test` environments.

A disposable branch can start from either:

- the globally configured parent branch, normally a dedicated blank sandbox; or
- a repository-specific baseline branch selected by variables pulled from that
  repository's Vercel Development environment.

Neon clones the selected parent branch's schema and data when it creates the
disposable branch.

## Requirements

- Bun and the package dependencies installed
- Git worktree with ignored `.env.local` and `.env.test` files
- Neon API credential authorized for the selected project
- Vercel CLI authentication and project linkage when using `provision-env`

The launchers are installed by the dotfiles `scripts` package:

```sh
sandbox-db --help
provision-env --help
```

## Recommended: project-local Vercel configuration

For repositories in different Neon accounts, add this complete profile to the
Vercel project's **Development** environment:

```dotenv
SANDBOX_DB_NEON_API_KEY=project-scoped-api-key
SANDBOX_DB_NEON_PROJECT_ID=project-id
SANDBOX_DB_PARENT_BRANCH_ID=baseline-branch-id
```

Use a dedicated project-scoped API key. Keep these variables out of Preview and
Production unless those environments independently require them. The parent
branch should be a non-production, sanitized development baseline suitable for
local cloning.

Keep the profile in Development so both database leases resolve one atomic
credential/project/parent tuple. Configure a readable custom Vercel environment
named `test` for test-specific application variables. Vercel models custom
environments as deployment targets, so their pulls can include generated Git,
deployment, Turborepo, and Nx metadata. `provision-env` removes known
deployment-only variables while preserving explicitly configured application
variables. When `--database` is requested, it also removes any Vercel-provided
`DATABASE_URL` and `DATABASE_URL_UNPOOLED` values before allocating the isolated
sandbox databases. It then publishes both environments as ignored, mode-`0600`
files before calling `sandbox-db`:

```sh
provision-env --repo /path/to/worktree --database
```

An unlinked worktree automatically reuses the Vercel identity when its linked
sibling checkouts all identify the same project. `--source
/path/to/linked-checkout` remains available as an explicit override when sibling
checkouts intentionally use different Vercel projects.

The profile is atomic:

- if all three variables are present, it takes precedence over global auth;
- if none are present, `sandbox-db` falls back to global auth;
- if any variable is missing or empty, provisioning fails rather than combining
  credentials and settings from different accounts.

After resolving the profile, `sandbox-db` creates two independently expiring
branches with `SANDBOX_DB_PARENT_BRANCH_ID` as their Neon `parent_id`. Local
lease records are disposable lookup hints for branch reuse and cleanup, not
locks: a stale record is replaced and its old branch is left to its bounded TTL.
The two slots are:

- the backward-compatible `default` lease writes `DATABASE_URL` and
  `DATABASE_URL_UNPOOLED` to `.env.local`;
- the `test` lease writes independent URLs to `.env.test` while still reading
  its sandbox profile from `.env.local`.

The three `SANDBOX_DB_*` variables remain unchanged so later lifecycle commands
can authenticate. Repository-owned schema preparation remains a separate step.
Run it once for each database when the baseline does not already contain the
required schema, and only use commands known to be safe for isolated databases.

## Global fallback configuration

Global auth remains useful for repositories that share one dedicated sandbox
project:

```sh
sandbox-db auth login \
  --project-id PROJECT_ID \
  --parent-branch PARENT_BRANCH_ID

sandbox-db auth status
```

On macOS, the API key is stored in Keychain. Other systems use a mode-`0600`
configuration file. Non-secret project settings are stored under the XDG config
directory. `NEON_AGENTS_SANDBOX_API_KEY` can override the stored global key for
a parent process or CI environment.

Inspect the profile resolved for a particular worktree with:

```sh
sandbox-db auth status --worktree /path/to/worktree
```

The command verifies both project access and the configured parent branch
without printing the credential.

## Direct lifecycle usage

Create or reuse the default lease for the current worktree:

```sh
sandbox-db create --label issue-123-development --ttl 7d
```

Create an independent named test lease whose profile comes from `.env.local`:

```sh
sandbox-db create \
  --lease test \
  --config-env-file .env.local \
  --env-file .env.test \
  --label issue-123-test \
  --ttl 7d
```

Target another worktree:

```sh
sandbox-db create --worktree /path/to/worktree --label issue-123 --ttl 3d
```

Inspect, renew, and release either slot:

```sh
sandbox-db status --worktree /path/to/worktree --lease test
sandbox-db renew --worktree /path/to/worktree --lease test --ttl 7d
sandbox-db release --worktree /path/to/worktree --lease test
```

Omitting `--lease` continues to target the `default` slot and remains compatible
with legacy single-lease records.

List local lease records and prune records for branches that Neon has already
removed:

```sh
sandbox-db list
sandbox-db gc --dry-run
sandbox-db gc
```

Important lifecycle behavior:

- branch names use the guarded `agent/` prefix;
- TTL is mandatory and cannot exceed seven days;
- `create` reuses a compatible live lease in the same named slot, refreshes its
  requested TTL, and restores connection URLs when the env file lost them;
- a mismatched or unusable lease record is ignored and replaced; the old branch
  expires automatically;
- release refuses default, protected, wrong-project, or non-`agent/` branches;
- release removes the leased database URL keys unless `--keep-env` is passed;
- leases contain identifiers and paths, never API keys or database URLs;
- connection strings are written to the selected ignored env file but never printed;
- custom `--keys` must be valid environment names and cannot overwrite the
  `SANDBOX_DB_*` authentication profile.

Use `--force-new` when a fresh branch is explicitly desired. Replaced branches
may remain until their TTL expires, but they never block normal provisioning.

## `provision-env` behavior

```sh
provision-env --database
```

In order, the coordinator:

1. validates the target Git checkout and ignored secret paths;
2. resolves any existing env-file conflict before making changes;
3. installs dependencies from the committed frozen lockfile;
4. reuses or creates the Vercel project link;
5. pulls Vercel Development variables into a staged `.env.local`;
6. pulls the Vercel `test` environment into a staged `.env.test`;
7. removes generated deployment-only metadata from both pulls;
8. removes Vercel database URLs when isolated databases were requested;
9. atomically publishes both files with mode `0600`;
10. creates the `default` and `test` database leases when `--database` is requested.

The default is `--env-conflict=overwrite`: repeated runs refresh both files from
Vercel without prompting. Existing database URLs are retained when database
allocation is skipped. With `--database`, Vercel database URLs are removed and
matching live leases restore their URLs; stale lease records are replaced with
fresh disposable branches. `--env-conflict=preserve`, `ask`, and `error` remain
available for explicit alternative behavior.

A worktree-scoped Git lock prevents concurrent `provision-env` runs. Immediately
before publication, overwrite mode revalidates both original files so concurrent
changes are preserved instead of replaced.

Agents and scripts may pass `--non-interactive`; the default refresh behavior
requires no extra conflict flag. `--skip-vercel` remains the direct way to use an intentionally
prepared pair without pulling. If setup fails after database allocation starts,
it releases only leases created by that invocation in reverse order, restores
preserved env files, and removes only env files it created.

## Recovery and cleanup

Both project-local lease slots resolve their credential from `.env.local`. If
both `.env.local` and `.env.test` are deleted, rerun `provision-env --database`:
it pulls the original Vercel profile, verifies the recorded branches, and
restores both connection overlays. Existing lease records store the database and
role selection; older records can also be repaired when their branch has exactly
one database.

For direct lifecycle commands, restore the worktree's Vercel link if needed and
pull `.env.local` from Vercel Development before retrying `sandbox-db status`,
`renew`, or `release`. Those explicit management commands still require the
lease's original profile; normal `create`/`provision-env` instead replaces stale
records.

`gc` reports `partial` and exits non-zero when a lease cannot be authenticated;
it does not assume an inaccessible branch is gone. Neon TTL expiration remains
the infrastructure cleanup backstop even if the local worktree or environment
file has already been removed.

## Development

Source lives in `scripts/.local/share/sandbox-db` and is run directly by Bun.

```sh
cd scripts/.local/share/sandbox-db
bun install
bun test
bun run typecheck
```
