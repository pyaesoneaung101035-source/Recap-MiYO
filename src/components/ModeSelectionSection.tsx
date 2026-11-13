import React from 'react';
import { Mic, Film, FileText, Subtitles, Layers, Check } from 'lucide-react';
import { ActionPlanMode } from '../types/narrator';

interface ModeSelectionSectionProps {
  selectedMode: ActionPlanMode;
  onSelectMode: (mode: ActionPlanMode) => void;
  disabled?: boolean;
}

interface ModeCard {
  id: ActionPlanMode;
  title: string;
  burmeseSubtitle: string;
  description: string;
  icon: React.ReactNode;
}

export const ModeSelectionSection: React.FC<ModeSelectionSectionProps> = ({
  selectedMode,
  onSelectMode,
  disabled = false,
}) => {
  const modes: ModeCard[] = [
    {
      id: 'burmese_narrator',
      title: 'မြန်မာ narrator ဘာသာပြန်',
      burmeseSubtitle: 'Burmese Narrator Translation',
      description: 'မူရင်းစကားပြောများကို ဇာတ်ကြောင်းပြောဟန်ဖြင့် သဘာဝကျစွာ မြန်မာလို အသံသွင်းဘာသာပြန်ဆိုပေးမည်။',
      icon: <Mic className="w-5 h-5 text-cyan-400" />,
    },
    {
      id: 'scene_retell',
      title: 'ဇာတ်ကြောင်းကို အချိန်ကွက်အလိုက် ပြန်ဆိုရန်',
      burmeseSubtitle: 'Scene-timed Retelling',
      description: 'ဗီဒီယိုမြင်ကွင်း အပြောင်းအလဲနှင့် အချိန်ကွက်အလိုက် စိတ်ဝင်စားဖွယ် ဇာတ်ကြောင်းပြန်ပြောဟန် ဖွဲ့စည်းမည်။',
      icon: <Film className="w-5 h-5 text-teal-400" />,
    },
    {
      id: 'transcript_only',
      title: 'Transcript ထုတ်ရန်သာ',
      burmeseSubtitle: 'Transcript Extraction Only',
      description: 'အသံမထုတ်လုပ်ဘဲ မူရင်း စကားပြောများနှင့် အချိန်ကိုက် မြန်မာစာသားများကိုသာ တိကျစွာ ထုတ်ယူမည်။',
      icon: <FileText className="w-5 h-5 text-sky-400" />,
    },
    {
      id: 'subtitle_only',
      title: 'Subtitle SRT ထုတ်ရန်သာ',
      burmeseSubtitle: 'Subtitle (.SRT) Only',
      description: 'ဗီဒီယိုတွင် တိုက်ရိုက် ထည့်သွင်းပြသနိုင်သော စံချိန်မီ မြန်မာစာတန်းထိုး SRT ဖိုင်ကိုသာ သီးသန့်ထုတ်ပေးမည်။',
      icon: <Subtitles className="w-5 h-5 text-indigo-400" />,
    },
    {
      id: 'narration_and_subtitle',
      title: 'Narration နှင့် subtitle နှစ်မျိုးလုံးထုတ်ရန်',
      burmeseSubtitle: 'Full Voiceover + Subtitles Package',
      description: 'ဇာတ်ကြောင်းပြော အသံဖိုင်အသစ်ရော၊ စာတန်းထိုး Subtitle ဖိုင်ပါ တစ်ခါတည်း အပြည့်အစုံ တွဲဖက်ထုတ်လုပ်မည်။',
      icon: <Layers className="w-5 h-5 text-emerald-400" />,
    },
  ];

  return (
    <section className="p-6 sm:p-7 rounded-3xl bg-zinc-900/60 border border-white/10 shadow-2xl backdrop-blur-xl space-y-5">
      {/* Step Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-white/10">
        <div className="w-8 h-8 rounded-xl bg-teal-500/20 text-teal-300 border border-teal-500/30 font-bold flex items-center justify-center text-sm shadow-md">
          ၂
        </div>
        <div>
          <h2 className="text-base font-bold text-white tracking-tight">
            လုပ်ဆောင်ချက်ရွေးရန် (Mode Selection)
          </h2>
          <p className="text-xs text-zinc-400 font-myanmar mt-0.5">
            သင့်ဗီဒီယိုအတွက် လိုအပ်သော ထုတ်လုပ်မှု ပုံစံကို ရွေးချယ်ပါ
          </p>
        </div>
      </div>

      {/* Grid of 5 Selectable Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {modes.map((mode) => {
          const isSelected = selectedMode === mode.id;
          return (
            <button
              key={mode.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelectMode(mode.id)}
              className={`p-4 rounded-2xl border text-left transition-all cursor-pointer relative flex flex-col justify-between gap-3 ${
                isSelected
                  ? 'bg-cyan-500/15 border-cyan-400/60 shadow-lg shadow-cyan-500/10 ring-1 ring-cyan-400/30'
                  : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/20'
              } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="w-9 h-9 rounded-xl bg-black/40 border border-white/10 flex items-center justify-center shrink-0">
                    {mode.icon}
                  </div>
                  {isSelected && (
                    <span className="w-5 h-5 rounded-full bg-cyan-400 text-zinc-950 flex items-center justify-center">
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    </span>
                  )}
                </div>

                <div>
                  <h3 className="text-xs font-bold text-white font-myanmar leading-snug">
                    {mode.title}
                  </h3>
                  <span className="text-[10px] text-zinc-400 font-mono block mt-0.5">
                    {mode.burmeseSubtitle}
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-zinc-400 font-myanmar leading-relaxed">
                {mode.description}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
};
