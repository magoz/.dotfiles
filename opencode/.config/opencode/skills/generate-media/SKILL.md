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

Choose based on what the user wants. When in doubt, use the **recommended default**.

#### Image Generation — "I want to create an image"

| Use case                                        | Model                 | ID / Endpoint                 | Speed   |
| ----------------------------------------------- | --------------------- | ----------------------------- | ------- |
| **Product photos, e-commerce, stock imagery**   | Google Imagen 4       | `google/imagen4`              | ~5-10s  |
| Quick mockups, thumbnails, drafts               | Google Imagen 4 Fast  | `google/imagen4-fast`         | ~3-5s   |
| Print-ready hero images, billboards             | Google Imagen 4 Ultra | `google/imagen4-ultra`        | ~10-20s |
| **Photo restoration, marketing with text**      | Nano Banana Pro       | `nano-banana-pro`             | ~5-10s  |
| Multi-image composition, 4K output              | Nano Banana 2         | `nano-banana-2`               | ~5-10s  |
| Social media posts, style transfer (Ghibli etc) | GPT Image 1.5         | `gpt-image/1.5-text-to-image` | ~10-15s |
| **Logos, posters, signage, packaging**          | Ideogram 3.0          | `ideogram/v3-text-to-image`   | ~5-10s  |
| Brand assets, batch catalogs, automation        | Flux 2 Pro            | `flux-2/pro-text-to-image`    | ~5-10s  |
| Character sheets, consistent multi-scene        | Ideogram Character    | `ideogram/character`          | ~5-10s  |
| Memes, unrestricted people/portrait photos      | Grok Imagine          | `grok-imagine/text-to-image`  | ~5-10s  |
| K-beauty, Asian fashion, CJK marketing          | Seedream 5.0 Lite     | `seedream/5-lite-text-to-image` | ~5-10s |
| Chinese/multilingual marketing materials        | Qwen                  | `qwen/text-to-image`          | ~5-10s  |
| Image gen + editing in one model                | Wan 2.7 Image         | `wan/2-7-image`               | ~5-10s  |

**How to pick:**

- **Photography** (products, food, real estate) → Imagen 4. Best photorealism fidelity, fine-grained textures
- **Marketing materials with text** → Nano Banana Pro. Excels at photo restoration, text overlays, social media ads with accurate copy. Up to 4K resolution
- **Design** (logos, posters, packaging) → Ideogram 3.0. Purpose-built for legible typography. Best text-in-image accuracy
- **Social media / style transfer** → GPT Image 1.5. Viral for Ghibli/Pixar/Vermeer style transfers. Easiest for non-technical users
- **Multi-image composition** → Nano Banana 2. Accepts up to 14 input images, 4K output
- **Automation/batch** → Flux 2 Pro. Supports reference images + JSON-structured prompts. Open-source community favorite
- **Unrestricted portraits** → Grok Imagine. Fewest content restrictions of any major model

#### Image Editing — "I want to modify an existing image"

| Use case                                       | Model             | Endpoint                      | Speed   |
| ---------------------------------------------- | ----------------- | ----------------------------- | ------- |
| **Photo editing, compositing, visual mashups** | 4o Image (GPT)    | 4o Image endpoint             | ~10-20s |
| Outfit/object swaps, character consistency     | Flux Kontext Pro  | Flux Kontext endpoint         | ~5-10s  |
| Complex edits, typography changes              | Flux Kontext Max  | Flux Kontext endpoint         | ~10-15s |
| Inpainting, regional touch-ups                 | Seedream 4.5 Edit | `seedream/4.5-edit`           | ~5-10s  |
| Total style transformation                     | Flux 2 Pro I2I    | `flux-2/pro-image-to-image`   | ~5-10s  |
| Background removal for product cutouts         | Recraft           | `recraft/remove-background`   | ~3-5s   |
| Reframe / change aspect ratio                  | Ideogram Reframe  | `ideogram/v3-reframe`         | ~5-10s  |
| Editing with non-English instructions          | Qwen Edit         | `qwen/image-edit`             | ~5-10s  |
| Photo restoration, cleanup, colorization       | Nano Banana Edit  | `google/nano-banana-edit`     | ~5-10s  |
| Style transfer from image input                | GPT Image 1.5 I2I | `gpt-image/1.5-image-to-image`| ~10-15s |

