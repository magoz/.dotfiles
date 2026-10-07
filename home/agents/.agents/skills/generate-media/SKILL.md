---
name: generate-media
description: Generate images, videos, music, and speech using AI models (GPT Image, Nano Banana, Seedream, Wan, Seedance, Kling, Veo, Gemini Omni, Suno, ElevenLabs, Gemini TTS, etc.). Use when user asks to create, generate, edit, upscale, or produce any visual or audio media.
metadata:
  opencode/slash: "true"
---

# Generate Media

Generate images, videos, music, and audio using AI. All generation is asynchronous — submit a task, poll for the result, download immediately.

Powered by kie.ai — a unified API for frequently updated image, video, music, and speech models.

**Catalog last audited:** 2026-10-07 against the English entries in `https://docs.kie.ai/sitemap.xml`. Every model ID below was copied from its OpenAPI schema on that date.

**Quality rankings last checked:** 2026-10-07 against LMArena (image), Artificial Analysis (video, speech, music) and recent community discussion. Rankings shift monthly; if this date is more than ~6 weeks old, treat the recommendations as a starting point and check what's new in the sitemap.

## Prerequisites

The `KIE_API_KEY` environment variable must be set. If missing, ask the user to provide their API key from https://kie.ai/api-key and set it in their environment (`export KIE_API_KEY=...` or add to `.env`).

## API Basics

**Base URL:** `https://api.kie.ai`

**Auth header (all requests):**

```
Authorization: Bearer $KIE_API_KEY
Content-Type: application/json
```

**Unified API:** As of 2026-10, every generation family (Market models, Veo, Runway, Runway Aleph, Suno, Flux Kontext, 4o Image) is created with `POST /api/v1/jobs/createTask` and polled with `GET /api/v1/jobs/recordInfo`. Older dedicated endpoints (`/api/v1/veo/generate`, `/api/v1/generate`, etc.) are no longer documented — always follow the fetched docs.

**Async pattern:** Every generation returns a `taskId`. Poll for results, then download.

**Credit check:** `GET https://api.kie.ai/api/v1/chat/credit` — returns `{ "code": 200, "data": <number> }`

## Workflow

### Step 1: Pick the Right Model

Choose based on what the user wants. When in doubt, use the **recommended default** (bolded). If the user names a model, use that model.

**Note:** IDs are verified as of the audit date, but kie.ai changes models often. **Always fetch fresh API docs in Step 2** and use the exact model ID from the docs.

#### Image Generation — "I want to create an image"

| Use case | Model | ID |
|----------|-------|----|
| **Best all-round: photorealism, text, layouts, up to 4K** | GPT Image 2.5 Sunburst | `gpt-image-2-5-sunburst-text-to-image` |
| Same quality family, faster | GPT Image 2.5 Flare | `gpt-image-2-5-flare-text-to-image` |
| **Multi-reference composition, identity, restoration, 4K** | Nano Banana 2.1 | `nano-banana-2-1` |
| Photorealism and identity alternative | Nano Banana Pro | `nano-banana-pro` |
| Typography/layout alternative | Grok Imagine Image 2.0 | `grok-imagine-image-2-0/text-to-image` |
| **Product photos, e-commerce** | Seedream 5.0 Pro | `seedream/5-pro-text-to-image` |
| Fast, cheap drafts | Seedream 5.0 Flash | `seedream/5-flash-text-to-image` |
| Cheapest drafts and thumbnails | Z-Image | `z-image` |
| Dense text layouts, Chinese/multilingual | Qwen3 Pro | `qwen3/pro-text-to-image` |
| **Logos, posters, signage, packaging** | Ideogram 3.0 | `ideogram/v3-text-to-image` |
| Sets of up to 12 consistent images, storyboards | Wan 2.7 Image Pro | `wan/2-7-image-pro` |
| Character sheets, consistent multi-scene | Ideogram Character | `ideogram/character` |

**How to pick:**

