# Myanmar AI Video Recap & Motion Studio (Alight Motion & Voice Clone)

An all-in-one AI video production suite tailored for Myanmar content creators. The application features multi-key Gemini API rotation with automatic quota fallback, FAL AI FLUX Schnell visuals, video upload with AI-powered timestamped Myanmar transcription and recap, free unlimited Myanmar voice cloning (Thiha & Nilar neural voices) with intelligent ~0.25s pause trimming, customizable on-video translated subtitles, and an Alight Motion-style multi-track timeline editor with keyframe animations, effects, and smart audio-visual synchronization.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural decisions have been incorporated into this implementation plan:

- **Confirmed Decision 1 (Voice System)**: Implements free unlimited Myanmar neural voice synthesis using Edge TTS `mm-MM-ThihaNeural` (Male) and `mm-MM-NilarNeural` (Female) with automated silence trimming (~1.0s natural pause cut down to ~0.25s) and custom audio pitch/rate controls.
- **Confirmed Decision 2 (Gemini Multi-Key Rotation)**: Supports inputting multiple Google Gemini API keys. Requests use auto round-robin and immediately catch 429 quota exhaustion or invalid key errors to seamlessly fall back to the next valid key without interrupting user workflow.
- **Confirmed Decision 3 (Smart Sync & Frame Lock)**: Video acceleration is capped at 1.25x speed max with frame-lock stabilization to prevent audio-video drift across long videos while chaining consecutive audio clips seamlessly.
- **Confirmed Decision 4 (Alight Motion Editor)**: A browser-based multi-track timeline supporting keyframing (Position, Scale, Rotation, Opacity), motion presets (Shake, Smooth Zoom, Bounce, Glitch, Color Grade), and Canvas WebAudio composite video recording & export.

---

## 1. Overview & Core Concept

### What It Does
1. **API Key Manager**: Multi-key Gemini API manager (with active rotation, quota monitoring, local browser storage, and phone direct-call mode) + FAL API key manager for FLUX Schnell image generation and Story Motion.
2. **Video Ingestion & Multimodal AI**: Upload any video (MP4, WebM, MOV) with instant playback, waveform visualization, and frame-accurate seeking.
3. **AI Transcription, Myanmar Translation & Recap**: Generates structured timestamped transcripts, Myanmar translations, and concise video recaps (Dubbing script, Subtitle, Long-to-Short highlight moments, Story plan/narrator, Dhamma AI background).
4. **Voice Clone & Synthesis**: Free unlimited Myanmar voice generation for Thiha and Nilar with zero-latency audio pipeline and silence trimming (from ~1s to ~0.25s).
5. **On-Video Subtitles**: Synchronized Myanmar subtitles rendered directly over the video with customizable styling (Pyidaungsu font, font size, stroke outline, drop shadow, background box, karaoke highlight mode).
6. **Alight Motion & Timeline Video Editor**: Multi-track timeline (Video, Voice, Subtitles, BGM, FX/Keyframes) with keyframe interpolation, transition effects, split/trim tools, and export to WebM/MP4 video, SRT, and project files.

---

## 2. User Experience & Visual Design

### Key User Flows
1. **API Setup**: Creator opens the API Settings modal or drawer, pastes one or more Gemini API keys (comma or newline separated) and an optional FAL API key. The system verifies connectivity and displays quota statuses.
2. **Video Upload & Analysis**: Creator uploads a source video. Creator clicks "AI Smart Recap & Transcribe". The system selects an active Gemini key to analyze the video/audio, extracting timeline segments with exact start/end timestamps and Myanmar translation.
3. **Voice Clone & Audio Generation**: Creator selects voice actor (`Thiha` or `Nilar`), adjusts pitch and rate. The system generates synced voice clips, automatically cuts inter-sentence pauses to 0.25s, and positions them on the audio track.
4. **Alight Motion Editing**: Creator adjusts video playback speed (enforcing $\le 1.25\times$ Smart Sync limit), applies keyframe motions (Zoom In, Punch In, Shake, Fade, Rotate), configures subtitle overlay styling, and previews in real-time.
5. **Export & Sharing**: Creator exports the composite video (burned-in subtitles and cloned voice), downloads the SRT subtitle file, or saves the project state.

### Visual Identity & Theme
- **Theme**: Dark modern workstation (slate-950 base, zinc-900 surface panels, sleek zinc-800 hairline borders).
- **Accents**: Neon Cyan (`#06b6d4`) for timeline playhead, Violet (`#8b5cf6`) for Gemini AI actions, Emerald (`#10b981`) for Voice Clone audio tracks, and Amber (`#f59e0b`) for Keyframes.
- **Typography**: Clean display font for studio controls, paired with Myanmar-optimized font stack (`Pyidaungsu`, `Noto Sans Myanmar`, sans-serif) for Burmese text, and monospace tabular numerals (`tabular-nums`) for timestamps.
- **Top Bar Contract**: Brand Wordmark (`MotionRecap Studio`) — Workspace Mode Tabs (`Recap & AI`, `Voice Studio`, `Alight Timeline`, `Export`) — Primary Action (`Generate Video`).

