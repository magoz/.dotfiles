---
name: generate-media
description: Generate images, videos, music, and speech using AI models (Imagen, Flux, Veo, Runway, Kling, PixVerse, Suno, ElevenLabs, Gemini, etc.). Use when user asks to create, generate, edit, upscale, or produce any visual or audio media.
---

# Generate Media

Generate images, videos, music, and audio using AI. All generation is asynchronous — submit a task, poll for the result, download immediately.

Powered by kie.ai — a unified API for frequently updated image, video, music, and speech models.

**Catalog last audited:** 2026-08-01 against the English entries in `https://docs.kie.ai/sitemap.xml`.

## Prerequisites

The `KIE_API_KEY` environment variable must be set. If missing, ask the user to provide their API key from https://kie.ai/api-key and set it in their environment (`export KIE_API_KEY=...` or add to `.env`).

## API Basics

**Base URL:** `https://api.kie.ai`

**Auth header (all requests):**

```
Authorization: Bearer $KIE_API_KEY
Content-Type: application/json
```

**Async pattern:** Every generation returns a `taskId`. Poll for results, then download.

**Credit check:** `GET https://api.kie.ai/api/v1/chat/credit` — returns `{ "code": 200, "data": <number> }`

## Workflow

### Step 1: Pick the Right Model

Choose based on what the user wants. When in doubt, use the **recommended default** (bolded).

**Note:** Models are frequently updated on kie.ai. The tables below are curated recommendations — **model IDs may be approximate or outdated**. After picking a model, **always fetch fresh API docs in Step 2** and use the exact model ID from the docs, not from these tables.

#### Image Generation — "I want to create an image"

| Use case | Model | ID |
|----------|-------|----|
| **Best all-round, photorealism, text, up to 4K** | GPT Image 2 | `gpt-image-2-text-to-image` |
| Multi-image input, photo restoration, 4K | Nano Banana Pro | `nano-banana-pro` |
| **Product photos, e-commerce, stock** | Google Imagen 4 | `google/imagen4` |
| Quick mockups, thumbnails, drafts | Google Imagen 4 Fast | `google/imagen4-fast` |
| Print-ready hero images, billboards | Google Imagen 4 Ultra | `google/imagen4-ultra` |
| Multi-image composition, 4K output | Nano Banana 2 | `nano-banana-2` |
| Budget multi-reference generation (up to 10 images) | Nano Banana 2 Lite | `nano-banana-2-lite` |
| Social media posts, style transfer | GPT Image 1.5 | `gpt-image/1.5-text-to-image` |
| **Logos, posters, signage, packaging** | Ideogram 3.0 | `ideogram/v3-text-to-image` |
| Brand assets, batch catalogs, automation | Flux 2 Pro | `flux-2/pro-text-to-image` |
| Flexible 1K/2K generation | Flux 2 Flex | `flux-2/flex-text-to-image` |
| Character sheets, consistent multi-scene | Ideogram Character | `ideogram/character` |
| General portrait and image generation | Grok Imagine | `grok-imagine/text-to-image` |
| High-quality photorealism, 1K/2K | Seedream 5.0 Pro | `seedream/5-pro-text-to-image` |
| Fast CJK and multilingual creative work | Seedream 5.0 Lite | `seedream/5-lite-text-to-image` |
| Chinese/multilingual marketing materials | Qwen | `qwen/text-to-image` |
| Image generation and editing in one family | Wan 2.7 Image | `wan/2-7-image` |

**How to pick:**

- **Best all-round** → GPT Image 2; verify current resolution and speed options in its docs
- **Multi-image / restoration** → Nano Banana Pro or Nano Banana 2; use Nano Banana 2 Lite for a lower tier with up to 10 references
- **Product photography** → Imagen 4 for fine textures and clean photorealism
- **Design** (logos, posters, packaging) → Ideogram 3.0 for typography-heavy work
- **Flexible/batch workflows** → Flux 2 Pro or Flex; compare current inputs, resolution, and price in the fetched docs
- **Photorealistic Seedream output** → Seedream 5 Pro; use Lite when speed or cost matters more
- **Portrait alternative** → Grok Imagine; verify the current content-policy and image-input options before use

#### Image Editing — "I want to modify an existing image"

