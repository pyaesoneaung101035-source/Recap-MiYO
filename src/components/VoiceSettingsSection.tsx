import React, { useState } from 'react';
import { Volume2, Play, Loader2, Sparkles, User, Mic2, Activity, Gauge, KeyRound, ShieldCheck } from 'lucide-react';
import { TtsProvider, NarrationStyle } from '../types/narrator';
import { previewVoiceSample } from '../utils/narratorApi';

interface VoiceSettingsSectionProps {
  provider: TtsProvider;
  onSelectProvider: (p: TtsProvider) => void;
  gender: 'male' | 'female';
  onSelectGender: (g: 'male' | 'female') => void;
  voice: string;
  onSelectVoice: (v: string) => void;
  style: NarrationStyle;
  onSelectStyle: (s: NarrationStyle) => void;
  pacing: number;
  onSelectPacing: (p: number) => void;
  geminiConfigured: boolean;
  cambConfigured: boolean;
  onOpenSecretsModal: () => void;
  disabled?: boolean;
}

export const VoiceSettingsSection: React.FC<VoiceSettingsSectionProps> = ({
  provider,
  onSelectProvider,
  gender,
  onSelectGender,
  voice,
  onSelectVoice,
  style,
  onSelectStyle,
  pacing,
  onSelectPacing,
  geminiConfigured,
  cambConfigured,
  onOpenSecretsModal,
  disabled = false,
}) => {
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const maleVoices = [
    { id: 'Thiha', name: 'သီဟ (Thiha)', desc: 'နွေးထွေးခန့်ညားသော နေ့စဉ်စကားပြော သဘာဝအသံ (Conversational Male)' },
    { id: 'KyawKyaw', name: 'ကျော်ကျော် (Kyaw Kyaw)', desc: 'သြဇာကြီးမား နက်နဲသော Deep Bass အသံ (Movie Recap Specialist)' },
    { id: 'AungAung', name: 'အောင်အောင် (Aung Aung)', desc: 'တက်ကြွသွက်လက်သော လူငယ်သံ (Dynamic Youth Male)' },
    { id: 'MinThway', name: 'မင်းသွေး (Min Thway)', desc: 'အေးချမ်းတည်ကြည်သော ဇာတ်လမ်းပြောသံ (Calm Narrative Male)' },
  ];

  const femaleVoices = [
    { id: 'Nilar', name: 'နီလာ (Nilar)', desc: 'သဘာဝကျနူးညံ့ ကြည်လင်ပြတ်သားသော အသံ (Natural Clear Female)' },
    { id: 'MayThu', name: 'မေသူ (May Thu)', desc: 'ချိုသာနူးညံ့သော ဇာတ်လမ်းပြောသံ (Sweet Storytelling Female)' },
    { id: 'Thiri', name: 'သီရိ (Thiri)', desc: 'တောက်ပသွက်လက်သော သတင်းနှင့် တင်ဆက်သံ (Broadcast Presenter)' },
    { id: 'SuSu', name: 'စုစု (Su Su)', desc: 'ချစ်စဖွယ် လန်းဆန်းပျော်ရွှင်သော အသံ (Cheerful Sweet Female)' },
  ];

  const styles: { id: NarrationStyle; label: string; desc: string }[] = [
    { id: 'recap', label: '🎬 ဇာတ်လမ်းဆန်ဆန် (Dramatic Recap)', desc: 'ရုပ်ရှင်/ဗီဒီယို ဇာတ်ကွက် စိတ်ဝင်စားဖွယ် ဆွဲဆောင်မှုရှိသော အသံ' },
    { id: 'conversational', label: '💬 နေ့စဉ်စကားပြော (Conversational)', desc: 'လူအချင်းချင်း သဘာဝကျကျ စကားပြောသလို ရင်းနှီးနွေးထွေးသော အသံ' },
    { id: 'documentary', label: '🎙️ မှတ်တမ်းရုပ်ရှင် (Documentary)', desc: 'လေးနက်တည်ကြည်ပြီး ဗဟုသုတရစေမည့် သတင်းတင်ဆက်ဟန်' },
    { id: 'energetic', label: '⚡ သွက်လက်တက်ကြွ (High Energy)', desc: 'TikTok / Shorts အတွက် ဆွဲဆောင်မှုရှိပြီး အားပါသော အသံ' },
    { id: 'soothing', label: '🌿 အေးချမ်းညင်သာ (Soothing Warm)', desc: 'နားဆင်ရ သက်သာပြီး ငြိမ်းချမ်းသော ရသစုံ အသံ' },
  ];

  const handlePreviewVoice = async () => {
    setIsPlayingPreview(true);
    setPreviewError(null);
    try {
      const res = await previewVoiceSample({
        voice,
        gender,
        style,
        pacing,
        provider,
      });
      if (res.audioUrl) {
        const audio = new Audio(res.audioUrl);
        audio.onended = () => setIsPlayingPreview(false);
        audio.onerror = () => {
          setIsPlayingPreview(false);
          setPreviewError('အသံဖိုင် ဖွင့်မရပါ');
        };
        await audio.play();
      }
    } catch (err: any) {
      console.error('Preview error:', err);
      setPreviewError(err.message || 'အသံနမူနာ စမ်းသပ်မှု မအောင်မြင်ပါ');
      setIsPlayingPreview(false);
    }
  };

  return (
    <section className="p-6 sm:p-7 rounded-3xl bg-zinc-900/60 border border-white/10 shadow-2xl backdrop-blur-xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-purple-500/20 text-purple-300 border border-purple-500/30 font-bold flex items-center justify-center text-sm shadow-md">
            ၃
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              <span>အသံနှင့် နည်းပညာ ရွေးချယ်မှု (API / Voice Settings)</span>
            </h2>
            <p className="text-xs text-zinc-400 font-myanmar mt-0.5">
              မြန်မာဘာသာစကားအတွက် အကောင်းဆုံး ဇာတ်ကြောင်းပြော အသံနှင့် စတိုင်လ်ကို သတ်မှတ်ပါ
            </p>
          </div>
        </div>

        {/* Server Secret Info Link */}
        <button
          type="button"
          onClick={onOpenSecretsModal}
          className="text-xs text-purple-300 hover:text-purple-200 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 px-3 py-1.5 rounded-xl transition-all font-myanmar flex items-center gap-1.5 cursor-pointer self-start sm:self-center"
        >
          <KeyRound className="w-3.5 h-3.5" />
          <span>Secrets လမ်းညွှန် ဖတ်ရန်</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: TTS Provider & Gender/Voice */}
        <div className="space-y-4">
          {/* Provider Selector */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-200 font-myanmar block">
              TTS Provider ရွေးချယ်မှု (Text-to-Speech Engine)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelectProvider('gemini')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  provider === 'gemini'
                    ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-200 ring-1 ring-cyan-400/30 shadow-md'
                    : 'bg-white/5 border-white/5 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Gemini TTS</span>
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold font-mono">
                    gemini-3.8-flash-lite-tts
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 font-myanmar leading-tight">
                  Google AI Studio ၏ တရားဝင် Gemini TTS မော်ဒယ်
                </p>
              </button>

              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelectProvider('edge_neural')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  provider === 'edge_neural'
                    ? 'bg-teal-500/15 border-teal-400/50 text-teal-200 ring-1 ring-teal-400/30 shadow-md'
                    : 'bg-white/5 border-white/5 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Mic2 className="w-3.5 h-3.5 text-teal-400" />
                    <span>Native Studio Neural</span>
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-teal-500/20 text-teal-300 border border-teal-500/30 font-semibold font-mono">
                    24kHz Studio
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 font-myanmar leading-tight">
                  မြန်မာစကားပြော အသံထွက် အထူးသဘာဝကျသော စတူဒီယို အသံ
                </p>
              </button>
            </div>
          </div>

          {/* Gender Selector */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-200 font-myanmar block">
              ကျား / မ အသံ အမျိုးအစား
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  onSelectGender('male');
                  onSelectVoice('Thiha');
                }}
                className={`py-2 px-3 rounded-xl border text-xs font-bold font-myanmar transition-all cursor-pointer flex items-center justify-center gap-2 ${
                  gender === 'male'
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 shadow-md'
                    : 'bg-white/5 border-white/5 text-zinc-400 hover:text-white'
                }`}
              >
                <User className="w-3.5 h-3.5 text-cyan-400" />
                <span>အမျိုးသား အသံ (Male)</span>
              </button>

              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  onSelectGender('female');
                  onSelectVoice('Nilar');
                }}
                className={`py-2 px-3 rounded-xl border text-xs font-bold font-myanmar transition-all cursor-pointer flex items-center justify-center gap-2 ${
                  gender === 'female'
                    ? 'bg-teal-500/20 border-teal-400 text-teal-200 shadow-md'
                    : 'bg-white/5 border-white/5 text-zinc-400 hover:text-white'
                }`}
              >
                <User className="w-3.5 h-3.5 text-teal-400" />
                <span>အမျိုးသမီး အသံ (Female)</span>
              </button>
            </div>
          </div>

          {/* Specific Voice Actor Selection */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-200 font-myanmar block">
              ဇာတ်ကြောင်းပြောသူ အသံရွေးချယ်ရန် (Voice Persona)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(gender === 'male' ? maleVoices : femaleVoices).map((v) => {
                const isSelected = voice === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => onSelectVoice(v.id)}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-cyan-500/20 border-cyan-400/60 text-white shadow-md'
                        : 'bg-white/5 border-white/5 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <span className="text-xs font-bold block">{v.name}</span>
                    <span className="text-[10px] text-zinc-400 font-myanmar block mt-0.5 line-clamp-1">
                      {v.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Narration Style, Pacing, and Voice Preview */}
        <div className="space-y-4">
          {/* Narration Style */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-200 font-myanmar block">
              ဇာတ်ကြောင်းပြောဟန် စတိုင်လ် (Narration Style)
            </label>
            <div className="space-y-1.5">
              {styles.map((s) => {
                const isSelected = style === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => onSelectStyle(s.id)}
                    className={`w-full p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between ${
                      isSelected
                        ? 'bg-purple-500/15 border-purple-400/50 text-purple-200 shadow-md ring-1 ring-purple-400/30'
                        : 'bg-white/5 border-white/5 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-white block">{s.label}</span>
                      <span className="text-[10px] text-zinc-400 font-myanmar block">{s.desc}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Speaking Pace Slider */}
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-myanmar">
              <span className="font-bold text-zinc-200 flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5 text-cyan-400" />
                <span>စကားပြောနှုန်း (Speaking Pace):</span>
              </span>
              <span className="font-mono text-cyan-300 font-bold bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800">
                {pacing.toFixed(2)}x
              </span>
            </div>

            <input
              type="range"
              min="0.80"
              max="1.20"
              step="0.05"
              value={pacing}
              disabled={disabled}
              onChange={(e) => onSelectPacing(parseFloat(e.target.value))}
              className="w-full accent-cyan-400 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
            />

            <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
              <span>0.80x (တည်ငြိမ်)</span>
              <span>1.00x (ပုံမှန်)</span>
              <span>1.20x (သွက်လက်)</span>
            </div>
          </div>

          {/* Preview Button */}
          <div className="pt-1">
            <button
              type="button"
              onClick={handlePreviewVoice}
              disabled={isPlayingPreview || disabled}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-purple-500/20 to-cyan-500/20 hover:from-purple-500/30 hover:to-cyan-500/30 border border-purple-500/40 text-purple-200 font-bold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg active:scale-95 disabled:opacity-50"
            >
              {isPlayingPreview ? (
                <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
              ) : (
                <Volume2 className="w-4 h-4 text-purple-400" />
              )}
              <span className="font-myanmar">
                {isPlayingPreview ? 'အသံနမူနာ ဖတ်ပြနေပါသည်...' : 'ရွေးချယ်ထားသော အသံကို စမ်းသပ်နားထောင်မည် (Preview Voice)'}
              </span>
            </button>

            {previewError && (
              <p className="text-[11px] text-rose-400 font-myanmar text-center mt-1.5">
                {previewError}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
