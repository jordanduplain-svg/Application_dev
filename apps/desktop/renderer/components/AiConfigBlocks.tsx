import { useEffect, useState } from 'react';
import type { SettingsStatus, ScrapingConfig } from '@candio/shared';
import { api } from '../lib/api';
import AiModelSelector from './AiModelSelector';
import { SCRAPING_MODEL_CATALOG, qualityStars } from '../lib/ollamaModels';

/**
 * Blocs de configuration IA, affichés sur la page Profil (fusion Accueil+Profil).
 * Deux blocs CÔTE À CÔTE :
 *  1. Rédaction IA — Lettres de motivation + Fiches entreprise/actualités.
 *  2. IA Scraping — assistant LLM du crawl emails (avancé, désactivé par défaut).
 * + raccourcis SMTP / IMAP vers les Réglages.
 *
 * La config scraping est chargée une fois puis réécrite entièrement via
 * scraping:saveConfig à chaque changement (source unique, pas de course).
 */
export default function AiConfigBlocks({ onGoToSettings, onGoToScraping }: {
  onGoToSettings: () => void;
  onGoToScraping: () => void;
}) {
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [cfg, setCfg] = useState<ScrapingConfig | null>(null);
  const [installed, setInstalled] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // Provider des lettres (pour afficher le bon champ clé) + saisie de la clé.
  const [lettersProvider, setLettersProvider] = useState('openai');
  const [apiKey, setApiKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try { const st = await api.invoke('settings:getStatus'); if (alive) { setStatus(st); setLettersProvider(st.aiProvider || 'openai'); } } catch { /* */ }
      try { const c = await api.invoke('scraping:getConfig'); if (alive) setCfg(c); } catch { /* */ }
      try { const { models } = await api.invoke('settings:getOllamaModels'); if (alive) setInstalled(models); } catch { /* */ }
    })();
    return () => { alive = false; };
  }, []);

  const reloadStatus = async () => {
    try { const st = await api.invoke('settings:getStatus'); setStatus(st); } catch { /* */ }
  };

  // Métadonnées du champ clé API selon le provider cloud des lettres.
  const KEY_META: Record<string, { label: string; ph: string; ipc: 'settings:setOpenaiKey' | 'settings:setAnthropicKey' | 'settings:setGeminiKey' | 'settings:setGroqKey'; isSet: (s: SettingsStatus | null) => boolean; help: string }> = {
    openai: { label: 'Clé OpenAI', ph: 'sk-...', ipc: 'settings:setOpenaiKey', isSet: (s) => !!s?.openaiKeySet, help: 'platform.openai.com' },
    anthropic: { label: 'Clé Anthropic (Claude)', ph: 'sk-ant-...', ipc: 'settings:setAnthropicKey', isSet: (s) => !!s?.anthropicKeySet, help: 'console.anthropic.com' },
    gemini: { label: 'Clé Google Gemini', ph: 'AIza...', ipc: 'settings:setGeminiKey', isSet: (s) => !!s?.geminiKeySet, help: 'aistudio.google.com (gratuit)' },
    groq: { label: 'Clé Groq', ph: 'gsk_...', ipc: 'settings:setGroqKey', isSet: (s) => !!s?.groqKeySet, help: 'console.groq.com (gratuit)' },
  };
  const keyMeta = KEY_META[lettersProvider]; // undefined si ollama (local, pas de clé)

  const saveApiKey = async () => {
    if (!keyMeta || !apiKey.trim()) return;
    setSavingKey(true);
    try {
      await api.invoke(keyMeta.ipc, { key: apiKey.trim() });
      setApiKey('');
      await reloadStatus();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erreur lors de l\'enregistrement de la clé');
    } finally { setSavingKey(false); }
  };

  // Réécrit toute la config (source unique). On garde l'état local optimiste.
  const saveCfg = async (next: ScrapingConfig) => {
    setCfg(next);
    setSaving(true);
    try { await api.invoke('scraping:saveConfig', next); } catch { /* non bloquant */ }
    finally { setSaving(false); }
  };

  const describeProvider = cfg?.describeProvider || 'ollama';
  const describeModel = cfg?.describeModel || 'qwen2.5:7b';
  const ficheOptions = Array.from(new Set([...SCRAPING_MODEL_CATALOG.map((m) => m.id), ...installed]));

  const card: React.CSSProperties = { width: '100%', boxSizing: 'border-box' };
  const dot = (ok: boolean) => <span style={{ color: ok ? '#34c759' : '#ff453a', fontWeight: 600 }}>{ok ? '✓ configuré' : '✗ à configurer'}</span>;

  // Panneau repliable « loupe » : compare les modèles locaux (qualité/vitesse/taille)
  // et permet d'en choisir un — comme dans Réglages. Réutilisé dans les 2 blocs.
  const renderModelCompare = (current: string, onPick: (id: string) => void) => (
    <details style={{ marginTop: '8px' }}>
      <summary style={{ cursor: 'pointer', fontSize: '12px', color: '#0a84ff' }}>🔍 Comparer les modèles locaux</summary>
      <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {SCRAPING_MODEL_CATALOG.map((m) => {
          const inst = installed.includes(m.id);
          const sel = current === m.id;
          return (
            <div key={m.id} style={{ border: `1px solid ${sel ? '#0a84ff' : '#e0e0e0'}`, borderRadius: '6px',
              padding: '6px 8px', background: sel ? '#f0f7ff' : '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                <strong style={{ fontSize: '12px' }}>{m.name}{m.badge ? ` ${m.badge}` : ''}</strong>
                <button type="button" disabled={sel} onClick={() => onPick(m.id)}
                  style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '6px', cursor: sel ? 'default' : 'pointer',
                    border: 'none', background: sel ? '#34c759' : '#0a84ff', color: '#fff' }}>
                  {sel ? '✓ choisi' : 'Choisir'}
                </button>
              </div>
              <div style={{ fontSize: '11px', color: '#666' }}>
                Qualité {qualityStars(m.quality)} · Vitesse {qualityStars(m.speed ?? 3)} · {m.sizeLabel} · {inst ? '✓ installé' : '⚠ à télécharger'}
              </div>
              <div style={{ fontSize: '11px', color: '#888' }}>{m.note}</div>
            </div>
          );
        })}
      </div>
    </details>
  );

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

        {/* ───── BLOC 1 : Rédaction IA (Lettres + Fiches) ───── */}
        <div className="card" style={{ ...card, borderLeft: '4px solid #1D9E75' }}>
          <h3>🤖 Rédaction IA — Lettres + Fiches</h3>
          <p style={{ fontSize: '13px', color: '#555', lineHeight: 1.5 }}>
            IA qui <strong>rédige les lettres de motivation</strong> et les
            <strong> fiches entreprise / actualités</strong>. Une seule clé cloud (OpenAI / Claude /
            gratuit Gemini-Groq) sert aux deux.
          </p>

          <div style={{ fontSize: '12px', fontWeight: 600, color: '#666', margin: '4px 0' }}>Lettres de motivation</div>
          <AiModelSelector
            onGoToSettings={onGoToSettings}
            onProviderChange={(prov) => {
              setLettersProvider(prov);
              if (!cfg) return;
              // Les fiches SUIVENT le provider des lettres lors d'un basculement :
              // OpenAI → GPT-4o-mini ; Claude → Haiku ; Ollama → local. Gemini/Groq ne
              // gèrent pas les fiches côté Python → on n'y touche pas.
              if (prov === 'openai') void saveCfg({ ...cfg, describeProvider: 'openai', describeModel: 'gpt-4o-mini' });
              else if (prov === 'anthropic' || prov === 'claude') void saveCfg({ ...cfg, describeProvider: 'claude' });
              else if (prov === 'ollama') void saveCfg({ ...cfg, describeProvider: 'ollama', describeModel: describeModel.startsWith('gpt') ? 'qwen2.5:7b' : describeModel });
            }}
          />

          {/* Clé API du provider cloud des lettres — saisie directe ici (comme le bloc Scraping). */}
          {keyMeta && (
            <div style={{ marginTop: '6px' }}>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '3px' }}>
                {keyMeta.label} {keyMeta.isSet(status) ? <span style={{ color: '#34c759' }}>✓ enregistrée</span> : <span style={{ color: '#ff9500' }}>— requise ({keyMeta.help})</span>}
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                  placeholder={keyMeta.isSet(status) ? '(déjà enregistrée — saisir pour remplacer)' : keyMeta.ph}
                  onKeyDown={(e) => { if (e.key === 'Enter') void saveApiKey(); }}
                  style={{ flex: 1, minWidth: '180px', fontSize: '13px', padding: '5px 8px', borderRadius: '6px', border: '1px solid #ccc' }} />
                <button type="button" onClick={() => void saveApiKey()} disabled={!apiKey.trim() || savingKey}
                  style={{ fontSize: '12px', padding: '5px 12px', borderRadius: '6px', border: 'none',
                    background: !apiKey.trim() || savingKey ? '#ccc' : '#0a84ff', color: '#fff', cursor: !apiKey.trim() || savingKey ? 'default' : 'pointer' }}>
                  {savingKey ? '…' : 'Enregistrer'}
                </button>
              </div>
            </div>
          )}

          <div style={{ fontSize: '12px', fontWeight: 600, color: '#666', margin: '10px 0 4px' }}>
            Fiches entreprise / actualités
            <span style={{ fontWeight: 400, color: '#999' }}> — suivent le moteur des lettres, modifiable ici</span>
          </div>
          {cfg && (
            <>
              <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', marginBottom: '6px' }}>
                <label style={{ cursor: 'pointer', fontSize: '13px', fontWeight: describeProvider === 'ollama' ? 700 : 400 }}>
                  <input type="radio" name="ficheProvider" checked={describeProvider === 'ollama'}
                    onChange={() => void saveCfg({ ...cfg, describeProvider: 'ollama' })} style={{ marginRight: '6px' }} />
                  🦙 Local (gratuit)
                </label>
                <label style={{ cursor: 'pointer', fontSize: '13px', fontWeight: describeProvider === 'openai' ? 700 : 400 }}>
                  <input type="radio" name="ficheProvider" checked={describeProvider === 'openai'}
                    onChange={() => void saveCfg({ ...cfg, describeProvider: 'openai' })} style={{ marginRight: '6px' }} />
                  ☁️ OpenAI GPT-4o-mini
                </label>
                <label style={{ cursor: 'pointer', fontSize: '13px', fontWeight: describeProvider === 'claude' ? 700 : 400 }}>
                  <input type="radio" name="ficheProvider" checked={describeProvider === 'claude'}
                    onChange={() => void saveCfg({ ...cfg, describeProvider: 'claude' })} style={{ marginRight: '6px' }} />
                  🧠 Claude Haiku
                </label>
              </div>
              {describeProvider === 'ollama' ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <select value={describeModel} onChange={(e) => void saveCfg({ ...cfg, describeModel: e.target.value })}
                      style={{ fontSize: '13px', padding: '4px 8px', borderRadius: '6px', minWidth: '220px' }}>
                      {ficheOptions.map((id) => {
                        const spec = SCRAPING_MODEL_CATALOG.find((m) => m.id === id);
                        const inst = installed.includes(id);
                        return <option key={id} value={id}>{spec?.name ?? id}{inst ? '  ✓ installé' : '  ⚠ à télécharger'}</option>;
                      })}
                    </select>
                    <button type="button" onClick={onGoToSettings} title="Télécharger des modèles Ollama (Réglages)"
                      style={{ fontSize: '11px', padding: '4px 8px', background: '#0a84ff', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
                      ⬇ Modèles
                    </button>
                  </div>
                  {renderModelCompare(describeModel, (id) => void saveCfg({ ...cfg, describeModel: id }))}
                </>
              ) : (() => {
                // Panneau d'état clé cloud (OpenAI ou Claude). La clé est celle des Réglages
                // (partagée avec les lettres) — saisie via le bloc Lettres ou la page Réglages.
                const isOpenai = describeProvider === 'openai';
                const keySet = isOpenai ? !!status?.openaiKeySet : !!status?.anthropicKeySet;
                const okMsg = isOpenai
                  ? '✓ Fiches via GPT-4o-mini (clé OpenAI des Réglages, ~centimes/100 fiches).'
                  : '✓ Fiches via Claude Haiku (clé Anthropic des Réglages, ~centimes/100 fiches).';
                const koMsg = isOpenai
                  ? '⚠ Pas de clé OpenAI — ajoute-la dans Réglages (ou via « Lettres » ci-dessus).'
                  : '⚠ Pas de clé Anthropic — ajoute-la dans Réglages (ou via « Lettres » ci-dessus, provider Claude).';
                return (
                  <p style={{ fontSize: '12px', margin: 0,
                    color: keySet ? '#2a7' : '#856404',
                    background: keySet ? '#eaffea' : '#fff8e1',
                    border: `1px solid ${keySet ? '#34c759' : '#ffc107'}`, borderRadius: '6px', padding: '6px 10px' }}>
                    {keySet ? okMsg : koMsg}
                  </p>
                );
              })()}
            </>
          )}
        </div>

        {/* ───── BLOC 2 : IA Scraping (crawl emails) ───── */}
        <div className="card" style={{ ...card, borderLeft: '4px solid #D85A30' }}>
          <h3>🔍 IA Scraping — crawl emails</h3>
          <p style={{ fontSize: '13px', color: '#555', lineHeight: 1.5 }}>
            Assistant LLM <strong>de secours</strong> pendant le crawl : quand l'extraction par regex
            échoue (email obfusqué), une IA lit la page. Avancé — <strong>désactivé par défaut</strong>
            (le crawl appelle l'IA page par page → coûteux en cloud, lent sur CPU).
          </p>
          {cfg && (
            <>
              <select
                value={cfg.llmProvider ?? ''}
                onChange={(e) => void saveCfg({ ...cfg, llmProvider: e.target.value as '' | 'ollama' | 'openai' | 'claude' })}
                style={{ fontSize: '13px', padding: '6px 8px', borderRadius: '6px', border: '1px solid #ccc', minWidth: '240px' }}
              >
                <option value="">✗ Désactivé (recommandé sur CPU)</option>
                <option value="ollama">🦙 Ollama (local, gratuit)</option>
                <option value="openai">☁️ OpenAI (cloud)</option>
                <option value="claude">🧠 Claude (cloud)</option>
              </select>

              {cfg.llmProvider === 'ollama' && (
                <div style={{ marginTop: '8px' }}>
                  <span style={{ fontSize: '12px', color: '#666', marginRight: '6px' }}>Modèle :</span>
                  <select value={cfg.ollamaModel ?? ''} onChange={(e) => void saveCfg({ ...cfg, ollamaModel: e.target.value })}
                    style={{ fontSize: '13px', padding: '4px 8px', borderRadius: '6px' }}>
                    {cfg.ollamaModel && !installed.includes(cfg.ollamaModel) && <option value={cfg.ollamaModel}>{cfg.ollamaModel} (non installé ?)</option>}
                    {installed.length === 0 && !cfg.ollamaModel && <option value="">— aucun modèle —</option>}
                    {installed.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <button type="button" onClick={onGoToSettings} title="Télécharger des modèles Ollama (Réglages)"
                    style={{ marginLeft: '8px', fontSize: '11px', padding: '4px 8px', background: '#5856d6', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
                    ⬇ Modèles
                  </button>
                  {renderModelCompare(cfg.ollamaModel ?? '', (id) => void saveCfg({ ...cfg, ollamaModel: id }))}
                </div>
              )}

              {(cfg.llmProvider === 'openai' || cfg.llmProvider === 'claude') && (
                <label style={{ display: 'block', marginTop: '8px' }}>
                  <span style={{ fontSize: '12px', color: '#666' }}>Clé API {cfg.llmProvider === 'openai' ? 'OpenAI' : 'Claude'}</span>
                  <input type="password" value={cfg.llmApiKey ?? ''} onChange={(e) => void saveCfg({ ...cfg, llmApiKey: e.target.value })}
                    placeholder={cfg.llmProvider === 'openai' ? 'sk-…' : 'sk-ant-…'}
                    style={{ width: '100%', boxSizing: 'border-box', fontSize: '13px', padding: '6px 8px', borderRadius: '6px', border: '1px solid #ccc', marginTop: '2px' }} />
                </label>
              )}
              {!cfg.llmProvider && (
                <p style={{ fontSize: '12px', color: '#86868b', margin: '6px 0 0' }}>
                  L'extraction email se fait par regex (rapide). Laisse désactivé si tu n'es pas sûr.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* ───── Emails : raccourcis SMTP / IMAP ───── */}
      <div className="card" style={{ borderLeft: '4px solid #378ADD' }}>
        <h3>✉️ Envoi &amp; réception d'emails</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '8px' }}>
          <span style={{ fontSize: '13px' }}>SMTP (envoi) : {dot(status?.smtpConfigured ?? false)}</span>
          <button type="button" onClick={onGoToSettings}
            style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', border: '1px solid #ccc', cursor: 'pointer' }}>⚙ Configurer SMTP</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px' }}>IMAP (réception) : {dot(status?.imapConfigured ?? false)}</span>
          <button type="button" onClick={onGoToSettings}
            style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', border: '1px solid #ccc', cursor: 'pointer' }}>⚙ Configurer IMAP</button>
        </div>
        {saving && <span style={{ fontSize: '11px', color: '#888' }}>Enregistrement…</span>}
      </div>
    </>
  );
}
