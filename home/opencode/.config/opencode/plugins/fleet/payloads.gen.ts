// Generates payloads.json: real Fleet wire payloads built by Fleet's own projection
// (`buildSnapshot`, the same code behind `GET /api/fleet`) and checked against Fleet's schemas.
// Not part of the plugin or its tests; rerun when Fleet's wire types change:
//   cd ~/dev/repos/fleet && node_modules/.bin/tsx <this file> > <plugin dir>/payloads.json
// `@/` resolves through the Fleet checkout's tsconfig (run from its root).
import { Schema } from '@/node_modules/effect/dist/index.js'
import { fromSnapshot } from '@/lib/data/fleet/model'
import type { TrackedSession } from '@/lib/data/fleet/model'
import { buildRows, buildSnapshot } from '@/lib/data/fleet/snapshot'
import { countRows } from '@/lib/data/fleet/state'
import { baseTime, sessionRecord, webUrl } from '@/lib/data/fleet/testing/fixtures'
import {
  FleetChange,
  FleetSnapshot,
  HandledResult,
  LaunchStarted,
  LauncherList,
  OpenedCheckout,
  ReopenResult,
  SessionSummary
} from '@/lib/data/fleet/types'
import type { Launch, SessionRecord } from '@/lib/data/fleet/types'

const minute = 60_000
const hour = 60 * minute
const now = baseTime + 48 * hour

const fleet = '/home/magoz/dev/repos/fleet'
const featX = '/home/magoz/dev/repos/fleet-feat-x'
const box = '/home/magoz/dev/repos/box'

const finished = (at: number, outcome: 'succeeded' | 'failed' | 'interrupted' = 'succeeded') => ({
  idle: at,
  outcome
})

const sessions: ReadonlyArray<SessionRecord> = [
  sessionRecord('ses_wait_old', { title: 'Wait old', created: now - 3 * hour }),
  sessionRecord('ses_wait_sub', { title: 'Wait on subagent', created: now - 2 * hour }),
  sessionRecord('ses_wait_sub_child', {
    title: 'Explore schema',
    agent: 'explore',
    parentID: 'ses_wait_sub',
    created: now - 90 * minute
  }),
  sessionRecord('ses_wait_new', { title: 'Wait new', created: now - hour, directory: featX }),
  sessionRecord('ses_done_old', { title: 'Done old', ...finished(now - 5 * hour, 'failed') }),
  sessionRecord('ses_done_stop', {
    title: 'Stopped run',
    ...finished(now - 2 * hour, 'interrupted')
  }),
  sessionRecord('ses_done_new', {
    title: 'Done new',
    directory: featX,
    ...finished(now - 30 * minute)
  }),
  sessionRecord('ses_done_new_child', {
    title: 'Child run',
    parentID: 'ses_done_new',
    ...finished(now - 31 * minute)
  }),
  sessionRecord('ses_busy', { title: 'Busy run', created: now - 30 * minute }),
  sessionRecord('ses_quiet', { title: 'Quiet run', created: now - 2 * hour }),
  sessionRecord('ses_retry', { title: 'Retry run', created: now - 3 * hour, directory: featX }),
  sessionRecord('ses_handled', {
    title: 'Handled one',
    ...finished(now - 2 * hour),
    handled: now - 2 * hour
  }),
  sessionRecord('ses_gone', {
    title: 'Gone scratch',
    projectID: 'global',
    directory: '/tmp/tmp.gone',
    ...finished(now - 4 * hour)
  }),
  sessionRecord('ses_box', { title: 'Box route', projectID: 'prj_box', directory: box }),
  sessionRecord('ses_tmp', {
    title: 'Scratch',
    projectID: 'global',
    directory: '/tmp/scratch',
    ...finished(now - 10 * minute)
  })
]

type LiveFacts = Partial<Pick<TrackedSession, 'activity' | 'retry' | 'activityAt' | 'interrupt'>>

const live = new Map<string, LiveFacts>([
  ['ses_wait_sub', { activityAt: now - 50 * minute }],
  ['ses_wait_sub_child', { activityAt: now - 50 * minute }],
  ['ses_busy', { activityAt: now - minute, activity: { kind: 'tool', tool: 'bash', detail: 'pnpm test' } }],
  ['ses_quiet', { activityAt: now - 15 * minute }],
  ['ses_retry', { activityAt: now - minute, retry: { attempt: 2, at: now, message: 'rate limited' } }],
  ['ses_done_stop', { interrupt: 'inactivity' }]
])

