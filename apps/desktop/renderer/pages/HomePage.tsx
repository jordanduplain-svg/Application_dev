import { useEffect, useState } from 'react';
import {
  Send, Mail, ListChecks, Building2, Radar, ChartBar,
  FileText, User, Settings, Plus, ArrowRight, Flame, CircleCheck,
} from 'lucide-react';
import { api } from '../lib/api';

/**
 * DESIGN-2 : page d'accueil-lanceur (bento). Point d'entrée de l'app : un menu
 * de cartes cliquables vers chaque section, avec quelques chiffres réels.
 * Présentationnel — la navigation passe par onNavigate.
 */
type Nav = 'stats' | 'profile' | 'cv' | 'campaigns' | 'replies' | 'settings' | 'todo' | 'scraping' | 'leads';

interface HomeStats {
  firstName: string;
  active: number;
  drafts: number;
  todo: number;
  leads: number;
  cvOk: boolean;
  // SETUP-1 : réglages essentiels (pour les pastilles d'alerte de l'accueil).
  aiOk: boolean;    // moteur IA des lettres configuré (provider + clé si cloud)
  smtpOk: boolean;  // SMTP d'envoi configuré
  imapOk: boolean;  // IMAP configuré (détection des réponses)
  profileOk: boolean; // prénom + nom renseignés (ils signent les lettres)
}

// SETUP-1 : alertes « à régler » d'une carte. On affiche TOUTES celles actives.
type Alert = { show: boolean; cls: 'red' | 'amber'; label: string; title: string };