---

## 3. Key Product Decisions & Trade-Offs

| Decision | Selected Strategy | Rationale & Alternative Considered |
|---|---|---|
| **Gemini Multi-Key Rotation** | Client-managed round-robin pool with local encryption & direct Google API gateway | Enables direct calling from mobile devices (as requested in Note 3), eliminates quota bottlenecks across multiple free-tier projects, and gracefully recovers from 429 quota exhaustion. |
| **Myanmar Voice Clone** | High-performance Edge TTS synthesis (mm-MM-ThihaNeural & mm-MM-NilarNeural) + Web Audio Silence Trimmer | Provides 100% free unlimited voice synthesis without expensive third-party voice clone tokens; custom Web Audio DSP cuts pauses from ~1s to ~0.25s. |
| **Smart Sync Speed Cap** | Hard clamp at $1.25\times$ with frame-lock compensation | Matches user constraint: prevents video jitter and unnatural pitch shifts while keeping long-form videos perfectly in sync. |
| **Video Rendering Engine** | HTML5 Canvas + Web Audio MediaStream Recording with frame-by-frame compositing | Operates 100% client-side without heavy server rendering costs, rendering text, keyframes, and multi-track audio smoothly. |

---

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Top Navigation Bar                              │
│ [MotionRecap Studio]   [Recap & AI] [Voice Clone] [Alight Editor]   [Export] │
└────────────────────────────────────────────────────────────────────────┘
                                    │
    ┌───────────────────────────────┴───────────────────────────────┐
    ▼                                                               ▼
┌─────────────────────────────────────────┐  ┌─────────────────────────────────────────┐
│         Preview & Video Player          │  │           AI & Voice Workspace          │
│ ┌─────────────────────────────────────┐ │  │ • Gemini Key Pool (Auto-Rotate & Quota) │
│ │  Video Canvas / HTML5 Video Player  │ │  │ • FAL API (FLUX Schnell / Scene Art)   │
│ │  + Burned-in Myanmar Subtitle Layer │ │  │ • Prompt Presets: Recap, Dub, Dhamma    │
│ │  + Alight Motion Keyframe Transform │ │  │ • Myanmar Voice Clone (Thiha / Nilar)  │
│ └─────────────────────────────────────┘ │  │ • Silence Trimmer (~1s -> 0.25s)       │
│ [⏮] [▶/⏸] [⏭] [⏱ 00:01:23 / 00:04:12] │  │ • Timestamped Segment Editor Table      │
└─────────────────────────────────────────┘  └─────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│            Multi-Track Timeline & Alight Motion Keyframes              │
│ ┌────────────┬───────────────────────────────────────────────────────┐ │
│ │ Video Track│ [==== Clip 1 (1.15x Speed Lock) ====][== Clip 2 ==]   │ │
│ ├────────────┼───────────────────────────────────────────────────────┤ │
│ │ Voice Track│ [Thiha Voice: 00:00-00:04]  [Thiha Voice: 00:05-00:08]│ │
│ ├────────────┼───────────────────────────────────────────────────────┤ │
│ │ Subtitle   │ [မြန်မာစာတန်းထိုး 1]      [မြန်မာစာတန်းထိုး 2]        │ │
│ ├────────────┼───────────────────────────────────────────────────────┤ │
│ │ Motion FX  │  ◆ Keyframe Scale (1.0 -> 1.25)    ◆ Shake Effect     │ │
│ └────────────┴───────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

### Key Data Entities
- **ApiKeyPool**: List of Gemini API keys with usage counter, health state (`active`, `exhausted_429`, `invalid`), and active index.
- **FalConfig**: FAL API key with endpoint configurations for FLUX Schnell and Story Motion.
- **VideoProject**: Source video file/URL, duration, fps, resolution, playback rate (clamped at $1.25\times$), smart sync frame lock toggle.
- **TranscriptSegment**: `id`, `startTime`, `endTime`, `originalText`, `myanmarTranslation`, `audioUrl`, `voiceType` (`Thiha` | `Nilar`), `duration`, `status`.
- **AlightKeyframe**: `id`, `timestamp`, `property` (`scale`, `positionX`, `positionY`, `rotation`, `opacity`, `blur`, `shakeIntensity`), `easing` (`linear`, `easeIn`, `easeOut`, `easeInOut`, `spring`).
- **SubtitleStyle**: `fontFamily`, `fontSize`, `fontColor`, `outlineColor`, `outlineWidth`, `backgroundColor`, `position` (`bottom`, `center`, `top`), `karaoke`.

