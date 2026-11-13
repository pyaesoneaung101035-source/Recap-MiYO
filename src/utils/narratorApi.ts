import {
  NarratorJob,
  NarratorSegment,
  ServerConfig,
  ActionPlanMode,
  TtsProvider,
  NarrationStyle,
  VideoMetadata,
} from '../types/narrator';

export async function fetchServerConfig(): Promise<ServerConfig> {
  const res = await fetch('/api/narrator/config');
  if (!res.ok) {
    throw new Error('Failed to load server configuration');
  }
  return await res.json();
}

export async function uploadVideoFile(
  file: File,
  onProgress?: (percent: number) => void
): Promise<{ success: boolean; filePath: string; videoUrl: string; metadata: VideoMetadata }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('video', file);

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        const percent = Math.round((e.loaded / e.total) * 100);
        onProgress(percent);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve(data);
        } catch (err) {
          reject(new Error('Invalid response from server'));
        }
      } else {
        try {
          const errData = JSON.parse(xhr.responseText);
          reject(new Error(errData.error || `Upload failed with status ${xhr.status}`));
        } catch (_) {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Network error during video upload'));
    });

    xhr.open('POST', '/api/narrator/upload-video');
    xhr.send(formData);
  });
}

export async function startNarratorJob(params: {
  videoPath: string;
  videoUrl: string;
  metadata?: VideoMetadata;
  mode: ActionPlanMode;
  provider: TtsProvider;
  voice: string;
  gender: 'male' | 'female';
  style: NarrationStyle;
  pacing: number;
  muteOriginal: boolean;
  originalVolume: number;
  narrationVolume: number;
}): Promise<{ success: boolean; jobId: string; job: NarratorJob }> {
  const res = await fetch('/api/narrator/start-job', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to start job');
  }
  return data;
}

export async function fetchJobStatus(jobId: string): Promise<NarratorJob> {
  const res = await fetch(`/api/narrator/job/${jobId}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to fetch job status');
  }
  return await res.json();
}

export async function updateSegment(
  jobId: string,
  segmentId: string,
  updates: Partial<NarratorSegment>
): Promise<{ success: boolean; segment: NarratorSegment }> {
  const res = await fetch('/api/narrator/update-segment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, segmentId, ...updates }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to update segment');
  }
  return data;
}

export async function refineSegmentText(
  originalBurmese: string,
  targetDurationSec: number,
  sourceText?: string
): Promise<string> {
  const res = await fetch('/api/narrator/refine-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ originalBurmese, targetDurationSec, sourceText }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to refine text');
  }
  return data.refined;
}

export async function generateSegmentAudio(
  jobId: string,
  segmentId: string,
  customText?: string
): Promise<{ success: boolean; segment: NarratorSegment }> {
  const res = await fetch('/api/narrator/generate-segment-audio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, segmentId, customText }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to generate segment audio');
  }
  return data;
}

export async function generateAllNarrations(jobId: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch('/api/narrator/generate-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to generate all audio');
  }
  return data;
}

export async function previewVoiceSample(params: {
  voice: string;
  gender: 'male' | 'female';
  style: NarrationStyle;
  pacing: number;
  provider: TtsProvider;
}): Promise<{ success: boolean; audioUrl: string }> {
  const res = await fetch('/api/narrator/voice-preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to generate voice preview');
  }
  return data;
}

export async function exportFinalPackage(
  jobId: string,
  options?: {
    muteOriginal?: boolean;
    originalVolume?: number;
    narrationVolume?: number;
  }
): Promise<{ success: boolean; exportUrls: NarratorJob['exportUrls'] }> {
  const res = await fetch('/api/narrator/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, ...options }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to export package');
  }
  return data;
}