| Use case | Model | API Family |
|----------|-------|------------|
| **Pixel-level edits, product recolor, compositing** | GPT Image 2 I2I | Market (`gpt-image-2-image-to-image`) |
| Photo editing, compositing, mashups | 4o Image (GPT) | 4o Image |
| Outfit/object swaps, consistency | Flux Kontext Pro | Flux Kontext |
| Complex edits, typography | Flux Kontext Max | Flux Kontext |
| Inpainting, regional touch-ups | Seedream 4.5 Edit | Market (`seedream/4.5-edit`) |
| High-quality reference-based transformation | Seedream 5 Pro I2I | Market (`seedream/5-pro-image-to-image`) |
| Total style transformation | Flux 2 Pro I2I | Market (`flux-2/pro-image-to-image`) |
| Flexible 1K/2K image-conditioned work | Flux 2 Flex I2I | Market (`flux-2/flex-image-to-image`) |
| Background removal | Recraft | Market (`recraft/remove-background`) |
| Non-English editing instructions | Qwen Edit | Market (`qwen/image-edit`) |
| Photo restoration, colorization | Nano Banana Edit | Market (`google/nano-banana-edit`) |
| Style transfer from image input | GPT Image 1.5 I2I | Market (`gpt-image/1.5-image-to-image`) |

#### Image Upscaling — "I want higher resolution"

| Use case | Model | ID |
|----------|-------|----|
| **Enlarge for print, crisp details** | Recraft Crisp | `recraft/crisp-upscale` |
| Photo enhancement + upscale for web | Topaz | `topaz/image-upscale` |
| Quick upscale, less critical quality | Grok Upscale | `grok-imagine/upscale` |

#### Video Generation — "I want to create a video"

| Use case | Model | API Family |
|----------|-------|------------|
| **Explainers and clips with generated audio/dialogue** | Veo 3.1 Fast | Veo (`veo3_fast`) |
| Short films and ads with generated audio | Veo 3.1 Quality | Veo (`veo3`) |
| Budget Veo generation | Veo 3.1 Lite | Veo (`veo3_lite`) |
| **Music videos, branded content, fashion** | Runway Gen-4 | Runway |
| **Multi-shot social clips, up to 15s** | Kling 3.0 | Market (`kling-3.0/video`) |
| Faster 3-15s generation at 720p/1080p | Kling V3 Turbo | Market (`kling/v3-turbo-text-to-video`) |
| Animate product photos, reveal sequences | Kling 2.6 I2V | Market (`kling-2.6/image-to-video`) |
| Fast clips with first/last-frame or multimodal references and audio | Seedance 2 Mini | Market (`bytedance/seedance-2-mini`) |
| Full Seedance 2 promo and ad workflows | Bytedance Seedance 2 | Market (`bytedance/seedance-2`) |
| Budget fast promo, quick turnaround | Bytedance Seedance 2 Fast | Market (`bytedance/seedance-2-fast`) |
| Image animation at up to 1080p | Hailuo 2.3 Pro | Market (`hailuo/2-3-image-to-video-pro`) |
| General T2V and I2V | Wan 2.7 | Market (`wan/2-7-text-to-video`, `wan/2-7-image-to-video`) |
| Character/object/voice consistency from mixed references | Wan 2.7 R2V | Market (`wan/2-7-r2v`) |
| Named subject/background references with optional synchronized audio | PixVerse V6 Reference | Market (`pixverse-v6/reference-to-video`) |
| General 4-15s T2V, I2V, and reference video | MiniMax H3 | Market (`minimax-h3/text-to-video`) |
| Up to 9 visual references, 3-15s, 1080p | HappyHorse 1.1 Reference | Market (`happyhorse-1-1/reference-to-video`) |
| Multimodal asset/character-conditioned video, up to 4K | Gemini Omni Video | Market (`gemini-omni-video`) |
| Quick T2V/I2V with up to 7 references | Grok Imagine Video 1.5 Preview | Market (`grok-imagine-video-1-5-preview`) |
| Talking heads and presentations | Kling AI Avatar | Market (`kling/ai-avatar-pro`) |
| Audio-driven portrait animation | OmniHuman 1.5 | Market (`omnihuman-1-5`) |

**How to pick:**