#### Image Upscaling — "I want higher resolution"

| Use case                             | Model         | ID                      | Speed   |
| ------------------------------------ | ------------- | ----------------------- | ------- |
| **Enlarge for print, crisp details** | Recraft Crisp | `recraft/crisp-upscale` | ~5-15s  |
| Photo enhancement + upscale for web  | Topaz         | `topaz/image-upscale`   | ~10-20s |
| Quick upscale, less critical quality | Grok Upscale  | `grok-imagine/upscale`  | ~5-10s  |

#### Video Generation — "I want to create a video"

| Use case                                      | Model                  | Endpoint                                    | Speed    |
| --------------------------------------------- | ---------------------- | ------------------------------------------- | -------- |
| **Explainers, clips with voiceover/dialogue** | Veo 3.1 Fast           | Veo endpoint (`veo3_fast`)                  | ~1-3 min |
| Short films, ads with native audio            | Veo 3.1 Quality        | Veo endpoint (`veo3`)                       | ~2-5 min |
| Budget video with audio                       | Veo 3.1 Lite           | Veo endpoint (`veo3_lite`)                  | ~1-2 min |
| **Music videos, branded content, fashion**    | Runway Gen-4           | Runway endpoint                             | ~1-3 min |
| **Comedy/parody, social media, up to 15s**    | Kling 3.0              | `kling-3.0/video` (Market)                  | ~1-3 min |
| Animate product photos, reveal sequences      | Kling 2.6 I2V          | `kling/image-to-video` (Market)             | ~1-3 min |
| Cinematic trailers, artistic short films      | Sora 2 Pro             | `sora-2-pro-text-to-video` (Market)         | ~2-5 min |
| TikTok/Reels, viral social media clips        | Hailuo Standard        | `hailuo/02-text-to-video-standard` (Market) | ~1-2 min |
| Animate still photos, portrait motion         | Wan 2.7 I2V            | `wan/2-7-image-to-video` (Market)           | ~1-3 min |
| Talking head videos, presentations            | Kling AI Avatar        | `kling/ai-avatar-pro` (Market)              | ~1-3 min |
| Fast promo videos, ads with audio             | Bytedance Seedance 2   | `bytedance/seedance-2` (Market)             | ~1-2 min |
| Quick video from text description             | Grok Video             | `grok-imagine/text-to-video` (Market)       | ~1-3 min |

**How to pick:**

- **With audio/dialogue** → Veo 3.1. Only model generating synchronized audio natively. `veo3` for quality, `veo3_fast` for speed, `veo3_lite` for budget
- **Comedy/parody** → Kling 3.0. Multi-shot support, element references, up to 15s at 1080p (pro mode)
- **Music videos / brand films** → Runway Gen-4. Pioneer in AI video, best character consistency across shots
- **Social/viral clips** → Hailuo for TikTok templates. Seedance 2 for audio + references
- **Cinematic quality** → Sora 2 Pro for raw visual quality. Veo 3.1 Quality for quality + audio
- **Animate a photo** → Wan 2.7 I2V or Kling 2.6 I2V. Both strong at bringing stills to life
- **Reference-driven** → Seedance 2. Accepts up to 9 reference images, 3 videos, 3 audio files

#### Video Editing — "I want to modify an existing video"

| Use case                                 | Model        | Endpoint                          | Speed    |
| ---------------------------------------- | ------------ | --------------------------------- | -------- |
| **Restyle footage, add visual effects**  | Runway Aleph | Aleph endpoint                    | ~1-3 min |
| Upscale video to higher resolution       | Topaz Video  | `topaz/video-upscale` (Market)    | ~2-5 min |
| Restyle existing video, change aesthetic | Wan 2.6 V2V  | `wan/2-6-video-to-video` (Market) | ~2-5 min |
| Video editing with text instructions     | Wan 2.7 Edit | `wan/2-7-videoedit` (Market)      | ~2-5 min |

#### Music & Audio — "I want to create music or audio"

