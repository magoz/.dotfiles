---
name: generate-media
description: Generate images, videos, and music using AI models (Midjourney, Imagen, Flux, Veo, Runway, Kling, Sora, Suno, ElevenLabs, Luma, etc.). Use when user asks to create, generate, edit, upscale, or produce any visual or audio media.
---

# Generate Media

Generate images, videos, music, and audio using AI. All generation is asynchronous — submit a task, poll for the result, download immediately.

Powered by kie.ai — a unified API for 50+ models including Midjourney, Google Imagen, Flux, Veo, Runway, Kling, Sora, Suno, ElevenLabs, and more.

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

| Use case                                        | Model                 | ID / Endpoint                  | Speed    |
| ----------------------------------------------- | --------------------- | ------------------------------ | -------- |
| **Concept art, fantasy, editorial imagery**     | Midjourney v7         | MJ endpoint (`mj_txt2img`)     | ~30-120s |
| Anime, manga, game character art                | Midjourney niji7      | MJ endpoint (version: `niji7`) | ~30-120s |
| **Product photos, e-commerce, stock imagery**   | Google Imagen 4       | `google/imagen4`               | ~5-10s   |
| Quick mockups, thumbnails, drafts               | Google Imagen 4 Fast  | `google/imagen4-fast`          | ~3-5s    |
| Print-ready hero images, billboards             | Google Imagen 4 Ultra | `google/imagen4-ultra`         | ~10-20s  |
| **Photo restoration, marketing with text**      | Nano Banana Pro       | `google/nano-banana`           | ~5-10s   |
| Social media posts, style transfer (Ghibli etc) | GPT Image 1.5         | `gpt-image/1.5-text-to-image`  | ~10-15s  |
| **Logos, posters, signage, packaging**          | Ideogram 3.0          | `ideogram/character`           | ~5-10s   |
| Brand assets, batch catalogs, automation        | Flux 2 Pro            | `flux-2/pro-text-to-image`     | ~5-10s   |
| Character sheets, consistent multi-scene        | Ideogram Character    | `ideogram/character`           | ~5-10s   |
| Memes, unrestricted people/portrait photos      | Grok Imagine          | `grok-imagine/text-to-image`   | ~5-10s   |
| K-beauty, Asian fashion, CJK marketing          | Seedream 4.5          | `seedream/4.5-text-to-image`   | ~5-10s   |
| Chinese/multilingual marketing materials        | Qwen                  | `qwen/text-to-image`           | ~5-10s   |

**How to pick:**

- **Illustration / concept art** → Midjourney v7. Consistently the most praised for artistic beauty, cinematic lighting, rich textures. Looks professionally art-directed without heavy prompting. Community favorite for album covers, fantasy art, editorial imagery
- **Photography** (products, food, real estate) → Imagen 4. Best photorealism fidelity, fine-grained textures
- **Marketing materials with text** → Nano Banana Pro. ZDNET's #1 ranked image model (93% score). Excels at photo restoration, text overlays, social media ads with accurate copy
- **Design** (logos, posters, packaging) → Ideogram 3.0. Purpose-built for legible typography. Community consensus: best text-in-image accuracy
- **Social media / style transfer** → GPT Image 1.5. Went viral for Ghibli/Pixar/Vermeer style transfers. Easiest for non-technical users via chat
- **Anime/manga** → Midjourney niji7. Specialized model, no competitor comes close
- **Automation/batch** → Flux 2 Pro. Supports 8 reference images + JSON-structured prompts. Favorite of the open-source community for custom pipelines
- **Unrestricted portraits** → Grok Imagine. Fewest content restrictions of any major model

#### Image Editing — "I want to modify an existing image"

