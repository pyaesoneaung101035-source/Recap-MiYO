export interface GeminiKeyInfo {
  id: string;
  key: string;
  name: string;
  callCount: number;
  status: 'active' | 'quota_exceeded' | 'invalid' | 'idle';
  lastUsed?: string;
  lastError?: string;
}

export interface ApiKeys {
  assemblyAiKey: string;
}

export interface FalConfig {
  apiKey: string;
  status: 'active' | 'invalid' | 'idle';
  selectedModel: 'fal-ai/flux/schnell' | 'fal-ai/fast-sdxl';
}

export type AiMode = 'Dubbing' | 'Recap' | 'Subtitle' | 'Long to Short' | 'Gemini TTS' | 'Dhamma AI' | 'Dhamma AI background';

export type Step3ScriptStyle = 'narrator' | 'story' | 'translation';

export type VoiceOption =
  | 'Thiha'
  | 'KyawKyaw'
  | 'AungAung'
  | 'MinThway'
  | 'Nilar'
  | 'MayThu'
  | 'Thiri'
  | 'SuSu'
  | 'Sulafat'
  | 'Titus'
  | 'Virgo'
  | 'Perseus'
  | 'Minerva'
  | 'Luna'
  | 'Oberon'
  | 'Lyra'
  | 'Atlas'
  | 'Schedar'
  | 'Gacrux'
  | 'Pulcherrima'
  | 'Achird'
  | 'Zubenelgenubi'
  | 'Vindemiatrix'
  | 'Sadachbia'
  | 'Sadaltager'
  | 'NaraKoBanyar'
  | 'NaraHtetMyat'
  | 'NaraShoon'
  | 'NaraThazin';

export type TtsEngineMode = 'auto' | 'gemini' | 'neural' | 'nara';

export type VoiceToneOption =
  | 'natural'
  | 'warm'
  | 'deep'
  | 'bright'
  | 'calm'
  | 'dramatic'
  | 'soft';

export interface TranscriptSegment {
  id: string;
  startTime: number; // in seconds
  endTime: number; // in seconds
  originalText: string; // Original Chinese / source dialogue
  myanmarTranslation: string; // Natural conversational Burmese translation
  subtitleText?: string; // Clean Burmese subtitle text (max 2 lines, < 35 chars/line)
  duration?: number; // Target duration in seconds
  speaker?: string; // Speaker identity (e.g. Speaker 1 Adult Male)
  emotion?: string; // Speaking emotion and delivery
  isOnScreen?: boolean; // Whether the speaker is on screen
  lipSyncNote?: string; // Lip-sync note and pacing guidance
  voice: VoiceOption;
  audioUrl?: string;
  audioDuration?: number;
  isGeneratingAudio?: boolean;
  originalStartTime?: number; // original timestamp before nudge/catch-up
  originalEndTime?: number; // original timestamp before nudge/catch-up
  subtitleStartTime?: number; // independent subtitle start when unlinked from voice clip
  subtitleEndTime?: number; // independent subtitle end when unlinked from voice clip
  isTimingFixed?: boolean; // whether user locked/fixed this position
  playbackRate?: number; // voice clone speed for this segment
  videoPlaybackRate?: number; // video playback speed for this segment
  style?: 'conversational' | 'recap' | 'broadcast' | 'energetic' | 'soothing' | 'affectionate'; // vocal style for this segment
  tone?: VoiceToneOption; // vocal tone preset for this segment
  pitch?: number; // fine vocal pitch/tone offset (-15 to +15 %)
  voiceProvider?: 'gemini' | 'cloudtts_gemini' | 'nara_mini_v1';
  syllableCount?: number; // Burmese syllable count
  maxAllowedSyllables?: number; // Strict 5-second syllable budget
  atempoRate?: number; // Pitch-preserving audio speed factor (e.g. 1.0 - 1.25)
  isHumanReviewed?: boolean; // Verified by human reviewer
  pauseLead?: number; // Pre-speech breathing pause in seconds (default 0.1s)
  pauseTrail?: number; // Post-speech reaction pause in seconds
  sceneShotId?: string; // Visual shot / scene cut reference
  minutePartIndex?: number; // 1-based time block index (e.g. Part 1 = 0:00-1:00 or 30s Slot 1)
  slotMode?: 'scene_recap_30s' | 'dialogue_dub'; // 30s chronological story recap vs line-by-line dubbing
  scriptStyle?: Step3ScriptStyle; // Step 3 script generation style: Narrator vs Story vs Translation
  sceneTitle?: string; // Short Burmese plot event title for this scene slot
  mainNarration?: string; // Primary story recap narration in this 30s slot
  bridgeNarration?: string; // Short scene-matching bridging line to fill the 30s slot cleanly
  pauseBetweenParts?: number; // Silence gap in seconds between mainNarration and bridgeNarration (default 0.18s)
  narratorTimingWarning?: string; // Gentle timing warning if speech exceeds slot even at 1.15x
  visemeData?: { time: number; mouthOpening: number }[]; // Lip-sync viseme frames
}

