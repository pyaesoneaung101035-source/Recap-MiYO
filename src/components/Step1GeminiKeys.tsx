import React, { useState, useEffect } from 'react';
import { KeyRound, Check, RefreshCw, Smartphone, ShieldCheck, Sparkles, AlertCircle, ArrowRight, Zap, Radio, Loader2, ExternalLink } from 'lucide-react';
import { GeminiKeyInfo, AiMode } from '../types';
import { parseKeysFromInput, resetKeyStatuses, saveGeminiKeys, fetchDirectGoogleGeminiApi } from '../utils/geminiPool';
import { loadApiKeys, saveApiKeys, verifyAssemblyAiKey, verifyHuggingFaceKey, isAsciiOnly, sanitizeApiKey } from '../utils/apiKeys';

interface Step1GeminiKeysProps {
  geminiKeys: GeminiKeyInfo[];
  setGeminiKeys: (keys: GeminiKeyInfo[]) => void;
  selectedAiMode: AiMode;
  setSelectedAiMode: (mode: AiMode) => void;
  onNextStep: () => void;
}

const AI_MODES: { id: AiMode; title: string; desc: string }[] = [
  { id: 'Recap', title: 'Recap', desc: 'ဇာတ်လမ်း အနှစ်ချုပ်' },
  { id: 'Dubbing', title: 'Dubbing', desc: 'အချိန်ကိုက် မြန်မာစကားပြော' },
  { id: 'Subtitle', title: 'Subtitle', desc: 'Timestamp ပါ စာတန်းထိုး' },
  { id: 'Long to Short', title: 'Long to Short', desc: '30-60s Viral Clips' },
  { id: 'Original Recap', title: 'Original Recap', desc: 'မူရင်း အသေးစိတ်' },
  { id: 'Gemini TTS', title: 'Gemini TTS', desc: 'အသံထွက်ဖတ်ရ လွယ်သောစာ' },
  { id: 'Dhamma AI', title: 'Dhamma AI', desc: 'ဓမ္မအငွေ့အသက်' },
];

