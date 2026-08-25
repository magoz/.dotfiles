---
name: generate-media
description: Generate images, videos, and music using AI models (Imagen, Flux, Veo, Runway, Kling, Sora, Suno, ElevenLabs, etc.). Use when user asks to create, generate, edit, upscale, or produce any visual or audio media.
---

# Generate Media

Generate images, videos, music, and audio using AI. All generation is asynchronous — submit a task, poll for the result, download immediately.

Powered by kie.ai — a unified API for 50+ models including Google Imagen, Flux, Veo, Runway, Kling, Sora, Suno, ElevenLabs, and more.

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
| Social media posts, style transfer (Ghibli etc) | GPT Image 1.5 | `gpt-image/1.5-text-to-image` |
| **Logos, posters, signage, packaging** | Ideogram 3.0 | `ideogram/v3-text-to-image` |
| Brand assets, batch catalogs, automation | Flux 2 Pro | `flux-2/pro-text-to-image` |
| Character sheets, consistent multi-scene | Ideogram Character | `ideogram/character` |
| Memes, unrestricted people/portrait photos | Grok Imagine | `grok-imagine/text-to-image` |
| K-beauty, Asian fashion, CJK marketing | Seedream 5.0 Lite | `seedream/5-lite-text-to-image` |
| Chinese/multilingual marketing materials | Qwen | `qwen/text-to-image` |
| Image gen + editing in one model | Wan 2.7 Image | `wan/2-7-image` |

**How to pick:**

- **Best all-round** → GPT Image 2. Near-perfect typography, world-knowledge realism, up to 4K, fast (~3s)
- **Multi-image / restoration** → Nano Banana Pro or Nano Banana 2. Multi-image input, photo restoration, 4K
- **Product photography** → Imagen 4. Fine-grained textures, clean photorealism
- **Design** (logos, posters, packaging) → Ideogram 3.0. Best pure typography
- **Style transfer** → GPT Image 1.5. Ghibli/Pixar style transfers
- **Automation/batch** → Flux 2 Pro. Reference images + JSON prompts
- **Unrestricted portraits** → Grok Imagine. Fewest restrictions

#### Image Editing — "I want to modify an existing image"

| Use case | Model | API Family |
|----------|-------|------------|
| **Pixel-level edits, product recolor, compositing** | GPT Image 2 I2I | Market (`gpt-image-2-image-to-image`) |
| Photo editing, compositing, mashups | 4o Image (GPT) | 4o Image |
| Outfit/object swaps, consistency | Flux Kontext Pro | Flux Kontext |
| Complex edits, typography | Flux Kontext Max | Flux Kontext |
| Inpainting, regional touch-ups | Seedream 4.5 Edit | Market (`seedream/4.5-edit`) |
| Total style transformation | Flux 2 Pro I2I | Market (`flux-2/pro-image-to-image`) |
| Background removal | Recraft | Market (`recraft/remove-background`) |
| Reframe / change aspect ratio | Ideogram Reframe | Market (`ideogram/v3-reframe`) |
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
| **Explainers, clips with voiceover/dialogue** | Veo 3.1 Fast | Veo (`veo3_fast`) |
| Short films, ads with native audio | Veo 3.1 Quality | Veo (`veo3`) |
| Budget video with audio | Veo 3.1 Lite | Veo (`veo3_lite`) |
| **Music videos, branded content, fashion** | Runway Gen-4 | Runway |
| **Comedy/parody, social media, up to 15s** | Kling 3.0 | Market (`kling-3.0/video`) |
| Animate product photos, reveal sequences | Kling 2.6 I2V | Market (`kling/image-to-video`) |
| Cinematic trailers, artistic short films | Sora 2 Pro | Market (`sora-2-pro-text-to-video`) |
| Character-consistent multi-shot | Sora 2 Characters Pro | Market (`sora2/sora-2-characters-pro`) |
| TikTok/Reels, viral social media clips | Hailuo Standard | Market (`hailuo/02-text-to-video-standard`) |
| General T2V, motion physics, long scenes | Wan 2.7 T2V | Market (`wan/2-7-text-to-video`) |
| Animate still photos, portrait motion | Wan 2.7 I2V | Market (`wan/2-7-image-to-video`) |
| Talking head videos, presentations | Kling AI Avatar | Market (`kling/ai-avatar-pro`) |
| Fast promo videos, ads with audio | Bytedance Seedance 2 | Market (`bytedance/seedance-2`) |
| Budget fast promo, quick turnaround | Bytedance Seedance 2 Fast | Market (`bytedance/seedance-2-fast`) |
| Quick video from text description | Grok Video | Market (`grok-imagine/text-to-video`) |