- **Default** → GPT Image 2.5 Sunburst: #1 on LMArena text-to-image and image-edit (2026-10-06). Some users report grain/noise in skies and skin; if that shows up, try Nano Banana 2.1 or Flare
- **Sunburst vs Flare** → same price on kie; Sunburst is tuned for precision, Flare for speed
- **Many reference images / keep a person's identity** → Nano Banana 2.1 (up to 10 refs on kie); GPT Image 2.5 I2I accepts up to 16
- **Product photography** → Seedream 5.0 Pro (strong product identity, stricter content moderation than older Seedream)
- **Design** (logos, posters, packaging) → Ideogram 3.0; GPT Image 2.5 is also strong at text. Ideogram 4 and Recraft V4 (vector) are not on kie
- **Grok Imagine Image 2.0** ranks well on leaderboards but gets mixed user reviews (plasticky look, weak prompt adherence); prefer it as an alternative, not a default
- **Outranked, still available:** GPT Image 2, Nano Banana 2 / 2 Lite, Seedream 4.5 / 5 Lite, Imagen 4 (Fast/Ultra), Flux 2 (Pro/Flex), GPT Image 1.5, Qwen / Qwen 2.1, Wan 2.7 Image. Use them only when asked for or when a specific feature needs them

#### Image Editing — "I want to modify an existing image"

| Use case | Model | ID |
|----------|-------|----|
| **Instruction-following edits, compositing, recolor (≤16 refs)** | GPT Image 2.5 Sunburst I2I | `gpt-image-2-5-sunburst-image-to-image` |
| Same, faster | GPT Image 2.5 Flare I2I | `gpt-image-2-5-flare-image-to-image` |
| Multi-image composition, photo restoration | Nano Banana 2.1 (`image_input`) | `nano-banana-2-1` |
| Reference-based edit (1–5 images) | Grok Imagine Image 2.0 | `grok-imagine-image-2-0/image-edit` |
| Masked segment edit: get segments first, then edit them | Grok Imagine Image 2.0 | `grok-imagine-image-2-0/segment-map` → `grok-imagine-image-2-0/segment-edit` |
| Product-preserving edits | Seedream 5.0 Pro I2I | `seedream/5-pro-image-to-image` |
| Split an image into editable PNG layers | Seedream Layer Decomposition | `seedream/5-pro-layer-decomposition`, `seedream/5-flash-layer-decomposition` |
| Mask inpainting | Ideogram V3 Edit | `ideogram/v3-edit` |
| Restyle/remix from an image | Ideogram V3 Remix | `ideogram/v3-remix` |
| Non-English editing instructions | Qwen3 Pro I2I | `qwen3/pro-image-to-image` |
| Background removal | Recraft | `recraft/remove-background` |

**Doc quirk:** the Grok Imagine Image 2.0 doc URLs don't match their IDs. `/market/grok-imagine-image-2-0/image-to-image` documents `grok-imagine-image-2-0/image-edit`, and `/market/grok-imagine-image-2-0/image-edit` documents `grok-imagine-image-2-0/segment-edit`.

#### Image Upscaling — "I want higher resolution"

| Use case | Model | ID |
|----------|-------|----|
| **Enlarge for print, crisp details** | Recraft Crisp | `recraft/crisp-upscale` |
| Photo enhancement, faces, faithful restoration | Topaz | `topaz/image-upscale` |
| Quick upscale, less critical quality | Grok Upscale | `grok-imagine/upscale` |

#### Video Generation — "I want to create a video"

