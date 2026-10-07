---
name: generate-media
description: Generate images, videos, music, and speech using AI models (GPT Image, Nano Banana, Seedream, Wan, Seedance, Kling, Veo, Gemini Omni, Suno, ElevenLabs, Gemini TTS, etc.). Use when user asks to create, generate, edit, upscale, or produce any visual or audio media.
metadata:
  opencode/slash: "true"
---

# Generate Media

Generate images, videos, music, and audio using AI. All generation is asynchronous — submit a task, poll for the result, download immediately.

Powered by kie.ai — a unified API for frequently updated image, video, music, and speech models.

This skill adds curated model picks and prices on top of kie's official `kie-models` agent skill, whose API guidance (catalog, schema, upload and polling rules) is merged into Steps 2–6.

**Catalog last audited:** 2026-10-07 against the English entries in `https://docs.kie.ai/sitemap.xml`. Every model ID below was copied from its OpenAPI schema on that date.

**Quality rankings last checked:** 2026-10-07 against LMArena (image), Artificial Analysis (video, speech, music) and recent community discussion. Rankings shift monthly; if this date is more than ~6 weeks old, treat the recommendations as a starting point and check the catalog for newer models.

## Prerequisites

- `KIE_API_KEY` must be set in the environment. If missing, ask the user to create one at https://kie.ai/api-key and export it (`export KIE_API_KEY=...`). Never write the key into files or chat.
- `curl` and `jq` on `PATH`.

## API Basics

**Base URL:** `https://api.kie.ai` (uploads use `https://kieai.redpandaai.co`)

**Auth (all requests):** `Authorization: Bearer $KIE_API_KEY`. A header named `apikey` is rejected with 401.

**Flow:** search the catalog → read the model's schema → `POST /api/v1/jobs/createTask` → poll `GET /api/v1/jobs/recordInfo?taskId=…` → download. As of 2026-10, every media family (Market models, Veo, Runway, Aleph, Suno, Flux Kontext, 4o Image) uses this flow; older dedicated endpoints (`/api/v1/veo/generate`, `/api/v1/generate`, etc.) are no longer documented.

**Every response is `{code, msg, data}`. Check `code` in the body** — HTTP 200 doesn't mean the call succeeded.

## Workflow

### Step 1: Pick the Right Model

Choose based on what the user wants. When in doubt, use the **recommended default** (bolded). If the user names a model, use that model.

**Note:** IDs are verified as of the audit date, but kie.ai changes models often. **Always confirm the model and read its schema in Step 2** before calling it.

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

Descriptions are not model IDs (e.g. `wan 3.0 video`, `Google veo 3.1`, `MiniMax H3`); try a shorter search term if nothing matches. With an API key, `GET /api/v1/models/<model>/price` (Step 2) gives the price for an exact model ID.

### Step 2: Look Up the Model on kie

**MANDATORY.** Before calling a model, confirm it exists and read its schema from kie's catalog API. Never write a model ID or parameter from memory — including from this skill's tables. The catalog changes continuously: models are added, renamed and retired.

All catalog endpoints need `Authorization: Bearer $KIE_API_KEY` and return `{code, msg, data}`. **Check `code` in the body before reading `data`** — HTTP 200 does not mean success.

#### Search the catalog

```bash
curl -s -G -H "Authorization: Bearer $KIE_API_KEY" \
  'https://api.kie.ai/api/v1/models' --data-urlencode 'q=seedance'
```

- Optional filters, combinable: `q` (keyword), `provider` (e.g. `Kling`, `Suno`, `Google`), `taskType` (comma-separated, e.g. `Text to Video,Image to Video`). Percent-encode spaces or use `--data-urlencode` — a raw space aborts curl before it sends.
- The response is not paginated: `data.models[]` with `model` (the ID to use everywhere), `title`, `provider`, `taskType[]`, `description` (sometimes `null`) and `pricingDesc` (prose, matches what the job is billed).
- No match returns `total: 0` and an empty list — that's not an error.
- To compare several views, fetch once unfiltered and filter locally (see rate limits below).

