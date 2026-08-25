import { FileSystem, Path } from "@effect/platform"
import { Effect, Option, Schema } from "effect"
import { createHash, randomBytes } from "node:crypto"
import { Lease, LeaseError, LeaseFromJson, normalizeLease } from "./domain"

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

const leaseIdentity = (worktree: string, leaseName: string) =>
  leaseName === "default" ? worktree : JSON.stringify([worktree, leaseName])

const leaseFile = (worktree: string, leaseName: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const directory = yield* leaseDirectory
    const digest = createHash("sha256")
      .update(leaseIdentity(worktree, leaseName))
      .digest("hex")
      .slice(0, 16)
    return path.join(directory, `${digest}.json`)
  })

const decodeLease = (content: string) =>
  Schema.decodeUnknown(LeaseFromJson)(content).pipe(
    Effect.map(normalizeLease),
    Effect.map(Option.some),
    Effect.orElseSucceed(() => Option.none<Lease>())
  )

export const readLease = (worktree: string, leaseName = "default") =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const file = yield* leaseFile(worktree, leaseName)
    const exists = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false))
    if (!exists) return Option.none<Lease>()
    const content = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""))
    const decoded = yield* decodeLease(content)
    if (Option.isSome(decoded) && decoded.value.leaseName !== leaseName) {
      return Option.none<Lease>()
    }
    return decoded
  })

export const writeLease = (lease: Lease) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const file = yield* leaseFile(lease.worktree, lease.leaseName)
    const temporary = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`
    const content = yield* Schema.encode(LeaseFromJson)(lease).pipe(
      Effect.mapError((cause) => new LeaseError({ message: `lease encoding failed: ${cause}` }))
    )
    yield* fs.writeFileString(temporary, `${content}\n`).pipe(
      Effect.mapError((cause) => new LeaseError({ message: `lease write failed: ${cause}` }))
    )
    yield* fs.chmod(temporary, 0o600).pipe(
      Effect.mapError((cause) => new LeaseError({ message: `lease chmod failed: ${cause}` }))
    )
    yield* fs.rename(temporary, file).pipe(
      Effect.mapError((cause) => new LeaseError({ message: `lease replace failed: ${cause}` }))
    )
  })

export const removeLease = (worktree: string, leaseName = "default") =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const file = yield* leaseFile(worktree, leaseName)
    yield* fs.remove(file).pipe(Effect.orElseSucceed(() => undefined))
  })

export const allLeases = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = yield* leaseDirectory
  const entries = yield* fs.readDirectory(directory).pipe(
    Effect.orElseSucceed(() => [] as ReadonlyArray<string>)
  )
  const leases: Array<Lease> = []
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue
    const content = yield* fs.readFileString(path.join(directory, entry)).pipe(
      Effect.orElseSucceed(() => "")
    )
    const decoded = yield* decodeLease(content)
    if (Option.isSome(decoded)) leases.push(decoded.value)
  }
  return leases.sort(
    (a, b) => a.worktree.localeCompare(b.worktree) || a.leaseName.localeCompare(b.leaseName)
  )
})