| Use case | Model | ID |
|----------|-------|----|
| **Best overall quality, text-to-video, up to 30s, native audio** | Wan 3.0 | `wan/3-0-video` |
| Wan 3.0, faster tier | Wan 3.0 Prime | `wan/3-0-video-prime` |
| **Multi-shot, ads, many references (≤30 images, 10 clips, 10 audio), 4–30s** | Seedance 2.5 | `bytedance/seedance-2-5` |
| **Image-to-video** | MiniMax H3 I2V | `minimax-h3/image-to-video` |
| Mixed references with always-on stereo audio | MiniMax H3 R2V | `minimax-h3/reference-to-video` |
| Google's top model: characters, voices, up to 4K, 4–10s | Gemini Omni Flash 1.1 | `google/gemini-omni-flash-1-1` |
| Motion/physics, multi-shot (≤6 shots, ≤15s) | Kling 3.0 | `kling-3.0/video` |
| Kling with elements, first/last frame, refs | Kling 3.0 Omni | `kling-3.0-omni/text-to-video`, `kling-3.0-omni/image-to-video`, `kling-3.0-omni/reference-to-video` |
| **Value: fast 720p/1080p clips** | Kling V3 Turbo | `kling/v3-turbo-text-to-video`, `kling/v3-turbo-image-to-video` |
| Lip-synced dialogue, sound-designed cinematic shots | Veo 3.1 | `veo-3-1` with `input.model`: `veo3_fast` (default), `veo3`, `veo3_lite` |
| Budget fast clips, first/last frame | Seedance 2 Mini / Fast | `bytedance/seedance-2-mini`, `bytedance/seedance-2-fast` |
| First+last frame transitions | PixVerse V6 Transition | `pixverse-v6/transition` |
| Named subject/background refs | PixVerse V6 Reference | `pixverse-v6/reference-to-video` |
| Up to 9 visual references, wide language coverage | HappyHorse 1.1 Reference | `happyhorse-1-1/reference-to-video` |
| Quick T2V/I2V with up to 7 refs | Grok Imagine Video 1.5 Preview | `grok-imagine-video-1-5-preview` |
| **Talking heads and presentations** | Kling AI Avatar | `kling/ai-avatar-pro` |
| Audio-driven portrait animation, longer takes | OmniHuman 1.5 | `omnihuman-1-5` |
| Talking head from image + audio | Infinitalk | `infinitalk/from-audio` |

**How to pick:**

