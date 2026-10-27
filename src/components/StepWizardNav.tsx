import React from 'react';
import { Check, ChevronRight } from 'lucide-react';

export interface StepItem {
  number: number;
  id: string;
  title: string;
  subtitle: string;
  isComplete: boolean;
}

interface StepWizardNavProps {
  currentStep: number;
  onSelectStep: (stepNumber: number) => void;
  steps: StepItem[];
}

export const StepWizardNav: React.FC<StepWizardNavProps> = ({
  currentStep,
  onSelectStep,
  steps,
}) => {
  return (
    <div className="glass-panel rounded-2xl p-2.5 shadow-2xl relative z-20">
      <div className="flex items-center justify-between overflow-x-auto gap-2 py-0.5 scrollbar-none">
        {steps.map((s, idx) => {
          const isActive = currentStep === s.number;
          const isPassed = s.isComplete && currentStep > s.number;

          return (
            <React.Fragment key={s.number}>
              <button
                onClick={() => onSelectStep(s.number)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-all shrink-0 border cursor-pointer ${
                  isActive
                    ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-200 shadow-lg shadow-cyan-500/10 ring-1 ring-cyan-400/30'
                    : isPassed
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/15'
                    : 'bg-white/5 border-white/5 text-zinc-400 hover:text-zinc-200 hover:border-white/10 hover:bg-white/10'
                }`}
              >
                {/* Step Badge */}
                <div
                  className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold font-mono shrink-0 transition-transform ${
                    isPassed
                      ? 'bg-emerald-400 text-zinc-950 shadow-md shadow-emerald-500/20'
                      : isActive
                      ? 'bg-cyan-400 text-zinc-950 shadow-md shadow-cyan-500/30 scale-105'
                      : 'bg-white/10 text-zinc-400'
                  }`}
                >
                  {isPassed ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : s.number}
                </div>

                {/* Step Titles */}
                <div className="truncate max-w-[120px] sm:max-w-[150px]">
                  <span
                    className={`block text-xs font-bold leading-tight truncate ${
                      isActive ? 'text-white' : isPassed ? 'text-emerald-300' : 'text-zinc-400'
                    }`}
                  >
                    {s.title}
                  </span>
                  <span className="block text-[10px] text-zinc-400 truncate mt-0.5 font-medium">
                    {s.subtitle}
                  </span>
                </div>
              </button>

              {idx < steps.length - 1 && (
                <ChevronRight className="w-3.5 h-3.5 text-zinc-600 shrink-0 hidden sm:block" />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