- **Generated audio/dialogue** → Compare Veo 3.1, Seedance 2 Mini, and PixVerse; audio support is no longer unique to Veo
- **Fast 720p/1080p clips** → Kling V3 Turbo
- **Music videos / brand films** → Runway Gen-4
- **First/last-frame or mixed media control** → Seedance 2 Mini
- **Character/object/voice references** → Wan 2.7 R2V, PixVerse V6 Reference, HappyHorse 1.1, or Gemini Omni; choose by accepted inputs and output limits
- **General T2V** → Wan 2.7 or MiniMax H3
- **Animate a photo** → Wan 2.7 I2V, Kling I2V, or Hailuo 2.3
- **Drive a portrait from audio** → OmniHuman 1.5

#### Video Editing — "I want to modify an existing video"

| Use case | Model | API Family |
|----------|-------|------------|
| **Restyle footage, add visual effects** | Runway Aleph | Runway Aleph |
| Extend an existing generated clip | Grok Imagine Extend | Market (`grok-imagine/extend`) |
| Transfer or control motion from a reference video | Kling 3.0 Motion Control | Market (`kling-3.0/motion-control`) |
| Upscale video to higher resolution | Topaz Video | Market (`topaz/video-upscale`) |
| Restyle existing video, change aesthetic | Wan 2.6 V2V | Market (`wan/2-6-video-to-video`) |
| Video editing with text instructions | Wan 2.7 Edit | Market (`wan/2-7-videoedit`) |

#### Music & Audio — "I want to create music or audio"

| Use case | Model | API Family |
|----------|-------|------------|
| **Full songs, jingles, background music** | Suno | Suno |
| Sound effects and loops | Suno Sounds | Suno |
| **Voiceovers, narration, podcasts** | ElevenLabs TTS | Market (`elevenlabs/text-to-speech-turbo-2-5`) |
| Multi-character dialogue | ElevenLabs Dialogue | Market (`elevenlabs/text-to-dialogue-v3`) |
| Multi-speaker dialogue with configurable voice, accent, style, and pace | Gemini 3.1 Flash TTS | Market (`google/gemini-3-1-flash-tts`) |
| Quality-oriented Gemini speech generation | Gemini 2.5 Pro TTS | Market (`google/gemini-2-5-pro-tts`) |
| Remove background noise, isolate vocals | ElevenLabs Isolation | Market (`elevenlabs/audio-isolation`) |

**How to pick:**

- **Music** → Fetch the Suno generation docs and use a currently accepted model/version value; do not assume the latest version from this table
- **Sound effects/loops** → Suno Sounds when its current endpoint supports the requested output
- **Single-speaker voiceover** → ElevenLabs TTS
- **Structured multi-speaker dialogue** → Gemini 3.1 Flash TTS or ElevenLabs Dialogue; compare voice controls and language support in the fetched docs
- **Advanced Suno operations** → The current docs also expose cover, extend, add vocals/instrumental, lyrics, persona, mashup, WAV, stem-separation, MIDI, music-video, and voice workflows

### Step 2: Fetch Fresh API Documentation

**MANDATORY.** Before making any API call, fetch the latest docs for your chosen model. kie.ai updates models and parameters frequently — hardcoded params go stale.

Fetch the relevant doc page from `https://docs.kie.ai` using web fetch tools or `curl`.

When using `curl`, fetch `${DOC_URL}.md` or send `Accept: text/markdown`; the extensionless URL may return rendered HTML instead of readable OpenAPI YAML.

#### For Market models (most models)

**Do not derive a documentation URL from a model ID.** Kie documentation routes are irregular and change independently of request model IDs. For example, `flux-2/flex-text-to-image` is documented under `/market/flux2/flex-text-to-image`, while `grok-imagine-video-1-5-preview` is under `/market/grok-imagine/1-5-preview`.

1. Fetch `https://docs.kie.ai/sitemap.xml`.
2. Ignore `/cn/` and `/cnmarket/` paths unless the user requests Chinese docs; prefer the canonical `/market/` entry.
3. Search the English URLs for the provider/model name and operation (text-to-image, image-to-video, edit, extend, and so on).
4. Fetch the exact matching page and read its OpenAPI specification.
5. Copy the request `model` enum/default from the OpenAPI schema. Never infer it from the page URL or this skill's tables.

Examples of current irregular mappings:

