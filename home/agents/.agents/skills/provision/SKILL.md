---
name: provision
description: Use the provision CLI to make a checkout or worktree runnable (dependencies, Vercel link, env files, setup commands), manage disposable Neon databases for local checkouts, and prepare provision factory runs that create a project's provider resources. Use when a checkout needs env files or databases, when a repository's package.json has a "provision" key, or when the user mentions provision, factories, sandbox databases, or provisioning a new project.
---

# provision

`provision` has three modes:

- `provision env`: make a checkout runnable.
- `provision db`: manage disposable Neon database branches for local checkouts.
- `provision factory`: create a project's provider resources and write scoped keys to Vercel.

Run `provision <mode> --help` for every flag. The repository's root `package.json` `provision` key
configures it (`appDir`, `setup`, `factory.steps`).

## What you may run, and what only the human may run

| Command                                                           | Who                              |
| ----------------------------------------------------------------- | -------------------------------- |
| `provision env …`, `provision db …`, `provision contract`         | you                              |
| `provision config list`, `provision config op-token status`       | you                              |
| `provision factory …`, `provision config add/verify/op-token set` | **the human, in their terminal** |

Commands that read a factory's 1Password item need the operator's **provision passphrase**, typed
on the terminal. That passphrase is the human's approval for using admin keys.

When you run one of them, `provision` detects the agent, changes nothing, and exits **4** with one
JSON object on stderr:

```json
{
  "status": "approval_required",
  "reason": "…",
  "hint": "…",
  "next": [
    "cd /home/acme/src/acme-app && /usr/local/bin/provision factory --domain app.acme.com --dry-run"
  ]
}
```

Give the human the `next` command verbatim, say in one or two sentences what it will do, and wait
for them to paste the output. You may also skip the attempt and write the command yourself; use
`/usr/local/bin/provision` when it exists, since a `provision` earlier on `PATH` could be a
different binary.

Agents are also detected for `provision env`, which then never prompts (as with
`--non-interactive`).

## Make a checkout or worktree runnable

```bash
provision env --repo <checkout> --database --non-interactive
```

This installs dependencies, links the Vercel project, pulls Development into `.env.local` and the
`test` environment into `.env.test`, creates two disposable databases (`default` and `test`
leases), and runs `package.json` `provision.setup` (usually migrations). Without `--database` the
env files keep whatever database Vercel provides; prefer `--database` for anything that writes data.

- **Exit 3** (`{"status":"vercel_link_required",…}` on stderr): the app is not linked and the
  project is ambiguous. Rerun with `--source <already-linked checkout>` or
  `--vercel-project <name>`; ask the human which project if you cannot tell.
- **Setup failed**: env files and databases are kept. Fix the cause, then rerun the same command;
  it resumes. `--skip-setup` skips setup on purpose.
- **Existing env files**: refreshed from Vercel by default. `--env-conflict preserve` keeps them.
- Never print `.env*` files or connection strings; they hold secrets. Check for a key with
  `grep -c '^KEY=' .env.local` instead of reading values.

## Add or change an environment variable

Vercel is the source of truth. `provision env` rewrites `.env.local` and `.env.test` from Vercel on
every run, so a value added only to a local file is lost. Add it to the Vercel project, then pull:

```bash
cd <checkout>   # linked to the project (.vercel/project.json)
vercel env add <KEY> development               # local development only
vercel env add <KEY> preview                   # repeat per environment as needed
vercel env add <KEY> test                      # the custom e2e environment (.env.test)
vercel env add <KEY> production --sensitive    # production secrets are Sensitive
provision env --repo <checkout> --skip-install --skip-setup   # refresh the env files
```

Follow the project's convention: pre-production values (Development, Preview, `test`) and
production values are separate, and production secrets are Sensitive. Development cannot hold
Sensitive values.

- **Secrets** (API keys, tokens): don't handle the value. Give the human the `vercel env add`
  command; it prompts for the value. Never pass a secret with `--value` or put it in a file,
  commit, or the chat.
- **Non-secret config** (URLs, feature flags, thresholds): you may run
  `vercel env add <KEY> <environment> --value <value> --yes` yourself.
