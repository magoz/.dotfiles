---
name: figma-import-image
description: Import a bitmap image (PNG/JPEG/GIF) from a URL into a Figma file as a frame. Use whenever an image needs to land in Figma — AI mockups, photos, renders, artwork, screenshots. Bypasses use_figma sandbox limits that block the obvious paths (fetch, atob, createImageAsync, REST upload). If you skip this skill and try the obvious paths, you will lose 30+ minutes. Triggers on: import image to Figma, add image to Figma, put image in Figma, Figma image import, bitmap to Figma.
---

# figma-import-image

Get a bitmap image into a Figma file as a real frame with an `Image` hash. Works around the heavy restrictions in the `use_figma` JS sandbox.

## When to use

- A mockup, photo, render, screenshot, or artwork reference needs to live in a Figma file
- The image is at a public URL or a local file that needs hosting first
- Target Figma file already exists (use `create_new_file` first if not)

## Why this skill exists

`use_figma` runs in a restricted JS sandbox. After multiple rounds of trial-and-error, only one path reliably works. Every other path is blocked. **Do not try the blocked paths** — they burn time and lead to dead ends. See [references/sandbox-limits.md](./references/sandbox-limits.md) for the full list.

## Prerequisites

- `agent-browser` CLI available
- Target Figma `fileKey`
- Image at a **public URL** — if local, upload via `vltra_storage_upload_url` first (see Step 0)
- R2 Storage connected in Project > Integrations (for local file uploads)

## Workflow

### Step 0: Upload to R2 (if image is local)

Skip if image is already at a public URL.

```
# 1. Get a presigned upload URL
vltra_storage_upload_url({
  filename: "figma-<timestamp>.png",
  contentType: "image/png"
})
# → { uploadUrl: "https://...presigned...", publicUrl: "https://pub-xxx.r2.dev/figma-<timestamp>.png" }

# 2. Upload the file (no credentials needed — URL is pre-signed)
curl -s -X PUT "<uploadUrl>" -H "Content-Type: image/png" --data-binary @/path/to/file.png

# 3. Use publicUrl in the next steps
```

Adjust `Content-Type` for JPEG (`image/jpeg`) or GIF (`image/gif`).

> **Not connected?** Set up R2 Storage in Project > Integrations first. Requires a Cloudflare R2 bucket with public access enabled.

### Step 1: Get a capture ID

Call `generate_figma_design` — no node ID needed:

```
generate_figma_design({
  outputMode: "existingFile",
  fileKey: "<FILE_KEY>"
})
```

Returns a `captureId` (UUID). Capture IDs are single-use.

### Step 2: Build the data: URL

Dimensions default to A4 portrait `595×842`. Adjust to match your target frame. URL-encode the HTML and prepend `data:text/html,`.

```html
<!DOCTYPE html><html><head>
  <meta charset="utf-8">
  <script src="https://mcp.figma.com/mcp/html-to-design/capture.js"></script>
  <style>
    html,body { margin:0; padding:0; width:595px; height:842px; background:#fff; }
    img { display:block; width:595px; height:842px; object-fit:cover; }
  </style>
</head><body>
  <img src="<PUBLIC_URL>" alt="<ALT>">
</body></html>
```

Append hash params:

```
#figmacapture=<CAPTURE_ID>&figmaendpoint=https%3A%2F%2Fmcp.figma.com%2Fmcp%2Fcapture%2F<CAPTURE_ID>%2Fsubmit&figmadelay=2000
```

One-liner to build in bash (Python for URL-encoding):

```bash
HTML='<!DOCTYPE html><html><head><meta charset="utf-8"><script src="https://mcp.figma.com/mcp/html-to-design/capture.js"></script><style>html,body{margin:0;padding:0;width:595px;height:842px;}img{display:block;width:595px;height:842px;object-fit:cover;}</style></head><body><img src="'"$PUBLIC_URL"'" alt="'"$ALT"'"></body></html>'
ENCODED=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$HTML")
DATA_URL="data:text/html,${ENCODED}#figmacapture=${CID}&figmaendpoint=https%3A%2F%2Fmcp.figma.com%2Fmcp%2Fcapture%2F${CID}%2Fsubmit&figmadelay=2000"
```

### Step 3: Open in agent-browser and wait

```bash
agent-browser set viewport 595 842
agent-browser open "$DATA_URL"
sleep 8
```

Sanity checks (optional):

```bash
agent-browser eval "typeof window.figma"            # "object"
agent-browser eval "document.querySelector('img')?.complete"  # true
```

### Step 4: Poll for completion

```
generate_figma_design({ captureId: "<CAPTURE_ID>" })
```

Returns a Figma node URL like `...?node-id=203-14` when `status: completed`. Poll every 5s, up to ~10 times. Usually completes in <10s.

### Step 5: Move / rename (usually needed)

The captured frame lands at an arbitrary position on the first page. Load `figma-use` and reposition:

```js
const f = await figma.getNodeByIdAsync("<NODE_ID>");
f.name = "<DESCRIPTION>";
f.x = <target-x>;
f.y = <target-y>;
```

### Step 6: Cleanup

```bash
agent-browser close
```

## Pitfalls

- **`ERR_ABORTED` opening a raw image URL in agent-browser** — direct image URLs don't open as pages. Always wrap in HTML (the data: URL).
- **Image doesn't load in capture** — check CORS headers on the source. Some CDNs block anonymous cross-origin image loads. Re-host to R2.
- **Capture ID reused** — each ID captures exactly one page. Get a new one for each image.
- **Frame lands off-screen** — the capture tool places the frame at an arbitrary position. Always reposition in step 5.
- **Do NOT try** to import bytes via base64 inside `use_figma` — times out over ~20KB (see [references/sandbox-limits.md](./references/sandbox-limits.md)).
- **R2 lifecycle** — if your bucket has auto-delete rules (e.g. 7 days), re-upload if generating weeks apart.