| Request model ID | Doc URL |
|----------|---------|
| `google/imagen4` | `https://docs.kie.ai/market/google/imagen4` |
| `flux-2/flex-text-to-image` | `https://docs.kie.ai/market/flux2/flex-text-to-image` |
| `grok-imagine-video-1-5-preview` | `https://docs.kie.ai/market/grok-imagine/1-5-preview` |
| `nano-banana-2-lite` | `https://docs.kie.ai/market/google/nano-banana-2-lite` |

Model doc pages return an **OpenAPI spec** with the exact request body schema, parameters, and response format.

Also fetch the shared task detail endpoint docs for polling:

```
https://docs.kie.ai/market/common/get-task-detail
```

#### For non-market API families

These have dedicated endpoints — fetch their specific docs:

| API Family | Create endpoint docs | Poll endpoint docs |
|------------|---------------------|--------------------|
| 4o Image | `https://docs.kie.ai/4o-image-api/generate-4-o-image` | `https://docs.kie.ai/4o-image-api/get-4-o-image-details` |
| Flux Kontext | `https://docs.kie.ai/flux-kontext-api/generate-or-edit-image` | `https://docs.kie.ai/flux-kontext-api/get-image-details` |
| Veo | `https://docs.kie.ai/veo3-api/generate-veo-3-video` | `https://docs.kie.ai/veo3-api/get-veo-3-video-details` |
| Runway | `https://docs.kie.ai/runway-api/generate-ai-video` | `https://docs.kie.ai/runway-api/get-ai-video-details` |
| Runway Aleph | `https://docs.kie.ai/runway-api/generate-aleph-video` | `https://docs.kie.ai/runway-api/get-aleph-video-details` |
| Suno | `https://docs.kie.ai/suno-api/generate-music` | `https://docs.kie.ai/suno-api/get-music-details` |

#### Discovering new models

The official sitemap is the primary current inventory:

```
https://docs.kie.ai/sitemap.xml
```

Search it every time rather than treating this skill's tables as exhaustive. Then fetch the exact English model page and use its OpenAPI `model` enum/default.

Check `https://kie.ai/changelog` only as a secondary source for release notes and parameter changes; the page may be empty even when the docs inventory has changed.

#### If you can't find a model's doc URL

1. Search the English entries in `https://docs.kie.ai/sitemap.xml` by provider, family, and operation—not just the exact model ID
2. Check `https://kie.ai/{model-slug}`; playground pages may appear before API docs
3. Search Kie's official site for the model name plus `site:docs.kie.ai`
4. If no current official page or OpenAPI schema can be found, tell the user and do not guess the model ID or parameters

#### If web fetch is blocked

If the available web fetch tool or `curl` cannot retrieve docs.kie.ai (for example because of rate limiting or network issues), use the `agent-browser` skill to browse the docs interactively.

### Step 3: Generate Content

Use the **fetched docs** to construct the correct API call. General patterns:

**Market models** use a unified endpoint:

```bash
curl -s -X POST "https://api.kie.ai/api/v1/jobs/createTask" \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "<model-id>",
    "input": {
      "prompt": "...",
      ...other params from fetched docs
    }
  }'
```

**Non-market APIs** have dedicated create endpoints — use the exact URL and body from the fetched docs.

**Common aspect ratios:** `1:1`, `16:9`, `9:16`, `3:2`, `2:3`, `3:4`, `4:3`

### Step 4: Poll for Results

Each API family has its own poll endpoint and state field. Refer to fetched docs for exact details. Universal polling pattern:

```bash
poll_task() {
  local task_id="$1"
  local endpoint="$2"  # Full URL: https://api.kie.ai/api/v1/jobs/recordInfo, etc.
  local max_attempts=60
  local interval=5

  for i in $(seq 1 $max_attempts); do
    local response
    response=$(curl -s "${endpoint}?taskId=$task_id" \
      -H "Authorization: Bearer $KIE_API_KEY")

    # Market/Runway use .data.state, Suno uses .data.status
    # Veo/Flux/4o/Aleph use .data.successFlag (0=pending, 1=success, 2/3=fail)
    local state
    state=$(echo "$response" | jq -r '.data.state // empty')
    if [ -z "$state" ]; then
      local flag
      flag=$(echo "$response" | jq -r '.data.successFlag // empty')
      if [ -n "$flag" ]; then
        state="$flag"
      else
        state=$(echo "$response" | jq -r '.data.status // empty')
      fi
    fi

    case "$state" in
      success|1|SUCCESS|FIRST_SUCCESS)
        echo "$response"
        return 0
        ;;
      fail|2|3|GENERATE_AUDIO_FAILED|CREATE_TASK_FAILED|SENSITIVE_WORD_ERROR)
        echo "FAILED" >&2
        echo "$response" >&2
        return 1
        ;;
      *)
        sleep $interval
        ;;
    esac
  done

  echo "Timed out" >&2
  return 1
}
```

