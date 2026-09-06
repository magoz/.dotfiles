import { FileSystem, Path } from "@effect/platform"
import { Effect, Schema } from "effect"
import { ProvisionError } from "./provision-domain"

const PackageConfig = Schema.parseJson(Schema.Struct({
  provisionEnv: Schema.optional(Schema.Struct({ appDir: Schema.String }))
}))

const fail = (message: string) => Effect.fail(new ProvisionError({ message }))

// Resolve a selected application without changing checkout/lease identity.
// Never infer an app from directory names or copy a different app's Vercel link.
export const resolveAppDirectory = (repo: string, appDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    if (
      appDir !== "." && (
        path.isAbsolute(appDir) ||
        appDir.includes("\\") ||
        appDir.includes(":") ||
        appDir.split("/").some((part) => part === "" || part === "." || part === "..")
      )
    ) {
      return yield* fail("app directory must be '.' or a checkout-relative path without traversal")
    }
    const directory = path.join(repo, appDir)
    const canonicalRoot = yield* fs.realPath(repo).pipe(
      Effect.mapError(() => new ProvisionError({ message: "cannot resolve checkout directory" }))
    )
    const canonicalApp = yield* fs.realPath(directory).pipe(
      Effect.mapError(() => new ProvisionError({ message: `app directory does not exist: ${appDir}` }))
    )
    if (canonicalApp !== path.join(canonicalRoot, appDir)) {
      return yield* fail("app directory must not traverse symlinks")
    }
    const info = yield* fs.stat(directory).pipe(
      Effect.mapError(() => new ProvisionError({ message: `cannot inspect app directory: ${appDir}` }))
    )
    if (info.type !== "Directory") return yield* fail(`not an app directory: ${appDir}`)
    if (appDir !== ".") {
      const manifest = yield* fs.stat(path.join(directory, "package.json")).pipe(
        Effect.mapError(() => new ProvisionError({ message: "app directory must contain package.json" }))
      )
      if (manifest.type !== "File") return yield* fail("app directory must contain package.json")
    }
    return directory
  })

// Inspect directory entries rather than exists(): dangling symlinks must also fail.
// This is preflight validation, not a sandbox against concurrent same-user mutation.
export const ensureProvisionPaths = (directory: string, files: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    for (const file of files) {
      let parent = directory
      for (const component of file.split("/")) {
        const entries = yield* fs.readDirectory(parent).pipe(
          Effect.mapError(() => new ProvisionError({ message: `cannot inspect provisioning path: ${file}` }))
        )
        if (!entries.includes(component)) break
        const child = path.join(parent, component)
        const canonicalParent = yield* fs.realPath(parent)
        const canonicalChild = yield* fs.realPath(child).pipe(
          Effect.mapError(() => new ProvisionError({ message: `cannot resolve provisioning path: ${file}` }))
        )
        if (canonicalChild !== path.join(canonicalParent, component)) {
          return yield* fail(`provisioning path must not traverse symlinks: ${file}`)
        }
        parent = child
      }
    }
  })

export const resolveProvisionTarget = (repo: string, override?: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    let appDir = override
    if (appDir === undefined) {
      const manifest = path.join(repo, "package.json")
      if (yield* fs.exists(manifest)) {
        const content = yield* fs.readFileString(manifest).pipe(
          Effect.mapError(() => new ProvisionError({ message: "cannot read checkout package.json" }))
        )
        const config = yield* Schema.decodeUnknown(PackageConfig)(content).pipe(
          Effect.mapError(() => new ProvisionError({
            message: "invalid package.json provisioning config; expected provisionEnv.appDir to be a string"
          }))
        )
        appDir = config.provisionEnv?.appDir
      }
    }
    appDir ??= "."
    const directory = yield* resolveAppDirectory(repo, appDir)
    return { appDir, directory }
  })
