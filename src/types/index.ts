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
  huggingFaceKey?: string;
}

export interface FalConfig {
  apiKey: string;
  status: 'active' | 'invalid' | 'idle';
  selectedModel: 'fal-ai/flux/schnell' | 'fal-ai/fast-sdxl';
}

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
  | 'Sadaltager';

export interface TranscriptSegment {
  id: string;
  startTime: number; // in seconds
  endTime: number; // in seconds
  originalText: string;
  myanmarTranslation: string;
  voice: VoiceOption;
  audioUrl?: string;
  audioDuration?: number;
  isGeneratingAudio?: boolean;
  originalStartTime?: number; // original timestamp before nudge/catch-up
  originalEndTime?: number; // original timestamp before nudge/catch-up
  isTimingFixed?: boolean; // whether user locked/fixed this position
  playbackRate?: number; // voice clone speed for this segment
  videoPlaybackRate?: number; // video playback speed for this segment
  style?: 'conversational' | 'recap' | 'broadcast' | 'energetic' | 'soothing' | 'affectionate'; // vocal style for this segment
  voiceProvider?: 'gemini' | 'huggingface' | 'cloudtts_gemini';
  hfModel?: string;
  hfSpeaker?: string;
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

export type AiMode =
  | 'Recap'
  | 'Dubbing'
  | 'Subtitle'
  | 'Long to Short'
  | 'Original Recap'
  | 'Gemini TTS'
  | 'Dhamma AI'
  | 'Dhamma AI background';

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

export interface ProjectState {
  videoFile?: File | null;
  videoUrl: string | null;
  videoName: string;
  videoDuration: number;
  currentTime: number;
  isPlaying: boolean;
  playbackRate: number; // Video playback speed (default 1.0x, max 1.25x)
  voicePlaybackRate: number; // Voice Clone audio speed (independent of video speed, default 1.0x)
  voiceStyle?: 'conversational' | 'recap' | 'broadcast' | 'energetic' | 'soothing' | 'affectionate'; // Active global voice style
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
  selectedAiMode: AiMode;
  blurBoxes: BlurBox[];
  logoConfig?: LogoConfig | null;
  globalColorFilter: 'none' | 'cinematic' | 'warm' | 'vintage' | 'cyber' | 'dhamma_gold';
}
