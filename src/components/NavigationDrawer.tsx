import React from 'react';
import { X, CheckCircle2, ChevronRight, Sparkles } from 'lucide-react';
import { StepItem } from './StepWizardNav';

interface NavigationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  steps: StepItem[];
  currentStep: number;
  onSelectStep: (step: number) => void;
}

export const NavigationDrawer: React.FC<NavigationDrawerProps> = ({
  isOpen,
  onClose,
  steps,
  currentStep,
  onSelectStep,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-md h-full bg-zinc-950 border-l border-white/15 p-6 flex flex-col justify-between shadow-2xl relative overflow-y-auto">
        {/* Glow */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="space-y-6 relative z-10">
          <div className="flex items-center justify-between pb-4 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-white font-display">Navigation Drawer</h3>
                <p className="text-xs text-zinc-400">Jump to any studio step instantly</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-2.5">
            {steps.map((st) => {
              const isActive = currentStep === st.number;
              return (
                <button
                  key={st.id}
                  onClick={() => {
                    onSelectStep(st.number);
                    onClose();
                  }}
                  className={`w-full p-4 rounded-2xl border text-left transition-all duration-300 flex items-center justify-between cursor-pointer group ${
                    isActive
                      ? 'bg-gradient-to-r from-cyan-500/20 via-teal-500/10 to-transparent border-cyan-400 text-white shadow-xl ring-1 ring-cyan-400/40'
                      : 'bg-white/5 border-white/10 text-zinc-300 hover:bg-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center gap-3.5">
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs ${
                        isActive
                          ? 'bg-cyan-400 text-zinc-950 shadow-md'
                          : st.isComplete
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-white/10 text-zinc-400'
                      }`}
                    >
                      {st.isComplete && !isActive ? <CheckCircle2 className="w-4 h-4" /> : st.number}
                    </div>
                    <div>
                      <span className="text-xs font-black block text-white font-display">{st.title}</span>
                      <span className="text-[10px] text-zinc-400 block mt-0.5">{st.subtitle}</span>
                    </div>
                  </div>
                  <ChevronRight className={`w-4 h-4 transition-transform ${isActive ? 'text-cyan-400 translate-x-1' : 'text-zinc-600 group-hover:text-zinc-300'}`} />
                </button>
              );
            })}
          </div>
        </div>

        <div className="pt-6 border-t border-white/10 text-center text-xs text-zinc-500 font-mono relative z-10">
          MotionRecap Ultimate Studio Pro v3.0
        </div>
      </div>
    </div>
  );
};
