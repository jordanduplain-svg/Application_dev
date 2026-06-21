import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * OLLAMA-3 : sélecteur du moteur IA actif (provider + modèle).
 *
 * Le choix est GLOBAL (stocké dans les Réglages via settings:setAiProvider /
 * setAiModel / setOllamaModel) et utilisé par generatePitch lors de la génération
 * des emails. Affiché à la fois sur la page Campagnes et sur le détail d'une
 * campagne pour que l'utilisateur n'ait pas à fouiller les Réglages.
 *
 * aiValue encode provider + modèle : "openai:gpt-4o" | "ollama:mistral:7b".
 */
export default function AiModelSelector({ onGoToSettings, onProviderChange }: {
  onGoToSettings?: () => void;
  // Notifie le parent quand le PROVIDER change (pas juste la variante de modèle) →
  // permet de faire suivre les fiches (cf. AiConfigBlocks).
  onProviderChange?: (provider: string) => void;
}) {
  const [aiValue, setAiValue] = useState<string>('openai:gpt-4o');
  const [installedModels, setInstalledModels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Charge le provider/modèle courant + les modèles Ollama installés au montage.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const st = await api.invoke('settings:getStatus');
        if (!alive) return;
        const provider = st.aiProvider ?? 'openai';
        const cloud = st.aiModel ?? 'gpt-4o';
        setAiValue(
          provider === 'ollama' ? `ollama:${st.ollamaModel ?? 'llama3.2:3b'}`
          : provider === 'anthropic' ? `anthropic:${cloud}`
          : provider === 'gemini' ? `gemini:${cloud}`
          : provider === 'groq' ? `groq:${cloud}`
          : `openai:${cloud}`
        );
      } catch { /* silencieux */ }
      try {
        const { models } = await api.invoke('settings:getOllamaModels');
        if (alive) setInstalledModels(models);
      } catch { /* Ollama non lancé — liste vide */ }
    })();
    return () => { alive = false; };
  }, []);

  const changeAi = async (value: string) => {
    const prevProvider = aiValue.slice(0, aiValue.indexOf(':')); // provider AVANT changement
    setAiValue(value);
    setSaving(true);
    try {
      const i = value.indexOf(':');
      const provider = value.slice(0, i);          // 'openai' | 'ollama' | 'anthropic' | …
      const modelId = value.slice(i + 1);          // 'gpt-4o' | 'mistral:7b'
      await api.invoke('settings:setAiProvider', { provider });
      if (provider === 'ollama') {
        await api.invoke('settings:setOllamaModel', { model: modelId });
      } else {
        await api.invoke('settings:setAiModel', { model: modelId });
      }
      // N'avertit le parent que si le PROVIDER a changé (pas une simple variante de modèle)
      // → les fiches ne sont re-forcées que sur un vrai basculement, respectant un choix manuel.
      if (provider !== prevProvider) onProviderChange?.(provider);
    } catch { /* non bloquant */ }
    finally { setSaving(false); }
  };

  const isLocal = aiValue.startsWith('ollama:');

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
      padding: '8px 12px', marginBottom: '12px',
      background: '#f5f5f7', borderRadius: '8px', border: '1px solid #e0e0e0',
    }}>
      <span style={{ fontSize: '13px', color: '#555', whiteSpace: 'nowrap' }}>🤖 Modèle IA :</span>

      <select
        value={aiValue}
        onChange={(e) => { void changeAi(e.target.value); }}
        disabled={saving}
        style={{ fontSize: '13px', padding: '4px 8px', borderRadius: '6px', minWidth: '210px' }}
      >
        <optgroup label="☁️ OpenAI (clé API requise)">
          <option value="openai:gpt-4o">GPT-4o — OpenAI (recommandé)</option>
          <option value="openai:gpt-4o-mini">GPT-4o mini — OpenAI (rapide)</option>
          <option value="openai:gpt-3.5-turbo">GPT-3.5 Turbo — OpenAI (économique)</option>
        </optgroup>

        <optgroup label="☁️ Claude (clé Anthropic requise)">
          <option value="anthropic:claude-sonnet-4-6">Claude Sonnet 4.6 — Anthropic (qualité max)</option>
          <option value="anthropic:claude-haiku-4-5-20251001">Claude Haiku 4.5 — Anthropic (rapide)</option>
        </optgroup>

        <optgroup label="🆓 Gemini — Google (palier gratuit)">
          <option value="gemini:gemini-2.0-flash">Gemini 2.0 Flash — Google (gratuit)</option>
          <option value="gemini:gemini-1.5-flash">Gemini 1.5 Flash — Google (gratuit)</option>
        </optgroup>

        <optgroup label="🆓 Groq (gratuit, ultra-rapide)">
          <option value="groq:llama-3.3-70b-versatile">Llama 3.3 70B — Groq (gratuit)</option>
          <option value="groq:llama-3.1-8b-instant">Llama 3.1 8B — Groq (gratuit, instantané)</option>
        </optgroup>

        {installedModels.length > 0 ? (
          <optgroup label="🦙 Local — Ollama (installé sur ce PC)">
            {installedModels.map((m) => (
              <option key={m} value={`ollama:${m}`}>{m}</option>
            ))}
          </optgroup>
        ) : (
          <optgroup label="🦙 Local — Ollama (aucun modèle détecté)">
            <option disabled value="">Ollama non lancé — voir « Télécharger une IA »</option>
          </optgroup>
        )}
      </select>

      {saving && <span style={{ fontSize: '12px', color: '#888' }}>Enregistrement…</span>}

      {!saving && (
        <span style={{
          fontSize: '11px', padding: '2px 8px', borderRadius: '12px', whiteSpace: 'nowrap',
          background: isLocal ? 'rgba(52,199,89,0.15)' : 'rgba(10,132,255,0.12)',
          color: isLocal ? '#34c759' : '#0a84ff',
        }}>
          {isLocal ? '🦙 Local (gratuit)' : '☁️ Cloud'}
        </span>
      )}

      <button
        type="button"
        onClick={() => onGoToSettings?.()}
        title="Ouvre les Réglages pour télécharger un modèle IA local (Ollama) ou changer de clé"
        style={{
          fontSize: '12px', padding: '4px 10px', marginLeft: 'auto',
          background: '#0a84ff', border: 'none', borderRadius: '6px',
          cursor: 'pointer', whiteSpace: 'nowrap', color: '#fff', fontWeight: 600,
        }}
      >
        ⬇ Télécharger / configurer une IA
      </button>
    </div>
  );
}
