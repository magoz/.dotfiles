// Registers `/<skill-id>` for every skill whose SKILL.md frontmatter sets
// `metadata.opencode/slash: "true"`. OpenCode V2 dropped native skill slash commands (v2.0.4);
// this restores them from the same flag. Running `/pr args` sends `args` as a prompt with the
// `pr` skill attached, like `@pr args`.
import { readFile } from "node:fs/promises"
import type { CommandDefinition, CommandInvocation } from "@opencode/plugin/effect/command"
import type { Plugin } from "@opencode/plugin/effect/plugin"
import type { SessionPromptInput } from "@opencode/client/effect/api"
import { Skill } from "@opencode/schema/skill"
import { Effect, Option, Schema, type Scope, Semaphore, Stream } from "effect"

const FLAG = "opencode/slash"
/** Catalog events after which flagged skills may have changed. */
const REFRESH_ON = new Set(["skill.updated", "config.updated", "plugin.updated"])

/** Reads `metadata.opencode/slash` from SKILL.md frontmatter; anything but true/"true" is off. */
export function slashFlag(text: string): boolean {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!frontmatter?.[1]) return false
  let metadata = false
  for (const line of frontmatter[1].split(/\r?\n/)) {
    if (/^metadata:\s*$/.test(line)) {
      metadata = true
      continue
    }
    if (!metadata) continue
    if (!/^\s/.test(line)) {
      metadata = false
      continue
    }
    const entry = /^\s+(["']?)([^"':]+)\1:\s*(["']?)([^"']*)\3\s*$/.exec(line)
    if (entry?.[2] === FLAG) return (entry[4] ?? "").trim().toLowerCase() === "true"
  }
  return false
}

/** Skill ID → description, sorted by ID. */
export type Found = ReadonlyMap<string, string | undefined>

interface SkillLike {
  readonly id: string
  readonly path: string
  readonly description?: string | undefined
}

/** The slice of OpenCode's plugin `Context` this plugin uses; the real `Context` satisfies it. */
export interface Host {
  readonly skill: { readonly list: () => Effect.Effect<{ readonly data: ReadonlyArray<SkillLike> }, unknown> }
  readonly command: {
    readonly list: () => Effect.Effect<{ readonly data: ReadonlyArray<{ readonly name: string }> }, unknown>
    readonly transform: (callback: (editor: { add(definition: CommandDefinition): void }) => void) => Effect.Effect<unknown, never, Scope.Scope>
    readonly reload: () => Effect.Effect<void>
  }
  readonly session: { readonly prompt: (input: SessionPromptInput) => Effect.Effect<unknown, unknown> }
  readonly event: { readonly subscribe: () => Stream.Stream<unknown, unknown> }
}

const readText = (file: string) => Effect.tryPromise(() => readFile(file, "utf8")).pipe(Effect.orElseSucceed(() => ""))

/** Slash-flagged skills, minus names already taken by other commands (`ours` are our own). */
export const discover = (host: Pick<Host, "skill" | "command">, ours: ReadonlySet<string>) =>
  Effect.gen(function* () {
    const [skills, commands] = yield* Effect.all([host.skill.list(), host.command.list()], { concurrency: 2 })
    const taken = new Set(commands.data.map((command) => command.name).filter((name) => !ours.has(name)))
    const candidates = skills.data.filter((skill) => !taken.has(skill.id))
    const flagged = yield* Effect.forEach(candidates, (skill) => readText(skill.path).pipe(Effect.map((text) => [skill, slashFlag(text)] as const)), {
      concurrency: 8,
    })
    const found: Found = new Map(
      flagged
        .filter(([, on]) => on)
        .map(([skill]): [string, string | undefined] => [skill.id, skill.description])
        .sort(([a], [b]) => a.localeCompare(b)),
    )
    return found
  })

/** Runs `/<id>` as a prompt with the skill attached first; an empty prompt asks to run the skill. */
export const run = (host: Pick<Host, "session">, id: string) => (input: CommandInvocation) =>
  host.session
    .prompt({
      sessionID: input.sessionID,
      text: input.prompt.text.trim() || `Run the ${id} skill.`,
      ...(input.prompt.files?.length ? { files: input.prompt.files } : {}),
      ...(input.prompt.agents?.length ? { agents: input.prompt.agents } : {}),
      skills: [{ id: Skill.ID.make(id) }, ...(input.prompt.skills ?? []).filter((skill) => skill.id !== id)],
      delivery: input.delivery,
    })
    .pipe(Effect.asVoid)

const EventType = Schema.Struct({ type: Schema.String })
const typeOf = Schema.decodeUnknownOption(EventType)

export const setup = (host: Host) =>
  Effect.gen(function* () {
    let current: Found = new Map()
    yield* host.command.transform((editor) => {
      for (const [id, description] of current) {
        editor.add({ name: id, ...(description ? { description } : {}), execute: run(host, id) })
      }
    })
    // Skills load after user plugins and can change at runtime, so discovery runs off the setup
    // path and again on catalog events. One refresh at a time; a failed one keeps the last state.
    const lock = yield* Semaphore.make(1)
    const refresh = Effect.gen(function* () {
      const next = yield* discover(host, new Set(current.keys()))
      if (sameEntries(current, next)) return
      current = next
      yield* host.command.reload()
    }).pipe(Semaphore.withPermits(lock, 1), Effect.ignore)
    yield* refresh.pipe(Effect.forkScoped)
    yield* host.event.subscribe().pipe(
      Stream.filter((event) => Option.exists(typeOf(event), ({ type }) => REFRESH_ON.has(type))),
      Stream.runForEach(() => refresh),
      Effect.ignore,
      Effect.forkScoped,
    )
  })

const sameEntries = (a: Found, b: Found) => a.size === b.size && [...a].every(([id, description]) => b.get(id) === description)

export default {
  id: "dotfiles-skill-commands",
  effect: (ctx) => setup(ctx),
} satisfies Plugin