#### Read the schema

```bash
curl -s -H "Authorization: Bearer $KIE_API_KEY" \
  'https://api.kie.ai/api/v1/models/bytedance/seedance-2-5/schema'
```

- **Don't URL-encode the slash** in the model ID; it goes into the path as-is.
- `data.openapi` is the model's full OpenAPI 3.1 document, already inlined as a JSON object. It's the authoritative source for the path and method, every `input` field with type, description, allowed values and defaults, the `required` arrays, and the callback payload.
- `data.openapi` can be `null` when kie hasn't synced the document yet. Fall back to the docs site (below) rather than guessing.
- **Call the path the schema declares.** Media models use `/api/v1/jobs/createTask`; a few models (chat, some Gemini paths) are synchronous endpoints that return the result directly — no task to poll.
- `$ref` pointers are not inlined; resolve them in the same document's `components`. Key names are literal: URL-decode each path segment (`response%20not%20with%20recordId`), and don't trim trailing spaces (`#/components/responses/Error `).
- When `input` is a `oneOf`, satisfy exactly one branch's `required` list; don't mix fields across branches.

#### Check price, reliability and balance

```bash
curl -s -H "Authorization: Bearer $KIE_API_KEY" 'https://api.kie.ai/api/v1/models/veo-3-1/price'
curl -s -H "Authorization: Bearer $KIE_API_KEY" 'https://api.kie.ai/api/v1/models/veo-3-1/success-rate'
curl -s -H "Authorization: Bearer $KIE_API_KEY" 'https://api.kie.ai/api/v1/chat/credit'
```

- `price` returns `{model, pricingDesc}`.
- `success-rate` returns the last 24h in 10-minute buckets (`successRate`, `errorRate`, `isNormal`). `null` rates mean no traffic in that bucket; an empty `points` list means no monitoring data, not zero success. Check it before expensive runs, and when a model keeps failing, before switching to the runner-up.
- `chat/credit` returns the raw credit balance in `data`. Compare it with `pricingDesc` before submitting; insufficient credits come back as `code` 402.

#### Docs site (fallback and human-readable reference)

Use `https://docs.kie.ai` when the schema is `null`, or when you want the prose explanations that schemas lack. Send `Accept: text/markdown`; otherwise you get rendered HTML instead of readable OpenAPI YAML.

**Don't derive a doc URL from a model ID** — the routes are irregular. Search the English entries (skip `/cn/` and `/cnmarket/`) in `https://docs.kie.ai/sitemap.xml` by provider, family and operation. Current examples:

| Model ID | Doc URL |
|----------|---------|
| `nano-banana-2-1` | `https://docs.kie.ai/market/google/nanobanana-2-1` |
| `nano-banana-pro` | `https://docs.kie.ai/market/google/pro-image-to-image` |
| `kling-3.0-omni/text-to-video` | `https://docs.kie.ai/market/kling/v3-omni-text-to-video` |
| `grok-imagine-video-1-5-preview` | `https://docs.kie.ai/market/grok-imagine/1-5-preview` |
| `veo-3-1` | `https://docs.kie.ai/veo3-api/generate-veo-3-video` |
| `ai-music-api/generate` (Suno) | `https://docs.kie.ai/suno-api/generate-music` |
| `runway`, `runway/gen4-aleph` | `https://docs.kie.ai/runway-api/generate-ai-video`, `.../generate-aleph-video` |

If neither the catalog nor the docs list a model, tell the user; don't guess IDs or parameters. If docs.kie.ai can't be fetched, use the `agent-browser` skill.

#### Discovering new models

Fetch the catalog unfiltered and compare it with this skill's tables. For release dates, `https://kie.ai/changelog` loads its entries from `POST https://api.kie.ai/api/v1/common/pageApiAnnouncementList`; the HTML page itself looks empty.