| Use case                                    | Model                | Endpoint                                       | Speed   |
| ------------------------------------------- | -------------------- | ---------------------------------------------- | ------- |
| **Full songs, jingles, background music**   | Suno V5.5            | Suno endpoint                                  | ~30-60s |
| Songs with specific vocal style             | Suno V5              | Suno endpoint                                  | ~30-60s |
| Sound effects, loops, foley (Suno)          | Suno Sounds          | Suno sounds endpoint                           | ~30-60s |
| **Voiceovers, narration, podcasts**         | ElevenLabs TTS       | `elevenlabs/text-to-speech-turbo-2-5` (Market) | ~3-10s  |
| Custom sound effects, foley                 | ElevenLabs SFX       | `elevenlabs/sound-effect-v2` (Market)          | ~5-10s  |
| Video game dialogue, multi-character scenes | ElevenLabs Dialogue  | `elevenlabs/text-to-dialogue-v3` (Market)      | ~10-20s |
| Transcription, subtitles                    | ElevenLabs STT       | `elevenlabs/speech-to-text` (Market)           | ~5-10s  |
| Remove background noise, isolate vocals     | ElevenLabs Isolation | `elevenlabs/audio-isolation` (Market)          | ~5-10s  |

**How to pick:**

- **Music** → Suno V5.5 (latest, best quality). V5 for predictable output. Suno now supports mashups, persona voices, section replacement, MIDI export
- **Sound effects/loops** → Suno Sounds for musical loops with BPM/key control. ElevenLabs SFX for non-musical sound effects
- **Voice** → ElevenLabs TTS. Industry-leading voice realism and cloning fidelity
- **SFX** → ElevenLabs SFX. Generate any sound effect from text description, royalty-free

### Step 2: Generate Content

There are **6 API families**, each with its own create/poll endpoints. Use the right one.

---

#### A. Market Models (unified endpoint — most models)

Used for: Imagen, Grok, Flux 2, Seedream, GPT Image 1.5, Ideogram, Qwen, Recraft, Topaz, Kling, Sora, Hailuo, Wan, Bytedance, ElevenLabs, Nano Banana, Z-Image.

**Create:**

```bash
curl -s -X POST "https://api.kie.ai/api/v1/jobs/createTask" \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "google/imagen4",
    "input": {
      "prompt": "A serene mountain lake at sunset, photorealistic",
      "aspect_ratio": "16:9"
    }
  }'
```

**Common aspect ratios:** `1:1`, `16:9`, `9:16`, `3:2`, `2:3`, `3:4`, `4:3`

**Image reference params by model** (pass inside `input`):

| Model | Image param | Max | Notes |
|-------|------------|-----|-------|
| `nano-banana-2` | `image_input` (uri[]) | 14 | Multi-image composition, editing |
| `nano-banana-pro` | `image_input` (uri[]) | 8 | Multi-image, up to 4K |
| `google/nano-banana-edit` | `image_urls` (uri[]) | 10 | Image editing |
| `gpt-image/1.5-image-to-image` | `input_urls` (uri[]) | 16 | Style transfer, editing |
| `flux-2/pro-image-to-image` | `input_urls` (uri[]) | 8 | Multi-ref restyle |
| `grok-imagine/image-to-image` | `image_urls` (uri[]) | 5 | Image editing. Ref in prompt via `@image1` |
| `qwen/image-edit` | `image_url` (string) | 1 | Instruction-based edit |
| `seedream/4.5-edit` | `image_urls` (uri[]) | 14 | Regional edits, up to 4K |
| `ideogram/v3-edit` | `image_url` (string) + `mask_url` (string) | 1 | Inpainting with mask |
| `ideogram/v3-remix` | `image_url` (string) | 1 | Remix existing image |
| `ideogram/character-edit` | `image_url` (string) | 1 | Character consistency edit |
| `recraft/crisp-upscale` | `image` (string) | 1 | Upscale input |
| `recraft/remove-background` | `image` (string) | 1 | Background removal |
| `topaz/image-upscale` | `image` (string) | 1 | Upscale input |
| `wan/2-7-image` | `input_urls` (uri[]) | 9 | Image editing, bbox regions, 4K |
| `wan/2-7-image-pro` | `input_urls` (uri[]) | 9 | Image editing (pro) |
| `kling-3.0/video` | `image_urls` (uri[]) | 2 | First/last frame control |
| `bytedance/seedance-2` | `first_frame_url`, `last_frame_url`, `reference_image_urls` (uri[]) | 9 refs | Most flexible: images + video + audio refs |
| `grok-imagine/image-to-video` | `image_urls` (uri[]) | 1 | Animate a still |

