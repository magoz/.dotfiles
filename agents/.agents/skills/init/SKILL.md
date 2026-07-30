---
name: init
description: Initialize a new project by cloning magoz/init template, configuring tech stack, and cleaning unused services.
---

# Project Initialization Skill

Initialize a new project by cloning the [magoz/init](https://github.com/magoz/init) template, then configuring the tech stack by removing unused services.

## Phase 1: Project Setup

### 1.1 Get Project Name

If the user didn't provide a project name as an argument, ask:

> What's the project name?

Use the name as-is for the directory and repo name (kebab-case recommended).

### 1.2 Clone Template

```bash
gh repo create <project-name> --template magoz/init --private --clone
```

Then `cd` into the new directory. All subsequent operations happen inside it.

### 1.3 Install & Configure

```bash
pnpm install
cp .env.example .env.local
```

Update `package.json` name to match the project name.

## Phase 2: What Are You Building?

Ask a single open question:

> What are you building?

Wait for the user's response. This informs cleanup decisions.

## Phase 3: Tech Stack Questions

Ask each question explicitly. Yes/No answers.

1. **Database:** "Will this project need a database?"
2. **Auth:** "Will users need to create accounts or log in?"
3. **Email:** "Will the app send emails? (notifications, confirmations, etc.)"
4. **File uploads:** "Will users upload files or images?"
5. **Admin notifications:** "Do you want Telegram notifications for admin events?"
6. **Error tracking:** "Do you want error tracking and analytics? (Sentry + PostHog)"

### Skip Logic

- If no database -> skip auth (auth requires db)
- If no auth and no email use case -> ask "Will the app send any emails? (contact forms, notifications)"

### Dependencies

| If removing... | Also remove... | Note                              |
| -------------- | -------------- | --------------------------------- |
| Database       | Auth           | Auth requires db for user storage |
| Telegram       | Activity       | Activity logs to Telegram         |

If user wants auth but said no to database, clarify:

> "Auth requires a database. Should I enable the database?"

## Phase 4: Clean Codebase

Remove unused services silently based on answers.

### Service Removal Map

| Service   | Remove if "no" to...                        |
| --------- | ------------------------------------------- |
| Db        | "database"                                  |
| Auth      | "accounts/login"                            |
| Email     | "emails"                                    |
| S3        | "file uploads"                              |
| Telegram  | "admin notifications"                       |
| Activity  | "admin notifications" (depends on Telegram) |
| Telemetry | "error tracking"                            |

### Files to Remove Per Service

#### Database (Db)

```
lib/services/db/
drizzle.config.ts
lib/services/db/migrations/
```

Also:

- Remove `Db.Live` from `lib/layers.ts`
- Remove `DATABASE_URL` from `.env.example` and `.env.local`
- Remove drizzle scripts from `package.json`
- Remove `drizzle-orm` and `drizzle-kit` from dependencies

#### Auth

```
lib/services/auth/
app/(auth)/
app/api/auth/
```

Also:

- Remove `Auth.Live` from `lib/layers.ts`
- Remove `BETTER_AUTH_SECRET` from `.env.example` and `.env.local`
- Remove `better-auth` from dependencies
- Remove user-related tables from schema if Db is kept
- Remove auth middleware references

#### Email

```
lib/services/email/
```

Also:

- Remove `Email.Live` from `lib/layers.ts`
- Remove `RESEND_API_KEY`, `EMAIL_SENDER` from `.env.example` and `.env.local`
- Remove `resend` from dependencies

#### S3

```
lib/services/s3/
lib/core/file/
```

Also:

- Remove `S3.Live` from `lib/layers.ts`
- Remove `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET` from `.env.example` and `.env.local`
- Remove `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` from dependencies

#### Telegram

```
lib/services/telegram/
```

Also:

- Remove `Telegram.Live` from `lib/layers.ts`
- Remove `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` from `.env.example` and `.env.local`

#### Activity

```
lib/services/activity/
```

Also:

- Remove `Activity.Live` from `lib/layers.ts`

#### Telemetry

```
lib/services/telemetry/
instrumentation.ts
instrumentation-client.ts
sentry.edge.config.ts
sentry.server.config.ts
```

Also:

- Remove `TelemetryLayer` from `lib/layers.ts`
- Remove `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_POSTHOG_KEY` from `.env.example` and `.env.local`
- Remove `@sentry/nextjs`, `posthog-js` from dependencies
- Remove Sentry webpack config from `next.config.ts`

### Cleaning Process

For each service to remove:

1. **Delete directories/files** listed above
2. **Update `lib/layers.ts`:** remove import + remove from `Layer.mergeAll(...)`
3. **Update `.env.example` and `.env.local`:** remove relevant env vars
4. **Update `package.json`:** remove dependencies and scripts
5. **Clean up imports:** search for imports from removed services, fix or remove
6. **Run `pnpm install`** after dependency changes

### After Cleaning

Remove example code that references removed services (e.g., `lib/core/post/` if it uses removed services).

Commit:

```bash
git add -A
git commit -m "chore: remove unused services"
```

Summarize:

> Cleaned up the codebase:
>
> - Removed: S3, Telegram, Activity
> - Kept: Database, Auth, Email, Telemetry

## Phase 5: Final Setup

1. Update `README.md` with project name and description
2. Remove the "After Cloning" and "Inspiration" sections from README
3. Run `pnpm dev` to verify everything works

```bash
git add -A
git commit -m "chore: init project"
```

## Completion

> Project initialized!
>
> **Tech stack:** [list of enabled services]
> **Next:** `pnpm dev` to start developing

## Re-running /init

If `/init` is run on a project that already has services configured:

1. Check if `lib/services/` has been modified from template
2. If yes, warn: "This project looks already initialized. Run this again to reconfigure the tech stack? This may break existing code."

## Error Handling

### Git Failures

> Couldn't commit changes. Please commit manually:
>
> ```
> git add -A && git commit -m "chore: init project"
> ```