---

## 5. Verification Plan

1. **Compilation Check**: Run `compile_applet` and verify no TypeScript or bundle errors.
2. **Key Rotation Test**: Test multi-key list parsing, key status badges, round-robin dispatching, and mock quota error auto-switch.
3. **Video & Waveform Ingestion**: Test video upload, seeking, frame step, and playback rate slider clamping at $1.25\times$.
4. **Gemini Video AI & Transcription**: Test transcript generation with Burmese translation and timestamp extraction across sample or user uploaded media.
5. **Voice Generation & Silence Trimmer**: Verify Edge TTS audio generation for Thiha and Nilar voices, confirming ~0.25s silence trimming logic.
6. **Subtitle Overlay**: Verify real-time Burmese subtitle rendering over video preview with responsive styling.
7. **Alight Motion Animation Engine**: Test keyframe interpolation (scale, position, shake, fade) smoothly applied to the video layer during playback and export.

---

## 6. Authentic 24kHz Studio Neural Voice Actors (8 Personas & 5 Styles)

- **Root Cause Resolved**: Eliminated archaic concatenative Google Translate TTS which previously created robotic tones with identical pitch for all voices.
- **Engine Architecture**: Upgraded to 24kHz Studio Neural Voice Actor models with Sec-MS-GEC v2 authentication and token caching.
- **8 Dedicated Personalities**:
  - **👨 4 Male Voices**: Thiha (သီဟ - Warm Conversational Native Male), Kyaw Kyaw (ကျော်ကျော် - Deep Bass Movie Recap Narrator), Aung Aung (အောင်အောင် - Dynamic Youth Male), Min Thway (မင်းသွေး - Calm Storyteller).
  - **👩 4 Female Voices**: Nilar (နီလာ - Clear Melodious Native Female), May Thu (မေသူ - Sweet Storyteller), Thiri (သီရိ - Crisp Broadcast Presenter), Su Su (စုစု - Cheerful Sweet Female).
- **5 Delivery Styles**: Conversational, Cinematic Recap, Broadcast, High Energy, Calm & Soothing.
- **1-Click Live Preview**: Instant audio preview for every character with real-time waveform playback.

---

## 7. Initial Voice Truncation Fix & Independent Voice Speed Control

- **Fix for Initial Sentence Truncation ("စာသားရဲ့အစတွေက voice အသံမထွက်ဘူးဖစ်နေတာ"):**
  - Added 60ms digital lead-in silence pre-padding in `cleanAndFadeAudioBuffer` so browser Web Audio DAC initialization never clips initial consonants/vowels ("မ", "သ", "ကျွန်").
  - Fixed HTML5 Audio playback onset alignment in `VideoPlayerView.tsx` (`expectedOffset < 0.35s ? 0 : expectedOffset`) to guarantee that every sentence plays from index 0.0 with 100% complete initial pronunciation.
- **Independent Voice Clone Speed Control ("Voice Speed ချိန်ရန်"):**
  - Added `voicePlaybackRate` (default `1.0x`, range `0.5x` to `2.0x`) independent of video speed (`playbackRate`).
  - Video speed remains strictly unchanged when adjusting voice speed.
  - Added Global Voice Clone Speed card in `VoiceCloneStudio.tsx` with slider and quick presets (`0.85x 🐢 Slow`, `1.0x 🎙️ Normal`, `1.15x ⚡ Fast`, `1.30x 🔥 High Speed`, `1.50x ⚡⚡ Ultra Speed`).
  - Added Per-Segment Voice Speed selector in segment tables (`VoiceCloneStudio.tsx` and `AiRecapStudio.tsx`) allowing fine-tuning for individual Burmese sentences to match subtitles with 100% precision.

---

## 8. Removal of OpenRouter API Button and Functions

- **User Request**: "remove openrouter api button and function"
- **Actions Taken**:
  - Removed OpenRouter connection cards, verification buttons, inputs, and model selectors from `Step1GeminiKeys.tsx` and `ApiKeyModal.tsx`.
  - Removed OpenRouter key management and verification functions (`verifyOpenRouterKey`, `openRouterKey`, `openRouterModel`) from `src/utils/apiKeys.ts` and `src/types/index.ts`.
  - Deleted obsolete `src/utils/openRouterClient.ts`.
  - Removed OpenRouter fallback from `src/utils/aiAutoSync.ts` and `src/utils/assemblyAi.ts` so translation directly and reliably uses Google Gemini Multi-Key Rotation.
  - Cleaned up proxy endpoints `/api/openrouter/verify` and `/api/openrouter/chat` from `server.ts`.
  - Clean build verified with `npm run lint` and `compile_applet`.