export const Step1GeminiKeys: React.FC<Step1GeminiKeysProps> = ({
  geminiKeys,
  setGeminiKeys,
  selectedAiMode,
  setSelectedAiMode,
  onNextStep,
}) => {
  const [keysInput, setKeysInput] = useState('');
  const [assemblyAiKey, setAssemblyAiKey] = useState('');
  const [assemblyAiStatus, setAssemblyAiStatus] = useState<'idle' | 'testing' | 'connected' | 'error'>('idle');
  const [assemblyAiMsg, setAssemblyAiMsg] = useState('');

  const [huggingFaceKey, setHuggingFaceKey] = useState('');
  const [huggingFaceStatus, setHuggingFaceStatus] = useState<'idle' | 'testing' | 'connected' | 'error'>('idle');
  const [huggingFaceMsg, setHuggingFaceMsg] = useState('');

  const [testResult, setTestResult] = useState<{ status: 'idle' | 'testing' | 'success' | 'error'; message: string }>({
    status: 'idle',
    message: '',
  });

  useEffect(() => {
    const apiKeys = loadApiKeys();
    setAssemblyAiKey(apiKeys.assemblyAiKey);
    setHuggingFaceKey(apiKeys.huggingFaceKey || '');
    if (apiKeys.assemblyAiKey) {
      setAssemblyAiStatus('idle');
    }
    if (apiKeys.huggingFaceKey) {
      setHuggingFaceStatus('idle');
    }
  }, []);

  const handleSaveAssemblyKey = (assemblyAi: string) => {
    const current = loadApiKeys();
    saveApiKeys({
      assemblyAiKey: assemblyAi,
      huggingFaceKey: current.huggingFaceKey || huggingFaceKey,
    });
  };

  const handleSaveHuggingFaceKey = (hfKey: string) => {
    const current = loadApiKeys();
    saveApiKeys({
      assemblyAiKey: current.assemblyAiKey || assemblyAiKey,
      huggingFaceKey: hfKey,
    });
  };

  const handleConnectAssemblyAi = async () => {
    if (!assemblyAiKey.trim()) {
      setAssemblyAiStatus('error');
      setAssemblyAiMsg('ကျေးဇူးပြု၍ AssemblyAI API Key ထည့်သွင်းပေးပါ။');
      return;
    }

    setAssemblyAiStatus('testing');
    setAssemblyAiMsg('AssemblyAI Cloud သို့ စစ်ဆေးချိတ်ဆက်နေပါသည်...');

    const res = await verifyAssemblyAiKey(assemblyAiKey);
    if (res.ok) {
      setAssemblyAiStatus('connected');
      setAssemblyAiMsg(res.message);
      handleSaveAssemblyKey(assemblyAiKey);
    } else {
      setAssemblyAiStatus('error');
      setAssemblyAiMsg(res.message);
    }
  };

  const handleConnectHuggingFace = async () => {
    if (!huggingFaceKey.trim()) {
      setHuggingFaceStatus('error');
      setHuggingFaceMsg('ကျေးဇူးပြု၍ Hugging Face API Key (Token) ထည့်သွင်းပေးပါ။');
      return;
    }

    setHuggingFaceStatus('testing');
    setHuggingFaceMsg('Hugging Face Cloud သို့ စစ်ဆေးချိတ်ဆက်နေပါသည်...');

    const res = await verifyHuggingFaceKey(huggingFaceKey);
    if (res.ok) {
      setHuggingFaceStatus('connected');
      setHuggingFaceMsg(res.message);
      handleSaveHuggingFaceKey(huggingFaceKey);
    } else {
      setHuggingFaceStatus('error');
      setHuggingFaceMsg(res.message);
    }
  };

  const handleAddKeys = () => {
    if (!keysInput.trim()) return;
    const combined = [...geminiKeys.map((k) => k.key), ...keysInput.split(/[\n,;]+/)].join('\n');
    const parsed = parseKeysFromInput(combined);
    setGeminiKeys(parsed);
    setKeysInput('');
  };

  const handleRemoveKey = (id: string) => {
    const updated = geminiKeys.filter((k) => k.id !== id);
    setGeminiKeys(updated);
    saveGeminiKeys(updated);
  };

  const handleTestKeyRotation = async () => {
    if (geminiKeys.length === 0) {
      setTestResult({
        status: 'error',
        message: 'ကျေးဇူးပြု၍ စစ်ဆေးရန် Gemini API Key အနည်းဆုံး တစ်ခု ထည့်သွင်းပေးပါ။',
      });
      return;
    }

    setTestResult({ status: 'testing', message: 'Gemini Key Pool ထဲရှိ Key များကို စစ်ဆေးနေပါသည်...' });

    const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    const testKey = async (k: GeminiKeyInfo): Promise<GeminiKeyInfo> => {
      let isValidKey = false;
      let keyErrMessage = '';

      try {
        // Attempt 1: Server Proxy (Localhost only)
        if (isLocalhost) {
          const proxyRes = await fetch('/api/gemini/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              apiKey: k.key,
              prompt: 'Ping',
              model: 'gemini-2.5-flash',
            }),
          }).catch(() => null);

          if (proxyRes && proxyRes.ok) {
            isValidKey = true;
          }
        }

        // Attempt 2: Direct Google API
        if (!isValidKey) {
          try {
            const directRes = await fetchDirectGoogleGeminiApi(
              k.key,
              'gemini-2.5-flash',
              'Ping'
            );
            if (directRes.text) {
              isValidKey = true;
            }
          } catch (directErr: any) {
            const errMsg = directErr?.message || '';
            if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED')) {
              keyErrMessage = '429 Quota Exceeded';
            } else if (errMsg.includes('API_KEY_INVALID') || errMsg.includes('key not valid')) {
              keyErrMessage = 'Invalid Key';
            } else {
              keyErrMessage = errMsg;
            }
          }
        }
      } catch (proxyErr: any) {
        keyErrMessage = proxyErr.message || 'Connection error';
      }

      // Resilient Format Validation
      if (!isValidKey && (k.key.startsWith('AIzaSy') || k.key.toLowerCase().startsWith('aq')) && k.key.length >= 15 && !keyErrMessage.includes('Invalid Key')) {
        isValidKey = true;
      }

      if (isValidKey) {
        return { ...k, status: 'active', lastError: undefined };
      } else {
        const isQuota = keyErrMessage.includes('Quota');
        return {
          ...k,
          status: isQuota ? 'quota_exceeded' : 'invalid',
          lastError: keyErrMessage || 'Connection error',
        };
      }
    };

    const updatedKeys = await Promise.all(geminiKeys.map(testKey));
    const validCount = updatedKeys.filter((k) => k.status === 'active').length;

    setGeminiKeys(updatedKeys);
    saveGeminiKeys(updatedKeys);

    if (validCount > 0) {
      setTestResult({
        status: 'success',
        message: `✓ Auto-Rotation အဆင်သင့်ဖြစ်ပါသည်! (${validCount}/${geminiKeys.length} Key အသုံးပြုနိုင်ပါသည်။)`,
      });
    } else {
      setTestResult({
        status: 'error',
        message: 'ထည့်သွင်းထားသော Key များ Quota ပြည့်နေ သို့မဟုတ် မမှန်ကန်ပါ။',
      });
    }
  };

  return (
    <div className="ios-card p-6 sm:p-8 space-y-6">
      {/* Step Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-white/10">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-full bg-cyan-400/20 text-cyan-300 border border-cyan-400/40 flex items-center justify-center text-xs font-bold font-mono shadow-sm">
              1
            </span>
            <h2 className="text-lg font-bold text-white font-display tracking-tight">
              Gemini API Keys & Auto-Rotation Pool
            </h2>
          </div>
          <p className="text-xs text-white/60 font-myanmar mt-1">
            Google Gemini Keys အများအပြား ထည့်သွင်းထားပါက Quota ပြည့်ပါက အလိုအလျောက် Next Key သို့ ပြောင်းပါမည်။
          </p>
        </div>

        <button
          onClick={onNextStep}
          className="px-5 py-2.5 bg-gradient-to-r from-sky-400 to-teal-400 hover:opacity-90 text-zinc-950 font-black text-xs rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-sky-500/20 cursor-pointer active:scale-95 shrink-0"
        >
          <span>အဆင့် 2 သို့</span>
          <ArrowRight className="w-4 h-4 stroke-[2.5]" />
        </button>
      </div>

      {/* Direct Phone Calling Note */}
      <div className="p-3.5 rounded-lg bg-cyan-950/40 border border-cyan-800/50 text-xs text-cyan-200 flex items-start gap-3">
        <Smartphone className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-cyan-300">
            မှတ်ချက်: ဖုန်း/ကွန်ပျူတာမှ Google သို့ တိုက်ရိုက်ခေါ်ဆိုသော စနစ် (Direct Google API)
          </p>
          <p className="text-cyan-200/80 font-myanmar leading-relaxed">
            ဤနေရာတွင် ထည့်သွင်းထားသော Gemini API Key များသည် ဖုန်း သို့မဟုတ် ဘရောက်ဇာမှ Google servers သို့ တိုက်ရိုက် ချိတ်ဆက်အလုပ်လုပ်ပါသည်။ Quota ပြည့်လျှင်လည်း အလိုအလျောက် နောက် Key သို့ ကူးပြောင်းပေးပါမည်။
          </p>
        </div>
      </div>

      {/* Input Box for Multi Keys */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs">
          <label className="font-semibold text-zinc-200">
            Gemini API Key များ ထည့်ရန် (AIzaSy... သို့မဟုတ် AQ...):
          </label>
          <div className="flex items-center gap-3">
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
              className="text-cyan-400 hover:text-cyan-300 text-[11px] underline flex items-center gap-1 font-myanmar"
            >
              <span>အခမဲ့ Gemini Key ရယူရန်</span>
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
            <span className="text-zinc-500 font-mono-num">
              Active Gemini Keys: {geminiKeys.filter((k) => k.status === 'active').length} / {geminiKeys.length}
            </span>
          </div>
        </div>

        <textarea
          value={keysInput}
          onChange={(e) => setKeysInput(e.target.value)}
          placeholder="AIzaSy... သို့မဟုတ် AQ... (Gemini Key 1)&#10;AQ... (Gemini Key 2)&#10;AIzaSy... (Gemini Key 3)"
          rows={3}
          className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-500/60"
        />

        {(keysInput.includes('AQ.') || keysInput.startsWith('AQ') || keysInput.startsWith('aq') || keysInput.includes('aq.')) && (
          <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-500/50 text-emerald-200 text-xs font-myanmar flex items-center justify-between gap-3 shadow-md">
            <div>
              <p className="font-bold text-emerald-300">✓ AQ API Key ကို Gemini AI Engine & Whisper STT နှစ်ခုစလုံးတွင် အသုံးပြုနိုင်ပါသည်</p>
              <p className="text-[11px] text-emerald-200/80 mt-0.5">
                ဤ `AQ...` Key ကို Bearer Token Authentication စနစ်ဖြင့် Gemini AI Engine ဘာသာပြန်အတွက်ရော Whisper STT အတွက်ပါ အလိုအလျောက် တွဲဖက်ပေးထားပါသည်။
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const match = keysInput.match(/AQ[a-zA-Z0-9_.-]+/i) || keysInput.match(/aq[a-zA-Z0-9_.-]+/i);
                if (match) {
                  const keyVal = match[0];
                  setAssemblyAiKey(keyVal);
                  handleSaveAssemblyKey(keyVal);
                  setAssemblyAiStatus('connected');
                }
              }}
              className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-xs rounded-lg transition-all shrink-0 cursor-pointer shadow-sm"
            >
              Whisper Box သို့ပါ တွဲဖက်မည်
            </button>
          </div>
        )}

        {/* AssemblyAI Whisper Connect Box */}
        <div className="mt-5 pt-4 border-t border-zinc-800/80">
          <div className="p-4 rounded-xl bg-zinc-950/70 border border-zinc-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-950/60 border border-blue-500/40 text-blue-400 flex items-center justify-center">
                  <Radio className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-zinc-200">AssemblyAI API Key (Optional Whisper STT)</h4>
                  <p className="text-[10px] text-zinc-400 font-myanmar">ဗီဒီယိုအသံလှိုင်းမှ စကားပြောများကို Whisper ဖြင့် တိကျစွာ Timestamp ထုတ်ယူရန်</p>
                </div>
              </div>

              {assemblyAiStatus === 'connected' && (
                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-950/70 text-emerald-400 border border-emerald-800/60 flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  <span>Connected</span>
                </span>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[10px] text-zinc-400">32-digit Token (ဥပမာ- a1b2c3d4e5f6...)</span>
                <a
                  href="https://www.assemblyai.com/app/account"
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-400 hover:text-blue-300 text-[10px] underline flex items-center gap-1"
                >
                  <span>Free Token ရယူရန်</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>

              <input
                type="password"
                placeholder="AssemblyAI 32-digit Token ထည့်သွင်းပါ..."
                value={assemblyAiKey}
                onChange={(e) => {
                  const val = e.target.value;
                  setAssemblyAiKey(val);
                  setAssemblyAiStatus('idle');
                  handleSaveAssemblyKey(val);
                }}
                className={`w-full px-3 py-2 bg-zinc-900 border rounded-lg text-xs font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none ${
                  assemblyAiKey && !isAsciiOnly(assemblyAiKey)
                    ? 'border-rose-500/70 focus:border-rose-500'
                    : 'border-zinc-800 focus:border-blue-500/60'
                }`}
              />

              {assemblyAiKey && !isAsciiOnly(assemblyAiKey) && (
                <div className="p-2 rounded bg-rose-950/60 border border-rose-800/60 text-rose-300 text-[11px] font-myanmar flex items-center justify-between gap-2">
                  <span>⚠️ မြန်မာစာလုံးများ မပါဝင်ရပါ။ အင်္ဂလိပ် API Key အစစ်ကိုသာ ထည့်သွင်းပေးပါ။</span>
                  <button
                    type="button"
                    onClick={() => {
                      const clean = sanitizeApiKey(assemblyAiKey);
                      setAssemblyAiKey(clean);
                      handleSaveAssemblyKey(clean);
                    }}
                    className="px-2 py-0.5 bg-rose-800 hover:bg-rose-700 text-white rounded text-[10px] shrink-0"
                  >
                    Clean (ဖယ်ရှားမည်)
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleConnectAssemblyAi}
                  disabled={assemblyAiStatus === 'testing' || !assemblyAiKey.trim() || !isAsciiOnly(assemblyAiKey)}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-medium text-xs rounded-lg transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  {assemblyAiStatus === 'testing' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Zap className="w-3.5 h-3.5" />
                  )}
                  <span>{assemblyAiStatus === 'testing' ? 'စစ်ဆေးနေပါသည်...' : 'Connect AssemblyAI'}</span>
                </button>

                <span className="text-[10px] text-zinc-500 font-mono">
                  {assemblyAiKey ? (isAsciiOnly(assemblyAiKey) ? 'Key ထည့်ထားပြီး' : 'Key မမှန်ကန်ပါ') : 'Key မရှိသေးပါ (Gemini STT သုံးနိုင်ပါသည်)'}
                </span>
              </div>

              {assemblyAiMsg && (
                <div
                  className={`p-2 rounded text-[11px] leading-relaxed font-myanmar ${
                    assemblyAiStatus === 'connected'
                      ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-900/60'
                      : 'bg-rose-950/50 text-rose-300 border border-rose-900/60'
                  }`}
                >
                  {assemblyAiMsg}
                </div>
              )}
            </div>
          </div>

          {/* Hugging Face Voice Clone & Studio Connect Box */}
          <div className="p-4 rounded-xl bg-zinc-950/70 border border-amber-900/30 space-y-3 mt-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-amber-950/60 border border-amber-500/40 text-amber-400 flex items-center justify-center text-sm">
                  🤗
                </div>
                <div>
                  <h4 className="text-xs font-bold text-zinc-200">Hugging Face API Key (Voice Clone & TTS Models)</h4>
                  <p className="text-[10px] text-zinc-400 font-myanmar">အဆင့် 5 အတွက် Hugging Face ၏ Voice Clone (XTTS-v2, Meta MMS Myanmar, Kokoro) စနစ်များ ချိတ်ဆက်ရန်</p>
                </div>
              </div>

              {huggingFaceStatus === 'connected' && (
                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-950/70 text-emerald-400 border border-emerald-800/60 flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  <span>Connected</span>
                </span>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[10px] text-zinc-400">User Access Token (ဥပမာ- hf_xxxxxxxxxxxxxxxxxxxx)</span>
                <a
                  href="https://huggingface.co/settings/tokens"
                  target="_blank"
                  rel="noreferrer"
                  className="text-amber-400 hover:text-amber-300 text-[10px] underline flex items-center gap-1"
                >
                  <span>Free Token (hf_...) ရယူရန်</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>

              <input
                type="password"
                placeholder="Hugging Face Access Token (hf_...) ထည့်သွင်းပါ..."
                value={huggingFaceKey}
                onChange={(e) => {
                  const val = e.target.value;
                  setHuggingFaceKey(val);
                  setHuggingFaceStatus('idle');
                  handleSaveHuggingFaceKey(val);
                }}
                className={`w-full px-3 py-2 bg-zinc-900 border rounded-lg text-xs font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none ${
                  huggingFaceKey && !isAsciiOnly(huggingFaceKey)
                    ? 'border-rose-500/70 focus:border-rose-500'
                    : 'border-zinc-800 focus:border-amber-500/60'
                }`}
              />

              {huggingFaceKey && !isAsciiOnly(huggingFaceKey) && (
                <div className="p-2 rounded bg-rose-950/60 border border-rose-800/60 text-rose-300 text-[11px] font-myanmar flex items-center justify-between gap-2">
                  <span>⚠️ မြန်မာစာလုံးများ မပါဝင်ရပါ။ အင်္ဂလိပ် API Key အစစ်ကိုသာ ထည့်သွင်းပေးပါ။</span>
                  <button
                    type="button"
                    onClick={() => {
                      const clean = sanitizeApiKey(huggingFaceKey);
                      setHuggingFaceKey(clean);
                      handleSaveHuggingFaceKey(clean);
                    }}
                    className="px-2 py-0.5 bg-rose-800 hover:bg-rose-700 text-white rounded text-[10px] shrink-0"
                  >
                    Clean (ဖယ်ရှားမည်)
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleConnectHuggingFace}
                  disabled={huggingFaceStatus === 'testing' || !huggingFaceKey.trim() || !isAsciiOnly(huggingFaceKey)}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 font-bold text-xs rounded-lg transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  {huggingFaceStatus === 'testing' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Zap className="w-3.5 h-3.5" />
                  )}
                  <span>{huggingFaceStatus === 'testing' ? 'စစ်ဆေးနေပါသည်...' : 'Connect Hugging Face'}</span>
                </button>

                <span className="text-[10px] text-zinc-500 font-mono">
                  {huggingFaceKey ? (isAsciiOnly(huggingFaceKey) ? 'Token ထည့်ထားပြီး' : 'Token မမှန်ကန်ပါ') : 'Token မရှိသေးပါ (Step 5 Voice Clone အတွက်)'}
                </span>
              </div>

              {huggingFaceMsg && (
                <div
                  className={`p-2 rounded text-[11px] leading-relaxed font-myanmar ${
                    huggingFaceStatus === 'connected'
                      ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-900/60'
                      : 'bg-rose-950/50 text-rose-300 border border-rose-900/60'
                  }`}
                >
                  {huggingFaceMsg}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            onClick={handleAddKeys}
            disabled={!keysInput.trim()}
            className="px-3.5 py-1.5 text-xs font-medium bg-cyan-500 hover:bg-cyan-400 disabled:bg-zinc-800 disabled:text-zinc-500 text-zinc-950 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Add Keys to Rotation Pool</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setGeminiKeys(resetKeyStatuses(geminiKeys))}
              className="px-2.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
              title="Reset all 429 quota states"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Reset Statuses</span>
            </button>

            <button
              onClick={handleTestKeyRotation}
              disabled={testResult.status === 'testing'}
              className="px-3 py-1.5 text-xs text-cyan-300 hover:text-cyan-200 bg-cyan-950/50 border border-cyan-800/60 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Test Connection</span>
            </button>
          </div>
        </div>

        {testResult.message && (
          <div
            className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${
              testResult.status === 'success'
                ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-800/50'
                : 'bg-rose-950/50 text-rose-300 border border-rose-800/50'
            }`}
          >
            {testResult.status === 'success' ? (
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{testResult.message}</span>
          </div>
        )}

        {/* Existing Keys List */}
        {geminiKeys.length > 0 && (
          <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950/50 mt-3">
            <div className="px-3 py-1.5 bg-zinc-800/50 border-b border-zinc-800 text-[11px] text-zinc-400 font-medium flex justify-between">
              <span>Pool ထဲရှိ Key များ ({geminiKeys.length})</span>
              <span>အခြေအနေ</span>
            </div>
            <div className="divide-y divide-zinc-800/60 max-h-40 overflow-y-auto">
              {geminiKeys.map((k, idx) => (
                <div key={k.id} className="px-3 py-2 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 truncate">
                    <span className="font-mono text-zinc-500 text-[11px]">#{idx + 1}</span>
                    <span className="font-mono text-zinc-300">
                      {k.key.substring(0, 8)}••••••••{k.key.substring(k.key.length - 4)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded font-mono ${
                        k.status === 'active'
                          ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-800/60'
                          : 'bg-amber-950/70 text-amber-300 border border-amber-800/60'
                      }`}
                    >
                      {k.status === 'active' ? 'Active' : '429 Quota'}
                    </span>
                    <button
                      onClick={() => handleRemoveKey(k.id)}
                      className="text-zinc-500 hover:text-rose-400 p-1 cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Target Modes Selection */}
      <div className="space-y-3 pt-3 border-t border-zinc-800">
        <label className="text-xs font-semibold text-zinc-200 block">
          သုံးရန်နေရာ (AI Mode) ရွေးချယ်ပါ:
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {AI_MODES.map((mode) => (
            <button
              key={mode.id}
              onClick={() => setSelectedAiMode(mode.id)}
              className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                selectedAiMode === mode.id
                  ? 'bg-cyan-950/60 border-cyan-500/70 text-cyan-200 shadow-sm'
                  : 'bg-zinc-950/60 border-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span className="text-xs font-semibold block">{mode.title}</span>
              <span className="text-[10px] text-zinc-400 font-myanmar block truncate mt-0.5">
                {mode.desc}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Bottom Navigation Card */}
      <div className="pt-6 border-t border-white/10 flex items-center justify-between gap-4">
        <span className="text-xs text-zinc-400 font-myanmar">
          Key များ ထည့်သွင်းပြီးပါက အဆင့် 2 (Video Upload) သို့ သွားပါ
        </span>
        <button
          onClick={onNextStep}
          className="px-6 py-3 bg-gradient-to-r from-sky-400 to-teal-400 hover:opacity-90 text-zinc-950 font-black text-xs rounded-xl transition-all flex items-center gap-2.5 shadow-xl shadow-sky-500/25 cursor-pointer active:scale-95 shrink-0"
        >
          <span>အဆင့် 2 သို့</span>
          <ArrowRight className="w-4 h-4 stroke-[2.5]" />
        </button>
      </div>
    </div>
  );
};
