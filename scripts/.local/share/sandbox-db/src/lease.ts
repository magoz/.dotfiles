import { FileSystem, Path } from "@effect/platform"
import { Effect, Option, Schema } from "effect"
import { Lease, LeaseError, LeaseFromJson } from "./domain"
import { createHash } from "node:crypto"

const leaseDirectory = Effect.gen(function* () {
  const path = yield* Path.Path
  const fs = yield* FileSystem.FileSystem
  const home = process.env.HOME ?? ""
  const stateHome = process.env.XDG_STATE_HOME ?? path.join(home, ".local", "state")
  const directory = path.join(stateHome, "pi", "sandbox-db", "leases")
  yield* fs.makeDirectory(directory, { recursive: true }).pipe(
    Effect.mapError((cause) => new LeaseError({ message: `lease directory unavailable: ${cause}` }))
  )
  return directory
})

const leaseFile = (worktree: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const directory = yield* leaseDirectory
    const digest = createHash("sha256").update(worktree).digest("hex").slice(0, 16)
    return path.join(directory, `${digest}.json`)
  })

export const readLease = (worktree: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const file = yield* leaseFile(worktree)
    const exists = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false))
    if (!exists) return Option.none<Lease>()
    const content = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""))
    return yield* Schema.decodeUnknown(LeaseFromJson)(content).pipe(
      Effect.map(Option.some),
      Effect.orElseSucceed(() => Option.none<Lease>())
    )
  })

export const writeLease = (lease: Lease) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const file = yield* leaseFile(lease.worktree)
    const content = yield* Schema.encode(LeaseFromJson)(lease).pipe(
      Effect.mapError((cause) => new LeaseError({ message: `lease encoding failed: ${cause}` }))
    )
    yield* fs.writeFileString(file, `${content}\n`).pipe(
      Effect.mapError((cause) => new LeaseError({ message: `lease write failed: ${cause}` }))
    )
    yield* fs.chmod(file, 0o600).pipe(Effect.orElseSucceed(() => undefined))
  })

export const removeLease = (worktree: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const file = yield* leaseFile(worktree)
    yield* fs.remove(file).pipe(Effect.orElseSucceed(() => undefined))
  })

export const allLeases = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = yield* leaseDirectory
  const entries = yield* fs.readDirectory(directory).pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>))
  const leases: Array<Lease> = []
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue
    const content = yield* fs.readFileString(path.join(directory, entry)).pipe(
      Effect.orElseSucceed(() => "")
    )
    const decoded = yield* Schema.decodeUnknown(LeaseFromJson)(content).pipe(
      Effect.map(Option.some),
      Effect.orElseSucceed(() => Option.none<Lease>())
    )
    if (Option.isSome(decoded)) leases.push(decoded.value)
  }
  return leases.sort((a, b) => a.branchName.localeCompare(b.branchName))
})