**Quick polling reference:**

| API Family | Poll Endpoint | State Field | Result Location |
|------------|--------------|-------------|-----------------|
| Market | `/api/v1/jobs/recordInfo` | `data.state` | `data.resultJson` (JSON string) |
| 4o Image | `/api/v1/gpt4o-image/record-info` | `data.successFlag` | `data.response.resultUrls[]` |
| Flux Kontext | `/api/v1/flux/kontext/record-info` | `data.successFlag` | `data.response.resultImageUrl` |
| Veo | `/api/v1/veo/record-info` | `data.successFlag` | `data.response.resultUrls[]` |
| Runway | `/api/v1/runway/record-detail` | `data.state` | `data.videoInfo.videoUrl` |
| Runway Aleph | `/api/v1/aleph/record-info` | `data.successFlag` | `data.response.resultVideoUrl` |
| Suno | `/api/v1/generate/record-info` | `data.status` | `data.response.sunoData[].audioUrl` |

**Poll intervals:** 3s for Market images, 5-10s for video/music. Increase to 15-30s after 2 min. Max poll: ~5 min images, ~10 min video/music.

### Step 5: Download Results

Result URLs expire (14 days for most). **Always download immediately.**

```bash
curl -sL "$RESULT_URL" -o "./generated-media.png"
```

Use appropriate extension: `.png`/`.jpg` for images, `.mp4` for video, `.mp3` for music.

**Download URL helper** (solves cross-domain issues, valid 20 min):

```bash
curl -s -X POST "https://api.kie.ai/api/v1/common/download-url" \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://..." }'
```

### Step 6: Upload Files (when needed)

Some endpoints require publicly accessible URLs for input images/videos. If the user has a local file, upload it first. For full upload API details, fetch: `https://docs.kie.ai/file-upload-api/quickstart`

**Upload base URL:** `https://kieai.redpandaai.co`

```bash
# Upload via URL
curl -s -X POST "https://kieai.redpandaai.co/api/file-url-upload" \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "fileUrl": "https://example.com/image.jpg" }'

# Upload via base64
curl -s -X POST "https://kieai.redpandaai.co/api/file-base64-upload" \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "base64Data": "<base64_data>", "fileName": "image.jpg" }'

# Upload via file stream
curl -s -X POST "https://kieai.redpandaai.co/api/file-stream-upload" \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -F "file=@/path/to/file.jpg"
```

**Response:** `{ "code": 200, "data": { "fileUrl": "https://...", "downloadUrl": "https://..." } }`

Uploaded files expire after **3 days**. Use the returned `fileUrl` as input to generation endpoints.

## Error Handling

| Code | Meaning | Action |
|------|---------|--------|
| 200 | Success | Parse result |
| 401 | Unauthorized | Check KIE_API_KEY |
| 402 | Insufficient credits | Top up at https://kie.ai/pricing |
| 408 | Upstream timeout | Task took >10 min, retry |
| 422 | Validation error | Check params against fetched docs |
| 429 | Rate limited | Wait and retry (max 20 req/10s) |
| 433 | Sub-key limit | API key usage cap exceeded |
| 455 | Service unavailable | Maintenance, retry later |
| 500 | Server error | Retry after a few seconds |
| 501 | Generation failed | Check failMsg, adjust prompt |
| 505 | Feature disabled | Feature not available |

## Important Notes

- **Always download results immediately** — URLs expire (14 days for most)
- **Use `jq` to parse JSON** — install via `brew install jq` if needed
- **Always fetch fresh docs** before API calls — models and params change frequently
- **Full API docs:** https://docs.kie.ai
- **Pricing:** https://kie.ai/pricing — fetch current pricing before comparing models