Example with image reference:

```bash
curl -s -X POST "https://api.kie.ai/api/v1/jobs/createTask" \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nano-banana-2",
    "input": {
      "prompt": "Transform this photo into a Studio Ghibli style painting",
      "image_input": ["https://example.com/photo.jpg"],
      "aspect_ratio": "16:9",
      "resolution": "2K"
    }
  }'
```

**Poll:**

```bash
curl -s "https://api.kie.ai/api/v1/jobs/recordInfo?taskId=$TASK_ID" \
  -H "Authorization: Bearer $KIE_API_KEY"
```

**States:** `waiting`, `queuing`, `generating` → keep polling. `success` → parse `resultJson`. `fail` → check `failMsg`.

**Result:** `data.resultJson` is a JSON string: `{"resultUrls":["https://..."]}`

---

#### B. 4o Image (GPT image editing)

**Create:**

```bash
curl -s -X POST "https://api.kie.ai/api/v1/gpt4o-image/generate" \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Make this image look like a watercolor painting",
    "filesUrl": ["https://example.com/source-image.jpg"],
    "size": "1:1"
  }'
```

**Sizes:** `1:1`, `3:2`, `2:3`. **filesUrl:** Up to 5 images (.jpg, .png, .webp).
**Options:** `maskUrl` (uri, for inpainting), `isEnhance` (bool), `enableFallback` (bool), `fallbackModel` (`GPT_IMAGE_1` or `FLUX_MAX`)

**Poll:** `GET /api/v1/gpt4o-image/record-info?taskId=xxx`

**Poll response uses `successFlag`:** `0` = generating, `1` = success, `2` = failed
**Result:** `data.response.resultUrls[]`
**Progress:** `data.progress` ("0.00" to "1.00")

---

#### C. Flux Kontext (image generation + editing)

**Create:**

```bash
curl -s -X POST "https://api.kie.ai/api/v1/flux/kontext/generate" \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A futuristic cityscape at night with neon lights",
    "aspectRatio": "16:9",
    "model": "flux-kontext-pro"
  }'
```

**Models:** `flux-kontext-pro` (standard), `flux-kontext-max` (higher quality)
**Aspect ratios:** `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `16:21`
**Image editing:** Add `"inputImage": "https://example.com/image.jpg"` to edit an existing image.
**Options:** `promptUpsampling` (bool), `safetyTolerance` (0-6 generate, 0-2 edit), `outputFormat` (`jpeg`/`png`), `enableTranslation` (bool, default true)

**Poll:** `GET /api/v1/flux/kontext/record-info?taskId=xxx`

**Poll response uses `successFlag`** (not `state`):

- `0` = generating, `1` = success, `2` = create failed, `3` = generate failed
- Result: `data.response.resultImageUrl`

---

#### D. Veo 3.1 Video

**Create:**

```bash
curl -s -X POST "https://api.kie.ai/api/v1/veo/generate" \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A golden retriever running through autumn leaves in slow motion",
    "model": "veo3_fast",
    "aspect_ratio": "16:9"
  }'
```

**Models:** `veo3` (quality), `veo3_fast` (speed), `veo3_lite` (budget)
**Aspect ratios:** `16:9`, `9:16`, `Auto`
**Resolution:** `720p`, `1080p`, `4k`

**Generation types:**

- `TEXT_2_VIDEO` — text only (default)
- `FIRST_AND_LAST_FRAMES_2_VIDEO` — 1-2 images as first/last frame control. Add `"imageUrls": ["https://..."]`
- `REFERENCE_2_VIDEO` — material-to-video (`veo3_fast` only, 1-3 images). Add `"imageUrls": [...]`

**Other params:** `seeds` (int 10000-99999), `enableTranslation` (bool, default true)

**Extend video:** `POST /api/v1/veo/extend` with `{ "taskId": "...", "prompt": "...", "model": "fast" }` (model values: `fast`, `quality`, `lite`)

**HD upgrade:** After success, call:
- `GET /api/v1/veo/get-1080p-video?taskId=xxx&index=0`
- `POST /api/v1/veo/get-4k-video` with `{ "taskId": "...", "index": 0 }` (extra credits, 5-10 min processing)

**Poll:** `GET /api/v1/veo/record-info?taskId=xxx`

**Poll response uses `successFlag`:** `0` = generating, `1` = success, `2`/`3` = failed
**Result:** `data.response.resultUrls[]`

---

#### E. Runway Video

**Create:**

```bash
curl -s -X POST "https://api.kie.ai/api/v1/runway/generate" \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A fluffy cat dancing in a colorful room with disco lights",
    "duration": 5,
    "quality": "720p",
    "aspectRatio": "16:9"
  }'
