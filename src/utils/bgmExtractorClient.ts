export interface ExtractBgmResult {
  success: boolean;
  bgmUrl: string;
  vocalUrl?: string;
  engineUsed: string;
  statusMessage: string;
  durationSec: number;
}

/**
 * Uploads or references the user's custom video to extract ONLY its background music & SFX
 * while removing original human speech/vocals via /api/audio/extract-bgm.
 */
export async function extractBackgroundMusicFromVideo(
  videoFile?: File | null,
  videoUrl?: string | null,
  videoName = 'custom_video.mp4'
): Promise<ExtractBgmResult> {
  if (!videoFile && !videoUrl) {
    throw new Error('နောက်ခံတီးလုံး ထုတ်ယူရန် ဗီဒီယိုဖိုင် အရင်တင်ပေးပါ။');
  }

  let res: Response;

  if (videoFile) {
    const formData = new FormData();
    formData.append('video', videoFile, videoFile.name || videoName);
    res = await fetch('/api/audio/extract-bgm', {
      method: 'POST',
      body: formData,
    });
  } else if (videoUrl && (videoUrl.startsWith('blob:') || videoUrl.startsWith('data:'))) {
    // Convert browser blob URL to File/Blob upload for server FFmpeg stem removal
    const blobRes = await fetch(videoUrl);
    if (!blobRes.ok) {
      throw new Error('ဗီဒီယို Blob ဖိုင်ကို ဖတ်၍မရပါ။ Step 2 တွင် ဗီဒီယိုဖိုင်ကို ပြန်တင်ပေးပါ။');
    }
    const videoBlob = await blobRes.blob();
    const formData = new FormData();
    formData.append('video', videoBlob, videoName.endsWith('.mp4') ? videoName : `${videoName}.mp4`);
    res = await fetch('/api/audio/extract-bgm', {
      method: 'POST',
      body: formData,
    });
  } else if (videoUrl && videoUrl.startsWith('/')) {
    // Local server asset or upload path
    res = await fetch('/api/audio/extract-bgm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl }),
    });
  } else if (videoUrl) {
    // Remote URL: fetch client-side first and stream to extract-bgm
    const blobRes = await fetch(videoUrl);
    if (!blobRes.ok) {
      throw new Error(`ဗီဒီယို ဖိုင်ရယူမှု မအောင်မြင်ပါ (${blobRes.status})`);
    }
    const videoBlob = await blobRes.blob();
    const formData = new FormData();
    formData.append('video', videoBlob, 'remote_video.mp4');
    res = await fetch('/api/audio/extract-bgm', {
      method: 'POST',
      body: formData,
    });
  } else {
    throw new Error('ဗီဒီယိုဖိုင် မတွေ့ရှိပါ။');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success || !data.bgmUrl) {
    throw new Error(data.error || 'နောက်ခံတီးလုံး ခွဲထုတ်ခြင်း မအောင်မြင်ပါ');
  }

  return data as ExtractBgmResult;
}
