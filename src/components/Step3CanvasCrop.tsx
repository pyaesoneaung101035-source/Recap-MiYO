import React from 'react';
import {
  Crop,
  Smartphone,
  Tv,
  Square,
  Layout,
  Maximize2,
  RotateCcw,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Sliders,
  Sparkles,
} from 'lucide-react';
import { ProjectState, AspectRatioType, FrameCropConfig } from '../types';
import { VideoPlayerView } from './VideoPlayerView';

interface Step3CanvasCropProps {
  project: ProjectState;
  setProject: React.Dispatch<React.SetStateAction<ProjectState>>;
  onNextStep: () => void;
  onPrevStep: () => void;
}

export const PLATFORM_SIZES: {
  id: AspectRatioType;
  title: string;
  sub: string;
  platform: string;
  aspectLabel: string;
  icon: React.ReactNode;
  badge: string;
  badgeColor: string;
  description: string;
}[] = [
  {
    id: '9:16',
    title: 'TikTok / Shorts / Reels',
    sub: '9:16 Vertical Phone (1080x1920)',
    platform: 'TikTok, IG Reels, YouTube Shorts',
    aspectLabel: '9:16',
    icon: <Smartphone className="w-5 h-5 text-cyan-400" />,
    badge: 'TikTok / Shorts',
    badgeColor: 'bg-cyan-950 border-cyan-500/60 text-cyan-300',
    description: 'ဖုန်းမျက်နှာပြင်ပြည့် ဒေါင်လိုက်ဗီဒီယို (TikTok, Facebook Reels, Shorts မူပိုင်ပုံစံ)',
  },
  {
    id: '1:1',
    title: 'Facebook / IG Square Feed',
    sub: '1:1 Square Canvas (1080x1080)',
    platform: 'Facebook & Instagram Feed',
    aspectLabel: '1:1',
    icon: <Square className="w-5 h-5 text-amber-400" />,
    badge: 'FB / IG Feed',
    badgeColor: 'bg-amber-950 border-amber-500/60 text-amber-300',
    description: 'Square ပုံစံ Feed များအတွက် အထူးသင့်လျော်သော ဗီဒီယိုအရွယ်အစား',
  },
  {
    id: '4:5',
    title: 'Facebook Mobile Feed Portrait',
    sub: '4:5 Mobile Portrait (1080x1350)',
    platform: 'Facebook Mobile App Feed',
    aspectLabel: '4:5',
    icon: <Layout className="w-5 h-5 text-rose-400" />,
    badge: 'FB Mobile Feed',
    badgeColor: 'bg-rose-950 border-rose-500/60 text-rose-300',
    description: 'Facebook မိုဘိုင်းဆော့ဖ်ဝဲ Feed တွင် နေရာအပြည့်ယူနိုင်သော ပုံစံ',
  },
  {
    id: '16:9',
    title: 'YouTube / TV Landscape',
    sub: '16:9 Widescreen (1920x1080)',
    platform: 'YouTube & Desktop TV',
    aspectLabel: '16:9',
    icon: <Tv className="w-5 h-5 text-emerald-400" />,
    badge: 'YouTube Standard',
    badgeColor: 'bg-emerald-950 border-emerald-500/60 text-emerald-300',
    description: 'YouTube, TV နှင့် ကွန်ပျူတာ မျက်နှာပြင်ကျယ် ဗီဒီယိုပုံစံ',
  },
];

