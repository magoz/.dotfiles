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
provision-env --repo /path/to/worktree --source /path/to/linked-checkout --database
```

The profile is atomic:

- if all three variables are present, it takes precedence over global auth;
- if none are present, `sandbox-db` falls back to global auth;
- if any variable is missing or empty, provisioning fails rather than combining
  credentials and settings from different accounts.

After resolving the profile, `sandbox-db` creates two independently expiring
branches with `SANDBOX_DB_PARENT_BRANCH_ID` as their Neon `parent_id`:

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
- `create` reuses a live lease in the same named slot by default;
- release refuses default, protected, wrong-project, or non-`agent/` branches;
- release removes the leased database URL keys unless `--keep-env` is passed;
- leases contain identifiers and paths, never API keys or database URLs;
- connection strings are written to the selected ignored env file but never printed;
- custom `--keys` must be valid environment names and cannot overwrite the
  `SANDBOX_DB_*` authentication profile.

Prefer releasing an existing lease before creating another. Use `--force-new`
only when the recorded branch is known to be gone; replacing a live lease record
would make the old branch harder to manage until its TTL expires.

## `provision-env` behavior

```sh
provision-env --database
```

In order, the coordinator:

1. validates the target Git checkout and ignored secret paths;
2. installs dependencies from the committed frozen lockfile;
3. reuses or creates the Vercel project link;
4. pulls Vercel Development variables into a staged `.env.local`;
5. pulls the Vercel `test` environment into a staged `.env.test`;
6. removes generated deployment-only metadata from both pulls;
7. removes Vercel database URLs when isolated databases were requested;
8. atomically publishes both files with mode `0600`;
9. creates the `default` and `test` database leases when `--database` is requested.

It refuses to overwrite either env file. Use `--skip-vercel` only when
intentionally preserving both prepared files. If setup fails after database
allocation starts, it releases only leases created by that invocation in
reverse order, restores preserved env files, and removes only env files it created.

## Recovery and cleanup

Both project-local lease slots resolve their credential from `.env.local`. If
that file is deleted, moved, or no longer contains the original profile:

1. restore the worktree's Vercel link if needed;
2. run `vercel env pull .env.local --environment development` in the worktree;
3. retry `sandbox-db status`, `renew`, or `release` with the affected `--lease`.

Do not substitute a profile from another Neon project. Project mismatches fail
closed.

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