| Use case                                       | Model              | Endpoint                           | Speed    |
| ---------------------------------------------- | ------------------ | ---------------------------------- | -------- |
| **Photo editing, compositing, visual mashups** | 4o Image (GPT)     | 4o Image endpoint                  | ~10-20s  |
| Outfit/object swaps, character consistency     | Flux Kontext Pro   | Flux Kontext endpoint              | ~5-10s   |
| Complex edits, typography changes              | Flux Kontext Max   | Flux Kontext endpoint              | ~10-15s  |
| Apply art style from reference image           | MJ Style Reference | MJ endpoint (`mj_style_reference`) | ~30-120s |
| Put character/object into new scene            | MJ Omni Reference  | MJ endpoint (`mj_omni_reference`)  | ~30-120s |
| Inpainting, regional touch-ups                 | Seedream 4.5 Edit  | `seedream/4.5-edit`                | ~5-10s   |
| Total style transformation                     | Flux 2 Pro I2I     | `flux-2/pro-image-to-image`        | ~5-10s   |
| Background removal for product cutouts         | Recraft            | `recraft/remove-background`        | ~3-5s    |
| Reframe / change aspect ratio                  | Ideogram Reframe   | `ideogram/v3-reframe`              | ~5-10s   |
| Editing with non-English instructions          | Qwen Edit          | `qwen/image-edit`                  | ~5-10s   |
| Photo restoration, cleanup, colorization       | Nano Banana Edit   | `google/nano-banana-edit`          | ~5-10s   |

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
| **Music videos, branded content, fashion**    | Runway Gen-4           | Runway endpoint                             | ~1-3 min |
| **Comedy/parody, social media, up to 2min**   | Kling 3.0              | `kling-3.0` (Market)                        | ~1-3 min |
| Animate product photos, reveal sequences      | Kling 2.6 I2V          | `kling-2.6/image-to-video` (Market)         | ~1-3 min |
| Cinematic trailers, artistic short films      | Sora 2 Pro             | `sora-2-pro-text-to-video` (Market)         | ~2-5 min |
| TikTok/Reels, viral social media clips        | Hailuo Standard        | `hailuo/02-text-to-video-standard` (Market) | ~1-2 min |
| Animate still photos, portrait motion         | Wan 2.6 I2V            | `wan/2-6-image-to-video` (Market)           | ~1-3 min |
| Talking head videos, presentations            | Kling AI Avatar        | `kling/ai-avatar-pro` (Market)              | ~1-3 min |
| Fast promo videos, ads                        | Bytedance Seedance 1.5 | `bytedance/seedance-1.5-pro` (Market)       | ~1-2 min |
| Quick video from text description             | Grok Video             | `grok-imagine/text-to-video` (Market)       | ~1-3 min |
| Video modification, dreamlike effects         | Luma                   | Luma endpoint                               | ~2-5 min |
| MJ-aesthetic image-to-video                   | Midjourney Video       | MJ endpoint (`mj_video`)                    | ~1-5 min |

**How to pick:**

- **With audio/dialogue** → Veo 3.1. Only model generating synchronized audio natively. "The moment AI video left the silent film era" — all others need post-production audio
- **Comedy/parody** → Kling 3.0. Most popular on r/aivideo for comedy content. Up to 2 min at 1080p, excellent motion quality
- **Music videos / brand films** → Runway Gen-4. Pioneer in AI video, best character consistency across shots. Widely used by professional creators
- **Social/viral clips** → Hailuo for TikTok templates. Kling 3.0 for longer-form social
- **Cinematic quality** → Sora 2 Pro for raw visual quality (controversial but impressive). Veo 3.1 Quality for quality + audio
- **Animate a photo** → Kling 2.6 I2V or Wan 2.6 I2V. Both strong at bringing stills to life

#### Video Editing — "I want to modify an existing video"

| Use case                                 | Model        | Endpoint                          | Speed    |
| ---------------------------------------- | ------------ | --------------------------------- | -------- |
| **Restyle footage, add visual effects**  | Luma Modify  | Luma endpoint                     | ~2-5 min |
| Transform video style with text prompt   | Runway Aleph | Runway Aleph endpoint             | ~1-3 min |
| Upscale video to higher resolution       | Topaz Video  | `topaz/video-upscale` (Market)    | ~2-5 min |
| Restyle existing video, change aesthetic | Wan 2.6 V2V  | `wan/2-6-video-to-video` (Market) | ~2-5 min |

#### Music & Audio — "I want to create music or audio"

| Use case                                    | Model                | Endpoint                                       | Speed   |
| ------------------------------------------- | -------------------- | ---------------------------------------------- | ------- |
| **Full songs, jingles, background music**   | Suno V5              | Suno endpoint                                  | ~30-60s |
| Songs with specific vocal style             | Suno V4.5            | Suno endpoint                                  | ~30-60s |
| **Voiceovers, narration, podcasts**         | ElevenLabs TTS       | `elevenlabs/text-to-speech-turbo-2-5` (Market) | ~3-10s  |
| Custom sound effects, foley                 | ElevenLabs SFX       | `elevenlabs/sound-effect-v2` (Market)          | ~5-10s  |
| Video game dialogue, multi-character scenes | ElevenLabs Dialogue  | `elevenlabs/text-to-dialogue-v3` (Market)      | ~10-20s |
| Transcription, subtitles                    | ElevenLabs STT       | `elevenlabs/speech-to-text` (Market)           | ~5-10s  |
| Remove background noise, isolate vocals     | ElevenLabs Isolation | `elevenlabs/audio-isolation` (Market)          | ~5-10s  |

