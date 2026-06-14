import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { GlobalStats } from '@candio/shared';
import { api } from '../lib/api';

// ANA-1v2 : données d'activité quotidienne pour le graphique en barres.
type DayActivity = { date: string; sent: number; replied: number };
// ANA-4v3 : données de comparaison des campagnes.
type CampaignRow = { id: string; name: string; sent: number; replied: number; replyRate: number; avgDays: number | null };
// FM-02 : résultat de comparaison A/B par campagne.
type AbTestRow = {
  campaignId: string; campaignName: string;
  variantA: { sent: number; replied: number; replyRate: number };
  variantB: { sent: number; replied: number; replyRate: number };
};

// MOD-01 : clés de query pour react-query.
const QUERY_KEYS = {
  global: ['stats:getGlobal'] as const,
  activity: (days: number) => ['stats:getActivityByDay', days] as const,
  comparison: ['stats:getCampaignComparison'] as const,
  abTest: ['stats:getAbTest'] as const,
};

// ANA-1 : tableau de bord global avec les KPIs de l'application.
export default function DashboardPage({ onOpenCampaign }: { onOpenCampaign?: (id: string) => void }) {
  const queryClientHook = useQueryClient();
  // ANA-2v3 : sélecteur de plage temporelle (7 / 30 / 90 / 0=tout).
  const [activityDays, setActivityDays] = useState(30);

  // MOD-01 : migration vers useQuery (remplace les api.invoke() + cache.ts manuels).
  const { data: stats, error: statsError } = useQuery({
    queryKey: QUERY_KEYS.global,
    queryFn: () => api.invoke('stats:getGlobal'),
  });

  const { data: activity = [] } = useQuery({
    queryKey: QUERY_KEYS.activity(activityDays),
    queryFn: () => api.invoke('stats:getActivityByDay', { days: activityDays }),
  });

  const { data: comparison = [] } = useQuery({
    queryKey: QUERY_KEYS.comparison,
    queryFn: () => api.invoke('stats:getCampaignComparison'),
  });

  const { data: abTest = [] } = useQuery({
    queryKey: QUERY_KEYS.abTest,
    queryFn: () => api.invoke('stats:getAbTest', {}),
  });

  // MOD-01 : invalider les queries quand une tâche se termine (équivalent de cacheInvalidate).
  useEffect(() => {
    return api.on('task:progress', (p) => {
      if (p.status === 'done') {
        void queryClientHook.invalidateQueries({ queryKey: ['stats:getGlobal'] });
        void queryClientHook.invalidateQueries({ queryKey: ['stats:getActivityByDay'] });
        void queryClientHook.invalidateQueries({ queryKey: ['stats:getCampaignComparison'] });
        void queryClientHook.invalidateQueries({ queryKey: ['stats:getAbTest'] });
      }
    });
  }, [queryClientHook]);

  // ANA-2v3 : rechargement lors du changement de plage.
  const handleDaysChange = (days: number) => {
    setActivityDays(days);
  };

  const error = statsError instanceof Error ? statsError.message : statsError ? 'Erreur de chargement' : null;

  if (error) return <section><h2>Tableau de bord</h2><p className="error">{error}</p></section>;
  if (!stats) return <section><h2>Tableau de bord</h2><p>Chargement…</p></section>;

  return (
    <section>
      <h2>Tableau de bord</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
        {/* KPI : campagnes */}
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2em', fontWeight: 'bold' }}>{stats.totalCampaigns}</div>
          <div>Campagnes actives</div>
        </div>

        {/* KPI : entreprises */}
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2em', fontWeight: 'bold' }}>{stats.totalCompanies}</div>
          <div>Entreprises ciblées</div>
        </div>

        {/* KPI : envoyés */}
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2em', fontWeight: 'bold' }}>{stats.totalSent}</div>
          <div>Candidatures envoyées</div>
        </div>

        {/* KPI : réponses */}
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2em', fontWeight: 'bold' }}>{stats.totalReplied}</div>
          <div>Réponses reçues</div>
        </div>

        {/* KPI : taux de réponse */}
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2em', fontWeight: 'bold' }}>{stats.replyRate}%</div>
          <div>Taux de réponse</div>
        </div>

        {/* KPI : délai moyen */}
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2em', fontWeight: 'bold' }}>
            {stats.avgDaysToReply !== null ? `${stats.avgDaysToReply}j` : '—'}
          </div>
          <div>Délai moyen de réponse</div>
        </div>
      </div>

      {/* KPI : statuts manuels post-réponse (UX-4v3). */}
      {(stats.totalInterviewed > 0 || stats.totalOffers > 0) && (
        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
          <div className="card" style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ fontSize: '1.5em', fontWeight: 'bold', color: '#ff9f0a' }}>{stats.totalInterviewed}</div>
            <div>Entretiens</div>
          </div>
          <div className="card" style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ fontSize: '1.5em', fontWeight: 'bold', color: '#34c759' }}>{stats.totalOffers}</div>
            <div>Offres reçues</div>
          </div>
        </div>
      )}

      {/* ANA-3v3 : meilleure campagne cliquable pour navigation directe. */}
      {stats.topCampaign && (
        <div
          className="card"
          onClick={() => onOpenCampaign?.(stats.topCampaign!.id)}
          style={{ cursor: onOpenCampaign ? 'pointer' : 'default' }}
          title={onOpenCampaign ? 'Ouvrir cette campagne' : undefined}
        >
          <h3>Meilleure campagne ↗</h3>
          <p>
            <strong>{stats.topCampaign.name}</strong>
            {' '}— taux de réponse : <strong>{stats.topCampaign.replyRate}%</strong>
          </p>
        </div>
      )}

      {/* ANA-1v3 : entonnoir de conversion. */}
      <FunnelChart data={stats.funnelStats} />

      {/* ANA-2v3 : graphique d'activité avec sélecteur de plage. */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <h3 style={{ margin: 0 }}>
            Activité ({activityDays === 0 ? 'tout le temps' : `${activityDays} derniers jours`})
          </h3>
          {/* ANA-2v3 : sélecteur de plage temporelle. */}
          <div style={{ display: 'flex', gap: '4px' }}>
            {([7, 30, 90, 0] as const).map((d) => (
              <button
                key={d}
                onClick={() => handleDaysChange(d)}
                style={{
                  padding: '3px 8px', fontSize: '12px',
                  background: activityDays === d ? '#007aff' : undefined,
                  color: activityDays === d ? '#fff' : undefined,
                }}
              >
                {d === 0 ? 'Tout' : `${d}j`}
              </button>
            ))}
          </div>
        </div>
        <ActivityChart data={activity} />
      </div>

      {/* ANA-4v3 : tableau comparatif des campagnes. */}
      {comparison.length > 0 && (
        <div className="card">
          <h3>Comparaison des campagnes</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Campagne</th>
                <th style={{ textAlign: 'right', padding: '6px 8px' }}>Envoyés</th>
                <th style={{ textAlign: 'right', padding: '6px 8px' }}>Réponses</th>
                <th style={{ textAlign: 'right', padding: '6px 8px' }}>Taux</th>
                <th style={{ textAlign: 'right', padding: '6px 8px' }}>Délai moy.</th>
              </tr>
            </thead>
            <tbody>
              {comparison.map((row) => (
                <tr
                  key={row.id}
                  style={{ borderBottom: '1px solid #f0f0f0', cursor: onOpenCampaign ? 'pointer' : 'default' }}
                  onClick={() => onOpenCampaign?.(row.id)}
                  title={onOpenCampaign ? 'Ouvrir cette campagne' : undefined}
                >
                  <td style={{ padding: '6px 8px' }}>{row.name}</td>
                  <td style={{ textAlign: 'right', padding: '6px 8px' }}>{row.sent}</td>
                  <td style={{ textAlign: 'right', padding: '6px 8px' }}>{row.replied}</td>
                  <td style={{ textAlign: 'right', padding: '6px 8px' }}>
                    <span style={{
                      background: row.replyRate >= 20 ? '#34c75920' : '#ff453a20',
                      color: row.replyRate >= 20 ? '#1a7a38' : '#cc2318',
                      padding: '2px 6px', borderRadius: '4px',
                    }}>
                      {row.replyRate}%
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', padding: '6px 8px', color: '#888' }}>
                    {row.avgDays !== null ? `${row.avgDays}j` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* FM-02 : tableau comparatif A/B par variante de prompt. */}
      {abTest.length > 0 && (
        <div className="card">
          <h3>Test A/B — variantes de prompt</h3>
          <p style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>
            Comparaison du taux de réponse selon la variante de prompt envoyée.
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Campagne</th>
                <th style={{ textAlign: 'right', padding: '6px 8px' }}>A — Envoyés</th>
                <th style={{ textAlign: 'right', padding: '6px 8px' }}>A — Taux</th>
                <th style={{ textAlign: 'right', padding: '6px 8px' }}>B — Envoyés</th>
                <th style={{ textAlign: 'right', padding: '6px 8px' }}>B — Taux</th>
                <th style={{ textAlign: 'right', padding: '6px 8px' }}>Gagnant</th>
              </tr>
            </thead>
            <tbody>
              {abTest.map((row) => {
                // Déclarer le gagnant si au moins 5 envois de chaque côté.
                const winner =
                  row.variantA.sent >= 5 && row.variantB.sent >= 5
                    ? row.variantA.replyRate >= row.variantB.replyRate ? 'A' : 'B'
                    : null;
                return (
                  <tr key={row.campaignId} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '6px 8px' }}>{row.campaignName}</td>
                    <td style={{ textAlign: 'right', padding: '6px 8px' }}>{row.variantA.sent}</td>
                    <td style={{ textAlign: 'right', padding: '6px 8px' }}>
                      <span style={{
                        background: '#007aff20', color: '#005cbf',
                        padding: '2px 6px', borderRadius: '4px',
                      }}>{row.variantA.replyRate}%</span>
                    </td>
                    <td style={{ textAlign: 'right', padding: '6px 8px' }}>{row.variantB.sent}</td>
                    <td style={{ textAlign: 'right', padding: '6px 8px' }}>
                      <span style={{
                        background: '#5856d620', color: '#3d3b9e',
                        padding: '2px 6px', borderRadius: '4px',
                      }}>{row.variantB.replyRate}%</span>
                    </td>
                    <td style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 'bold' }}>
                      {winner ? (
                        <span style={{ color: winner === 'A' ? '#005cbf' : '#3d3b9e' }}>
                          Variante {winner}
                        </span>
                      ) : (
                        <span style={{ color: '#999', fontWeight: 'normal' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ANA-1v3 : entonnoir de conversion SVG (sans lib externe).
function FunnelChart({ data }: { data: GlobalStats['funnelStats'] }) {
  if (!data || data.targeted === 0) return null;

  const steps = [
    { label: 'Ciblées', value: data.targeted, color: '#007aff' },
    { label: 'Rédigées', value: data.drafted, color: '#5856d6' },
    { label: 'Envoyées', value: data.sent, color: '#ff9f0a' },
    { label: 'Réponses', value: data.replied, color: '#34c759' },
    { label: 'Entretiens', value: data.interviewed, color: '#ff6b35' },
    { label: 'Offres', value: data.offers, color: '#30d158' },
  ].filter((s) => s.value > 0 || s.label === 'Ciblées');

  const max = Math.max(1, data.targeted);

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <h3>Entonnoir de conversion</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {steps.map((step, i) => {
          const pct = Math.round((step.value / max) * 100);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '80px', fontSize: '12px', color: '#555', textAlign: 'right' }}>
                {step.label}
              </div>
              <div style={{
                flex: 1, background: '#f0f0f0', borderRadius: '4px', height: '22px', overflow: 'hidden',
              }}>
                <div style={{
                  width: `${pct}%`, height: '100%', background: step.color,
                  borderRadius: '4px', minWidth: step.value > 0 ? '2px' : '0',
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <div style={{ width: '60px', fontSize: '12px', color: '#333' }}>
                {step.value} ({pct}%)
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Graphique en barres SVG — pas de dépendance externe.
function ActivityChart({ data }: { data: DayActivity[] }) {
  if (data.length === 0) return <p style={{ color: '#888', fontSize: '13px' }}>Aucune activité sur cette période.</p>;

  const maxVal = Math.max(1, ...data.map((d) => Math.max(d.sent, d.replied)));
  const BAR_W = 14;     // largeur d'une barre
  const GAP = 4;        // écart entre les deux barres d'un même jour
  const COL_W = BAR_W * 2 + GAP + 6; // largeur totale par colonne
  const H = 80;         // hauteur de la zone graphique
  const TOTAL_W = data.length * COL_W;

  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', fontSize: '11px', marginBottom: '6px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ display: 'inline-block', width: 12, height: 12, background: '#007aff', borderRadius: 2 }} />
          Envoyés
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ display: 'inline-block', width: 12, height: 12, background: '#34c759', borderRadius: 2 }} />
          Réponses
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <svg width={TOTAL_W} height={H + 20} aria-label="Graphique d'activité">
          {data.map((d, i) => {
            const x = i * COL_W;
            const hSent = Math.round((d.sent / maxVal) * H);
            const hReplied = Math.round((d.replied / maxVal) * H);
            // Étiquette de date toutes les 5 colonnes (ou toutes les colonnes si peu de données).
            const stride = data.length <= 10 ? 1 : 5;
            const label = i % stride === 0 ? d.date.slice(5) : null; // MM-DD
            return (
              <g key={d.date}>
                {/* Barre envois */}
                <rect
                  x={x}
                  y={H - hSent}
                  width={BAR_W}
                  height={hSent}
                  fill="#007aff"
                  opacity={0.85}
                >
                  <title>{d.date} — {d.sent} envoi(s)</title>
                </rect>
                {/* Barre réponses */}
                <rect
                  x={x + BAR_W + GAP}
                  y={H - hReplied}
                  width={BAR_W}
                  height={hReplied}
                  fill="#34c759"
                  opacity={0.85}
                >
                  <title>{d.date} — {d.replied} réponse(s)</title>
                </rect>
                {/* Étiquette de date */}
                {label && (
                  <text
                    x={x + BAR_W}
                    y={H + 14}
                    fontSize={9}
                    textAnchor="middle"
                    fill="#888"
                  >
                    {label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
