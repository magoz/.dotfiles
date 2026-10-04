// Host-boundary schemas. This plugin brings its own copy of `effect` (pinned to the host's
// version): Effects interoperate across the two copies, but Effect *schemas* do not. The host
// re-runs refinements (`Int`, `Finite`, min/max lengths) with its own copy and rejects valid
// values ("Expected an integer"). So every schema the host decodes or encodes (tool input, RPC
// inputs/outputs/events) is handed over as a plain Standard Schema whose `validate` runs here,
// in this plugin's copy. It deliberately is not an Effect schema, so the host never takes its
// Effect-schema path. JSON Schema comes along for the model's tool definition.
import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec"
import { Schema } from "effect"

export interface Portable<Input, Output> extends StandardSchemaV1<Input, Output> {
  readonly "~standard": StandardSchemaV1.Props<Input, Output> & StandardJSONSchemaV1.Props<Input, Output>
}

export function portable<S extends Schema.Codec<unknown, unknown>>(schema: S): Portable<S["Encoded"], S["Type"]> {
  const standard = Schema.toStandardSchemaV1(schema)["~standard"]
  const json = Schema.toStandardJSONSchemaV1(schema)["~standard"].jsonSchema
  return {
    "~standard": {
      version: 1,
      vendor: "effect",
      validate: (value) => standard.validate(value),
      jsonSchema: json,
    },
  }
}