**How to pick:**

- **Music** → Suno V5. Dominant AI music platform ($2.45B valuation). Suno Studio adds DAW-like editing. V5 for best quality, V4.5 for more predictable output
- **Voice** → ElevenLabs TTS. Industry-leading voice realism and cloning fidelity
- **SFX** → ElevenLabs SFX. Generate any sound effect from text description, royalty-free

### Step 2: Generate Content

There are **8 API families**, each with its own create/poll endpoints. Use the right one.

---

#### A. Market Models (unified endpoint — most models)

Used for: Imagen, Grok, Flux 2, Seedream, GPT Image, Ideogram, Qwen, Recraft, Topaz, Kling, Sora, Hailuo, Wan, Bytedance, ElevenLabs, Nano Banana.

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

**Poll:** `GET /api/v1/gpt4o-image/record-info?taskId=xxx`

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
**Options:** `promptUpsampling` (bool), `safetyTolerance` (0-6 generate, 0-2 edit), `outputFormat` (`jpeg`/`png`)

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

**Models:** `veo3` (quality), `veo3_fast` (speed)
**Aspect ratios:** `16:9`, `9:16`, `Auto`

**Image-to-video:** Add `"imageUrls": ["https://..."], "generationType": "FIRST_AND_LAST_FRAMES_2_VIDEO"`

**Extend video:** `POST /api/v1/veo/extend-video` with `{ "taskId": "original_task", "prompt": "..." }`

**HD upgrade (16:9 only):** After success, call `GET /api/v1/veo/get-1080p-video?taskId=xxx` or `GET /api/v1/veo/get-4k-video?taskId=xxx`

**Poll:** `GET /api/v1/veo/record-info?taskId=xxx`

**Poll response uses `successFlag`:** `0` = generating, `1` = success, `2`/`3` = failed
**Result:** `data.resultUrls` (JSON string of URL array)

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
**Extend video:** `POST /api/v1/runway/extend` with `{ "taskId": "original_task", "prompt": "...", "quality": "720p" }`

**Runway Aleph (video-to-video):**

```bash
curl -s -X POST "https://api.kie.ai/api/v1/runway/generate/aleph" \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Transform into anime style",
    "videoUrl": "https://example.com/input.mp4",
    "duration": 5,
    "aspectRatio": "16:9"
  }'
```

**Poll:** `GET /api/v1/runway/record-detail?taskId=xxx`

**States:** `wait`, `queueing`, `generating` → keep polling. `success` → done. `fail` → check `failMsg`.
**Result:** `data.videoInfo.videoUrl`

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
    "model": "V5"
  }'
```

**Models:** `V3_5` (structured songs, max 4 min), `V4` (better vocals, max 4 min), `V4_5` (smart prompts, max 8 min), `V4_5PLUS` (richer sound, max 8 min), `V4_5ALL` (smart + fast, max 8 min), `V5` (fastest, superior musicality, max 8 min)

**Custom mode (`customMode: true`):** Requires `style` and `title` fields. Prompt is lyrics.

**Extend music:** `POST /api/v1/generate/extend` with `{ "audioId": "...", "prompt": "...", "model": "V5" }`

**Generate lyrics:** `POST /api/v1/lyrics` with `{ "prompt": "..." }`

**Poll:** `GET /api/v1/generate/record-info?taskId=xxx`

**Statuses:** `PENDING` → keep polling. `SUCCESS` / `FIRST_SUCCESS` → done. `GENERATE_AUDIO_FAILED` → failed.
**Result:** `data.response.sunoData[].audioUrl`

---

#### G. Midjourney

Midjourney produces 4 images per request (grid). Best for artistic/editorial imagery, concept art, illustration. Returns `resultUrls` array with 4 image URLs.

**Create (text-to-image):**

```bash
curl -s -X POST "https://api.kie.ai/api/v1/mj/generate" \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "taskType": "mj_txt2img",
    "prompt": "a serene mountain lake at sunset, photorealistic",
    "speed": "fast",
    "aspectRatio": "16:9",
    "version": "7"
  }'
