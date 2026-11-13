export interface VideoMetadata {
  filename: string;
  filesize: number;
  duration: number; // in seconds
  width: number;
  height: number;
  resolution: string;
  format: string;
  hasAudio: boolean;
  uploadedAt: number;
}

export interface NarratorSegment {
  id: string;
  index: number;
  startTime: number;
  endTime: number;
  duration: number;
  sourceText: string;
  burmeseText: string;
  uncertainWords: string[];
  approved: boolean;
  audioUrl?: string | null;
  audioDuration?: number | null;
  speedAdjustment?: number; // e.g. 1.0 to 1.10 max
  status: 'pending' | 'review' | 'generating' | 'ready' | 'error';
  errorMessage?: string;
  durationWarning?: string;
}

export type JobStage =
  | 'idle'
  | 'uploading'
  | 'reading_video'
  | 'transcribing'
  | 'translating'
  | 'waiting_for_review'
  | 'generating_narration'
  | 'syncing_audio'
  | 'exporting_mp4'
  | 'completed'
  | 'error';

export type ActionPlanMode =
  | 'burmese_narrator'
  | 'scene_retell'
  | 'transcript_only'
  | 'subtitle_only'
  | 'narration_and_subtitle';

export type TtsProvider = 'gemini' | 'edge_neural' | 'camb';

export type NarrationStyle = 'recap' | 'conversational' | 'documentary' | 'energetic' | 'soothing';

export interface NarratorJob {
  id: string;
  createdAt: number;
  stage: JobStage;
  stagePercent: number;
  overallPercent: number;
  message: string;
  elapsedSeconds: number;
  mode: ActionPlanMode;
  provider: TtsProvider;
  voice: string;
  gender: 'male' | 'female';
  style: NarrationStyle;
  pacing: number;
  muteOriginal: boolean;
  originalVolume: number;
  narrationVolume: number;
  videoPath: string;
  videoUrl: string;
  videoMetadata: VideoMetadata;
  audioPath?: string;
  segments: NarratorSegment[];
  exportUrls?: {
    videoMp4?: string;
    audioWav?: string;
    subtitleSrt?: string;
    scriptTxt?: string;
    scriptJson?: string;
  };
  error?: string;
}

export interface ServerConfig {
  geminiConfigured: boolean;
  cambConfigured: boolean;
  edgeConfigured: boolean;
  defaultProvider: string;
  instructions: {
    gemini: string;
    camb: string;
  };
}