const base = fromSnapshot(
  {
    sessions,
    running: ['ses_wait_sub', 'ses_wait_sub_child', 'ses_busy', 'ses_quiet', 'ses_retry'],
    permissions: [
      { id: 'per_old', sessionID: 'ses_wait_old', action: 'bash', resources: ['pnpm db:push'] }
    ],
    forms: [
      {
        id: 'frm_sub',
        sessionID: 'ses_wait_sub_child',
        title: 'Which database?',
        fields: [
          {
            key: 'db',
            type: 'string',
            options: [
              { value: 'neon', label: 'Neon' },
              { value: 'local', label: 'Local' }
            ]
          }
        ]
      },
      {
        id: 'frm_new',
        sessionID: 'ses_wait_new',
        title: 'Ship it?',
        fields: [{ key: 'ok', type: 'boolean' }]
      }
    ],
    projects: [
      { id: 'prj_fleet', name: 'fleet', directory: fleet },
      { id: 'prj_box', name: 'box', directory: box },
      { id: 'global', directory: '/' }
    ],
    worktrees: [{ projectID: 'prj_fleet', directories: [featX] }]
  },
  now,
  new Map([['/tmp/tmp.gone', true]])
)

const tracked = new Map(base.sessions)

for (const [id, facts] of live) {
  const session = tracked.get(id)

  if (session !== undefined) tracked.set(id, { ...session, ...facts })
}

const model = { ...base, sessions: tracked }

const launch = (overrides: Partial<Launch> & Pick<Launch, 'id' | 'status'>): Launch => ({
  repo: fleet,
  repoName: 'fleet',
  branch: 'feat/palette',
  task: 'Add the launcher palette',
  startedAt: now - 42_000,
  updatedAt: now - 42_000,
  ...overrides
})

const launches: ReadonlyArray<Launch> = [
  launch({ id: 'launch-1', status: 'provisioning' }),
  launch({
    id: 'launch-2',
    status: 'failed',
    branch: 'fix/broken',
    task: 'Fix the broken thing',
    error: 'No exact worktree name for fix/broken',
    preserved: 'nothing',
    updatedAt: now - 10_000
  }),
  launch({
    id: 'launch-3',
    status: 'ready',
    branch: 'feat/x',
    task: 'Build x',
    directory: featX,
    sessionID: 'ses_busy',
    updatedAt: now - 5_000
  })
]

const connection = { status: 'connected' as const, since: now, failures: 0, version: '2.0.20' }

const snapshot = Schema.decodeUnknownSync(FleetSnapshot)(
  buildSnapshot(model, { connection, webUrl, now, launches })
)

const rows = buildRows(model, webUrl)
const changed = rows.filter(row => row.id === 'ses_busy')

const change = Schema.decodeUnknownSync(FleetChange)({
  initial: false,
  connection,
  counts: countRows(rows, now),
  rows: changed,
  removed: ['ses_tmp'],
  launches
})

const tally = (counts: Partial<Record<'blocked' | 'working' | 'finished' | 'handled', number>>) => ({
  blocked: 0,
  working: 0,
  finished: 0,
  handled: 0,
  ...counts
})

const launcher = Schema.decodeUnknownSync(LauncherList)({
  generatedAt: now,
  entries: [
    {
      name: 'fleet',
      directory: fleet,
      projectID: 'prj_fleet',
      sessions: tally({ blocked: 2, working: 2, finished: 2, handled: 1 }),
      latestSession: 'ses_busy',
      activeAt: now - minute,
      lastActivity: now - minute,
      worktrees: [
        {
          directory: featX,
          branch: 'feat/x',
          owner: 'dotfiles',
          pr: { state: 'open', number: 7, url: 'https://github.com/o/fleet/pull/7' },
          sessions: tally({ blocked: 1, working: 1, finished: 1 }),
          latestSession: 'ses_retry',
          activeAt: now - minute
        },
        {
          directory: '/home/magoz/dev/repos/fleet-pi-thing',
          branch: 'pi/thing',
          owner: 'other',
          pr: { state: 'closed', number: 3 },
          sessions: tally({})
        }
      ]
    },
    {
      name: 'box',
      directory: box,
      projectID: 'prj_box',
      sessions: tally({ handled: 1 }),
      latestSession: 'ses_box',
      activeAt: now - 5 * hour,
      lastActivity: now - 5 * hour,
      worktrees: []
    },
    { name: 'anvil', directory: '/home/magoz/dev/repos/anvil', sessions: tally({}), worktrees: [] }
  ]
})

const summary = Schema.decodeUnknownSync(SessionSummary)({
  sessionID: 'ses_done_new',
  idle: now - 30 * minute,
  answer: 'Added the palette.\nAll tests pass.',
  changes: { files: 3, additions: 40, deletions: 2 }
})

const results = {
  handled: Schema.decodeUnknownSync(HandledResult)({ sessionID: 'ses_done_new', outcome: 'handled' }),
  reopen: Schema.decodeUnknownSync(ReopenResult)({ sessionID: 'ses_done_new', outcome: 'reopened' }),
  launch: Schema.decodeUnknownSync(LaunchStarted)({ launchID: 'launch-4' }),
  opened: Schema.decodeUnknownSync(OpenedCheckout)({ sessionID: 'ses_retry', created: false })
}

console.log(JSON.stringify({ now, snapshot, change, launcher, summary, results }, null, 2))