```

**Create (image-to-image):**

```bash
curl -s -X POST "https://api.kie.ai/api/v1/mj/generate" \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "taskType": "mj_img2img",
    "prompt": "transform into watercolor painting style",
    "fileUrls": ["https://example.com/source.jpg"],
    "speed": "fast",
    "version": "7"
  }'
```

**Create (image-to-video):**

```bash
curl -s -X POST "https://api.kie.ai/api/v1/mj/generate" \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "taskType": "mj_video",
    "prompt": "camera slowly zooms out revealing the full scene",
    "fileUrls": ["https://example.com/image.jpg"],
    "aspectRatio": "16:9"
  }'
```

**Create (style reference — apply style from reference image):**

```bash
curl -s -X POST "https://api.kie.ai/api/v1/mj/generate" \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "taskType": "mj_style_reference",
    "prompt": "a futuristic city at night",
    "fileUrls": ["https://example.com/style-reference.jpg"],
    "speed": "fast",
    "version": "7"
  }'
```

**Create (omni reference — put characters/objects from reference into new image):**

```bash
curl -s -X POST "https://api.kie.ai/api/v1/mj/generate" \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "taskType": "mj_omni_reference",
    "prompt": "the character standing in a medieval castle",
    "fileUrls": ["https://example.com/character.jpg"],
    "ow": 500
  }'
```

**Task types:**
| Type | Purpose | Required fields |
|------|---------|-----------------|
| `mj_txt2img` | Text-to-image | `prompt`, `speed` |
| `mj_img2img` | Image-to-image | `prompt`, `speed`, `fileUrls` |
| `mj_video` | Image-to-video (~$0.30) | `prompt`, `fileUrls` (1 image only) |
| `mj_style_reference` | Apply style from reference | `prompt`, `speed`, `fileUrls` |
| `mj_omni_reference` | Transfer characters/objects | `prompt`, `fileUrls`, `ow` |

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `taskType` | string (required) | See table above |
| `prompt` | string (required) | Max 2000 chars. Detailed description of desired output |
| `speed` | string | `relaxed` (~$0.015), `fast` (~$0.04), `turbo` (~$0.08). Not used for `mj_video`/`mj_omni_reference` |
| `fileUrls` | string[] | Input images. Required for img2img/video/style_ref/omni_ref. 1 image max for video |
| `fileUrl` | string | Single input image (legacy — prefer `fileUrls`) |
| `aspectRatio` | string | `1:2`, `9:16`, `2:3`, `3:4`, `5:6`, `6:5`, `4:3`, `3:2`, `1:1`, `16:9`, `2:1` |
| `version` | string | `7` (default, best), `6.1`, `6`, `5.2`, `5.1`, `niji6` (anime), `niji7` (anime) |
| `stylization` | int 0-1000 | Artistic intensity. Higher = more stylized. Multiples of 50 |
| `weirdness` | int 0-3000 | Creativity/uniqueness. Higher = more unusual. Multiples of 100 |
| `variety` | int 0-100 | Diversity of 4 results. Higher = more diverse. Increments of 5 |
| `ow` | int 1-1000 | Omni reference strength. Only for `mj_omni_reference`. Higher = stronger reference |
| `enableTranslation` | bool | Auto-translate non-English prompts (defaults true) |
| `callBackUrl` | string | Webhook URL for completion notification |
| `waterMark` | string | Optional watermark identifier |

**Version guide:**

- `7` — latest, best overall quality and coherency (default)
- `6.1` / `6` — previous gen, more predictable/controllable
- `niji7` — specialized for anime/manga (best anime model available)
- `niji6` — previous anime model

**Poll:** `GET /api/v1/mj/record-info?taskId=xxx`

**Poll response uses `successFlag`:** `0` = generating, `1` = success, `2`/`3` = failed
**Result:** `data.resultInfoJson.resultUrls[]` — array of objects, each with `resultUrl` field (4 for images, 1 for video)

**Parse result:**

```bash
# Extract all image URLs from MJ result
echo "$response" | jq -r '.data.resultInfoJson.resultUrls[].resultUrl'
```

**Callback format (if `callBackUrl` provided):**

```json
{
  "code": 200,
  "data": { "taskId": "...", "resultUrls": ["url1", "url2", "url3", "url4"] }
}
```

**Timing:** `relaxed` ~2-5 min, `fast` ~30-60s, `turbo` ~15-30s. Poll every 10s for MJ.

---

#### H. Luma Video Modification

**Create:**

```bash
curl -s -X POST "https://api.kie.ai/api/v1/modify/generate" \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Transform into a futuristic cityscape with neon lights",
    "videoUrl": "https://example.com/input-video.mp4"
  }'
