import { TranscriptSegment } from '../types';
import { findActiveSegmentForTime } from './timingSync';

let sharedAudioCtx: AudioContext | null = null;
const decodedBufferCache = new Map<string, AudioBuffer>();
const pendingDecodePromises = new Map<string, Promise<AudioBuffer | null>>();
const failedDecodeUntil = new Map<string, number>();

export function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    sharedAudioCtx = new Ctx();
  }
  return sharedAudioCtx;
}

export async function unlockSharedAudioContext(): Promise<AudioContext | null> {
  const ctx = getSharedAudioContext();
  if (!ctx) return null;
  try {
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    // Play a 1-sample silent buffer synchronously to guarantee mobile Chrome/Safari AudioContext unlock
    const silentBuf = ctx.createBuffer(1, 1, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = silentBuf;
    src.connect(ctx.destination);
    src.start(0);
  } catch (_) {}
  return ctx;
}

export async function loadAndDecodeAudioBuffer(url: string): Promise<AudioBuffer | null> {
  if (!url) return null;
  const cached = decodedBufferCache.get(url);
  if (cached) return cached;

  const failedAt = failedDecodeUntil.get(url);
  if (failedAt && Date.now() < failedAt) return null;

  const existing = pendingDecodePromises.get(url);
  if (existing) return existing;

  const task = (async () => {
    try {
      const ctx = getSharedAudioContext();
      if (!ctx) return null;
      const res = await fetch(url);
      if (!res.ok) {
        failedDecodeUntil.set(url, Date.now() + 2500);
        return null;
      }
      const arrayBuf = await res.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
      decodedBufferCache.set(url, decoded);
      failedDecodeUntil.delete(url);
      return decoded;
    } catch (err) {
      failedDecodeUntil.set(url, Date.now() + 2500);
      console.warn('[AudioMixer] Decode failed for', url, err);
      return null;
    } finally {
      pendingDecodePromises.delete(url);
    }
  })();

  pendingDecodePromises.set(url, task);
  return task;
}

export interface MixerSyncParams {
  isPlaying: boolean;
  currentTime: number;
  playbackRate: number;
  isMuted: boolean;
  bgmUrl: string | null | undefined;
  isBgmEnabled: boolean;
  bgmVolume: number;
  segments: TranscriptSegment[];
  voiceSpeed: number;
  isVoiceEnabled: boolean;
  voiceVolume: number;
}

/**
 * Unified Web Audio API Mixer for simultaneous BGM + Voice Clone playback.
 * Mixes both tracks into ONE hardware AudioContext bus with a master limiter/compressor
 * so Android/Desktop browsers NEVER stutter ("ထစ်") or steal audio focus across tracks.
 */
export class UnifiedAudioMixer {
  private bgmGain: GainNode | null = null;
  private voiceGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private masterGain: GainNode | null = null;

  private bgmSource: AudioBufferSourceNode | null = null;
  private bgmPlayingUrl = '';
  private bgmAnchorCtxTime = 0;
  private bgmAnchorOffset = 0;
  private bgmRate = 1.0;
  private bgmPlayToken = 0;

  private voiceSource: AudioBufferSourceNode | null = null;
  private voicePlayingKey = ''; // `${segId}::${audioUrl}`
  private completedVoiceKeys = new Set<string>();
  private lastActiveSegKey = '';
  private voiceAnchorCtxTime = 0;
  private voiceAnchorOffset = 0;
  private voiceRate = 1.0;
  private voicePlayToken = 0;

  private lastVideoTime = -1;
  private wasPlaying = false;
  private lastSyncParams: MixerSyncParams | null = null;

  private ensureGraph(): AudioContext | null {
    const ctx = getSharedAudioContext();
    if (!ctx) return null;

    if (!this.masterGain || this.masterGain.context !== ctx) {
      this.bgmGain = ctx.createGain();
      this.voiceGain = ctx.createGain();
      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -3;
      this.compressor.knee.value = 6;
      this.compressor.ratio.value = 1.8;
      this.compressor.attack.value = 0.005;
      this.compressor.release.value = 0.15;

      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = 1.0;

      this.bgmGain.connect(this.compressor);
      this.voiceGain.connect(this.compressor);
      this.compressor.connect(this.masterGain);
      this.masterGain.connect(ctx.destination);
    }
    return ctx;
  }

  public unlock(): void {
    this.ensureGraph();
    void unlockSharedAudioContext();
  }

  public preloadBgm(url: string | null | undefined): void {
    if (!url) return;
    if (url.includes('/uploads/exports/bgm_')) {
      for (const cachedUrl of Array.from(decodedBufferCache.keys())) {
        if (cachedUrl !== url && cachedUrl.includes('/uploads/exports/bgm_')) {
          decodedBufferCache.delete(cachedUrl);
        }
      }
    }
    void loadAndDecodeAudioBuffer(url);
  }

  public preloadVoices(segments: TranscriptSegment[]): void {
    const urls = Array.from(
      new Set(segments.map((s) => s.audioUrl).filter((u): u is string => Boolean(u)))
    ).filter((u) => !decodedBufferCache.has(u));
    if (urls.length === 0) return;

    // Decode sequentially in small concurrency batches of 4 so all clips stay cached cleanly
    void (async () => {
      for (let i = 0; i < urls.length; i += 4) {
        await Promise.all(urls.slice(i, i + 4).map((u) => loadAndDecodeAudioBuffer(u)));
      }
    })();
  }

  private stopBgmNode(): void {
    this.bgmPlayToken++;
    if (this.bgmSource) {
      try {
        this.bgmSource.onended = null;
        this.bgmSource.stop(0);
        this.bgmSource.disconnect();
      } catch (_) {}
      this.bgmSource = null;
    }
    this.bgmPlayingUrl = '';
  }

  private stopVoiceNode(): void {
    this.voicePlayToken++;
    if (this.voiceSource) {
      try {
        this.voiceSource.onended = null;
        this.voiceSource.stop(0);
        this.voiceSource.disconnect();
      } catch (_) {}
      this.voiceSource = null;
    }
    this.voicePlayingKey = '';
  }

  public stopAll(): void {
    this.stopBgmNode();
    this.stopVoiceNode();
    this.completedVoiceKeys.clear();
    this.lastActiveSegKey = '';
    this.lastVideoTime = -1;
    this.wasPlaying = false;
  }

  private startBgmAt(url: string, offsetSec: number): void {
    const ctx = this.ensureGraph();
    if (!ctx || !this.bgmGain) return;

    this.stopBgmNode();

    const cached = decodedBufferCache.get(url);
    if (cached) {
      if (ctx.state === 'suspended') {
        const token = ++this.bgmPlayToken;
        this.bgmPlayingUrl = url;
        void ctx.resume()
          .then(() => {
            if (token !== this.bgmPlayToken) return;
            const latest = this.lastSyncParams;
            if (!latest || !latest.isPlaying || !latest.isBgmEnabled || latest.bgmUrl !== url) {
              this.bgmPlayingUrl = '';
              return;
            }
            this.startBgmAt(url, Math.max(0, latest.currentTime));
          })
          .catch(() => {
            if (token === this.bgmPlayToken) {
              this.bgmPlayingUrl = '';
            }
          });
        return;
      }
      if (offsetSec >= cached.duration - 0.04) return;
      const src = ctx.createBufferSource();
      src.buffer = cached;
      // BGM ALWAYS plays at natural 1.0x pitch and tempo (unaffected by Video Speed slow-mo)
      src.playbackRate.value = 1.0;
      src.connect(this.bgmGain);
      const safeOffset = Math.max(0, Math.min(offsetSec, Math.max(0, cached.duration - 0.05)));
      src.start(0, safeOffset);
      this.bgmSource = src;
      this.bgmPlayingUrl = url;
      this.bgmAnchorCtxTime = ctx.currentTime;
      this.bgmAnchorOffset = safeOffset;
      this.bgmRate = 1.0;
      src.onended = () => {
        if (this.bgmSource === src) {
          this.bgmSource = null;
          this.bgmPlayingUrl = '';
        }
      };
      return;
    }

    // Buffer not yet decoded: decode async then start compensating for elapsed playback time
    const token = ++this.bgmPlayToken;
    const requestedAtWallMs = performance.now();
    this.bgmPlayingUrl = url; // prevent redundant requests while decoding
    void loadAndDecodeAudioBuffer(url).then((buf) => {
      if (token !== this.bgmPlayToken) return;
      if (!buf) {
        this.bgmPlayingUrl = '';
        return;
      }
      const latest = this.lastSyncParams;
      if (!latest || !latest.isPlaying || !latest.isBgmEnabled || latest.bgmUrl !== url) {
        this.bgmPlayingUrl = '';
        return;
      }
      const elapsedWall = (performance.now() - requestedAtWallMs) / 1000;
      const compensatedOffset = Math.max(latest.currentTime, offsetSec + elapsedWall);
      this.startBgmAt(url, compensatedOffset);
    });
  }

  private startVoiceAt(
    key: string,
    url: string,
    offsetSec: number,
    rate: number
  ): void {
    const ctx = this.ensureGraph();
    if (!ctx || !this.voiceGain) return;

    this.stopVoiceNode();

    const cached = decodedBufferCache.get(url);
    if (cached) {
      if (ctx.state === 'suspended') {
        const token = ++this.voicePlayToken;
        this.voicePlayingKey = key;
        void ctx.resume()
          .then(() => {
            if (token !== this.voicePlayToken) return;
            const latest = this.lastSyncParams;
            if (!latest || !latest.isPlaying || !latest.isVoiceEnabled) {
              this.voicePlayingKey = '';
              return;
            }
            this.startVoiceAt(key, url, offsetSec, rate);
          })
          .catch(() => {
            if (token === this.voicePlayToken) {
              this.voicePlayingKey = '';
            }
          });
        return;
      }
      if (offsetSec >= cached.duration - 0.04) {
        this.voicePlayingKey = key;
        this.completedVoiceKeys.add(key);
        return;
      }
      const src = ctx.createBufferSource();
      src.buffer = cached;
      src.playbackRate.value = rate;
      src.connect(this.voiceGain);
      const safeOffset = Math.max(0, Math.min(offsetSec, Math.max(0, cached.duration - 0.05)));
      src.start(0, safeOffset);
      this.voiceSource = src;
      this.voicePlayingKey = key;
      this.voiceAnchorCtxTime = ctx.currentTime;
      this.voiceAnchorOffset = safeOffset;
      this.voiceRate = rate;
      src.onended = () => {
        if (this.voiceSource === src) {
          this.voiceSource = null;
          this.completedVoiceKeys.add(key);
        }
      };
      return;
    }

    const token = ++this.voicePlayToken;
    const requestedAtWallMs = performance.now();
    this.voicePlayingKey = key;
    void loadAndDecodeAudioBuffer(url).then((buf) => {
      if (token !== this.voicePlayToken) return;
      if (!buf) {
        this.voicePlayingKey = '';
        return;
      }
      const latest = this.lastSyncParams;
      if (!latest || !latest.isPlaying || !latest.isVoiceEnabled) {
        this.voicePlayingKey = '';
        return;
      }
      const elapsedWall = (performance.now() - requestedAtWallMs) / 1000;
      const compensatedOffset = offsetSec === 0 && elapsedWall < 0.4 ? 0 : offsetSec + elapsedWall * rate;
      if (compensatedOffset >= buf.duration - 0.04) {
        this.voicePlayingKey = key;
        this.completedVoiceKeys.add(key);
        return;
      }
      this.startVoiceAt(key, url, compensatedOffset, rate);
    });
  }

  public sync(params: MixerSyncParams, forceReseek = false): void {
    this.lastSyncParams = params;
    const ctx = this.ensureGraph();
    if (!ctx || !this.bgmGain || !this.voiceGain || !this.masterGain) return;

    if (params.isPlaying && ctx.state === 'suspended') {
      void ctx.resume();
    }

    const justStartedPlaying = params.isPlaying && !this.wasPlaying;
    const isDiscontinuousSeek =
      forceReseek ||
      (this.lastVideoTime >= 0 && Math.abs(params.currentTime - this.lastVideoTime) > 1.8);
    const effectiveReseek = isDiscontinuousSeek || justStartedPlaying;
    this.lastVideoTime = params.currentTime;
    this.wasPlaying = params.isPlaying;

    // Master gain
    const targetMaster = params.isMuted ? 0 : 1.0;
    this.masterGain.gain.setTargetAtTime(targetMaster, ctx.currentTime, 0.03);

    // Check active voice segment at current playhead
    const activeMatch = findActiveSegmentForTime(
      params.segments,
      params.currentTime,
      params.voiceSpeed,
      true
    );
    const seg = activeMatch?.segment || null;
    const segKey = seg && seg.audioUrl ? `${seg.id}::${seg.audioUrl}` : '';

    const isVoiceActuallySpeaking = Boolean(
      params.isPlaying &&
        params.isVoiceEnabled &&
        segKey &&
        (this.voiceSource || !this.completedVoiceKeys.has(segKey))
    );

    // Smooth BGM Ducking (42% during narrator speech so voice stays crystal-clear above BGM)
    const duckFactor = isVoiceActuallySpeaking ? 0.42 : 1.0;
    const targetBgmGain =
      params.isBgmEnabled && !params.isMuted
        ? Math.max(0, Math.min(1.0, params.bgmVolume * duckFactor))
        : 0;
    this.bgmGain.gain.setTargetAtTime(targetBgmGain, ctx.currentTime, 0.06);

    const targetVoiceGain =
      params.isVoiceEnabled && !params.isMuted
        ? Math.max(0, Math.min(1.5, params.voiceVolume))
        : 0;
    this.voiceGain.gain.setTargetAtTime(targetVoiceGain, ctx.currentTime, 0.03);

    // Pause both if stopped
    if (!params.isPlaying) {
      if (this.bgmSource || this.bgmPlayingUrl) this.stopBgmNode();
      if (this.voiceSource || this.voicePlayingKey) this.stopVoiceNode();
      this.completedVoiceKeys.clear();
      this.lastActiveSegKey = '';
      return;
    }

    // 1. Synchronize BGM BufferSource (always at 1.00x normal speed/pitch, never warped by Video Speed)
    if (params.isBgmEnabled && params.bgmUrl && params.bgmVolume > 0) {
      const cachedBgm = decodedBufferCache.get(params.bgmUrl);
      if (cachedBgm && effectiveReseek && params.currentTime >= cachedBgm.duration - 0.05) {
        if (this.bgmSource || this.bgmPlayingUrl) this.stopBgmNode();
      } else {
        const sameUrl = this.bgmPlayingUrl === params.bgmUrl;
        if (!sameUrl || effectiveReseek) {
          this.startBgmAt(params.bgmUrl, Math.max(0, params.currentTime));
        }
      }
    } else if (this.bgmSource || this.bgmPlayingUrl) {
      this.stopBgmNode();
    }

    // 2. Synchronize Voice Clone BufferSource
    // IMPORTANT: Once a segment begins playing, never replay or cut/re-seek it mid-sentence in the same pass!
    if (effectiveReseek) {
      this.completedVoiceKeys.clear();
    } else if (this.lastActiveSegKey && this.lastActiveSegKey !== segKey) {
      // Playhead exited previous segment window: allow it to play again only if playhead re-enters later
      this.completedVoiceKeys.delete(this.lastActiveSegKey);
    }
    this.lastActiveSegKey = segKey;

    if (seg && seg.audioUrl && activeMatch && params.isVoiceEnabled) {
      const segSpeed = activeMatch.window.speed;
      const expectedSrcTime = Math.max(0, params.currentTime - activeMatch.window.startTime) * segSpeed;
      const cachedVoice = decodedBufferCache.get(seg.audioUrl);
      const clipDur = cachedVoice ? cachedVoice.duration : (seg.audioDuration || 0);

      if (effectiveReseek) {
        if (clipDur > 0 && expectedSrcTime >= clipDur - 0.04) {
          this.stopVoiceNode();
          this.completedVoiceKeys.add(segKey);
          this.voicePlayingKey = segKey;
        } else {
          const cleanStart = expectedSrcTime < 0.35 ? 0 : expectedSrcTime;
          this.startVoiceAt(segKey, seg.audioUrl, cleanStart, segSpeed);
        }
      } else if (this.completedVoiceKeys.has(segKey)) {
        // Already finished speaking in this pass — never repeat!
      } else if (this.voicePlayingKey === segKey) {
        // Currently playing or awaiting decode/resume for this exact segment — let it finish cleanly!
        if (this.voiceSource && Math.abs(this.voiceRate - segSpeed) > 0.02) {
          this.voiceSource.playbackRate.setValueAtTime(segSpeed, ctx.currentTime);
          this.voiceAnchorOffset =
            this.voiceAnchorOffset + (ctx.currentTime - this.voiceAnchorCtxTime) * this.voiceRate;
          this.voiceAnchorCtxTime = ctx.currentTime;
          this.voiceRate = segSpeed;
        }
      } else {
        // Entered a new segment naturally during continuous playback
        if (clipDur > 0 && expectedSrcTime >= clipDur - 0.05) {
          this.stopVoiceNode();
          this.completedVoiceKeys.add(segKey);
          this.voicePlayingKey = segKey;
        } else {
          const cleanStart = expectedSrcTime < 0.45 ? 0 : expectedSrcTime;
          this.startVoiceAt(segKey, seg.audioUrl, cleanStart, segSpeed);
        }
      }
    } else if (!params.isVoiceEnabled || effectiveReseek) {
      if (this.voiceSource || this.voicePlayingKey) {
        this.stopVoiceNode();
      }
    } else if (!this.voiceSource && this.voicePlayingKey) {
      // Previous segment finished cleanly and playhead is in silence gap
      this.voicePlayingKey = '';
    }
  }

  public dispose(): void {
    this.stopAll();
    try {
      this.bgmGain?.disconnect();
      this.voiceGain?.disconnect();
      this.compressor?.disconnect();
      this.masterGain?.disconnect();
    } catch (_) {}
    this.bgmGain = null;
    this.voiceGain = null;
    this.compressor = null;
    this.masterGain = null;
  }
}
