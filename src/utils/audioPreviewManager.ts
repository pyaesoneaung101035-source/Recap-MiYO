/**
 * Global single-voice preview audio manager.
 * Guarantees only ONE preview audio clip plays at any moment across all steps
 * and notifies the main VideoPlayerView to pause whenever a preview clip starts.
 */

let activePreviewAudio: HTMLAudioElement | null = null;
let onPreviewStopCallback: (() => void) | null = null;

export const PREVIEW_AUDIO_STARTED_EVENT = 'motionrecap:preview-audio-started';

export function stopAllPreviewAudio(): void {
  if (activePreviewAudio) {
    try {
      activePreviewAudio.pause();
      activePreviewAudio.currentTime = 0;
    } catch (_) {}
    activePreviewAudio = null;
  }
  if (onPreviewStopCallback) {
    try {
      onPreviewStopCallback();
    } catch (_) {}
    onPreviewStopCallback = null;
  }
}

export function registerPreviewAudio(
  audio: HTMLAudioElement,
  onStop?: () => void
): void {
  if (activePreviewAudio && activePreviewAudio !== audio) {
    stopAllPreviewAudio();
  }
  activePreviewAudio = audio;
  onPreviewStopCallback = onStop || null;

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PREVIEW_AUDIO_STARTED_EVENT));
  }
}