### Step 3: Generate Content

For models whose schema declares `/api/v1/jobs/createTask`:

```bash
curl -s -X POST "https://api.kie.ai/api/v1/jobs/createTask" \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "<model-id>",
    "input": {
      "prompt": "...",
      ...fields from the schema
    }
  }'
```

- `model` must match the catalog exactly. `input` is a nested object whose fields come from the schema and differ per model. `callBackUrl` is optional (required only where the schema says so, e.g. `kling-3.0/motion-control`).
- The response is `{"code": 200, "data": {"taskId": "...", "recordId": "..."}}`. **Poll with `taskId`**, not `recordId`.
- For family models (Veo, Suno, Runway), the top-level `model` is the family ID and the variant goes in `input.model` — see Step 1.
- Helper endpoints such as Gemini Omni character/audio creation use their own paths and respond synchronously — follow their schema or docs.

**Common aspect ratios:** `1:1`, `16:9`, `9:16`, `3:2`, `2:3`, `3:4`, `4:3`

### Step 4: Poll for Results

Poll `GET https://api.kie.ai/api/v1/jobs/recordInfo?taskId=<taskId>` until `data.state` is terminal:

| `state` | `successFlag` | Terminal |
|---------|---------------|----------|
| `waiting`, `queuing`, `generating` | 0 | no |
| `success` | 1 | yes |
| `fail` | 3 | yes — read `failCode` and `failMsg` |

**Never pipe a kie response through `echo`.** `recordInfo` includes JSON-inside-JSON; zsh, dash and busybox `echo` expand its `\\\"` escapes and `jq` then fails with `Invalid numeric literal`. Write responses to a file (as below) or use `printf '%s' "$r" | jq …`.

```bash
out=$(mktemp)
deadline=$(( $(date +%s) + 300 ))  # 5 min for images; use 900+ for video and music
while :; do
  if curl -sf -H "Authorization: Bearer $KIE_API_KEY" \
       "https://api.kie.ai/api/v1/jobs/recordInfo?taskId=$TASK_ID" -o "$out"; then
    [ "$(jq -r .code "$out")" = 200 ] || { jq -r .msg "$out" >&2; break; }
    case $(jq -r .data.state "$out") in
      success) jq '.data.response' "$out"; break ;;
      fail)    jq -r '.data.failMsg' "$out" >&2; break ;;
    esac
  fi
  [ "$(date +%s)" -ge "$deadline" ] && { echo 'gave up waiting' >&2; break; }
  sleep 3
done
rm -f "$out"
```

- 3s is a good interval for images; use 5–10s for video and music. 30s Wan/Seedance clips can take well over 10 minutes.
- `curl -sf` turns HTTP errors into a retry; a non-200 body `code` stops the loop instead of looking like "still running".
- `progress` exists on `recordInfo` but is never filled in. Poll `state`.

#### Reading the output

- `data.response` is `data.resultJson` already parsed. Prefer it.
- Most models put files at `response.resultUrls[]`.
- **Suno is different:** generate, extend, sounds and upload-and-cover/extend return tracks at `response.data[].audio_url` (with `stream_audio_url`, cover `image_url`, `title`, `duration`). Lyrics and MIDI tasks return `response.resultObject` (lyrics at `resultObject.lyricsData[].text`). Suno file utilities (WAV, vocal separation, music video) use `resultUrls`.
- If a successful task has no `resultUrls`, read the model's own structure in `response`.
- `param.input` in the response is your input echoed back as a JSON *string*; parse it again to read it.

### Step 5: Download Results

Generated files are deleted after **14 days**, so always download immediately. Task records (the text `recordInfo` returns) are kept for 2 months.

```bash
curl -sL "$RESULT_URL" -o "./generated-media.png"
```

Use the right extension: `.png`/`.jpg`/`.webp` for images, `.mp4` for video, `.mp3`/`.wav` for audio.

