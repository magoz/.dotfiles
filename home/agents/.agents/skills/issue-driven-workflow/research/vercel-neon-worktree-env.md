# Vercel, Neon preview branches, and local worktree environment provisioning

Research date: 2026-08-01

## Executive conclusion

The central assumption is correct: with Neon's managed Vercel preview branching, a feature-specific Neon branch does **not** exist merely because a local Git branch or worktree exists. The documented lifecycle begins when Vercel starts a Preview Deployment. Vercel notifies Neon, Neon creates `preview/<git-branch>`, and the branch-specific connection variables are injected into that deployment. ([Neon: Vercel-Managed Integration](https://neon.com/docs/guides/vercel-managed-integration); [Neon: Neon-Managed Integration](https://neon.com/docs/guides/neon-managed-vercel-integration))

`vercel env pull --environment=preview --git-branch=<branch>` can retrieve Vercel **Project Environment Variables** that apply to that Git branch. It cannot retrieve the dynamically generated Neon preview connection values: Neon says those values are injected "for this deployment only," cannot be accessed or viewed in Vercel project environment settings, and are not stored there. ([Vercel CLI: `vercel env`](https://vercel.com/docs/cli/env); [Neon: Vercel-Managed Integration — Preview Branching and Limitations](https://neon.com/docs/guides/vercel-managed-integration))

Therefore, a new local worktree has three realistic database choices:

1. use a persistent Development database branch;
2. create and own a separate Neon branch directly through Neon CLI/API before implementation;
3. trigger the Vercel preview deployment first, then obtain the resulting Neon branch's connection string through Neon—not through `vercel env pull`.

The best choice depends on whether per-worktree database isolation is required before the first push/deployment.

## Confirmed lifecycle

### Before the first Preview Deployment

A local Git worktree and branch do not trigger the Neon–Vercel integration. The official flow for both managed integrations starts with a feature-branch push that causes a Vercel Preview Deployment. Only then does Vercel send the integration webhook and Neon create a branch. ([Neon: Vercel-Managed Integration](https://neon.com/docs/guides/vercel-managed-integration); [Neon: Neon-Managed Integration](https://neon.com/docs/guides/neon-managed-vercel-integration))

For the Vercel-managed integration, Neon documents the sequence explicitly:

> 1. Developer pushes to feature branch → Vercel kicks off Preview Deployment.
> 2. Vercel sends a webhook to Neon → Neon creates branch `preview/<git-branch>`.
> 3. Environment variables for the branch connection are injected via webhook at deployment time, overriding preview environment variables for this deployment only.

Source: [Neon: Vercel-Managed Integration — Enable automated preview branching](https://neon.com/docs/guides/vercel-managed-integration#enable-automated-preview-branching-recommended).

The Neon-managed integration describes the same ordering: push, Vercel deployment, webhook-created `preview/<git-branch>`, then per-deployment variable injection. Source: [Neon: Neon-Managed Integration — How Preview Branching works](https://neon.com/docs/guides/neon-managed-vercel-integration#how-preview-branching-works).

The Vercel-managed setup can require the resource to be active before deployment. This allows the branch to be ready before the deployment build proceeds, which is why build-time migrations can target it. It does not make the branch exist before a deployment is initiated. ([Neon: Vercel-Managed Integration](https://neon.com/docs/guides/vercel-managed-integration))

### At deployment time

The integration injects the branch connection variables into that specific deployment. These override ordinary Preview environment values for the deployment. The variables include `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, and optional granular `PG*`/legacy values. ([Neon: Vercel-Managed Integration](https://neon.com/docs/guides/vercel-managed-integration); [Neon: Neon-Managed Integration](https://neon.com/docs/guides/neon-managed-vercel-integration))

This deployment-time availability supports running schema migrations during the Vercel build before the application build. Both Neon integration guides show migrations as part of the Vercel build command. The migration operates on the preview database because the injected connection variables are already present in the deployment build. ([Neon: Vercel-Managed Integration](https://neon.com/docs/guides/vercel-managed-integration); [Neon: Neon-Managed Integration](https://neon.com/docs/guides/neon-managed-vercel-integration))

### After deployment

The Neon branch exists and is visible in Neon. A connection string for a named branch can be obtained using:

```bash
neon connection-string 'preview/<git-branch>' --pooled --project-id <project-id>
```

The Neon CLI documentation says `neon connection-string [branch]` returns a connection URL for any database on any branch and includes the selected role's password. ([Neon CLI: `connection-string`](https://neon.com/docs/cli/connection-string))

For a Vercel-managed Neon organization, normal `neon auth` is not supported, but Neon documents API-key authentication as available. ([Neon: Vercel-Managed Integration — Limitations](https://neon.com/docs/guides/vercel-managed-integration#limitations))

The Neon API also supports listing branches and retrieving a project connection URI. ([Neon API Reference](https://neon.com/docs/reference/api-reference))

## Integration variants

Neon documents three current connection modes. They must not be conflated. ([Neon: Integrating Neon with Vercel](https://neon.com/docs/guides/vercel))

### Vercel-Managed / Native Integration

- Installed as a Vercel Marketplace Native Integration.
- Billing is through Vercel.
- Vercel creates or manages the Neon organization/project.
- Preview branching is optional and creates an isolated branch for Preview Deployments.
- Dynamic branch credentials are deployment-only and are not stored in project environment settings.
- Preview branches are deleted when corresponding Vercel deployments are removed; Vercel's default Preview deployment retention is six months, so branches may persist for months.
- Neon CLI requires API-key authentication; `neon auth` is unavailable for this account type.

Source: [Neon: Vercel-Managed Integration](https://neon.com/docs/guides/vercel-managed-integration).

### Neon-Managed / Connectable Account Integration

- Connects an existing Neon account/project.
- Billing remains through Neon.
- Preview branching creates `preview/<git-branch>` during Vercel Preview Deployment.
- Preview credentials are injected dynamically per deployment.
- It can optionally create a persistent `vercel-dev` Neon branch and set Vercel Development environment variables to use it.
- Optional cleanup follows Git branch deletion and runs when a later preview deployment triggers cleanup.

Source: [Neon: Neon-Managed Integration](https://neon.com/docs/guides/neon-managed-vercel-integration).

### Manual connection / custom CI

- Database variables are ordinary Vercel Project Environment Variables.
- Preview branching is not automatic.
- Neon recommends this path when custom CI/CD needs direct control over branch naming, seeding, migrations, or teardown.
- Neon provides official GitHub Actions for branch creation, deletion, reset, and schema diff.

Sources: [Neon: Manual Vercel connection](https://neon.com/docs/guides/vercel-manual); [Neon: Branching with GitHub Actions](https://neon.com/docs/guides/branching-github-actions).

## Vercel CLI behavior

### Linking a worktree

`vercel link` links the current directory to a Vercel project. Non-interactive use can specify the project explicitly:

```bash
vercel link --yes --project <project-name-or-id>
```

`VERCEL_PROJECT_ID` may be supplied instead of `--project`. ([Vercel CLI: `vercel link`](https://vercel.com/docs/cli/link))

Because `.vercel/` is local state rather than a tracked Git checkout, each worktree must be linked explicitly or supplied equivalent project/scope identifiers. Do not use an unqualified `vercel link --yes` in autonomous provisioning when the worktree directory name differs from the project name; specify the existing project.

### `vercel env pull`

Default behavior writes Development Project Environment Variables to a local file. It also supports Preview and Git-branch selection:

```bash
vercel env pull .env.local --environment=development --yes
vercel env pull .env.local --environment=preview --git-branch=<git-branch> --yes
```

Source: [Vercel CLI: `vercel env`](https://vercel.com/docs/cli/env).

This command retrieves stored Project Environment Variables. Vercel's branch-specific Preview variables are ordinary project configuration and override general Preview values. ([Vercel: Environment variables — Preview](https://vercel.com/docs/environment-variables#preview-environment-variables))

It does **not** provide the Neon integration's dynamically injected preview connection values. Neon explicitly states:

> Branch-specific connection variables cannot be accessed or viewed in your Vercel project's environment variable settings (they're injected at deployment time only and not stored ...).

Source: [Neon: Vercel-Managed Integration — Limitations](https://neon.com/docs/guides/vercel-managed-integration#limitations).

The Neon-managed guide likewise says Preview values are injected dynamically "for that specific deployment only." ([Neon: Neon-Managed Integration](https://neon.com/docs/guides/neon-managed-vercel-integration))

### `vercel env run`

`vercel env run` can run a local command with stored Vercel Project Environment Variables without writing them to disk:

```bash
vercel env run -e preview --git-branch=<git-branch> -- pnpm test
```

Source: [Vercel CLI: `vercel env`](https://vercel.com/docs/cli/env#running-commands-with-environment-variables).

This improves local secret handling for stored variables but does not change the dynamic Neon limitation. A per-deployment Neon variable that is not stored in Project Settings is not made pullable by choosing `env run` instead of `env pull`.

### `vercel pull`

`vercel pull` caches project settings and variables under `.vercel/.env.<target>.local` for `vercel build` and `vercel dev`. It supports `--environment=preview --git-branch=<branch>`. Vercel says it is unnecessary unless using `vercel build` or `vercel dev`. ([Vercel CLI: `vercel pull`](https://vercel.com/docs/cli/pull))

It has the same source-data limitation: it pulls configured environment data, not credentials generated only for a specific integration deployment.

### Sensitive variables

Vercel Sensitive Environment Variable values are non-readable after creation. They remain available inside Vercel builds and runtimes, but a local workflow should not assume every Preview or Production secret can be pulled back out. Development variables cannot use Vercel's Sensitive type. ([Vercel: Sensitive environment variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables))

## Git-branch-scoped variables are not dynamic Neon deployment variables

These are separate mechanisms:

| Mechanism | Stored in Project Settings | Selectable by Git branch | Available through `vercel env pull` | Lifecycle |
|---|---:|---:|---:|---|
| Vercel Development variables | Yes | No | Yes | Explicit project configuration |
| Vercel Preview variables | Yes | Optional branch override | Yes, subject to sensitive-value restrictions | Explicit project configuration |
| Neon managed preview connection variables | No | Derived from deployment Git branch | No | Injected for one Preview Deployment |

Vercel's environment documentation describes branch-specific Preview variables as project configuration. Neon separately says its preview connection values override Preview values at deployment time and are not stored. ([Vercel: Environment variables](https://vercel.com/docs/environment-variables); [Neon: Vercel-Managed Integration](https://neon.com/docs/guides/vercel-managed-integration))

## What cannot be done through the managed Vercel integration

- A local worktree alone cannot cause the managed integration to create a Neon preview branch.
- `vercel link`, `vercel env pull`, `vercel env run`, and `vercel pull` do not create the Neon preview branch.
- `vercel env pull --environment=preview --git-branch=<branch>` does not retrieve the dynamically injected Neon preview connection string.
- The dynamic value remains unavailable through Project Environment Variable settings even after deployment.
- An autonomous workflow cannot safely assume that copying the original worktree's `.env.local` provides issue-specific isolation; it usually provides the original worktree's Development database and other local secrets.
- Official documentation does not promise that a Neon branch manually created with the managed integration's `preview/<git-branch>` name will be adopted or reused by that integration. Avoid depending on name collision behavior.

## Supported bootstrap options

These are factual capability combinations, not a final workflow choice.

### Option A — persistent Development database

1. Create the worktree.
2. Link it to the existing Vercel project explicitly.
3. Pull Development variables or run commands with them:

   ```bash
   vercel env pull .env.local --environment=development --yes
   # or
   vercel env run -e development -- pnpm test
   ```

4. For the Neon-managed integration, enable its documented persistent `vercel-dev` branch so Development does not target the production/default branch.

Advantages: no early push/deployment; simple; officially supported.

Trade-off: concurrent worktrees share the Development database and can interfere with one another.

### Option B — deploy first, then reuse the integration-created preview branch locally

1. Create and push the Git branch so Vercel starts a Preview Deployment.
2. Wait for the integration to create `preview/<git-branch>`.
3. Use authenticated Neon CLI/API access to obtain that branch's connection string.
4. Inject it locally without logging it, either into an ignored mode-`0600` env file or directly into the process environment.

Advantages: local work and the deployed preview use the same isolated database branch.

Trade-offs: environment provisioning depends on an early remote branch/deployment; Vercel cannot export the dynamic value, so Neon access is still required.

The official guides explicitly document the Git-push route. They do not clearly guarantee identical branch behavior for a local CLI-created Preview Deployment with no Git push, so the Git integration path is the conservative supported choice.

### Option C — create a local worktree branch directly through Neon

1. Create the worktree.
2. Use Neon CLI/API to create a dedicated branch with a distinct ownership namespace such as `local/<issue-or-git-branch>`.
3. Obtain its connection string with `neon connection-string`.
4. Inject it locally.
5. Delete it explicitly when the worktree is retired.
6. Let the Vercel integration separately own `preview/<git-branch>` after deployment.

Advantages: per-worktree database isolation exists before any push or Vercel deployment.

Trade-offs: two database branches may exist for one code branch; local schema/data must be reproduced in the Vercel preview through migrations/seeding; the workflow owns cleanup and requires Neon API credentials.

Neon officially supports branch creation/list/delete and connection URI retrieval through its CLI/API. ([Neon API Reference](https://neon.com/docs/reference/api-reference); [Neon CLI: `connection-string`](https://neon.com/docs/cli/connection-string))

### Option D — own preview branching in CI

Use Neon's official GitHub Actions or API to create/delete branches and manage credentials as part of CI, then connect Vercel manually. Neon recommends manual connection when custom control over branch naming, seeding, migrations, and teardown is required. ([Neon: Manual Vercel connection](https://neon.com/docs/guides/vercel-manual); [Neon: Branching with GitHub Actions](https://neon.com/docs/guides/branching-github-actions))

Advantages: deterministic lifecycle under repository automation.

Trade-offs: more infrastructure and secret management; conflicts conceptually with retaining the simpler managed integration.

## Security and lifecycle implications

- Never copy all ignored files into a worktree. Provision an explicit allowlist and verify each resulting file remains ignored.
- Do not print `vercel env pull`, Neon connection strings, `.env.local`, or command environments into agent transcripts. Neon connection strings include passwords. ([Neon CLI: `connection-string`](https://neon.com/docs/cli/connection-string))
- Prefer process injection (`vercel env run` or equivalent) when tools do not require an env file.
- If writing `.env.local`, set restrictive permissions and delete it with worktree cleanup.
- Never silently fall back to Production variables when branch provisioning fails.
- A shared Development database is not safe isolation for destructive migrations, parallel tests, or concurrent writers.
- Vercel-managed preview branches can remain for the deployment retention period, six months by default. Neon-managed cleanup follows Git branch deletion and runs during subsequent preview activity. ([Neon: Integrating Neon with Vercel](https://neon.com/docs/guides/vercel); [Neon: Vercel-Managed Integration](https://neon.com/docs/guides/vercel-managed-integration); [Neon: Neon-Managed Integration](https://neon.com/docs/guides/neon-managed-vercel-integration))

## Recommendation candidates for discussion

### Minimal initial policy

For code-only tasks and tests that do not require runtime secrets, do not provision env files at all. Install dependencies and run the applicable deterministic checks.

When environment-dependent local validation is required, explicitly choose a named environment mode rather than copying `.env.local` implicitly:

- `development-shared`: pull Development values and use the persistent Development/`vercel-dev` database;
- `local-isolated`: create and own a dedicated Neon branch before implementation;
- `preview-reuse`: push/deploy first, then retrieve the integration-created branch through Neon.

The skill should stop rather than choosing Production or downgrading from isolated to shared database access silently.

### Likely fit for AFK worktree implementation

If isolated database tests must run before the first push, Option C is the only managed, deterministic sequence that avoids the deployment circularity. It requires a Neon API credential available to the coordinator and explicit branch cleanup.

If most implementation tests do not require a database, the lower-complexity policy is to skip env provisioning during implementation, open/push the draft PR, let Vercel create its preview branch, and use the deployed preview plus later validation. This preserves the current integration and avoids additional branch automation.

If local and deployed preview must share a database, Option B is the supported route, but branch push becomes an early provisioning action rather than a final delivery action.

## Open uncertainties

1. The installed integration type for Afloat has not been identified. The best local Development path differs: Neon-managed can create `vercel-dev`; Vercel-managed connects selected Development variables but documents different account/auth constraints.
2. Official docs consistently demonstrate Git push as the preview trigger. They describe "every Preview Deployment," but do not clearly specify behavior or branch naming for a Preview Deployment initiated exclusively by the Vercel CLI without a Git push.
3. Official docs do not promise managed-integration adoption of a manually pre-created `preview/<git-branch>` branch. A local automation should use a separate namespace unless Neon documents otherwise.
4. The exact Afloat checks that require database/network credentials have not yet been classified. Many unit/component checks may require no environment provisioning.

## Primary sources

Accessed 2026-08-01:

- [Neon — Integrating Neon with Vercel](https://neon.com/docs/guides/vercel)
- [Neon — Vercel-Managed Integration](https://neon.com/docs/guides/vercel-managed-integration)
- [Neon — Neon-Managed Integration](https://neon.com/docs/guides/neon-managed-vercel-integration)
- [Neon — Manual Vercel connection](https://neon.com/docs/guides/vercel-manual)
- [Neon — Branching with GitHub Actions](https://neon.com/docs/guides/branching-github-actions)
- [Neon CLI — `connection-string`](https://neon.com/docs/cli/connection-string)
- [Neon API Reference](https://neon.com/docs/reference/api-reference)
- [Vercel CLI — `vercel env`](https://vercel.com/docs/cli/env)
- [Vercel CLI — `vercel pull`](https://vercel.com/docs/cli/pull)
- [Vercel CLI — `vercel link`](https://vercel.com/docs/cli/link)
- [Vercel — Environment variables](https://vercel.com/docs/environment-variables)
- [Vercel — Sensitive environment variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables)
