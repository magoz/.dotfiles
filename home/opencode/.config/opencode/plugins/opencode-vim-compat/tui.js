import legacy from "@leohenon/opencode-vim-plugin"
import { createSignal } from "solid-js"

function eventOf(input, event) {
  return event ?? input?.event
}

function bindingOf(value) {
  if (typeof value === "string") return value
  if (!value || typeof value.name !== "string") return undefined
  return [value.ctrl && "ctrl", value.meta && "meta", value.shift && "shift", value.super && "super", value.name]
    .filter(Boolean)
    .join("+")
}

function commandOf(item) {
  const id = item.name ?? item.id
  const bind = bindingOf(item.key ?? item.bind)

  return {
    ...(id ? { id } : {}),
    ...(item.title ? { title: item.title } : {}),
    ...(item.desc ? { description: item.desc } : {}),
    ...(item.category ? { group: item.category } : {}),
    ...(item.namespace === "palette" ? { palette: true } : {}),
    ...(item.slashName ? { slash: { name: item.slashName } } : {}),
    ...(bind ? { bind } : {}),
    run(input, event) {
      const key = eventOf(input, event)
      const result = item.run({ input, event: key })
      if (result === true) key?.preventDefault?.()
      return result
    },
  }
}

function layerOf(layer, handlers, idPrefix) {
  const commands = (layer.commands ?? []).map(commandOf)

  for (const [index, binding] of (layer.bindings ?? []).entries()) {
    if (typeof binding.cmd === "function") {
      commands.push(commandOf({
        id: `${idPrefix}.${index}`,
        key: binding.key,
        desc: binding.desc,
        category: binding.group,
        run: ({ event }) => binding.cmd({ event }),
      }))
      continue
    }

    commands.push(commandOf({
      id: `${idPrefix}.${index}`,
      key: binding.key,
      desc: binding.desc,
      category: binding.group,
      run: ({ event }) => {
        const result = handlers.get(binding.cmd)?.(event)
        if (result === true) event?.preventDefault?.()
        return result
      },
    }))
  }

  return {
    ...(layer.mode ? { mode: layer.mode } : {}),
    ...(layer.priority !== undefined ? { priority: layer.priority } : {}),
    ...(layer.enabled !== undefined ? { enabled: layer.enabled } : {}),
    commands,
  }
}

function legacyApi(context, dispose, slots, setSlots) {
  const memory = context.storage.memory("legacy-kv", { initial: {} })
  const handlers = new Map()
  let layerIndex = 0

  const keymap = {
    dispatchCommand(id) {
      const local = handlers.get(id)
      if (local) return local()
      context.keymap.dispatch(id)
    },
    registerToken() {
      // V2 does not expose custom key tokens. The Vim plugin only needs this
      // for optional user-defined normal-mode leaders.
    },
    registerLayer(layer) {
      for (const command of layer.commands ?? []) {
        const id = command.name ?? command.id
        if (id) handlers.set(id, event => command.run({ event }))
      }
      const idPrefix = `ocv-compat.binding.${layerIndex++}`
      context.keymap.layer(() => layerOf(layer, handlers, idPrefix))
    },
  }

  const route = {
    get current() {
      const current = context.ui.router.current()
      return current.type === "plugin"
        ? { name: current.name, params: current.data }
        : { name: current.type, params: current.type === "session" ? { sessionID: current.sessionID } : undefined }
    },
  }

  const theme = {
    get current() {
      return {
        background: context.theme.background.default,
        text: context.theme.text.default,
        textMuted: context.theme.text.subdued,
        secondary: context.theme.text.action.primary.focused,
      }
    },
  }

  return {
    renderer: context.renderer,
    route,
    theme,
    keymap,
    kv: {
      get(key, fallback) {
        return key in memory[0] ? memory[0][key] : fallback
      },
      set(key, value) {
        memory[1](draft => {
          draft[key] = value
        })
      },
    },
    lifecycle: {
      onDispose(fn) {
        dispose.push(fn)
        return () => {
          const index = dispose.indexOf(fn)
          if (index !== -1) dispose.splice(index, 1)
        }
      },
    },
    ui: {
      toast(options) {
        context.ui.toast.show(options)
      },
      dialog: {
        clear: () => context.ui.dialog.clear(),
        get open() {
          // Dialogs take editor focus, so the Vim plugin's focused-editor
          // check still keeps prompt handling inactive while one is open.
          return false
        },
      },
    },
    slots: {
      register(plugin) {
        setSlots(current => ({ ...current, ...plugin.slots }))
      },
    },
  }
}

export default {
  id: "ocv-plugin",
  setup(context) {
    if (typeof legacy?.tui !== "function") {
      throw new Error("The installed Vim plugin does not expose its legacy TUI entrypoint")
    }

    const dispose = []
    const [slots, setSlots] = createSignal({})
    let initialized = false

    function Init() {
      if (initialized) return null
      initialized = true
      const api = legacyApi(context, dispose, slots, setSlots)
      void legacy.tui(api, context.options).catch(error => {
        context.ui.toast.show({
          variant: "error",
          title: "Vim plugin",
          message: error instanceof Error ? error.message : String(error),
        })
      })
      return null
    }

    function Status(input) {
      Init()
      const render = input.sessionID ? slots().session_prompt_right : slots().home_prompt_right
      return render?.(input) ?? null
    }

    context.ui.slot({ prepend: "prompt.footer", render: Status })

    return async () => {
      for (const fn of dispose.splice(0).reverse()) await fn()
    }
  },
}
