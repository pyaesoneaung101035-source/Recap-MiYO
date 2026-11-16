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
        failedDecodeUntil.set(url, Date.now() + 8000);
        return null;
      }
      const arrayBuf = await res.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
      decodedBufferCache.set(url, decoded);
      failedDecodeUntil.delete(url);
      return decoded;
    } catch (err) {
      failedDecodeUntil.set(url, Date.now() + 8000);
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
  private voiceClipEndedKey = '';
  private voiceAnchorCtxTime = 0;
  private voiceAnchorOffset = 0;
  private voiceRate = 1.0;
  private voicePlayToken = 0;

  private lastSyncParams: MixerSyncParams | null = null;

  private ensureGraph(): AudioContext | null {
    const ctx = getSharedAudioContext();
    if (!ctx) return null;

    if (!this.masterGain || this.masterGain.context !== ctx) {
      this.bgmGain = ctx.createGain();
      this.voiceGain = ctx.createGain();
      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -14;
      this.compressor.knee.value = 12;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.004;
      this.compressor.release.value = 0.14;

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
    this.voiceClipEndedKey = '';
  }

  public stopAll(): void {
    this.stopBgmNode();
    this.stopVoiceNode();
  }

  private startBgmAt(url: string, offsetSec: number, rate: number): void {
    const ctx = this.ensureGraph();
    if (!ctx || !this.bgmGain) return;

    const cached = decodedBufferCache.get(url);
    if (cached) {
      this.stopBgmNode();
      if (offsetSec >= cached.duration - 0.04) return;
      const src = ctx.createBufferSource();
      src.buffer = cached;
      src.playbackRate.value = rate;
      src.connect(this.bgmGain);
      const safeOffset = Math.max(0, Math.min(offsetSec, Math.max(0, cached.duration - 0.05)));
      src.start(0, safeOffset);
      this.bgmSource = src;
      this.bgmPlayingUrl = url;
      this.bgmAnchorCtxTime = ctx.currentTime;
      this.bgmAnchorOffset = safeOffset;
      this.bgmRate = rate;
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
      if (!buf || token !== this.bgmPlayToken) return;
      const latest = this.lastSyncParams;
      if (!latest || !latest.isPlaying || !latest.isBgmEnabled || latest.bgmUrl !== url) {
        this.bgmPlayingUrl = '';
        return;
      }
      const elapsedWall = (performance.now() - requestedAtWallMs) / 1000;
      const compensatedOffset = Math.max(latest.currentTime, offsetSec + elapsedWall * rate);
      this.startBgmAt(url, compensatedOffset, latest.playbackRate || rate);
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

    const cached = decodedBufferCache.get(url);
    if (cached) {
      this.stopVoiceNode();
      if (offsetSec >= cached.duration - 0.04) {
        this.voicePlayingKey = key;
        this.voiceClipEndedKey = key;
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
      this.voiceClipEndedKey = '';
      this.voiceAnchorCtxTime = ctx.currentTime;
      this.voiceAnchorOffset = safeOffset;
      this.voiceRate = rate;
      src.onended = () => {
        if (this.voiceSource === src) {
          this.voiceSource = null;
          this.voiceClipEndedKey = key;
        }
      };
      return;
    }

    const token = ++this.voicePlayToken;
    const requestedAtWallMs = performance.now();
    this.voicePlayingKey = key;
    this.voiceClipEndedKey = '';
    void loadAndDecodeAudioBuffer(url).then((buf) => {
      if (!buf || token !== this.voicePlayToken) return;
      const latest = this.lastSyncParams;
      if (!latest || !latest.isPlaying || !latest.isVoiceEnabled) {
        this.voicePlayingKey = '';
        return;
      }
      const elapsedWall = (performance.now() - requestedAtWallMs) / 1000;
      const compensatedOffset = offsetSec + elapsedWall * rate;
      if (compensatedOffset >= buf.duration - 0.04) return;
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
    const isNarratorActive = Boolean(activeMatch && activeMatch.segment.audioUrl && params.isVoiceEnabled);

    // Smooth BGM Ducking (55% during narrator speech so voice sits cleanly on top of BGM)
    const duckFactor = isNarratorActive ? 0.55 : 1.0;
    const targetBgmGain =
      params.isBgmEnabled && !params.isMuted
        ? Math.max(0, Math.min(1.0, params.bgmVolume * duckFactor))
        : 0;
    this.bgmGain.gain.setTargetAtTime(targetBgmGain, ctx.currentTime, 0.06);

    const targetVoiceGain =
      params.isVoiceEnabled && !params.isMuted
        ? Math.max(0, Math.min(1.2, params.voiceVolume))
        : 0;
    this.voiceGain.gain.setTargetAtTime(targetVoiceGain, ctx.currentTime, 0.03);

    // Pause both if stopped
    if (!params.isPlaying) {
      if (this.bgmSource || this.bgmPlayingUrl) this.stopBgmNode();
      if (this.voiceSource || this.voicePlayingKey) this.stopVoiceNode();
      return;
    }

    // 1. Synchronize BGM BufferSource
    const safeRate = Math.max(0.25, Math.min(2.5, params.playbackRate || 1.0));
    if (params.isBgmEnabled && params.bgmUrl && params.bgmVolume > 0) {
      const cachedBgm = decodedBufferCache.get(params.bgmUrl);
      if (cachedBgm && params.currentTime >= cachedBgm.duration - 0.05) {
        if (this.bgmSource || this.bgmPlayingUrl) this.stopBgmNode();
      } else {
        const sameUrl = this.bgmPlayingUrl === params.bgmUrl;
        if (!sameUrl || forceReseek) {
          this.startBgmAt(params.bgmUrl, Math.max(0, params.currentTime), safeRate);
        } else if (this.bgmSource) {
          if (Math.abs(this.bgmRate - safeRate) > 0.02) {
            this.bgmSource.playbackRate.setValueAtTime(safeRate, ctx.currentTime);
            this.bgmAnchorOffset =
              this.bgmAnchorOffset + (ctx.currentTime - this.bgmAnchorCtxTime) * this.bgmRate;
            this.bgmAnchorCtxTime = ctx.currentTime;
            this.bgmRate = safeRate;
          }
          const liveBgmPos =
            this.bgmAnchorOffset + (ctx.currentTime - this.bgmAnchorCtxTime) * this.bgmRate;
          // Only seek BGM if user truly jumped > 0.75s (prevents micro-seeking stutters!)
          if (Math.abs(liveBgmPos - params.currentTime) > 0.75) {
            this.startBgmAt(params.bgmUrl, Math.max(0, params.currentTime), safeRate);
          }
        }
      }
    } else if (this.bgmSource || this.bgmPlayingUrl) {
      this.stopBgmNode();
    }

    // 2. Synchronize Voice Clone BufferSource
    const seg = activeMatch?.segment || null;
    if (seg && seg.audioUrl && activeMatch && params.isVoiceEnabled) {
      const segKey = `${seg.id}::${seg.audioUrl}`;
      const segSpeed = activeMatch.window.speed;
      const expectedSrcTime = Math.max(0, params.currentTime - activeMatch.window.startTime) * segSpeed;
      const cachedVoice = decodedBufferCache.get(seg.audioUrl);
      const clipDur = cachedVoice ? cachedVoice.duration : (seg.audioDuration || 0);

      if (clipDur > 0 && expectedSrcTime >= clipDur - 0.02) {
        if (this.voiceSource) this.stopVoiceNode();
      } else if (
        this.voicePlayingKey !== segKey ||
        forceReseek ||
        (this.voiceClipEndedKey === segKey && clipDur > 0 && expectedSrcTime < clipDur - 0.35)
      ) {
        this.startVoiceAt(segKey, seg.audioUrl, expectedSrcTime, segSpeed);
      } else if (this.voiceSource) {
        if (Math.abs(this.voiceRate - segSpeed) > 0.02) {
          this.voiceSource.playbackRate.setValueAtTime(segSpeed, ctx.currentTime);
          this.voiceAnchorOffset =
            this.voiceAnchorOffset + (ctx.currentTime - this.voiceAnchorCtxTime) * this.voiceRate;
          this.voiceAnchorCtxTime = ctx.currentTime;
          this.voiceRate = segSpeed;
        }
        const liveVoicePos =
          this.voiceAnchorOffset + (ctx.currentTime - this.voiceAnchorCtxTime) * this.voiceRate;
        if (Math.abs(liveVoicePos - expectedSrcTime) > 0.65) {
          this.startVoiceAt(segKey, seg.audioUrl, expectedSrcTime, segSpeed);
        }
      }
    } else if (this.voiceSource || this.voicePlayingKey) {
      this.stopVoiceNode();
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