**Direct-download link** for browsers or downstream systems that can't stream the result URL:

```bash
curl -s -X POST "https://api.kie.ai/api/v1/common/download-url" \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://tempfile.redpandaai.co/..." }'
```

The input must be a kie-hosted URL (external URLs return `code` 422). `data` is the link as a bare string, valid for 20 minutes; it doesn't extend the 14-day retention.

### Step 6: Upload Input Files (when needed)

Many image-to-image and image/video-to-video models need a file URL inside `input`. The field name differs per model (`image_url`, `input_urls`, `image_input`, `video_url`, `first_frame_image`, …) — **read it from the schema; don't guess**. If the user already has a public HTTPS URL, use it directly.

Uploads go to a **different host**, `https://kieai.redpandaai.co`, with the same bearer token. **Uploaded files are deleted after 24 hours**, so upload right before submitting.

| Endpoint | When | Body |
|----------|------|------|
| `POST /api/file-stream-upload` | File on disk, any size | `multipart/form-data`: `file`, `uploadPath`, optional `fileName` |
| `POST /api/file-base64-upload` | Small in-memory file (≤10MB) | JSON: `base64Data` (base64 or data URL), `uploadPath`, optional `fileName` |
| `POST /api/file-url-upload` | Rehost a public URL | JSON: `fileUrl`, `uploadPath`, optional `fileName` |

`uploadPath` is **required**, with no leading or trailing slash (e.g. `images/user-uploads`). **Put `data.downloadUrl` from the response into the model's `input`.**

```bash
UPLOAD_URL=$(curl -s -X POST 'https://kieai.redpandaai.co/api/file-stream-upload' \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -F "file=@/path/to/input.png" -F "uploadPath=images/user-uploads" \
  | jq -r .data.downloadUrl)
```

## Rate Limits

Over-limit requests are rejected with `code` 429 **in the body** (HTTP status may still be 200) and are not queued — retry them yourself.

| Endpoints | Limit | Counted per |
|-----------|-------|-------------|
| `models`, `schema`, `price`, `success-rate` | 1 request/second, **one shared budget** | account |
| `createTask` | 20 requests / 10 seconds | account |
| `recordInfo` | 10 requests/second | taskId |

Space discovery calls at least 1.1 seconds apart. `createTask` typically allows 100+ concurrent tasks.

## Error Handling

Codes arrive in the response body's `code` field.

| Code | Meaning | Action |
|------|---------|--------|
| 200 | Success | Parse result |
| 401 | Unauthorized | Check `KIE_API_KEY`; only `Authorization: Bearer` is accepted |
| 402 | Insufficient credits | Top up at https://kie.ai/pricing |
| 404 | Not found | Model ID not in the catalog — search again |
| 408 | Upstream timeout | Task took >10 min, retry |
| 422 | Validation error | Check `input` against the schema's `required` and allowed values |
| 429 | Rate limited | Wait and retry (limits above) |
| 433 | Sub-key limit | API key usage cap exceeded |
| 455 | Service unavailable | Maintenance, retry later |
| 500 | Server error | Retry after a few seconds |
| 501 | Generation failed | Check `failMsg`, adjust prompt |
| 505 | Feature disabled | Feature not available |

Every call also shows up on https://kie.ai/logs with its error.

## Important Notes

- **Look up the catalog and schema every time** — this skill's tables guide the choice; the catalog is the truth
- **Download results immediately** — files expire after 14 days, uploads after 24 hours
- **Use `jq`, never `echo`, to handle responses** — install with `brew install jq` or `apt install jq`
- **Never put `KIE_API_KEY` in files, chat or commits**; it lives only in the environment
- **Full API docs:** https://docs.kie.ai · **Official kie skill** (reference for API changes): `https://kie.ai/.well-known/agent-skills/index.json` → `kie-models.tar.gz`, English text in `references/en.md`