export default function HomePage({ onNavigate }: { onNavigate: (n: Nav) => void }) {
  const [s, setS] = useState<HomeStats>({ firstName: '', active: 0, drafts: 0, todo: 0, leads: 0, cvOk: false, aiOk: true, smtpOk: true, imapOk: true, profileOk: true });

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [camps, todo, leads, prof, st, cvs] = await Promise.all([
          api.invoke('campaign:list'),
          api.invoke('application:listActionRequired'),
          api.invoke('scraping:listLeads').catch(() => [] as unknown[]),
          api.invoke('profile:get'),
          api.invoke('settings:getStatus').catch(() => null),
          api.invoke('cv:list').catch(() => [] as { parsed?: boolean }[]),
        ]);
        if (!alive) return;
        const live = camps.filter((c) => !c.archivedAt);
        // Moteur IA des lettres : ollama = local (toujours ok) ; sinon clé requise.
        const p = st?.aiProvider ?? '';
        const aiOk = p === 'ollama' ? true
          : p === 'openai' ? !!st?.openaiKeySet
          : p === 'anthropic' ? !!st?.anthropicKeySet
          : p === 'gemini' ? !!st?.geminiKeySet
          : p === 'groq' ? !!st?.groqKeySet
          : false;
        setS({
          firstName: prof?.firstName ?? '',
          active: live.filter((c) => c.status !== 'COMPLETED' && c.status !== 'DRAFT').length,
          drafts: live.filter((c) => c.status === 'DRAFT').length,
          todo: todo.length,
          leads: Array.isArray(leads) ? leads.length : 0,
          // CV-MULTI : un CV est « ok » dès qu'au moins un CV analysé existe (modèle Cv,
          // plus l'ancien champ profile.cvParsed). Repli sur le legacy si la liste échoue.
          cvOk: (Array.isArray(cvs) && cvs.some((c) => c?.parsed)) || !!prof?.cvParsed,
          aiOk,
          smtpOk: !!st?.smtpConfigured,
          imapOk: !!st?.imapConfigured,
          profileOk: !!(prof?.firstName?.trim() && prof?.lastName?.trim()),
        });
      } catch { /* non bloquant — l'accueil s'affiche avec des valeurs à 0 */ }
    })();
    return () => { alive = false; };
  }, []);

  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const ICON = 19;

  // SETUP-1 : alertes agrégées par carte (le réglage IA vit dans Profil ET Réglages).
  const reglagesAlerts: Alert[] = [
    { show: !s.smtpOk, cls: 'red', label: 'SMTP requis', title: 'SMTP non configuré — indispensable pour envoyer les candidatures' },
    { show: !s.imapOk, cls: 'amber', label: 'IMAP requis', title: 'IMAP non configuré — sans lui, les réponses des recruteurs ne sont pas détectées' },
    { show: !s.aiOk, cls: 'red', label: 'IA à choisir', title: 'Moteur IA des lettres non configuré (réglable ici ou dans Profil)' },
  ];
  const profilAlerts: Alert[] = [
    { show: !s.profileOk, cls: 'red', label: 'À compléter', title: 'Renseigne ton prénom et ton nom — ils signent les lettres' },
    { show: !s.aiOk, cls: 'red', label: 'IA à choisir', title: 'Moteur IA des lettres non configuré (réglable ici ou dans Réglages)' },
  ];
  // Affiche TOUTES les pastilles actives de la carte (empilées).
  const Badges = ({ alerts }: { alerts: Alert[] }) => {
    const list = alerts.filter((a) => a.show);
    return list.length ? (
      <div className="bento-alerts">
        {list.map((a, i) => <span key={i} className={`bento-alert ${a.cls}`} title={a.title}>{a.label}</span>)}
      </div>
    ) : null;
  };

  return (
    <section className="home">
      <div className="home-head">
        <h1>
          Bonjour{s.firstName ? ` ${s.firstName}` : ''} <span className="muted">— on postule ?</span>
        </h1>
        <span className="home-streak"><Flame size={14} /> {today}</span>
      </div>

      <div className="bento">
        {/* Héro — Campagnes */}
        <div
          className="bento-card b-hero"
          onClick={() => onNavigate('campaigns')}
          style={{ color: '#fff', background: 'linear-gradient(135deg, #2b2466 0%, #17132e 100%)' }}
        >
          <div className="bento-top">
            <div className="bento-chip" style={{ background: 'rgba(255,255,255,0.14)', color: '#fff' }}><Send size={ICON} /></div>
            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              Ouvrir <ArrowRight size={13} />
            </span>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
              <span className="bento-num" style={{ fontSize: '46px', color: '#fff' }}>{s.active}</span>
              {s.drafts > 0 && <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)' }}>+{s.drafts} brouillon{s.drafts > 1 ? 's' : ''}</span>}
            </div>
            <div className="bento-lbl" style={{ fontSize: '16px', color: 'rgba(255,255,255,0.9)' }}>Campagnes actives</div>
            <div style={{ marginTop: '12px', display: 'flex', gap: '5px' }}>
              <span style={{ height: '5px', flex: 2, borderRadius: '3px', background: '#7F77DD' }} />
              <span style={{ height: '5px', flex: 1, borderRadius: '3px', background: '#5DCAA5' }} />
              <span style={{ height: '5px', flex: 1, borderRadius: '3px', background: 'rgba(255,255,255,0.18)' }} />
            </div>
          </div>
        </div>

        {/* Réponses */}
        <div className="bento-card b-rep" onClick={() => onNavigate('replies')} style={{ background: '#0F6E56', color: '#fff' }}>
          <div className="bento-top"><div className="bento-chip" style={{ background: 'rgba(255,255,255,0.16)', color: '#fff' }}><Mail size={ICON} /></div></div>
          <div><div className="bento-lbl" style={{ color: '#fff' }}>Réponses</div><div className="bento-sub">à consulter</div></div>
        </div>

        {/* À traiter */}
        <div className="bento-card b-tdo" onClick={() => onNavigate('todo')} style={{ background: '#854F0B', color: '#fff' }}>
          <div className="bento-top"><div className="bento-chip" style={{ background: 'rgba(255,255,255,0.16)', color: '#fff' }}><ListChecks size={ICON} /></div></div>
          <div><span className="bento-num" style={{ color: '#fff' }}>{s.todo}</span><div className="bento-sub">à traiter</div></div>
        </div>

        {/* Leads */}
        <div className="bento-card b-leads" onClick={() => onNavigate('leads')} style={{ background: '#185FA5', color: '#fff' }}>
          <div className="bento-top"><div className="bento-chip" style={{ background: 'rgba(255,255,255,0.16)', color: '#fff' }}><Building2 size={ICON} /></div></div>
          <div><span className="bento-num" style={{ color: '#fff', fontSize: '26px' }}>{s.leads}</span><div className="bento-sub">leads</div></div>
        </div>

        {/* Scraping */}
        <div className="bento-card b-scr" onClick={() => onNavigate('scraping')} style={{ background: '#993C1D', color: '#fff' }}>
          <Badges alerts={[{ show: s.leads === 0, cls: 'amber', label: 'À lancer', title: 'Aucun lead collecté — lance un premier scraping pour alimenter tes campagnes' }]} />
          <div className="bento-top"><div className="bento-chip" style={{ background: 'rgba(255,255,255,0.16)', color: '#fff' }}><Radar size={ICON} /></div></div>
          <div><div className="bento-lbl" style={{ color: '#fff' }}>Scraping</div><div className="bento-sub">collecter</div></div>
        </div>

        {/* Tableau de bord (large) */}
        <div className="bento-card util row b-dash" onClick={() => onNavigate('stats')}>
          <div className="bento-chip" style={{ background: '#EEEDFE', color: '#26215C' }}><ChartBar size={ICON} /></div>
          <div style={{ flex: 1 }}>
            <div className="bento-lbl">Tableau de bord</div>
            <div className="bento-sub" style={{ opacity: 1, color: 'var(--text-sub)' }}>taux de réponse · entonnoir · activité</div>
          </div>
          <ArrowRight size={16} color="var(--text-sub)" />
        </div>

        {/* CV */}
        <div className="bento-card util b-cv" onClick={() => onNavigate('cv')}>
          <Badges alerts={[{ show: !s.cvOk, cls: 'amber', label: 'À ajouter', title: 'Aucun CV analysé — ajoute ton CV pour des lettres qui citent tes vraies expériences' }]} />
          <div className="bento-top">
            <div className="bento-chip" style={{ background: '#f2f2f7', color: 'var(--text-sub)' }}><FileText size={ICON} /></div>
            {s.cvOk && <CircleCheck size={16} color="#1D9E75" />}
          </div>
          <div><div className="bento-lbl">CV</div><div className="bento-sub" style={{ opacity: 1, color: 'var(--text-sub)' }}>{s.cvOk ? 'analysé' : 'à ajouter'}</div></div>
        </div>

        {/* Profil */}
        <div className="bento-card util b-prof" onClick={() => onNavigate('profile')}>
          <Badges alerts={profilAlerts} />
          <div className="bento-top"><div className="bento-chip" style={{ background: '#f2f2f7', color: 'var(--text-sub)' }}><User size={ICON} /></div></div>
          <div><div className="bento-lbl">Profil</div><div className="bento-sub" style={{ opacity: 1, color: 'var(--text-sub)' }}>identité · contact</div></div>
        </div>

        {/* Réglages (large) */}
        <div className="bento-card util row b-set" onClick={() => onNavigate('settings')}>
          <Badges alerts={reglagesAlerts} />
          <div className="bento-chip" style={{ background: '#f2f2f7', color: 'var(--text-sub)' }}><Settings size={ICON} /></div>
          <div style={{ flex: 1 }}>
            <div className="bento-lbl">Réglages</div>
            <div className="bento-sub" style={{ opacity: 1, color: 'var(--text-sub)' }}>IA · SMTP · sécurité</div>
          </div>
          <ArrowRight size={16} color="var(--text-sub)" />
        </div>

        {/* Action primaire — Nouvelle campagne */}
        <div className="bento-card row b-cta" onClick={() => onNavigate('campaigns')}
          style={{ background: '#378ADD', color: '#fff', justifyContent: 'center' }}>
          <Plus size={18} color="#fff" />
          <span style={{ fontSize: '15px', fontWeight: 600 }}>Nouvelle campagne</span>
        </div>
      </div>
    </section>
  );
}
