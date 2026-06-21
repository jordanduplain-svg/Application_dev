// Secteurs d'activité SIRENE partagés (scraping + campagnes). Chaque `value`
// correspond à une clé de SECTOR_NAF côté Python (sources.py).
import { useEffect, useRef, useState } from 'react';

export const INDUSTRY_GROUPS: { group: string; items: { value: string; label: string }[] }[] = [
  { group: '💻 Numérique', items: [
    { value: 'tech',      label: '💻 IT / Tech' },
    { value: 'data',      label: '📊 Data / IA' },
    { value: 'logiciel',  label: '🖥️ Logiciel / SaaS' },
  ]},
  { group: '💰 Finance & Conseil', items: [
    { value: 'finance',   label: '💰 Finance / Banque' },
    { value: 'assurance', label: '🛡️ Assurance' },
    { value: 'conseil',   label: '🧠 Conseil / Consulting' },
    { value: 'audit',     label: '📋 Audit / Expertise' },
  ]},
  { group: '🏭 Industrie & Énergie', items: [
    { value: 'industrie', label: '🏭 Industrie / Manufacture' },
    { value: 'energie',   label: '⚡ Énergie / Environnement' },
    { value: 'btp',       label: '🏗️ BTP / Construction' },
  ]},
  { group: '🏥 Santé & Sciences', items: [
    { value: 'sante',     label: '🏥 Santé / Médical' },
    { value: 'pharma',    label: '💊 Pharmacie / Biotech' },
  ]},
  { group: '🛍️ Commerce & Logistique', items: [
    { value: 'retail',      label: '🛍️ Commerce / Retail' },
    { value: 'ecommerce',   label: '🛒 E-commerce' },
    { value: 'logistique',  label: '📦 Logistique / Supply Chain' },
    { value: 'transport',   label: '🚛 Transport' },
  ]},
  { group: '📺 Médias & Services', items: [
    { value: 'media',        label: '📺 Médias / Communication' },
    { value: 'immobilier',   label: '🏠 Immobilier' },
    { value: 'education',    label: '🎓 Éducation / Formation' },
    { value: 'restauration', label: '🍽️ Restauration / Hôtellerie' },
    { value: 'agriculture',  label: '🌾 Agriculture / Agroalimentaire' },
  ]},
];

// Flat list pour les lookups rapides (label, récapitulatif…).
export const INDUSTRY_CHOICES = INDUSTRY_GROUPS.flatMap((g) => g.items);

export function sectorLabel(value: string): string {
  return INDUSTRY_CHOICES.find((c) => c.value === value)?.label ?? value;
}

/**
 * Sélecteur multi-secteurs (menu déroulant à cases), identique à celui de la page
 * Scraping. `value` = liste de clés ; `max` = nombre max sélectionnable.
 */
export function SectorMultiSelect({
  value, onChange, max = 5, emptyLabel = 'Tous secteurs (aucune préférence)',
}: {
  value: string[];
  onChange: (next: string[]) => void;
  max?: number;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const sel = value.filter(Boolean);
  const atMax = sel.length >= max;
  const triggerLabel = sel.length === 0
    ? emptyLabel
    : sel.length === 1 ? sectorLabel(sel[0]) : `${sel.length} secteurs sélectionnés`;

  const toggle = (v: string) => {
    const isSel = sel.includes(v);
    if (!isSel && atMax) return;
    onChange(isSel ? sel.filter((x) => x !== v) : [...sel, v]);
  };

  return (
    <div ref={ref} style={{ position: 'relative', zIndex: 20 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', textAlign: 'left', padding: '8px 11px',
          border: '1px solid', borderColor: sel.length ? '#007aff' : '#d1d1d6',
          borderRadius: '8px', background: '#fff', cursor: 'pointer',
          fontSize: '13px', color: sel.length ? '#007aff' : '#555',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontWeight: sel.length ? 600 : 400, boxSizing: 'border-box',
        }}
      >
        <span>{triggerLabel}</span>
        <span style={{ fontSize: '10px', color: '#888', marginLeft: '8px' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: '#fff', border: '1px solid #d1d1d6', borderRadius: '8px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: '320px', overflowY: 'auto',
          padding: '6px 0',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '4px 12px 8px', borderBottom: '1px solid #f0f0f0' }}>
            <span style={{ fontSize: '11px', color: atMax ? '#ff9500' : '#888' }}>
              {sel.length}/{max} secteur(s){atMax ? ' — maximum atteint' : ''}
            </span>
            {sel.length > 0 && (
              <button type="button" onClick={() => onChange([])}
                style={{ fontSize: '11px', color: '#ff453a', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                ✕ Effacer
              </button>
            )}
          </div>
          {INDUSTRY_GROUPS.map((group) => (
            <div key={group.group}>
              <div style={{ padding: '6px 12px 2px', fontSize: '11px', fontWeight: 700, color: '#888',
                textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {group.group}
              </div>
              {group.items.map((item) => {
                const checked = sel.includes(item.value);
                const disabled = !checked && atMax;
                return (
                  <label key={item.value}
                    title={disabled ? `Maximum ${max} secteurs — décochez-en un d'abord` : ''}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 12px',
                      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1, fontSize: '13px' }}>
                    <input type="checkbox" checked={checked} disabled={disabled}
                      onChange={() => toggle(item.value)} style={{ width: 'auto' }} />
                    {item.label}
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