```

**Poll:** `GET /api/v1/modify/record-info?taskId=xxx`

**Poll response uses `successFlag`:** `0` = generating, `1` = success, `2`/`3` = failed, `4` = success but callback failed
**Result:** `data.response.resultUrls[]`

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
    # Veo/Flux/4o/MJ/Luma use .data.successFlag (0=pending, 1=success, 2/3=fail)
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
      fail|2|3|GENERATE_AUDIO_FAILED|CREATE_TASK_FAILED)
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

| API Family   | Create Endpoint                 | Poll Endpoint                      | State Field        | Result Location                              |
| ------------ | ------------------------------- | ---------------------------------- | ------------------ | -------------------------------------------- |
| Market       | `/api/v1/jobs/createTask`       | `/api/v1/jobs/recordInfo`          | `data.state`       | `data.resultJson` (JSON string)              |
| 4o Image     | `/api/v1/gpt4o-image/generate`  | `/api/v1/gpt4o-image/record-info`  | `data.successFlag` | `data.response`                              |
| Flux Kontext | `/api/v1/flux/kontext/generate` | `/api/v1/flux/kontext/record-info` | `data.successFlag` | `data.response.resultImageUrl`               |
| Veo 3.1      | `/api/v1/veo/generate`          | `/api/v1/veo/record-info`          | `data.successFlag` | `data.resultUrls` (JSON string)              |
| Runway       | `/api/v1/runway/generate`       | `/api/v1/runway/record-detail`     | `data.state`       | `data.videoInfo.videoUrl`                    |
| Suno         | `/api/v1/generate`              | `/api/v1/generate/record-info`     | `data.status`      | `data.response.sunoData[].audioUrl`          |
| Midjourney   | `/api/v1/mj/generate`           | `/api/v1/mj/record-info`           | `data.successFlag` | `data.resultInfoJson.resultUrls[].resultUrl` |
| Luma         | `/api/v1/modify/generate`       | `/api/v1/modify/record-info`       | `data.successFlag` | `data.response.resultUrls[]`                 |

### Step 4: Download Results

Result URLs expire (14 days for most, 24h for some market models). **Always download immediately.**

```bash
curl -sL "$RESULT_URL" -o "./generated-media.png"
```

Use appropriate extension: `.png`/`.jpg` for images, `.mp4` for video, `.mp3` for music.

### Step 5: Upload Files (when needed)

Some endpoints require publicly accessible URLs for input images/videos. If the user has a local file, upload it first:

```bash
# Upload via URL
curl -s -X POST "https://api.kie.ai/api/v1/uploads/url" \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://example.com/image.jpg" }'

# Upload via base64
curl -s -X POST "https://api.kie.ai/api/v1/uploads/base64" \
  -H "Authorization: Bearer $KIE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "base64": "<base64_data>", "fileName": "image.jpg" }'
```

**Response:** `{ "code": 200, "data": { "fileUrl": "https://..." } }`

Uploaded files expire after **3 days**. Use the returned `fileUrl` as input to generation endpoints.

## Error Handling

| Code | Meaning              | Action                                   |
| ---- | -------------------- | ---------------------------------------- |
| 200  | Success              | Parse result                             |
| 401  | Unauthorized         | Check KIE_API_KEY                        |
| 402  | Insufficient credits | User tops up at https://kie.ai/pricing   |
| 422  | Validation error     | Check params                             |
| 429  | Rate limited         | Wait and retry (max 20 requests per 10s) |
| 455  | Service unavailable  | Maintenance, retry later                 |
| 500  | Server error         | Retry after a few seconds                |
| 501  | Generation failed    | Check failMsg, adjust prompt             |

## Important Notes

- **Always download results immediately** — URLs expire (14 days for most)
- **Use `jq` to parse JSON** — install via `brew install jq` if needed
- **Poll interval:** 3s for Market images, 5-10s for video/music, **10s for Midjourney**. Increase to 15-30s after 2 min
- **Max poll time:** ~5 min images, ~10 min video/music, ~3 min Midjourney fast, ~5 min Midjourney relaxed
- **Midjourney returns 4 images** per request — present all 4 to user and let them pick
- **Midjourney result parsing:** `data.resultInfoJson.resultUrls[]` is an array of objects with `resultUrl` field
- **Full API docs:** https://docs.kie.ai
- **Pricing:** https://kie.ai/pricing (typically 30-50% cheaper than official APIs)