**How to pick:**

- **With audio/dialogue** → Veo 3.1. Only model with native synchronized audio
- **Comedy/parody** → Kling 3.0. Multi-shot, element references, up to 15s 1080p
- **Music videos / brand films** → Runway Gen-4. Best character consistency
- **Social/viral clips** → Hailuo or Seedance 2
- **Character consistency** → Sora 2 Characters Pro. Same characters across shots
- **Cinematic quality** → Sora 2 Pro or Veo 3.1 Quality
- **Text-to-video (general)** → Wan 2.7 T2V. Good motion, long scenes
- **Animate a photo** → Wan 2.7 I2V or Kling 2.6 I2V

#### Video Editing — "I want to modify an existing video"

| Use case | Model | API Family |
|----------|-------|------------|
| **Restyle footage, add visual effects** | Runway Aleph | Runway Aleph |
| Upscale video to higher resolution | Topaz Video | Market (`topaz/video-upscale`) |
| Restyle existing video, change aesthetic | Wan 2.6 V2V | Market (`wan/2-6-video-to-video`) |
| Video editing with text instructions | Wan 2.7 Edit | Market (`wan/2-7-videoedit`) |

#### Music & Audio — "I want to create music or audio"

| Use case | Model | API Family |
|----------|-------|------------|
| **Full songs, jingles, background music** | Suno V5.5 | Suno |
| Songs with specific vocal style | Suno V5 | Suno |
| Sound effects, loops, foley | Suno Sounds | Suno |
| **Voiceovers, narration, podcasts** | ElevenLabs TTS | Market (`elevenlabs/text-to-speech-turbo-2-5`) |
| Custom sound effects, foley | ElevenLabs SFX | Market (`elevenlabs/sound-effect-v2`) |
| Video game dialogue, multi-character | ElevenLabs Dialogue | Market (`elevenlabs/text-to-dialogue-v3`) |
| Transcription, subtitles | ElevenLabs STT | Market (`elevenlabs/speech-to-text`) |
| Remove background noise, isolate vocals | ElevenLabs Isolation | Market (`elevenlabs/audio-isolation`) |

**How to pick:**

- **Music** → Suno V5.5 (latest, best quality). Supports mashups, persona voices, section replacement, MIDI
- **Sound effects/loops** → Suno Sounds for musical loops. ElevenLabs SFX for non-musical
- **Voice** → ElevenLabs TTS. Best realism and cloning fidelity
- **SFX** → ElevenLabs SFX. Any sound from text, royalty-free

### Step 2: Fetch Fresh API Documentation

**MANDATORY.** Before making any API call, fetch the latest docs for your chosen model. kie.ai updates models and parameters frequently — hardcoded params go stale.

Fetch the relevant doc page from `https://docs.kie.ai` using web fetch tools or `curl`:

#### For Market models (most models)

Fetch the model's doc page:

```
https://docs.kie.ai/market/{provider}/{model-slug}
```

The provider is the first segment of the model ID (e.g., `google` from `google/imagen4`). The model-slug is the rest with dots replaced by dashes and slashes replaced by dashes. Some model IDs don't contain a `/` (e.g., `nano-banana-pro`) — these don't follow this pattern. Use the sitemap fallback below to find their doc URL.

Examples:

| Model ID | Doc URL |
|----------|---------|
| `google/imagen4` | `https://docs.kie.ai/market/google/imagen4` |
| `ideogram/v3-text-to-image` | `https://docs.kie.ai/market/ideogram/v3-text-to-image` |
| `kling-3.0/video` | `https://docs.kie.ai/market/kling/kling-3-0` |
| `elevenlabs/text-to-speech-turbo-2-5` | `https://docs.kie.ai/market/elevenlabs/text-to-speech-turbo-2-5` |

Model doc pages return an **OpenAPI spec** with the exact request body schema, all parameters, and response format.

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

Check `https://kie.ai/changelog` for recently added models, parameter changes, and new features. Useful when the user asks for a model not listed in the tables above.

#### If you can't find a model's doc URL

1. Check `https://kie.ai/{model-slug}` — playground pages often have param lists even before API docs are published (e.g., `https://kie.ai/nano-banana-pro`)
2. Fetch `https://docs.kie.ai/sitemap.xml` — lists all available doc pages
3. Search for the model name/ID in the URLs
4. Ignore `/cn/` paths (Chinese translations) — use English paths

#### If web fetch is blocked

If `mcp_Webfetch` or `curl` to docs.kie.ai fails (e.g., rate limiting, network issues), use the `agent-browser` skill to browse the docs interactively.

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
- **Pricing:** https://kie.ai/pricing (typically 30-50% cheaper than official APIs)
