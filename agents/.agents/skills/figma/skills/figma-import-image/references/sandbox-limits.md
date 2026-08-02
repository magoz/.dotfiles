# use_figma sandbox — what works, what doesn't

Tested Apr 2026. If any of these start working, update this file and SKILL.md.

## Globals exposed in use_figma

Only these:

- `console`
- `figma`
- `setTimeout` / `clearTimeout`
- `setInterval` / `clearInterval`
- `__queryResultBuilder` (internal)

**Everything else is gone.**

## Globals that are MISSING (unlike a normal browser or Figma plugin)

- `fetch` — not defined. Cannot download bytes from a URL.
- `atob` / `btoa` — undefined. Cannot decode/encode base64.
- `Buffer` — not defined. No Node.js APIs.
- `TextEncoder` / `TextDecoder` — not defined. Cannot convert string↔bytes.
- `Uint8Array.fromBase64` — undefined (TC39 proposal, not exposed).
- `XMLHttpRequest` — not tested but expect missing.

## Figma APIs that are GATED in the MCP sandbox

These exist on the `figma` object but throw when called:

- `figma.createImageAsync(url)` → throws `"not a supported API"`. Would have been the easy path.
- `figma.notify()` → throws "not implemented".
- `figma.currentPage = page` → throws `"Setting figma.currentPage is not supported"`. Use `setCurrentPageAsync` instead.
- `getPluginData` / `setPluginData` → not supported. Use `getSharedPluginData` / `setSharedPluginData`.

## Figma APIs that DO work

- `figma.createImage(bytes)` — **if** you have a `Uint8Array`
- `figma.getNodeByIdAsync`
- `figma.setCurrentPageAsync`
- `figma.createFrame`, `createText`, `createRectangle`, etc.
- `figma.variables.*`
- `figma.loadFontAsync`
- `figma.importComponentByKeyAsync` / `importComponentSetByKeyAsync`
- `figma.importStyleByKeyAsync`
- `figma.variables.importVariableByKeyAsync`
- Reading/writing node properties

## Code size limits in use_figma

- Hard limit on `use_figma.code` field: **50,000 characters**
- Effective limit before MCP times out on processing: **~20,000 characters** (even for simple decoder loops)
- A 32 KB JPEG → 43 KB base64 → reliably times out when embedded as a string literal in code

## Figma REST API

- **No image upload endpoint exists.** Checked.
- `GET /v1/images/:key` only EXPORTS images from a file.
- `GET /v1/files/:key/images` returns existing image metadata.
- Image hashes are cryptographic; cannot be forged.

## Paths tried and their results

| Path | Works? | Why / why not |
|---|---|---|
| `figma.createImageAsync(url)` | ❌ | Blocked in MCP sandbox |
| `fetch(url).then(r => r.arrayBuffer())` | ❌ | `fetch` undefined |
| `atob(b64)` + `figma.createImage(bytes)` | ⚠️ | Works for images <~5 KB. Times out over ~20 KB |
| Manual base64 decoder (no atob) + `createImage` | ⚠️ | Same size/time limits |
| Figma REST API `POST /v1/images` | ❌ | Endpoint does not exist |
| `generate_figma_design` + Playwright MCP | ✅ | Works but Playwright MCP isn't installed by default |
| `generate_figma_design` + `agent-browser` + `data:` URL | ✅ | **The answer.** Any size, any public URL |
| `generate_figma_design` + localhost server + `agent-browser` | ✅ | Also works. Harder because backgrounded `python3 -m http.server` is flaky in this sandbox |
| Drag/drop manually in Figma desktop | ✅ | Always works. Use when automation isn't needed |

## Therefore

From an agent sandbox, the only reliable automated path to import a new bitmap image into a Figma file is:

**`generate_figma_design` + `agent-browser` + `data:` URL**

See [../SKILL.md](../SKILL.md) for the step-by-step.

## Background-process gotcha

In this sandbox, starting a local HTTP server with `python3 -m http.server 3000 &` often appears to work at first (`curl` returns 200 once) but dies or becomes unreachable on the next bash call. Even with `nohup`, `setsid`, `disown`, and stdin redirect, the process disappears.

**Workaround:** use `data:text/html,...` URLs. No server, no background process, no port management. This is why the data-URL path is preferred over the localhost-server path.
