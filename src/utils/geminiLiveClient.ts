/**
 * Gemini Live Client
 * Bridges browser audio capture & playback to the server-side Live API session via WebSocket (/live).
 * No API key is exposed in the browser; all Gemini Live API calls are handled on the server.
 */

export interface GeminiLiveClientOptions {
  apiKey?: string;
  onAudioData?: (base64Audio: string) => void;
  onInterrupted?: () => void;
  onError?: (error: string) => void;
  onStatusChange?: (status: 'disconnected' | 'connecting' | 'connected' | 'error') => void;
}

export class GeminiLiveClient {
  private ws: WebSocket | null = null;
  private inputAudioCtx: AudioContext | null = null;
  private outputAudioCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private nextStartTime = 0;
  private options: GeminiLiveClientOptions;

  constructor(options: GeminiLiveClientOptions = {}) {
    this.options = options;
  }

  public async connect(): Promise<void> {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.options.onStatusChange?.('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const query = this.options.apiKey ? `?apiKey=${encodeURIComponent(this.options.apiKey)}` : '';
    const wsUrl = `${protocol}//${window.location.host}/live${query}`;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = async () => {
          this.options.onStatusChange?.('connected');
          try {
            await this.startAudioCapture();
            resolve();
          } catch (err: any) {
            this.disconnect();
            reject(err);
          }
        };

        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.error) {
              this.options.onError?.(msg.error);
            }
            if (msg.audio) {
              this.options.onAudioData?.(msg.audio);
              this.playAudioChunk(msg.audio);
            }
            if (msg.interrupted) {
              this.options.onInterrupted?.();
              this.nextStartTime = this.outputAudioCtx?.currentTime || 0;
            }
          } catch (err) {
            console.error('Error handling live message:', err);
          }
        };

        this.ws.onerror = (err) => {
          console.error('WebSocket Live API error:', err);
          this.options.onStatusChange?.('error');
          this.options.onError?.('Gemini Live WebSocket error');
          reject(err);
        };

        this.ws.onclose = () => {
          this.options.onStatusChange?.('disconnected');
          this.cleanupAudio();
        };
      } catch (e) {
        this.options.onStatusChange?.('error');
        reject(e);
      }
    });
  }

  public sendText(text: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ text }));
    }
  }

  public sendAudioChunk(base64Pcm: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ audio: base64Pcm }));
    }
  }

  private async startAudioCapture(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      return;
    }

    this.inputAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: 16000,
    });
    this.outputAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: 24000,
    });
    this.nextStartTime = this.outputAudioCtx.currentTime;

    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = this.inputAudioCtx.createMediaStreamSource(this.mediaStream);
    this.processor = this.inputAudioCtx.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const channelData = e.inputBuffer.getChannelData(0);
      const base64 = this.floatTo16BitPCMBase64(channelData);
      this.ws.send(JSON.stringify({ audio: base64 }));
    };

    source.connect(this.processor);
    this.processor.connect(this.inputAudioCtx.destination);
  }

  private playAudioChunk(base64Pcm: string): void {
    if (!this.outputAudioCtx) {
      this.outputAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 24000,
      });
      this.nextStartTime = this.outputAudioCtx.currentTime;
    }

    try {
      const binary = atob(base64Pcm);
      const len = binary.length;
      const buffer = new ArrayBuffer(len);
      const view = new Uint8Array(buffer);
      for (let i = 0; i < len; i++) {
        view[i] = binary.charCodeAt(i);
      }

      const pcm16 = new Int16Array(buffer);
      const audioBuffer = this.outputAudioCtx.createBuffer(1, pcm16.length, 24000);
      const channel = audioBuffer.getChannelData(0);
      for (let i = 0; i < pcm16.length; i++) {
        channel[i] = pcm16[i] / 32768.0;
      }

      const source = this.outputAudioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputAudioCtx.destination);

      const currentTime = this.outputAudioCtx.currentTime;
      if (this.nextStartTime < currentTime) {
        this.nextStartTime = currentTime;
      }
      source.start(this.nextStartTime);
      this.nextStartTime += audioBuffer.duration;
    } catch (err) {
      console.error('Error playing audio chunk:', err);
    }
  }

  private floatTo16BitPCMBase64(input: Float32Array): string {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    const bytes = new Uint8Array(output.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  public disconnect(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
    this.cleanupAudio();
    this.options.onStatusChange?.('disconnected');
  }

  private cleanupAudio(): void {
    if (this.processor) {
      try {
        this.processor.disconnect();
      } catch (_) {}
      this.processor = null;
    }
    if (this.mediaStream) {
      try {
        this.mediaStream.getTracks().forEach((track) => track.stop());
      } catch (_) {}
      this.mediaStream = null;
    }
    if (this.inputAudioCtx && this.inputAudioCtx.state !== 'closed') {
      try {
        this.inputAudioCtx.close();
      } catch (_) {}
      this.inputAudioCtx = null;
    }
    if (this.outputAudioCtx && this.outputAudioCtx.state !== 'closed') {
      try {
        this.outputAudioCtx.close();
      } catch (_) {}
      this.outputAudioCtx = null;
    }
  }
}