- **Variables `provision factory` manages** (`DATABASE_URL*`, `SANDBOX_DB_*`, `R2_*`, `QSTASH_*`,
  `RESEND_API_KEY`, `REPORT_RECEIVER_*`, `BETTER_AUTH_SECRET`, `INTEGRATION_CREDENTIAL_ENCRYPTION_KEY`,
  `CRON_SECRET`, `VAPID_*`, `AUTH_EMAIL_FROM`, `AI_PROVIDER_USAGE_ALERT_THRESHOLDS`,
  `ALLOW_E2E_DATABASE_RESET`): don't edit them by hand. Have the human rerun the step, e.g.
  `--only resend --on-existing overwrite` to rotate a key.
- Deployments only see variables added before they were built; redeploy to pick up a change.

## Disposable databases

```bash
provision db status  --worktree <checkout> --lease default --json   # exit 1: no lease
provision db renew   --worktree <checkout> --lease default          # extend TTL (max 7d)
provision db create  --worktree <checkout> --lease default          # create, or reuse a live lease
provision db create  --worktree <checkout> --lease test \
  --env-file .env.test --config-env-file .env.local                 # test lease writes .env.test
provision db release --worktree <checkout> --lease default          # delete branch, drop env keys
provision db release --worktree <checkout> --lease test
provision db list --json
```

Release both leases before deleting a worktree. Branches expire on their own after their TTL;
`provision db gc --dry-run` lists stale ones. A database whose TTL ran out is gone: rerun
`provision env --repo <checkout> --database`, which recreates both leases and reruns setup.

## Provision a new project (human runs it)

Prerequisites: the GitHub repository exists under the factory's GitHub owner, there is a local
checkout with that `origin`, and the factory is registered (`provision config list`).

Prepare these for the human, in order:

```bash
# 1. Plan: reads providers, changes nothing
/usr/local/bin/provision factory --checkout <checkout> --domain <production-host> --dry-run

# 2. Apply
/usr/local/bin/provision factory --checkout <checkout> --domain <production-host> \
  --sender-name <App name> --email-from noreply@<verified-domain>

# 3. Confirm idempotence: should print only "reusing" lines
/usr/local/bin/provision factory --checkout <checkout> --domain <production-host> \
  --sender-name <App name> --email-from noreply@<verified-domain> --on-existing reuse

# 4. Local checkout (you can run this one)
provision env --repo <checkout> --database
```

Reading the output: each step prints one block. `would …` is a dry-run plan, `exists:` /
`reusing …` means nothing changed, `skipped:` means the factory lacks that provider, and
`manual: …` is a follow-up the human must do by hand. Relay `manual:` lines to the human.

QStash credentials are pasted by the human when `provision factory` asks for them (hidden input,
written straight to Vercel). If they skipped it, give them
`/usr/local/bin/provision factory --checkout <checkout> --domain <host> --only upstash --on-existing reuse`.
Never ask the human to paste QStash values, or any other credential, into the chat.

`--on-existing`: `ask` (default, prompts), `reuse` (change nothing that exists), `overwrite`
(rotate keys and regenerate secrets: invalidates sessions and encrypted data; only on the human's
explicit request), `abort`. Data (databases, buckets, teams) is never deleted or replaced.
`--only <steps>` reruns a subset, e.g. `--only reports` after the factory gains a report receiver.

## Never

- Run a passphrase command in a way that gets around the approval: piping input, `script`,
  `expect`, `tmux send-keys`, a pseudo-terminal, or unsetting agent variables such as `AI_AGENT`.
- Ask the human for the passphrase, a 1Password token, or an admin key; set
  `OP_SERVICE_ACCOUNT_TOKEN`; run `op`; or read `~/.config/provision/*.cred`.
- Print `.env*` files, connection strings, or keys, or copy them into chat, commits, or logs.
- Pass `--on-existing overwrite` unless the human asked to rotate: it invalidates sessions and
  encrypted data.
- Delete provider resources (Neon projects, R2 buckets, Upstash teams, Vercel projects) to "start
  over"; `provision` reuses what exists.
- Delete a worktree before `provision db release` for both leases.
- Edit `~/.config/provision/` or the lease files under `~/.local/state/pi/sandbox-db/` by hand.

## Exit codes

`0` success; `1` negative result (for example no lease) or usage error; `2` failure, explained in
one `provision <mode>: …` line on stderr; `3` `env` needs a Vercel link (JSON on stderr); `4` a
human must run this command (JSON with `next` on stderr).
