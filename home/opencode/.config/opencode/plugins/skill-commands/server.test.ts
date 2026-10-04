import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import type { CommandDefinition } from "@opencode/plugin/effect/command"
import { PromptInput } from "@opencode/schema/prompt-input"
import { Session } from "@opencode/schema/session"
import { Effect, Exit, Queue, Schema, Scope, Stream } from "effect"
import type { SessionPromptInput } from "@opencode/client/effect/api"
import plugin, { setup, slashFlag, type Host } from "./server.ts"

const skill = (metadata: string) => `---\nname: x\ndescription: d\n${metadata}---\n\n# Body\n`
const settle = Effect.gen(function* () {
  for (let i = 0; i < 50; i++) yield* Effect.yieldNow
  yield* Effect.sleep("20 millis")
})

test("slashFlag reads only metadata.opencode/slash", () => {
  assert.equal(slashFlag(skill('metadata:\n  opencode/slash: "true"\n')), true)
  assert.equal(slashFlag(skill("metadata:\n  opencode/slash: 'true'\n")), true)
  assert.equal(slashFlag(skill('metadata:\n  "opencode/slash": true\n')), true)
  assert.equal(slashFlag(skill('metadata:\n  other: x\n  opencode/slash: "false"\n')), false)
  assert.equal(slashFlag(skill('metadata:\n  opencode/autoinvoke: "true"\n')), false)
  assert.equal(slashFlag(skill("slash: true\n")), false)
  assert.equal(slashFlag(skill('metadata:\n  a: b\nopencode/slash: "true"\n')), false)
  assert.equal(slashFlag("# no frontmatter"), false)
})

test("registers flagged skills, skips taken names, refreshes on catalog events, runs them as skill-attached prompts", async () => {
  assert.equal(plugin.id, "dotfiles-skill-commands")
  const dir = await mkdtemp(path.join(tmpdir(), "skill-commands-"))
  const file = async (id: string, metadata: string) => {
    const target = path.join(dir, `${id}.md`)
    await writeFile(target, skill(metadata))
    return { id, description: `${id} skill`, path: target }
  }
  const skills = [
    await file("pr", 'metadata:\n  opencode/slash: "true"\n'),
    await file("quiet", ""),
    await file("prd", 'metadata:\n  opencode/slash: "true"\n'),
  ]
  const transforms = new Set<(editor: { add(definition: CommandDefinition): void }) => void>()
  const prompts: SessionPromptInput[] = []
  let reloads = 0
  const commands = () => {
    const added: CommandDefinition[] = []
    for (const callback of transforms) callback({ add: (definition) => added.push(definition) })
    return added
  }
  await Effect.runPromise(Effect.gen(function* () {
    const events = yield* Queue.unbounded<unknown>()
    const host: Host = {
      skill: { list: () => Effect.succeed({ data: skills }) },
      command: {
        list: () => Effect.sync(() => ({ data: [{ name: "prd" }, ...commands().map(({ name }) => ({ name }))] })),
        transform: (callback) =>
          Effect.acquireRelease(Effect.sync(() => transforms.add(callback)), () => Effect.sync(() => transforms.delete(callback))),
        reload: () => Effect.sync(() => { reloads++ }),
      },
      session: { prompt: (input) => Effect.sync(() => { prompts.push(input) }) },
      event: { subscribe: () => Stream.fromQueue(events) },
    }
    const scope = yield* Scope.make()
    yield* setup(host).pipe(Scope.provide(scope))
    yield* settle
    assert.deepEqual(commands().map(({ name, description }) => [name, description]), [["pr", "pr skill"]])
    assert.equal(reloads, 1)

    yield* Queue.offer(events, { type: "skill.updated" })
    yield* Queue.offer(events, { type: "session.idle" })
    yield* settle
    assert.equal(reloads, 1, "unchanged catalog does not reload")
    skills.push(yield* Effect.promise(() => file("learn", 'metadata:\n  opencode/slash: "true"\n')))
    yield* Queue.offer(events, { type: "skill.updated" })
    yield* settle
    assert.deepEqual(commands().map(({ name }) => name), ["learn", "pr"])
    assert.equal(reloads, 2)

    // Raw input, decoded like the host decodes it (brands included).
    const prompt = (text: string, extra: Readonly<Record<string, unknown>> = {}) =>
      Schema.decodeUnknownSync(PromptInput.Prompt)({ text, ...extra })
    const pr = commands().find((command) => command.name === "pr")
    assert.ok(pr)
    const sessionID = Session.ID.make("ses_1")
    yield* pr.execute({ sessionID, delivery: "steer", prompt: prompt(" open draft ", { skills: [{ id: "pr" }, { id: "learn" }] }) }).pipe(Effect.orDie)
    yield* pr.execute({ sessionID, delivery: "queue", prompt: prompt("") }).pipe(Effect.orDie)
    assert.deepEqual(
      prompts.map(({ text, skills, delivery }) => ({ text, skills: skills?.map((s) => s.id), delivery })),
      [
        { text: "open draft", skills: ["pr", "learn"], delivery: "steer" },
        { text: "Run the pr skill.", skills: ["pr"], delivery: "queue" },
      ],
    )
    yield* Scope.close(scope, Exit.void)
  }))
  assert.equal(transforms.size, 0, "closing the plugin scope removes the command transform")
})