export const Step3CanvasCrop: React.FC<Step3CanvasCropProps> = ({
  project,
  setProject,
  onNextStep,
  onPrevStep,
}) => {
  const currentRatio = project.aspectRatio || '9:16';
  const crop = project.frameCrop || {
    fitMode: 'cover',
    scale: 1.0,
    posX: 0,
    posY: 0,
    backgroundStyle: 'blur',
  };

  const handleRatioSelect = (ratio: AspectRatioType) => {
    setProject((prev) => ({
      ...prev,
      aspectRatio: ratio,
    }));
  };

  const handleCropUpdate = (updates: Partial<FrameCropConfig>) => {
    setProject((prev) => ({
      ...prev,
      frameCrop: {
        ...prev.frameCrop,
        ...updates,
      },
    }));
  };

  const handleResetCrop = () => {
    setProject((prev) => ({
      ...prev,
      frameCrop: {
        fitMode: 'contain',
        scale: 1.0,
        posX: 0,
        posY: 0,
        backgroundStyle: 'blur',
      },
    }));
  };

  return (
    <div className="space-y-6">
      {/* Step Header */}
      <div className="ios-card p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-full bg-cyan-400/20 text-cyan-300 border border-cyan-400/40 flex items-center justify-center text-xs font-bold font-mono shadow-sm">
              3
            </span>
            <h2 className="text-lg font-bold text-white font-display tracking-tight flex items-center gap-2">
              <Crop className="w-5 h-5 text-cyan-400" />
              <span>Frame Crop & Platform Canvas Size</span>
            </h2>
          </div>
          <p className="text-xs text-white/60 font-myanmar mt-1">
            Customer Upload Video ၏ အရွယ်အစားကို TikTok (9:16), Facebook Feed (1:1 / 4:5), YouTube (16:9) စိတ်ကြိုက် ရွေးချယ်နိုင်ပါသည်။
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={onPrevStep}
            className="px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white font-bold text-xs rounded-xl transition-all border border-white/15 flex items-center gap-2 cursor-pointer active:scale-95 shadow-md"
          >
            <ArrowLeft className="w-4 h-4 stroke-[2.5]" />
            <span>အဆင့် 2 သို့</span>
          </button>

          <button
            onClick={onNextStep}
            className="px-5 py-2.5 bg-gradient-to-r from-sky-400 to-teal-400 hover:opacity-90 text-zinc-950 font-black text-xs rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-sky-500/20 cursor-pointer active:scale-95"
          >
            <span>အဆင့် 4 သို့</span>
            <ArrowRight className="w-4 h-4 stroke-[2.5]" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Platform Sizes & Crop Controls */}
        <div className="lg:col-span-5 space-y-5">
          {/* PLATFORM SIZES SELECTOR */}
          <div className="ios-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <span>1. Platform Aspect Ratio Size</span>
              </span>
              <span className="ios-pill text-[10px] bg-cyan-500/20 text-cyan-300 border-cyan-400/30 font-mono font-bold">
                Active: {currentRatio}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {PLATFORM_SIZES.map((item) => {
                const isSelected = currentRatio === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleRatioSelect(item.id)}
                    className={`p-4 rounded-2xl border text-left transition-all flex items-start justify-between gap-3 cursor-pointer ${
                      isSelected
                        ? 'bg-cyan-500/15 border-cyan-400/80 text-white shadow-xl shadow-cyan-500/10 ring-1 ring-cyan-400/40 backdrop-blur-xl'
                        : 'bg-white/[0.03] border-white/10 text-white/60 hover:border-white/25 hover:text-white hover:bg-white/[0.06]'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2.5 rounded-xl ${isSelected ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/30' : 'bg-white/10 text-white/60'}`}>
                        {item.icon}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-bold text-white">{item.title}</h4>
                          <span className={`text-[9px] px-2 py-0.5 rounded-full border font-mono font-bold ${item.badgeColor}`}>
                            {item.aspectLabel}
                          </span>
                        </div>
                        <p className="text-[11px] text-white/50 font-medium mt-0.5">{item.sub}</p>
                        <p className="text-[10px] text-white/60 font-myanmar mt-1 leading-relaxed">
                          {item.description}
                        </p>
                      </div>
                    </div>

                    {isSelected && (
                      <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0 mt-1" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* FRAME FIT & CROP POSITIONING CONTROLS */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                <Sliders className="w-4 h-4 text-amber-400" />
                <span>2. Video Fit & Frame Positioning (Zoom / Crop / Position)</span>
              </span>
              <button
                type="button"
                onClick={handleResetCrop}
                className="px-2 py-1 text-[10px] font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded transition-colors flex items-center gap-1"
                title="Reset Crop Position"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            </div>

            {/* Fit Mode Toggle (Cover / Fill vs Contain / Letterbox) */}
            <div className="space-y-1.5">
              <label className="text-[11px] text-zinc-300 font-medium block">
                Video Fit Mode (Frame အပြည့်ဖြည့်မလား သို့မဟုတ် Letterbox ထားမလား):
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleCropUpdate({ fitMode: 'cover' })}
                  className={`p-2.5 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    crop.fitMode === 'cover'
                      ? 'bg-cyan-500 text-zinc-950 border-cyan-400 shadow-md font-bold'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                  }`}
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>Crop Fill (Cover Frame)</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleCropUpdate({ fitMode: 'contain' })}
                  className={`p-2.5 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    crop.fitMode === 'contain'
                      ? 'bg-cyan-500 text-zinc-950 border-cyan-400 shadow-md font-bold'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                  }`}
                >
                  <Layout className="w-3.5 h-3.5" />
                  <span>Fit Letterbox (Blurred BG)</span>
                </button>
              </div>
            </div>

            {/* Background Style when Contain */}
            {crop.fitMode === 'contain' && (
              <div className="space-y-1.5 pt-1">
                <label className="text-[11px] text-zinc-300 font-medium block">
                  Letterbox Background Fill Style:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'blur', label: 'Dark Blurred Video' },
                    { id: 'black', label: 'Solid Black' },
                    { id: 'gradient', label: 'Dark Gradient' },
                  ].map((bg) => (
                    <button
                      key={bg.id}
                      type="button"
                      onClick={() => handleCropUpdate({ backgroundStyle: bg.id as any })}
                      className={`p-1.5 rounded text-[11px] border font-medium text-center transition-all cursor-pointer ${
                        crop.backgroundStyle === bg.id
                          ? 'bg-amber-500 text-zinc-950 border-amber-400 font-bold'
                          : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                      }`}
                    >
                      {bg.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Zoom / Scale Slider */}
            <div className="space-y-1.5 pt-2 border-t border-zinc-800/80">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-300 font-medium">Zoom / Scale Video:</span>
                <span className="font-mono text-cyan-400 font-bold">{(crop.scale || 1.0).toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.5"
                step="0.05"
                value={crop.scale || 1.0}
                onChange={(e) => handleCropUpdate({ scale: parseFloat(e.target.value) })}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>

            {/* Offset X Slider (Pan Left / Right) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-300 font-medium">Position X (ဘယ် / ညာ ရွှေ့ရန်):</span>
                <span className="font-mono text-cyan-400 font-bold">{crop.posX || 0}px</span>
              </div>
              <input
                type="range"
                min="-150"
                max="150"
                step="2"
                value={crop.posX || 0}
                onChange={(e) => handleCropUpdate({ posX: parseInt(e.target.value, 10) })}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>

            {/* Offset Y Slider (Pan Up / Down) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-300 font-medium">Position Y (အပေါ် / အောက် ရွှေ့ရန်):</span>
                <span className="font-mono text-cyan-400 font-bold">{crop.posY || 0}px</span>
              </div>
              <input
                type="range"
                min="-150"
                max="150"
                step="2"
                value={crop.posY || 0}
                onChange={(e) => handleCropUpdate({ posY: parseInt(e.target.value, 10) })}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>
          </div>
        </div>

        {/* Right Column: Live Frame Preview */}
        <div className="lg:col-span-7 space-y-3 sticky top-20">
          <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs">
            <span className="font-bold text-zinc-200 flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>Live Frame Canvas Preview ({currentRatio} Size)</span>
            </span>
            <span className="text-[10px] text-zinc-400 font-myanmar">
              အခြား အဆင့်အားလုံးတွင် ဤ အရွယ်အစားအတိုင်း အတူတူ ပေါ်မည်ဖြစ်သည်
            </span>
          </div>

          <VideoPlayerView
            project={project}
            setProject={setProject}
            activeSegment={null}
          />
        </div>
      </div>

      {/* Bottom Navigation Card */}
      <div className="ios-card p-5 flex items-center justify-between gap-4">
        <button
          onClick={onPrevStep}
          className="px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white font-bold text-xs rounded-xl transition-all border border-white/15 flex items-center gap-2 cursor-pointer active:scale-95 shadow-md"
        >
          <ArrowLeft className="w-4 h-4 stroke-[2.5]" />
          <span>အဆင့် 2 သို့</span>
        </button>

        <span className="text-xs text-zinc-400 font-myanmar hidden sm:inline">
          Canvas Size ချိန်ညှိပြီးပါက အဆင့် 4 (AI Transcript) သို့ သွားပါ
        </span>

        <button
          onClick={onNextStep}
          className="px-6 py-3 bg-gradient-to-r from-sky-400 to-teal-400 hover:opacity-90 text-zinc-950 font-black text-xs rounded-xl transition-all flex items-center gap-2.5 shadow-xl shadow-sky-500/25 cursor-pointer active:scale-95"
        >
          <span>အဆင့် 4 သို့</span>
          <ArrowRight className="w-4 h-4 stroke-[2.5]" />
        </button>
      </div>
    </div>
  );
};
