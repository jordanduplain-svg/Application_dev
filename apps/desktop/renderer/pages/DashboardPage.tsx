import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Megaphone, Building2, Send, Mail, Percent, Clock,
  CalendarCheck, Trophy, Filter, Activity, BarChart3, FlaskConical,
} from 'lucide-react';
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
  bySector: ['stats:getBySector'] as const,
};

// ANA-1 : tableau de bord global avec les KPIs de l'application.
export default function DashboardPage({ onOpenCampaign }: { onOpenCampaign?: (id: string) => void }) {
  const queryClientHook = useQueryClient();
  // ANA-2v3 : sélecteur de plage temporelle (7 / 30 / 90 / 0=tout).
  const [activityDays, setActivityDays] = useState(30);

  // Justificatif France Travail (PDF du relevé des candidatures envoyées sur une période).
  const [ftOpen, setFtOpen] = useState(false);
  const [ftFrom, setFtFrom] = useState('');
  const [ftTo, setFtTo] = useState('');
  const [ftCap, setFtCap] = useState(80); // 0 = toutes les lettres
  const [genFt, setGenFt] = useState(false);
  const [ftMsg, setFtMsg] = useState('');
  const [genCsv, setGenCsv] = useState(false);
  const generateFtJustificatif = async () => {
    setGenFt(true);
    setFtMsg('');
    try {
      const r = await api.invoke('report:franceTravailPdf', { from: ftFrom || undefined, to: ftTo || undefined, detailCap: ftCap });
      setFtMsg(r ? `✅ PDF généré (${r.count} candidature(s)) : ${r.path}` : '');
    } catch (e) {
      setFtMsg(`✗ ${e instanceof Error ? e.message : 'Erreur lors de la génération'}`);
    } finally {
      setGenFt(false);
    }
  };
  const exportCsv = async () => {
    setGenCsv(true);
    setFtMsg('');
    try {
      const r = await api.invoke('report:applicationsCsv');
      setFtMsg(r ? `✅ Export CSV (${r.count} candidature(s)) : ${r.path}` : '');
    } catch (e) {
      setFtMsg(`✗ ${e instanceof Error ? e.message : 'Erreur lors de l\'export'}`);
    } finally {
      setGenCsv(false);
    }
  };

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

  // F3 : taux de réponse par secteur (donnée scraper).
  const { data: bySector = [] } = useQuery({
    queryKey: QUERY_KEYS.bySector,
    queryFn: () => api.invoke('stats:getBySector'),
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

  const error = statsError instanceof Error ? statsError.message : statsError ? 'Erreur de chargement' : null;

  if (error) return <section><div className="page-head"><h2>Tableau de bord</h2></div><p className="error">{error}</p></section>;
  if (!stats) return <section><div className="page-head"><h2>Tableau de bord</h2></div><p>Chargement…</p></section>;

  // KPIs principaux — chaque carte porte sa teinte d'accent via --m.
  const metrics = [
    { icon: Megaphone, color: '#5856d6', value: stats.totalCampaigns, label: 'Campagnes actives' },
    { icon: Building2, color: '#378ADD', value: stats.totalCompanies, label: 'Entreprises ciblées' },
    { icon: Send, color: '#ff9f0a', value: stats.totalSent, label: 'Candidatures envoyées' },
    { icon: Mail, color: '#1D9E75', value: stats.totalReplied, label: 'Réponses reçues' },
    { icon: Percent, color: '#0F6E56', value: `${stats.replyRate}%`, label: 'Taux de réponse' },
    { icon: Clock, color: '#8E8E93', value: stats.avgDaysToReply !== null ? `${stats.avgDaysToReply}j` : '—', label: 'Délai moyen de réponse' },
  ];

  return (
    <section>
      <div className="page-head" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h2>Tableau de bord</h2>
          <div className="page-sub">Vue d'ensemble de vos campagnes et de leurs performances.</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <button onClick={() => setFtOpen((o) => !o)}
            title="Génère un PDF du relevé de tes candidatures envoyées, à présenter à France Travail comme justificatif de recherche d'emploi."
            className="btn-secondary" style={{ fontSize: '12px' }}>
            📄 Justificatif France Travail
          </button>
          <button onClick={exportCsv} disabled={genCsv}
            title="Exporte toutes tes candidatures en CSV (ouvrable dans Excel / tableur)."
            className="btn-secondary" style={{ fontSize: '12px', marginLeft: '8px' }}>
            {genCsv ? 'Export…' : '📊 Exporter CSV'}
          </button>
          {ftOpen && (
            <div style={{ marginTop: '8px', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: '8px', textAlign: 'left', maxWidth: '280px' }}>
              <label style={{ display: 'block', fontSize: '11.5px', color: 'var(--text-sub)', marginBottom: '6px' }}>
                Du <input type="date" value={ftFrom} max={ftTo || undefined} onChange={(e) => setFtFrom(e.target.value)} style={{ marginLeft: '6px' }} />
              </label>
              <label style={{ display: 'block', fontSize: '11.5px', color: 'var(--text-sub)', marginBottom: '8px' }}>
                Au <input type="date" value={ftTo} min={ftFrom || undefined} onChange={(e) => setFtTo(e.target.value)} style={{ marginLeft: '6px' }} />
              </label>
              <label style={{ display: 'block', fontSize: '11.5px', color: 'var(--text-sub)', marginBottom: '8px' }}>
                Lettres détaillées
                <select value={ftCap} onChange={(e) => setFtCap(Number(e.target.value))} style={{ marginLeft: '6px' }}>
                  <option value={20}>20 max</option>
                  <option value={50}>50 max</option>
                  <option value={80}>80 max</option>
                  <option value={0}>Toutes</option>
                </select>
              </label>
              <div style={{ fontSize: '10.5px', color: 'var(--text-sub)', marginBottom: '8px' }}>Dates vides = toutes les candidatures. Les réponses reçues sont toujours incluses.</div>
              <button onClick={generateFtJustificatif} disabled={genFt} className="btn-secondary" style={{ fontSize: '12px' }}>
                {genFt ? 'Génération…' : 'Générer le PDF'}
              </button>
            </div>
          )}
          {ftMsg && <div style={{ fontSize: '11.5px', color: 'var(--text-sub)', marginTop: '4px', maxWidth: '280px' }}>{ftMsg}</div>}
        </div>
      </div>

      <div className="metric-grid">
        {metrics.map((m) => {
          const Icon = m.icon;
          return (
            <div key={m.label} className="metric" style={{ '--m': m.color } as React.CSSProperties}>
              <div className="metric-ico"><Icon size={18} /></div>
              <div className="metric-num">{m.value}</div>
              <div className="metric-lbl">{m.label}</div>
            </div>
          );
        })}

        {/* KPI : statuts manuels post-réponse (UX-4v3) — affichés seulement s'ils existent. */}
        {stats.totalInterviewed > 0 && (
          <div className="metric" style={{ '--m': '#ff6b35' } as React.CSSProperties}>
            <div className="metric-ico"><CalendarCheck size={18} /></div>
            <div className="metric-num">{stats.totalInterviewed}</div>
            <div className="metric-lbl">Entretiens</div>
          </div>
        )}
        {stats.totalOffers > 0 && (
          <div className="metric" style={{ '--m': '#30d158' } as React.CSSProperties}>
            <div className="metric-ico"><Trophy size={18} /></div>
            <div className="metric-num">{stats.totalOffers}</div>
            <div className="metric-lbl">Offres reçues</div>
          </div>
        )}
      </div>

      <div className="dash-grid">
      {/* ANA-3v3 : meilleure campagne cliquable pour navigation directe. */}
      {stats.topCampaign && (
        <div
          className="card spotlight"
          onClick={() => onOpenCampaign?.(stats.topCampaign!.id)}
          style={{ cursor: onOpenCampaign ? 'pointer' : 'default' }}
          title={onOpenCampaign ? 'Ouvrir cette campagne' : undefined}
        >
          <div className="bento-chip"><Trophy size={20} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '12px', color: 'var(--text-sub)', fontWeight: 600 }}>Meilleure campagne</div>
            <div style={{ fontSize: '16px', fontWeight: 700 }}>{stats.topCampaign.name}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--success)', lineHeight: 1 }}>
              {stats.topCampaign.replyRate}%
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-sub)' }}>taux de réponse</div>
          </div>
        </div>
      )}

      {/* ANA-1v3 : entonnoir de conversion. */}
      <FunnelChart data={stats.funnelStats} />

      {/* ANA-2v3 : graphique d'activité avec sélecteur de plage (bande large). */}
      <div className="card span-2">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '12px', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity size={17} color="var(--accent)" /> Activité
          </h3>
          {/* ANA-2v3 : sélecteur de plage temporelle (segmenté). */}
          <div className="seg">
            {([7, 30, 90, 0] as const).map((d) => (
              <button key={d} className={activityDays === d ? 'on' : ''} onClick={() => setActivityDays(d)}>
                {d === 0 ? 'Tout' : `${d}j`}
              </button>
            ))}
          </div>
        </div>
        <ActivityChart data={activity} />
      </div>

      {/* F3 : taux de réponse par secteur d'activité. */}
      {bySector.length > 0 && (
        <div className="card">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <BarChart3 size={17} color="var(--accent)" /> Taux de réponse par secteur
          </h3>
          <table className="data-table">
            <thead>
              <tr><th>Secteur</th><th>Envoyées</th><th>Réponses</th><th>Taux</th></tr>
            </thead>
            <tbody>
              {bySector.slice(0, 12).map((row) => (
                <tr key={row.sector}>
                  <td>{row.sector}</td>
                  <td>{row.sent}</td>
                  <td>{row.replied}</td>
                  <td><strong>{row.replyRate}%</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ANA-4v3 : tableau comparatif des campagnes. */}
      {comparison.length > 0 && (
        <div className="card">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <BarChart3 size={17} color="var(--accent)" /> Comparaison des campagnes
          </h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Campagne</th>
                <th>Envoyés</th>
                <th>Réponses</th>
                <th>Taux</th>
                <th>Délai moy.</th>
              </tr>
            </thead>
            <tbody>
              {comparison.map((row) => (
                <tr
                  key={row.id}
                  className={onOpenCampaign ? 'clickable' : ''}
                  onClick={() => onOpenCampaign?.(row.id)}
                  title={onOpenCampaign ? 'Ouvrir cette campagne' : undefined}
                >
                  <td>{row.name}</td>
                  <td>{row.sent}</td>
                  <td>{row.replied}</td>
                  <td>
                    <span className="pill" style={{
                      background: row.replyRate >= 20 ? '#34c75920' : '#ff453a20',
                      color: row.replyRate >= 20 ? '#1a7a38' : '#cc2318',
                    }}>
                      {row.replyRate}%
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-sub)' }}>
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
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FlaskConical size={17} color="var(--accent)" /> Test A/B — variantes de prompt
          </h3>
          <p style={{ fontSize: '12px', color: 'var(--text-sub)', marginBottom: '10px' }}>
            Comparaison du taux de réponse selon la variante de prompt envoyée.
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Campagne</th>
                <th>A — Envoyés</th>
                <th>A — Taux</th>
                <th>B — Envoyés</th>
                <th>B — Taux</th>
                <th>Gagnant</th>
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
                  <tr key={row.campaignId}>
                    <td>{row.campaignName}</td>
                    <td>{row.variantA.sent}</td>
                    <td>
                      <span className="pill" style={{ background: '#007aff20', color: '#005cbf' }}>
                        {row.variantA.replyRate}%
                      </span>
                    </td>
                    <td>{row.variantB.sent}</td>
                    <td>
                      <span className="pill" style={{ background: '#5856d620', color: '#3d3b9e' }}>
                        {row.variantB.replyRate}%
                      </span>
                    </td>
                    <td style={{ fontWeight: 'bold' }}>
                      {winner ? (
                        <span style={{ color: winner === 'A' ? '#005cbf' : '#3d3b9e' }}>
                          Variante {winner}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-sub)', fontWeight: 'normal' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </section>
  );
}

// ANA-1v3 : entonnoir de conversion SVG (sans lib externe).
function FunnelChart({ data }: { data: GlobalStats['funnelStats'] }) {
  if (!data || data.targeted === 0) return null;

  const steps = [
    { label: 'Ciblées', value: data.targeted, color: '#378ADD' },
    { label: 'Rédigées', value: data.drafted, color: '#5856d6' },
    { label: 'Envoyées', value: data.sent, color: '#ff9f0a' },
    { label: 'Réponses', value: data.replied, color: '#1D9E75' },
    { label: 'Entretiens', value: data.interviewed, color: '#ff6b35' },
    { label: 'Offres', value: data.offers, color: '#30d158' },
  ].filter((s) => s.value > 0 || s.label === 'Ciblées');

  const max = Math.max(1, data.targeted);

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Filter size={17} color="var(--accent)" /> Entonnoir de conversion
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
        {steps.map((step, i) => {
          const pct = Math.round((step.value / max) * 100);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '78px', fontSize: '12px', color: 'var(--text-sub)', textAlign: 'right', fontWeight: 600 }}>
                {step.label}
              </div>
              <div style={{
                flex: 1, background: '#f0f0f3', borderRadius: '7px', height: '24px', overflow: 'hidden',
              }}>
                <div style={{
                  width: `${pct}%`, height: '100%', background: step.color,
                  borderRadius: '7px', minWidth: step.value > 0 ? '3px' : '0',
                  transition: 'width 0.5s var(--ease-spring)',
                }} />
              </div>
              <div style={{ width: '66px', fontSize: '12px', color: 'var(--text)', fontWeight: 600 }}>
                {step.value} <span style={{ color: 'var(--text-sub)', fontWeight: 400 }}>({pct}%)</span>
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
  if (data.length === 0) return <p style={{ color: 'var(--text-sub)', fontSize: '13px' }}>Aucune activité sur cette période.</p>;

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
                  rx={2}
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
                  rx={2}
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
