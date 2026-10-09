import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Save, Check, RefreshCw } from 'lucide-react';
import i18n from '../i18n';
import { useToast } from '../components/Toast';

const API_BASE = `http://${window.location.hostname}:8000`;


export default function LanguageSettings() {
  const { t } = useTranslation();
  const toast = useToast();
  
  const [selectedLang, setSelectedLang] = useState<string>(i18n.language || 'en');
  const [multilingualBackend, setMultilingualBackend] = useState<'offline_ai' | 'dictionary' | 'openrouter'>('offline_ai');
  // The OpenRouter key lives only in backend/.env (OPENROUTER_API_KEY); the page just shows whether it is set.
  const [openrouterConfigured, setOpenrouterConfigured] = useState(false);
  const [modelDetails, setModelDetails] = useState<{
    offline_models_available?: boolean
    offline_translation_model?: string
    offline_multilingual_clip?: string
  }>({});
  const [saving, setSaving] = useState(false);
  const [testQuery, setTestQuery] = useState('');
  const [testResult, setTestResult] = useState<{ normalized: string, substitutions: string[] } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    // Older versions kept the key in browser storage; remove any leftover copy.
    try { localStorage.removeItem('openrouter_api_key'); } catch { /* storage unavailable */ }
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/search/multilingual/config`);
      if (res.ok) {
        const data = await res.json();
        if (data.backend) {
          setMultilingualBackend(data.backend);
        }
        setOpenrouterConfigured(Boolean(data.openrouter_configured));
        setModelDetails({
          offline_models_available: data.offline_models_available,
          offline_translation_model: data.offline_translation_model,
          offline_multilingual_clip: data.offline_multilingual_clip,
        });
      }
    } catch (error) {
      console.error('Failed to fetch config', error);
      setMultilingualBackend('offline_ai');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      i18n.changeLanguage(selectedLang);
      localStorage.setItem('tracenet_lang', selectedLang);
      const res = await fetch(`${API_BASE}/api/v1/search/multilingual/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backend: multilingualBackend })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      toast.success(t('settings.saved'));
    } catch (error) {
      toast.error(t('common.error'), String(error));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testQuery.trim()) return;
    setTesting(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/search/parse?q=${encodeURIComponent(testQuery)}`);
      if (res.ok) {
        const data = await res.json();
        const subs: string[] = [];
        if (data.is_multilingual) {
          subs.push(`Language Detected: ${data.detected_language} (${data.language_code})`);
          subs.push(`Engine Active: ${data.backend_used}`);
        }
        if (data.verifiable && data.verifiable.length > 0) {
          subs.push(`Verified Attributes: ${data.verifiable.map((v: any) => `${v.kind}: ${v.value}${v.region ? ` (${v.region})` : ''}`).join(', ')}`);
        }
        setTestResult({
          normalized: data.normalized_query || testQuery,
          substitutions: subs.length > 0 ? subs : ['Query passed through without substitution (English baseline)']
        });
      } else {
        setTestResult({
          normalized: testQuery,
          substitutions: ['API response error']
        });
      }
    } catch {
      setTestResult({
        normalized: testQuery,
        substitutions: ['Network error']
      });
    } finally {
      setTesting(false);
    }
  };

  const changeLangImmediately = (lang: string) => {
    setSelectedLang(lang);
    i18n.changeLanguage(lang);
    localStorage.setItem('tracenet_lang', lang);
    const names: Record<string, string> = { en: 'English', hi: 'हिंदी', gu: 'ગુજરાતી' };
    toast.success(t('settings.switched', { lang: names[lang] || lang }));
  };

  return (
    <div data-tour="language-settings" className="flex-1 overflow-y-auto bg-slate-100 dark:bg-slate-950 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        
        <div className="flex items-center space-x-4 mb-8">
          <Globe className="h-8 w-8 text-blue-600 dark:text-blue-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{t('settings.title')}</h1>
            <p className="text-slate-500 dark:text-slate-400">Configure interface language and search intelligence</p>
          </div>
        </div>

        {/* Section 1: Interface Language */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">{t('settings.language')}</h2>
          <p className="text-slate-500 dark:text-slate-400 mb-6">{t('settings.languageDesc')}</p>
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <button
              onClick={() => changeLangImmediately('en')}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                selectedLang === 'en' ? 'border-blue-500 bg-blue-500/10 shadow-md' : 'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:border-slate-400 dark:hover:border-slate-600'
              }`}
            >
              <div className="text-2xl mb-2">🇬🇧</div>
              <div className="font-semibold text-slate-800 dark:text-slate-200">English</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Default (EN)</div>
            </button>
            <button
              onClick={() => changeLangImmediately('hi')}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                selectedLang === 'hi' ? 'border-blue-500 bg-blue-500/10 shadow-md' : 'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:border-slate-400 dark:hover:border-slate-600'
              }`}
            >
              <div className="text-2xl mb-2">🇮🇳</div>
              <div className="font-semibold text-slate-800 dark:text-slate-200">हिंदी</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Hindi (HI)</div>
            </button>
            <button
              onClick={() => changeLangImmediately('gu')}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                selectedLang === 'gu' ? 'border-blue-500 bg-blue-500/10 shadow-md' : 'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:border-slate-400 dark:hover:border-slate-600'
              }`}
            >
              <div className="text-2xl mb-2">🇮🇳</div>
              <div className="font-semibold text-slate-800 dark:text-slate-200">ગુજરાતી</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Gujarati (GU)</div>
            </button>
          </div>
        </div>

        {/* Section 2: Multilingual Search Engine */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">{t('settings.multilingual')}</h2>
          <p className="text-slate-500 dark:text-slate-400 mb-6">{t('settings.multilingualDesc')}</p>

          <div className="space-y-4">
            {/* Option 1: Offline AI Engine (Recommended) */}
            <label className={`block p-4 rounded-lg border-2 cursor-pointer transition-all ${
              multilingualBackend === 'offline_ai' ? 'border-teal-500 bg-teal-500/10' : 'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800'
            }`}>
              <div className="flex items-start">
                <input
                  type="radio"
                  name="backend"
                  value="offline_ai"
                  checked={multilingualBackend === 'offline_ai'}
                  onChange={() => setMultilingualBackend('offline_ai')}
                  className="mt-1 mr-3 h-4 w-4 text-teal-500 focus:ring-teal-500 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{t('settings.offlineAi')}</span>
                    <span className="text-xs bg-teal-500/20 text-teal-700 dark:text-teal-400 font-bold px-2 py-1 rounded">100% OFFLINE LOCAL (RECOMMENDED)</span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {t('settings.offlineAiDesc')}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                    <span className="bg-white dark:bg-slate-950/80 border border-slate-300 dark:border-slate-700 px-2 py-1 rounded text-teal-700 dark:text-teal-300 flex items-center gap-1.5">
                      ✓ Translation: {modelDetails.offline_translation_model || 'Helsinki-NLP/opus-mt-hi-en'}
                    </span>
                    <span className="bg-white dark:bg-slate-950/80 border border-slate-300 dark:border-slate-700 px-2 py-1 rounded text-teal-700 dark:text-teal-300 flex items-center gap-1.5">
                      ✓ Multilingual CLIP: {modelDetails.offline_multilingual_clip || 'clip-ViT-B-32-multilingual-v1'}
                    </span>
                    <span className="bg-white dark:bg-slate-950/80 border border-slate-300 dark:border-slate-700 px-2 py-1 rounded text-teal-700 dark:text-teal-300 flex items-center gap-1.5">
                      ✓ Status: {modelDetails.offline_models_available ? 'Models Ready in backend/data' : 'Online'}
                    </span>
                  </div>
                </div>
              </div>
            </label>

            {/* Option 2: Offline Dictionary */}
            <label className={`block p-4 rounded-lg border-2 cursor-pointer transition-all ${
              multilingualBackend === 'dictionary' ? 'border-blue-500 bg-blue-500/10' : 'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800'
            }`}>
              <div className="flex items-start">
                <input
                  type="radio"
                  name="backend"
                  value="dictionary"
                  checked={multilingualBackend === 'dictionary'}
                  onChange={() => setMultilingualBackend('dictionary')}
                  className="mt-1 mr-3 h-4 w-4 text-blue-500 focus:ring-blue-500 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{t('settings.dictionary')}</span>
                    <span className="text-xs bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-1 rounded">FAST RULE-BASED</span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Lightweight domain dictionary for basic color and vehicle keywords.
                  </p>
                </div>
              </div>
            </label>

            {/* Option 3: OpenRouter */}
            <label className={`block p-4 rounded-lg border-2 cursor-pointer transition-all ${
              multilingualBackend === 'openrouter' ? 'border-blue-500 bg-blue-500/10' : 'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800'
            }`}>
              <div className="flex items-start">
                <input
                  type="radio"
                  name="backend"
                  value="openrouter"
                  checked={multilingualBackend === 'openrouter'}
                  onChange={() => setMultilingualBackend('openrouter')}
                  className="mt-1 mr-3 h-4 w-4 text-blue-500 focus:ring-blue-500 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{t('settings.openrouter')}</span>
                    <span className="text-xs bg-amber-500/20 text-amber-700 dark:text-amber-400 px-2 py-1 rounded">REQUIRES API KEY</span>
                  </div>
                  
                  {multilingualBackend === 'openrouter' && (
                    <div className="mt-4 space-y-3">
                      <div>
                        <span className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                          {t('settings.apiKey')}
                        </span>
                        {openrouterConfigured ? (
                          <p className="text-sm text-green-700 dark:text-green-400">Configured on the server.</p>
                        ) : (
                          <p className="text-sm text-amber-700 dark:text-amber-400">
                            Not configured: add <code className="font-mono">OPENROUTER_API_KEY=...</code> to{' '}
                            <code className="font-mono">backend/.env</code> and restart the backend. Until then the
                            dictionary is used.
                          </p>
                        )}
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          {t('settings.apiKeyHelp')}
                        </p>
                      </div>
                      <div className="flex items-center space-x-2 text-xs text-slate-500 dark:text-slate-400">
                        <Check className="h-4 w-4 text-green-500" />
                        <span>Using: meta-llama/llama-3.2-3b-instruct:free</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* Section 3: Test Multilingual Normalization */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">{t('settings.testQuery')}</h2>
          
          <div className="flex space-x-2 mb-4">
            <input
              type="text"
              value={testQuery}
              onChange={(e) => setTestQuery(e.target.value)}
              placeholder={t('settings.testPlaceholder')}
              className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded p-2 text-slate-800 dark:text-slate-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={handleTest}
              disabled={!testQuery || testing}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
            >
              {testing ? <RefreshCw className="h-5 w-5 animate-spin" /> : t('settings.testButton')}
            </button>
          </div>

          {testResult && (
            <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-4">
              <div className="mb-3">
                <div className="text-sm text-slate-500 dark:text-slate-400 mb-1">{t('settings.normalized')}:</div>
                <div className="text-lg text-emerald-700 dark:text-emerald-400 font-medium">{testResult.normalized}</div>
              </div>
              {testResult.substitutions.length > 0 && (
                <div>
                  <div className="text-sm text-slate-500 dark:text-slate-400 mb-1">{t('settings.substitutions')}:</div>
                  <div className="flex flex-wrap gap-2">
                    {testResult.substitutions.map((sub, i) => (
                      <span key={i} className="text-xs bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-slate-700 dark:text-slate-300">
                        {sub}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium flex items-center shadow-lg shadow-blue-500/20 disabled:opacity-50"
          >
            {saving ? (
              <RefreshCw className="h-5 w-5 mr-2 animate-spin" />
            ) : (
              <Save className="h-5 w-5 mr-2" />
            )}
            {t('settings.save')}
          </button>
        </div>

      </div>
    </div>
  );
}