- **Default** → Wan 3.0: #1 on Artificial Analysis text-to-video (2026-10-07). Users report slow generation and occasional face drift; switch to Seedance 2.5 if those matter
- **Ads, product shots, on-screen text, multi-shot stories** → Seedance 2.5 (#3 text-to-video, often called the best all-rounder). It's the most expensive option per second — see the cost snapshot
- **Animate a still** → MiniMax H3 I2V (#2 AA image-to-video; H3 Max, the #1, is not on kie), then Seedance 2 or Gemini Omni Flash 1.1
- **Recurring characters or custom voices** → Gemini Omni Flash 1.1 with free Omni helper endpoints: `POST /api/v1/omni/character/create` returns a `character_id`; `POST /api/v1/omni/audio/create` returns an `audioId`. Fetch `https://docs.kie.ai/market/gemini-omni-character` and `https://docs.kie.ai/market/gemini-omni-audio`
- **Dialogue with tight lip-sync** → Veo 3.1 is still the safest pick, though it ranks only ~#18 overall now; Kling 3.0 Omni is the runner-up
- **Audio defaults differ:** Seedance 2.5 and Wan 3.0 generate audio by default; Kling 3.0 Omni does not (`audio` defaults to false)
- **Outranked, still available:** Runway Gen-4 (`runway`), Hailuo 2.3, Wan 2.6/2.7, Kling 2.x, Seedance 1.x/2.0. Kling 4.0 is expected in October 2026; check the sitemap for it

#### Video Editing — "I want to modify an existing video"

| Use case | Model | ID |
|----------|-------|----|
| **Restyle or edit footage from instructions** (docs explicitly support video-editing tasks) | Seedance 2.5 | `bytedance/seedance-2-5` |
| Top-ranked editor, but kie docs only describe `reference_video_urls`, not a dedicated edit mode | Wan 3.0 | `wan/3-0-video` |
| Video-to-video with element references | Kling 3.0 Omni Transformation | `kling-3.0-omni/transformation` |
| Text-instruction edit on 3–60s clips | HappyHorse Video Edit | `happyhorse/video-edit` |
| Text-instruction edit | Wan 2.7 Edit | `wan/2-7-videoedit` |
| Localized edits, VFX | Runway Aleph | `runway/gen4-aleph` |
| Transfer motion from a reference video to a character | Kling 3.0 Motion Control | `kling-3.0/motion-control` (requires `callBackUrl`) |
| Replace speech in a video with new audio | Volcengine Lip Sync | `volcengine/video-to-video-lip-sync` |
| Extend a clip | PixVerse / Grok / Veo Extend | `pixverse-v6/extend`, `grok-imagine/extend`, Veo extend docs |
| Upscale video | Topaz Video | `topaz/video-upscale` |

Video-editing ranking (Artificial Analysis, 2026-10-07): Wan 3.0 #1, Seedance 2.5 #2, Gemini Omni Flash 1.1 #3, Runway Aleph #8. Check each model's docs for the exact edit-mode inputs.

#### Music & Audio — "I want to create music or audio"

| Use case | Model | ID |
|----------|-------|----|
| **Full songs, jingles, background music** | Suno V6 | `ai-music-api/generate` with `input.model: "V6"` |
| Bolder, more experimental output | Suno V6 Wild | `input.model: "V6_WILD"` |
| Cheaper/faster | Suno V6 Mini | `input.model: "V6_MINI"` |
| Replace a section of a song | Suno Replace Section | `ai-music-api/replace-section` |
| Sound effects and loops | Suno Sounds | see `https://docs.kie.ai/suno-api/generate-sounds` |
| **Voiceovers, narration, podcasts** | Gemini 3.8 Flash TTS | `google/gemini-3-8-flash-tts` |
| High-volume, low-latency, cheapest speech | Gemini 3.8 Flash-Lite TTS | `google/gemini-3-8-flash-lite-tts` |
| Specific ElevenLabs voices, fine voice controls | ElevenLabs Turbo 2.5 / Multilingual v2 | `elevenlabs/text-to-speech-turbo-2-5`, `elevenlabs/text-to-speech-multilingual-v2` |
| **Multi-character dialogue** | ElevenLabs Dialogue v3 | `elevenlabs/text-to-dialogue-v3` |
| Dialogue alternative with per-turn style | Gemini 3.8 Flash TTS (`speakers[]` + `dialogue_turns[]`) | `google/gemini-3-8-flash-tts` |
| Remove background noise, isolate vocals | ElevenLabs Isolation | `elevenlabs/audio-isolation` |

**How to pick:**

- **Music** → Suno V6 is #1 on Artificial Analysis music arenas. Many users find it muffled or over-compressed; offer V6 Wild if the result sounds flat. V4–V5_5 are discontinued even though the docs still list them
- **Speech** → Gemini 3.8 Flash TTS is the highest-ranked TTS on kie (AA voice Elo ~1276 vs ~1097 for ElevenLabs Turbo 2.5 / Multilingual v2). There is an open bug report about an intermittent low hum; regenerate if you hear it. ElevenLabs v4, the overall TTS leader, is not on kie yet
- **Dialogue** → ElevenLabs Dialogue v3 is the most reliable; Gemini 3.8 Flash TTS is competitive but has reported voice-swapping in multi-speaker mode
- **Outranked, still available:** Gemini 3.1 Flash TTS, Gemini 2.5 Pro TTS (`https://docs.kie.ai/google/gemini-2-5-pro-tts`)
- **Advanced Suno operations** → cover, extend, add vocals/instrumental, lyrics, timestamped lyrics, persona, mashup, boost style, WAV, stem separation, MIDI, music video, and voice workflows

#### Cost Snapshot (kie.ai, 2026-10-07)

USD as listed on kie.ai/pricing (1 credit ≈ $0.005). Prices change — for anything costly, look up the current price first (see below).

| Model | Price |
|-------|-------|
| GPT Image 2.5 Sunburst/Flare (and GPT Image 2) | $0.03 1K · $0.05 2K · $0.08 4K per image |
| Nano Banana 2.1 | $0.02 1K · $0.03 2K · $0.045 4K per image |
| Nano Banana Pro | $0.09 1–2K · $0.12 4K per image |
| Seedream 5 Pro / 5 Flash | $0.035 1K · $0.07 2K / $0.016 per image |
| Grok Imagine Image 2.0 · Z-Image · Qwen3 Pro | $0.02 · $0.004 · $0.032–0.06 per image |
| Ideogram 3 (Turbo→Quality) · Wan 2.7 Image Pro | $0.0175–0.05 · $0.06 per image |
| Wan 3.0 / Wan 3.0 Prime | $0.04 480p · ~$0.08 720p · $0.16 1080p / $0.25 1080p per second |
| **Seedance 2.5** | $0.14 480p · $0.315 720p · **$0.79 1080p per second** (cheaper with reference video input) |
| Seedance 2 · 2 Fast · 2 Mini (720p) | $0.205 · $0.124 · $0.041 per second |
| MiniMax H3 | $0.04 768p · $0.065 2K per second |
| Kling 3.0 / 3.0 Omni (1080p) · Kling V3 Turbo (1080p) | $0.09 silent, $0.135 with audio · $0.1125 per second |
| Gemini Omni Flash 1.1 | $0.315 4s · $0.525 8s · $0.63 10s per video (1080p); 4K $0.735–1.05 |
| Veo 3.1 Lite / Fast / Quality (1080p) | $0.175 / $0.325 / $1.275 per video |
| PixVerse V6 · HappyHorse 1.1 · Grok Video 1.5 (720p) | $0.036–0.092 · $0.11–0.145 · $0.0225 per second |
| Kling Avatar Pro · OmniHuman 1.5 · Infinitalk 720p · Volcengine lip sync | $0.08 · $0.135 · $0.06 · $0.04 per second |
| Suno generate (any V6 variant) | $0.06 per request |
| Gemini 3.8 Flash TTS / Flash-Lite TTS | $6.30 / $4.20 per 1M output audio tokens |
| ElevenLabs Turbo 2.5 · Multilingual v2 · Dialogue v3 | $0.03 · $0.06 · $0.07 per 1,000 characters |

**Cost notes:**

- Seedance 2.5 at 1080p costs ~$8 for a 10s clip — 5× Wan 3.0. Confirm with the user before long or 1080p Seedance 2.5 runs, or start at 480p/720p
- Wan 3.0 also bills reference-video seconds; Seedance and MiniMax H3 bill reference video at their own per-second rates

**Live price lookup** (no auth; `pageSize` max 100; `modelDescription` is a substring search):

```bash
curl -s -X POST "https://api.kie.ai/client/v1/model-pricing/page" \
  -H "Content-Type: application/json" \
  -d '{"pageNum":1,"pageSize":100,"modelDescription":"seedance-2-5"}' \
  | jq -r '.data.records[] | [.modelDescription, .creditPrice, .creditUnit, .usdPrice] | @tsv'
```

Descriptions are not model IDs (e.g. `wan 3.0 video`, `Google veo 3.1`, `MiniMax H3`); try a shorter search term if nothing matches.

### Step 2: Fetch Fresh API Documentation

**MANDATORY.** Before making any API call, fetch the latest docs for your chosen model. kie.ai updates models and parameters frequently — hardcoded params go stale.

Fetch the relevant doc page from `https://docs.kie.ai` using web fetch tools or `curl`.

When using `curl`, send `Accept: text/markdown`. Without it, extensionless URLs (and sometimes `.md` URLs) return rendered HTML instead of readable OpenAPI YAML.

#### Finding a model's doc page

**Do not derive a documentation URL from a model ID.** Kie documentation routes are irregular and change independently of request model IDs.

1. Fetch `https://docs.kie.ai/sitemap.xml`.
2. Ignore `/cn/` and `/cnmarket/` paths unless the user requests Chinese docs; prefer the canonical `/market/` entry.
3. Search the English URLs for the provider/model name and operation (text-to-image, image-to-video, edit, extend, and so on).
4. Fetch the exact matching page and read its OpenAPI specification.
5. Copy the request `model` enum/default from the OpenAPI schema. Never infer it from the page URL or this skill's tables.

Examples of current irregular mappings:

| Request model ID | Doc URL |
|----------|---------|
| `flux-2/flex-text-to-image` | `https://docs.kie.ai/market/flux2/flex-text-to-image` |
| `grok-imagine-video-1-5-preview` | `https://docs.kie.ai/market/grok-imagine/1-5-preview` |
| `nano-banana-2-1` | `https://docs.kie.ai/market/google/nanobanana-2-1` |
| `nano-banana-pro` | `https://docs.kie.ai/market/google/pro-image-to-image` |
| `kling-3.0-omni/text-to-video` | `https://docs.kie.ai/market/kling/v3-omni-text-to-video` |
| `qwen3/pro-text-to-image` | `https://docs.kie.ai/market/qwen3-pro/text-to-image` |
| `pixverse-v6/reference-to-video` | `https://docs.kie.ai/market/pixverse/reference-to-video` |

Also fetch the shared task detail endpoint docs for polling:

```
https://docs.kie.ai/market/common/get-task-detail
```

#### Families with their own doc sections

These still live outside `/market/` in the docs, but now use the same `createTask` + `recordInfo` flow. The top-level `model` is a family ID; the variant is often in `input.model`.

| Family | Create docs | Top-level `model` |
|--------|-------------|-------------------|
| Veo 3.1 | `https://docs.kie.ai/veo3-api/generate-veo-3-video` (also `extend-video`, `get-veo-3-1080-p-video`, `get-veo-3-4k-video`) | `veo-3-1` |
| Runway | `https://docs.kie.ai/runway-api/generate-ai-video` (also `extend-ai-video`) | `runway` |
| Runway Aleph | `https://docs.kie.ai/runway-api/generate-aleph-video` | `runway/gen4-aleph` |
| Suno | `https://docs.kie.ai/suno-api/generate-music` (and the other `/suno-api/*` pages) | `ai-music-api/generate` |
| Flux Kontext | `https://docs.kie.ai/flux-kontext-api/generate-or-edit-image` | `flux1-kontext` |
| 4o Image | `https://docs.kie.ai/4o-image-api/generate-4-o-image` | `4o-image-api` |

#### Discovering new models

The official sitemap is the primary current inventory:

```
https://docs.kie.ai/sitemap.xml
```

Search it every time rather than treating this skill's tables as exhaustive. Then fetch the exact English model page and use its OpenAPI `model` enum/default.

For release dates, `https://kie.ai/changelog` loads its entries from `POST https://api.kie.ai/api/v1/common/pageApiAnnouncementList`; the HTML page itself may look empty.

#### If you can't find a model's doc URL

1. Search the English entries in `https://docs.kie.ai/sitemap.xml` by provider, family, and operation—not just the exact model ID
2. Check `https://kie.ai/{model-slug}`; playground pages may appear before API docs
3. Search Kie's official site for the model name plus `site:docs.kie.ai`
4. If no current official page or OpenAPI schema can be found, tell the user and do not guess the model ID or parameters

#### If web fetch is blocked

If the available web fetch tool or `curl` cannot retrieve docs.kie.ai (for example because of rate limiting or network issues), use the `agent-browser` skill to browse the docs interactively.

### Step 3: Generate Content

Use the **fetched docs** to construct the correct API call. General pattern:

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

A few helper endpoints (Gemini Omni character/audio creation) use their own paths and respond synchronously — follow their docs.

**Common aspect ratios:** `1:1`, `16:9`, `9:16`, `3:2`, `2:3`, `3:4`, `4:3`

### Step 4: Poll for Results

Poll `GET https://api.kie.ai/api/v1/jobs/recordInfo?taskId=<taskId>`. `data.state` is one of `waiting`, `queuing`, `generating`, `success`, `fail`. On success, `data.resultJson` is a JSON string with the result URLs; on failure, read `data.failCode` and `data.failMsg`. If a fetched doc names a different poll endpoint or result shape, follow the doc.

```bash
poll_task() {
  local task_id="$1"
  local max_attempts=60
  local interval=5

  for i in $(seq 1 $max_attempts); do
    local response state
    response=$(curl -s "https://api.kie.ai/api/v1/jobs/recordInfo?taskId=$task_id" \
      -H "Authorization: Bearer $KIE_API_KEY")
    state=$(echo "$response" | jq -r '.data.state // empty')

    case "$state" in
      success)
        echo "$response" | jq -r '.data.resultJson'
        return 0
        ;;
      fail)
        echo "FAILED: $(echo "$response" | jq -r '.data.failMsg // "unknown"')" >&2
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

**Poll intervals:** 3s for images, 5-10s for video/music. Increase to 15-30s after 2 min. Max poll: ~5 min images, ~10 min video/music (30s Wan/Seedance clips can take longer).

### Step 5: Download Results

Result URLs expire (14 days for most). **Always download immediately.**

```bash
curl -sL "$RESULT_URL" -o "./generated-media.png"
```

Use appropriate extension: `.png`/`.jpg`/`.webp` for images, `.mp4` for video, `.mp3`/`.wav` for audio.

**Download URL helper** (solves cross-domain issues, valid 20 min):

```bash
curl -s -X POST "https://api.kie.ai/api/v1/common/download-url" \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://..." }'
```

### Step 6: Upload Files (when needed)

Some endpoints require publicly accessible URLs for input images/videos/audio. If the user has a local file, upload it first. For full upload API details, fetch: `https://docs.kie.ai/file-upload-api/quickstart`

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
- **Pricing:** https://kie.ai/pricing — doc pages don't list prices; use the live price lookup in Step 1 before comparing models on cost