export interface AlightKeyframe {
  id: string;
  time: number; // in seconds
  scale: number; // 1.0 = normal
  posX: number; // offset in px or %
  posY: number;
  rotation: number; // in degrees
  opacity: number; // 0 to 1
  blur: number; // in px
  shakeIntensity: number; // 0 to 10
  filter: 'none' | 'cinematic' | 'warm' | 'vintage' | 'cyber' | 'dhamma_gold';
}

export interface SubtitleSettings {
  fontFamily: 'Pyidaungsu' | 'Noto Sans Myanmar' | 'Plus Jakarta Sans';
  fontSize: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  backgroundColor: string;
  positionY: 'bottom' | 'center' | 'top';
  offsetX?: number; // relative horizontal offset in px
  offsetY?: number; // relative vertical offset in px
  showKaraoke: boolean;
}


export interface BlurBox {
  id: string;
  x: number; // percentage (0 to 100)
  y: number; // percentage (0 to 100)
  width: number; // percentage (5 to 100)
  height: number; // percentage (5 to 100)
  blurAmount: number; // blur radius in px (e.g. 16)
  name?: string;
}

export interface LogoConfig {
  imageUrl: string | null;
  shape: 'circle' | 'square';
  x: number; // percentage 0 to 100
  y: number; // percentage 0 to 100
  size: number; // width in px or % e.g. 80px
  opacity: number;
  textWatermark?: string; // moving text watermark
  textWatermarkSize?: number; // font size
  textWatermarkSpeed?: number; // movement speed
}

export type AspectRatioType = '9:16' | '1:1' | '16:9' | '4:5';

export interface FrameCropConfig {
  fitMode: 'cover' | 'contain';
  scale: number;
  posX: number;
  posY: number;
  backgroundStyle: 'blur' | 'black' | 'gradient';
}

export interface VideoInspection {
  duration: number;
  width: number;
  height: number;
  resolution: string;
  hasAudio: boolean;
  format?: string;
  filesize?: number;
  inspectedAt: number;
}

export interface ProjectState {
  videoFile?: File | null;
  videoUrl: string | null;
  videoName: string;
  videoDuration: number;
  videoInspection?: VideoInspection | null;
  currentTime: number;
  isPlaying: boolean;
  playbackRate: number; // Video playback speed (default 1.0x, max 1.25x)
  voicePlaybackRate: number; // Voice Clone audio speed (independent of video speed, default 1.0x)
  narrationMode?: 'scene_recap_30s' | 'dialogue_dub'; // Scene-by-scene 30s recap narration vs dialogue dubbing
  step3ScriptStyle?: Step3ScriptStyle; // Active Step 3 script style ('narrator' | 'story' | 'translation')
  recapSlotSeconds?: number; // Default 30s per scene recap slot
  voiceStyle?: 'conversational' | 'recap' | 'broadcast' | 'energetic' | 'soothing' | 'affectionate'; // Active global voice style
  voiceTone?: VoiceToneOption; // Active global voice tone preset
  voicePitch?: number; // Fine global voice tone/pitch offset (-15 to +15 %)
  ttsEngine?: TtsEngineMode; // Active Voice Clone TTS Engine ('auto' Gemini/Neural vs 'nara' YeeNyunn/nara-mini-v1)
  lockedVoice?: VoiceOption; // Single consistent narrator voice across the entire video
  smartSyncFrameLock: boolean;
  volume: number;
  isMuted?: boolean; // Mute original video audio
  voiceVolume?: number; // Cloned voice volume (0.0 to 1.5, default 1.0)
  isVoiceMuted?: boolean; // Mute cloned voice audio
  aspectRatio: AspectRatioType; // Platform size: '9:16' (TikTok), '1:1' (FB Square), '4:5' (FB Portrait), '16:9' (YouTube)
  frameCrop: FrameCropConfig; // Video framing & crop settings
  segments: TranscriptSegment[];
  keyframes: AlightKeyframe[];
  subtitleSettings: SubtitleSettings;
  blurBoxes: BlurBox[];
  logoConfig?: LogoConfig | null;
  globalColorFilter: 'none' | 'cinematic' | 'warm' | 'vintage' | 'cyber' | 'dhamma_gold';
  extractedBgmUrl?: string | null; // Extracted background music & SFX track (original vocals removed)
  useExtractedBgm?: boolean; // When true, reuse extracted BGM/SFX without original human dialogue
  bgmVolume?: number; // Background music track volume (0.0 to 1.0, default 0.35)
  bgmEngineUsed?: string | null; // Engine used for vocal removal (demucs / ffmpeg_stem_filter)
}
