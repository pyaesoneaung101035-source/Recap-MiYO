import React, { useState } from 'react';
import { Lock, Delete, AlertCircle } from 'lucide-react';

interface PasscodeLockModalProps {
  onUnlock: () => void;
}

export const PasscodeLockModal: React.FC<PasscodeLockModalProps> = ({ onUnlock }) => {
  const [enteredPin, setEnteredPin] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const CORRECT_PIN = '762005';

  const handleNumberClick = (num: string) => {
    if (enteredPin.length < 6) {
      const updated = enteredPin + num;
      setEnteredPin(updated);
      setErrorMsg(null);

      if (updated.length === 6) {
        if (updated === CORRECT_PIN) {
          sessionStorage.setItem('site_unlocked', 'true');
          onUnlock();
        } else {
          setErrorMsg('PIN နံပါတ် မှားယွင်းနေပါသည်။ (762005 ဖြစ်ပါသည်)');
          setTimeout(() => {
            setEnteredPin('');
            setErrorMsg(null);
          }, 1200);
        }
      }
    }
  };

  const handleBackspace = () => {
    setEnteredPin((prev) => prev.slice(0, -1));
    setErrorMsg(null);
  };

  const handleClear = () => {
    setEnteredPin('');
    setErrorMsg(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/95 backdrop-blur-2xl p-4">
      <div className="w-full max-w-sm glass-panel p-8 rounded-3xl shadow-2xl border border-white/15 text-center space-y-6 animate-in fade-in zoom-in duration-300">
        {/* Lock Icon */}
        <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-tr from-cyan-500/20 to-teal-500/20 border border-cyan-400/30 flex items-center justify-center text-cyan-400 shadow-xl shadow-cyan-500/10">
          <Lock className="w-8 h-8" />
        </div>

        {/* Titles */}
        <div className="space-y-1.5">
          <h2 className="text-xl font-bold text-white font-display tracking-tight">
            Passcode ထည့်သွင်းပါ
          </h2>
          <p className="text-xs text-zinc-400 font-myanmar">
            Website သို့ ဝင်ရောက်ရန် ၆ လုံးပါ PIN ရိုက်ပါ
          </p>
        </div>

        {/* 6 Digit Display Boxes */}
        <div className="flex items-center justify-center gap-2.5 my-4">
          {Array.from({ length: 6 }).map((_, i) => {
            const hasChar = enteredPin[i] !== undefined;
            return (
              <div
                key={i}
                className={`w-11 h-14 rounded-2xl border flex items-center justify-center text-xl font-mono font-bold transition-all ${
                  hasChar
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 shadow-lg shadow-cyan-500/20 scale-105'
                    : 'bg-white/5 border-white/10 text-zinc-600'
                }`}
              >
                {hasChar ? '•' : ''}
              </div>
            );
          })}
        </div>

        {errorMsg && (
          <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-myanmar flex items-center justify-center gap-1.5 animate-shake">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Numpad Grid */}
        <div className="grid grid-cols-3 gap-3 pt-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button
              key={digit}
              type="button"
              onClick={() => handleNumberClick(digit)}
              className="h-14 rounded-2xl bg-white/5 hover:bg-white/10 active:bg-white/20 border border-white/10 text-white font-mono text-xl font-bold transition-all cursor-pointer flex items-center justify-center shadow-md active:scale-95"
            >
              {digit}
            </button>
          ))}

          <button
            type="button"
            onClick={handleClear}
            className="h-14 rounded-2xl bg-white/5 hover:bg-white/10 active:bg-white/20 border border-white/10 text-zinc-400 hover:text-white font-myanmar text-xs font-bold transition-all cursor-pointer flex items-center justify-center shadow-md active:scale-95"
          >
            CLEAR
          </button>

          <button
            type="button"
            onClick={() => handleNumberClick('0')}
            className="h-14 rounded-2xl bg-white/5 hover:bg-white/10 active:bg-white/20 border border-white/10 text-white font-mono text-xl font-bold transition-all cursor-pointer flex items-center justify-center shadow-md active:scale-95"
          >
            0
          </button>

          <button
            type="button"
            onClick={handleBackspace}
            className="h-14 rounded-2xl bg-white/5 hover:bg-white/10 active:bg-white/20 border border-white/10 text-zinc-300 hover:text-white transition-all cursor-pointer flex items-center justify-center shadow-md active:scale-95"
          >
            <Delete className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};
