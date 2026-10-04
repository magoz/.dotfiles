// Server <-> TUI contract. Portable schemas (see ../shared/portable.ts): the host validates RPC
// traffic with them. The TUI uses only the ID and method name.
import { Schema } from "effect"
import { portable } from "../shared/portable.ts"

export const definition = {
  id: "dotfiles-subscription-usage",
  methods: {
    get: {
      input: portable(Schema.Struct({ sessionID: Schema.String.check(Schema.isMinLength(1)) })),
      output: portable(Schema.Struct({ status: Schema.Literals(["available", "stale", "unavailable"]), text: Schema.String })),
    },
  },
  events: {},
} as const
