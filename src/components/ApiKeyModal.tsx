import React, { useState, useEffect } from 'react';
import { X, KeyRound, Check, RefreshCw, AlertCircle, ShieldCheck, Sparkles, Smartphone, Radio, Zap, Loader2, ExternalLink } from 'lucide-react';
import { GeminiKeyInfo } from '../types';
import { parseKeysFromInput, saveGeminiKeys, resetKeyStatuses, testGeminiKeyDirect } from '../utils/geminiPool';
import { loadApiKeys, saveApiKeys, verifyAssemblyAiKey, verifyHuggingFaceKey, isAsciiOnly, sanitizeApiKey } from '../utils/apiKeys';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  geminiKeys: GeminiKeyInfo[];
  setGeminiKeys: (keys: GeminiKeyInfo[]) => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({
  isOpen,
  onClose,
  geminiKeys,
  setGeminiKeys,
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
    if (isOpen) {
      const keys = loadApiKeys();
      setAssemblyAiKey(keys.assemblyAiKey);
      setHuggingFaceKey(keys.huggingFaceKey || '');
      setAssemblyAiStatus('idle');
      setHuggingFaceStatus('idle');
    }
  }, [isOpen]);

  if (!isOpen) return null;

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

  const handleResetStatuses = () => {
    const updated = resetKeyStatuses(geminiKeys);
    setGeminiKeys(updated);
  };

  const handleTestKeyRotation = async () => {
    if (geminiKeys.length === 0) {
      setTestResult({ status: 'testing', message: 'Server Gemini API ချိတ်ဆက်မှုကို စစ်ဆေးနေပါသည်...' });
      const testRes = await testGeminiKeyDirect(undefined, 'gemini-3.5-flash');
      if (testRes.ok) {
        setTestResult({
          status: 'success',
          message: '✓ Server Gemini API ချိတ်ဆက်မှု အောင်မြင်ပါသည်! (အသုံးပြုသူအားလုံးအတွက် အဆင်သင့်ဖြစ်ပါပြီ)',
        });
      } else {
        setTestResult({
          status: 'error',
          message: testRes.message,
        });
      }
      return;
    }

    setTestResult({ status: 'testing', message: 'Gemini API ချိတ်ဆက်မှုကို စစ်ဆေးနေပါသည်...' });

    try {
      const activeKey = geminiKeys.find((k) => k.status === 'active') || geminiKeys[0];
      const result = await testGeminiKeyDirect(activeKey.key, 'gemini-3.5-flash');

      if (result.ok) {
        setTestResult({
          status: 'success',
          message: `ချိတ်ဆက်မှု အောင်မြင်ပါသည်! (${activeKey.name} - Gemini API Direct Connection Successful)`,
        });
        activeKey.status = 'active';
        activeKey.lastError = undefined;
        saveGeminiKeys(geminiKeys);
      } else {
        const details = result.errorDetails;
        let errMsg = result.message;
        if (details) {
          errMsg = `[${details.status}] Quota Type: ${details.quotaType} — ${details.detailedDescription} (Message: ${details.message})`;
        }
        setTestResult({
          status: 'error',
          message: errMsg,
        });
        if (details?.statusCode === 429) {
          activeKey.status = 'quota_exceeded';
          activeKey.lastError = `429 (${details.quotaType})`;
        } else if (details?.statusCode === 401 || details?.statusCode === 403) {
          activeKey.status = 'invalid';
          activeKey.lastError = '401/403 Invalid';
        }
        saveGeminiKeys(geminiKeys);
      }
    } catch (err: any) {
      setTestResult({
        status: 'error',
        message: `ကွန်ရက် ချိတ်ဆက်မှု အမှား (Network Error): ${err.message || 'Connection failed'}`,
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-cyan-950/60 border border-cyan-500/30 text-cyan-400">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-zinc-100">API Keys Manager & Rotation</h2>
              <p className="text-xs text-zinc-400">Gemini Multi-Key Quota Rotation & FAL AI Studio ချိတ်ဆက်မှု</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Note 3 explanation banner */}
          <div className="p-3.5 rounded-lg bg-cyan-950/30 border border-cyan-800/40 text-xs text-cyan-200 flex items-start gap-2.5">
            <Smartphone className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium text-cyan-300">
                Server-Side Gemini AI Engine (အသုံးပြုသူအားလုံးအတွက် အလိုအလျောက် အဆင်သင့်ဖြစ်ပါသည်)
              </p>
              <p className="text-cyan-200/80 leading-relaxed font-myanmar">
                ဤအက်ပ်အား ဖွင့်သူတိုင်း အသုံးပြုနိုင်ရန် Server-Side Gemini API Engine ကို အလိုအလျောက် တပ်ဆင်ထားပါသည်။ မိမိကိုယ်ပိုင် API Key များကိုလည်း Quota Rotation အတွက် ထည့်သွင်းအသုံးပြုနိုင်ပါသည်။
              </p>
            </div>
          </div>

          {/* Troubleshooting Help Box for 401/403/429 */}
          <div className="p-3.5 rounded-lg bg-amber-950/30 border border-amber-800/40 text-xs text-amber-200 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-amber-300">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
              <span>401 / 403 / 429 အမှားများ ဖြေရှင်းရန် လမ်းညွှန်</span>
            </div>
            <ul className="list-disc list-inside space-y-1 text-amber-200/90 text-[11px] font-myanmar">
              <li><strong>401/403 Invalid Key:</strong> Google AI Studio (<a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="underline text-cyan-400">aistudio.google.com/app/apikey</a>) မှ <span className="font-mono text-cyan-300">AIzaSy...</span> သို့မဟုတ် <span className="font-mono text-cyan-300">AQ...</span> ဖြင့်စတင်သော API Key အမှန်ကို ထည့်သွင်းပါ။</li>
              <li><strong>429 Quota Exceeded:</strong> မိနစ်ပိုင်းအတွင်း ခေါ်ဆိုမှုနှုန်း (RPM/TPM) ကျော်လွန်သွားခြင်းဖြစ်ပါသည်။ ခေတ္တစောင့်ပါ သို့မဟုတ် Key အသစ် ထပ်ထည့်ပါ။</li>
            </ul>
          </div>

          {/* Step 1: Gemini Keys Input */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-200 uppercase tracking-wider flex items-center gap-2">
                <span>အဆင့် 1: Gemini API Keys (Multi-Key Rotation)</span>
              </label>
              <span className="text-[11px] text-zinc-400">
                Key အသစ်များကို စာကြောင်းခြား သို့မဟုတ် ကော်မာ (,) ခြား၍ ထည့်ပါ
              </span>
            </div>

            <textarea
              value={keysInput}
              onChange={(e) => setKeysInput(e.target.value)}
              placeholder="AIzaSy... (Key 1)&#10;AIzaSy... (Key 2)&#10;AIzaSy... (Key 3)"
              rows={3}
              className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/50"
            />

            <div className="flex items-center justify-between gap-2">
              <button
                onClick={handleAddKeys}
                disabled={!keysInput.trim()}
                className="px-3 py-1.5 text-xs font-medium bg-cyan-500 hover:bg-cyan-400 disabled:bg-zinc-800 disabled:text-zinc-500 text-zinc-950 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Add Keys to Pool</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleResetStatuses}
                  className="px-2.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800/80 hover:bg-zinc-800 rounded-lg transition-colors flex items-center gap-1"
                  title="Reset all 429 quota statuses back to active"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Reset Statuses</span>
                </button>

                <button
                  onClick={handleTestKeyRotation}
                  disabled={testResult.status === 'testing'}
                  className="px-2.5 py-1.5 text-xs text-cyan-300 hover:text-cyan-200 bg-cyan-950/40 border border-cyan-800/50 rounded-lg transition-colors flex items-center gap-1"
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
                    ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/50'
                    : testResult.status === 'error'
                    ? 'bg-rose-950/40 text-rose-300 border border-rose-800/50'
                    : 'bg-zinc-800/80 text-zinc-300'
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

            {/* Keys Table */}
            {geminiKeys.length > 0 && (
              <div className="mt-3 border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950/50">
                <div className="px-3 py-2 bg-zinc-800/40 border-b border-zinc-800 flex items-center justify-between text-[11px] text-zinc-400 font-medium">
                  <span>Key List ({geminiKeys.length})</span>
                  <span>Usage & Health</span>
                </div>
                <div className="divide-y divide-zinc-800/60 max-h-48 overflow-y-auto">
                  {geminiKeys.map((k, index) => (
                    <div key={k.id} className="px-3 py-2 flex items-center justify-between text-xs gap-2">
                      <div className="flex items-center gap-2 truncate">
                        <span className="text-[11px] font-mono text-zinc-500">#{index + 1}</span>
                        <span className="font-mono text-zinc-300 truncate">
                          {k.key.substring(0, 8)}••••••••{k.key.substring(k.key.length - 4)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-mono ${
                            k.status === 'active'
                              ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/50'
                              : k.status === 'quota_exceeded'
                              ? 'bg-amber-950/60 text-amber-300 border border-amber-800/50'
                              : 'bg-rose-950/60 text-rose-300 border border-rose-800/50'
                          }`}
                        >
                          {k.status === 'active'
                            ? 'Active'
                            : k.status === 'quota_exceeded'
                            ? '429 Quota'
                            : 'Invalid'}
                        </span>
                        <span className="text-[11px] font-mono text-zinc-400 tabular-nums">
                          {k.callCount} calls
                        </span>
                        <button
                          onClick={() => handleRemoveKey(k.id)}
                          className="text-zinc-500 hover:text-rose-400 p-1 transition-colors"
                          title="Remove key"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* AssemblyAI Section */}
          <div className="border-t border-zinc-800/80 pt-5 space-y-4">
            <div className="p-3.5 rounded-lg bg-zinc-950/70 border border-zinc-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Radio className="w-4 h-4 text-blue-400" />
                  <span className="text-xs font-semibold text-zinc-200">AssemblyAI (Optional Whisper STT)</span>
                </div>
                {assemblyAiStatus === 'connected' && (
                  <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    <span>Connected</span>
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[10px] text-zinc-400">32-digit Token</span>
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
                value={assemblyAiKey}
                onChange={(e) => {
                  const val = e.target.value;
                  setAssemblyAiKey(val);
                  setAssemblyAiStatus('idle');
                  handleSaveAssemblyKey(val);
                }}
                placeholder="AssemblyAI 32-digit Token"
                className={`w-full px-3 py-1.5 bg-zinc-900 border rounded-lg text-xs font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none ${
                  assemblyAiKey && !isAsciiOnly(assemblyAiKey)
                    ? 'border-rose-500/70 focus:border-rose-500'
                    : 'border-zinc-800 focus:border-blue-500/60'
                }`}
              />

              {assemblyAiKey && !isAsciiOnly(assemblyAiKey) && (
                <div className="p-1.5 rounded bg-rose-950/60 border border-rose-800/60 text-rose-300 text-[10px] font-myanmar flex items-center justify-between gap-1">
                  <span>⚠️ မြန်မာစာလုံးများ မပါဝင်ရပါ</span>
                  <button
                    type="button"
                    onClick={() => {
                      const clean = sanitizeApiKey(assemblyAiKey);
                      setAssemblyAiKey(clean);
                      handleSaveAssemblyKey(clean);
                    }}
                    className="px-1.5 py-0.5 bg-rose-800 hover:bg-rose-700 text-white rounded text-[10px]"
                  >
                    Clean
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={handleConnectAssemblyAi}
                  disabled={assemblyAiStatus === 'testing' || !assemblyAiKey.trim() || !isAsciiOnly(assemblyAiKey)}
                  className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white rounded-lg transition-colors flex items-center gap-1.5"
                >
                  {assemblyAiStatus === 'testing' ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Zap className="w-3 h-3" />
                  )}
                  <span>{assemblyAiStatus === 'testing' ? 'စစ်ဆေးနေပါသည်...' : 'Connect AssemblyAI'}</span>
                </button>
                <span className="text-[10px] text-zinc-500 font-myanmar">Whisper စကားပြောစာတန်းထိုး</span>
              </div>

              {assemblyAiMsg && (
                <p className={`text-[11px] font-myanmar ${assemblyAiStatus === 'connected' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {assemblyAiMsg}
                </p>
              )}
            </div>
          </div>

          {/* Hugging Face Voice Clone & Studio Card */}
          <div className="p-3.5 rounded-xl bg-zinc-950/70 border border-amber-900/30 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-amber-950/60 border border-amber-500/40 text-amber-400 flex items-center justify-center text-xs">
                  🤗
                </div>
                <div>
                  <h4 className="text-xs font-bold text-zinc-200">Hugging Face API Key (Voice Clone)</h4>
                  <p className="text-[10px] text-zinc-400 font-myanmar">Voice Clone (XTTS-v2), Meta MMS Myanmar & Kokoro TTS</p>
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
                <span className="text-[10px] text-zinc-400 font-mono">Access Token (hf_...)</span>
                <a
                  href="https://huggingface.co/settings/tokens"
                  target="_blank"
                  rel="noreferrer"
                  className="text-amber-400 hover:text-amber-300 text-[10px] underline flex items-center gap-1"
                >
                  <span>Free Token ရယူရန်</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>

              <input
                type="password"
                value={huggingFaceKey}
                onChange={(e) => {
                  const val = e.target.value;
                  setHuggingFaceKey(val);
                  setHuggingFaceStatus('idle');
                  handleSaveHuggingFaceKey(val);
                }}
                placeholder="Hugging Face User Access Token (hf_...)"
                className={`w-full px-3 py-1.5 bg-zinc-900 border rounded-lg text-xs font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none ${
                  huggingFaceKey && !isAsciiOnly(huggingFaceKey)
                    ? 'border-rose-500/70 focus:border-rose-500'
                    : 'border-zinc-800 focus:border-amber-500/60'
                }`}
              />

              {huggingFaceKey && !isAsciiOnly(huggingFaceKey) && (
                <div className="p-1.5 rounded bg-rose-950/60 border border-rose-800/60 text-rose-300 text-[10px] font-myanmar flex items-center justify-between gap-1">
                  <span>⚠️ မြန်မာစာလုံးများ မပါဝင်ရပါ</span>
                  <button
                    type="button"
                    onClick={() => {
                      const clean = sanitizeApiKey(huggingFaceKey);
                      setHuggingFaceKey(clean);
                      handleSaveHuggingFaceKey(clean);
                    }}
                    className="px-1.5 py-0.5 bg-rose-800 hover:bg-rose-700 text-white rounded text-[10px]"
                  >
                    Clean
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleConnectHuggingFace}
                  disabled={huggingFaceStatus === 'testing' || !huggingFaceKey.trim() || !isAsciiOnly(huggingFaceKey)}
                  className="px-3 py-1.5 text-xs font-bold bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-zinc-950 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  {huggingFaceStatus === 'testing' ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Zap className="w-3 h-3" />
                  )}
                  <span>{huggingFaceStatus === 'testing' ? 'စစ်ဆေးနေပါသည်...' : 'Connect Hugging Face'}</span>
                </button>
                <span className="text-[10px] text-zinc-500 font-myanmar">အဆင့် 5 Voice Clone</span>
              </div>

              {huggingFaceMsg && (
                <p className={`text-[11px] font-myanmar ${huggingFaceStatus === 'connected' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {huggingFaceMsg}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between">
          <span className="text-[11px] text-zinc-500">
            သုံးရန်နေရာ-: Recap, Dubbing, Subtitle, Long to Short, Gemini TTS, Dhamma AI
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