```

**Duration:** `5` or `10` seconds. **Quality:** `720p` (all durations), `1080p` (5s only).
**Aspect ratios:** `16:9`, `9:16`, `1:1`, `4:3`, `3:4`
**Image-to-video:** Add `"imageUrl": "https://..."`
**Extend video:** `POST /api/v1/runway/extend` with `{ "taskId": "...", "prompt": "...", "quality": "720p" }`

**Poll:** `GET /api/v1/runway/record-detail?taskId=xxx`

**States:** `wait`, `queueing`, `generating` → keep polling. `success` → done. `fail` → check `failMsg`.
**Result:** `data.videoInfo.videoUrl`

**Runway Aleph (video-to-video):**

```bash
curl -s -X POST "https://api.kie.ai/api/v1/aleph/generate" \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Transform into anime style",
    "videoUrl": "https://example.com/input.mp4",
    "aspectRatio": "16:9"
  }'
```

**Aleph aspect ratios:** `16:9`, `9:16`, `4:3`, `3:4`, `1:1`, `21:9`
**Aleph options:** `seed` (int), `referenceImage` (uri)

**Aleph poll:** `GET /api/v1/aleph/record-info?taskId=xxx`

**Aleph uses `successFlag`:** `0` = generating, `1` = success
**Aleph result:** `data.response.resultVideoUrl`

---

#### F. Suno Music

**Create:**

```bash
curl -s -X POST "https://api.kie.ai/api/v1/generate" \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "upbeat electronic track with synth melodies",
    "customMode": false,
    "instrumental": true,
    "model": "V5_5",
    "callBackUrl": "https://example.com/callback"
  }'
```

**Models:** `V4` (better vocals, max 4 min), `V4_5` (smart prompts, max 8 min), `V4_5PLUS` (richer sound, max 8 min), `V4_5ALL` (smart + fast, max 8 min), `V5` (superior musicality, max 8 min), `V5_5` (latest, best quality, max 8 min)

**Custom mode (`customMode: true`):** Requires `style` and `title` fields. Prompt is lyrics.

**Optional params:** `vocalGender` (`m`/`f`), `styleWeight` (0-1), `weirdnessConstraint` (0-1), `audioWeight` (0-1), `negativeTags`, `personaId`

**Extend music:** `POST /api/v1/generate/extend` with `{ "audioId": "...", "prompt": "...", "model": "V5_5" }`

**Generate lyrics:** `POST /api/v1/lyrics` with `{ "prompt": "..." }`

**Poll:** `GET /api/v1/generate/record-info?taskId=xxx`

**Statuses:** `PENDING`, `TEXT_SUCCESS` → keep polling. `SUCCESS` / `FIRST_SUCCESS` → done. `GENERATE_AUDIO_FAILED`, `CREATE_TASK_FAILED`, `SENSITIVE_WORD_ERROR` → failed.
**Result:** `data.response.sunoData[].audioUrl`

**Suno sub-endpoints:**

| Endpoint | Purpose | Key params |
|----------|---------|------------|
| `POST /api/v1/generate/sounds` | Sound effects/loops | `prompt`, `model`, `soundLoop`, `soundTempo` (1-300 BPM), `soundKey` |
| `POST /api/v1/generate/add-instrumental` | Add accompaniment to audio | `uploadUrl`, `title`, `tags`, `negativeTags` |
| `POST /api/v1/generate/add-vocals` | Add vocals to audio | `prompt`, `uploadUrl`, `title`, `style`, `negativeTags` |
| `POST /api/v1/generate/replace-section` | Replace time segment | `taskId`, `audioId`, `prompt`, `tags`, `title`, `infillStartS`, `infillEndS` (6-60s, max 50%) |
| `POST /api/v1/generate/mashup` | Remix 2 tracks | `uploadUrlList` (exactly 2 URIs), `customMode`, `model` |
| `POST /api/v1/generate/generate-persona` | Create voice persona | `taskId`, `audioId`, `name`, `description`, `vocalStart`, `vocalEnd` (10-30s) |
| `POST /api/v1/suno/cover/generate` | Generate cover art | `taskId` |
| `POST /api/v1/vocal-removal/generate` | Separate vocals/instruments | `taskId` |
| `POST /api/v1/midi/generate` | Convert to MIDI | `taskId` (from vocal separation) |
| `POST /api/v1/mp4/generate` | Create music video | `taskId` |
| `POST /api/v1/wav/generate` | Convert to WAV | `taskId` |
| `POST /api/v1/style/generate` | Boost style | `taskId` |

All Suno sub-endpoints use the same poll: `GET /api/v1/generate/record-info?taskId=xxx`

---

### Step 3: Poll for Results

Use the correct polling endpoint for the API family (see Step 2 above). Generic polling pattern:

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

**Polling endpoint reference:**

| API Family   | Create Endpoint                 | Poll Endpoint                      | State Field        | Result Location                    |
| ------------ | ------------------------------- | ---------------------------------- | ------------------ | ---------------------------------- |
| Market       | `/api/v1/jobs/createTask`       | `/api/v1/jobs/recordInfo`          | `data.state`       | `data.resultJson` (JSON string)    |
| 4o Image     | `/api/v1/gpt4o-image/generate`  | `/api/v1/gpt4o-image/record-info`  | `data.successFlag` | `data.response.resultUrls[]`       |
| Flux Kontext | `/api/v1/flux/kontext/generate` | `/api/v1/flux/kontext/record-info` | `data.successFlag` | `data.response.resultImageUrl`     |
| Veo 3.1      | `/api/v1/veo/generate`          | `/api/v1/veo/record-info`          | `data.successFlag` | `data.response.resultUrls[]`       |
| Runway       | `/api/v1/runway/generate`       | `/api/v1/runway/record-detail`     | `data.state`       | `data.videoInfo.videoUrl`          |
| Runway Aleph | `/api/v1/aleph/generate`        | `/api/v1/aleph/record-info`        | `data.successFlag` | `data.response.resultVideoUrl`     |
| Suno         | `/api/v1/generate`              | `/api/v1/generate/record-info`     | `data.status`      | `data.response.sunoData[].audioUrl`|

### Step 4: Download Results

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

### Step 5: Upload Files (when needed)

Some endpoints require publicly accessible URLs for input images/videos. If the user has a local file, upload it first.

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

| Code | Meaning              | Action                                   |
| ---- | -------------------- | ---------------------------------------- |
| 200  | Success              | Parse result                             |
| 401  | Unauthorized         | Check KIE_API_KEY                        |
| 402  | Insufficient credits | User tops up at https://kie.ai/pricing   |
| 408  | Upstream timeout     | Task took >10 min, retry                 |
| 422  | Validation error     | Check params                             |
| 429  | Rate limited         | Wait and retry (max 20 requests per 10s) |
| 433  | Sub-key limit        | API key usage cap exceeded               |
| 455  | Service unavailable  | Maintenance, retry later                 |
| 500  | Server error         | Retry after a few seconds                |
| 501  | Generation failed    | Check failMsg, adjust prompt             |
| 505  | Feature disabled     | Feature not available                    |

## Important Notes

- **Always download results immediately** — URLs expire (14 days for most)
- **Use `jq` to parse JSON** — install via `brew install jq` if needed
- **Poll interval:** 3s for Market images, 5-10s for video/music. Increase to 15-30s after 2 min
- **Max poll time:** ~5 min images, ~10 min video/music
- **Full API docs:** https://docs.kie.ai
- **Pricing:** https://kie.ai/pricing (typically 30-50% cheaper than official APIs)
