import type { ReactNode } from 'react';

/**
 * Bulle d'aide repliable pour débutants. Repliée par défaut (un clic pour ouvrir) →
 * discrète pour l'utilisateur aguerri, découvrable par le néophyte. Sans dépendance
 * (élément natif <details>). Utilisée par page (PageHelp) et par section (Scraping).
 */
export function HelpNote({
  summary = '💡 Besoin d’aide ?',
  accent = '#0a84ff',
  defaultOpen = false,
  children,
}: {
  summary?: string;
  accent?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      style={{
        background: `${accent}0d`, border: `1px solid ${accent}33`, borderRadius: '10px',
        padding: '8px 12px', margin: '0 0 14px', fontSize: '13px', color: '#3a3a3c',
      }}
    >
      <summary style={{ cursor: 'pointer', fontWeight: 600, color: accent }}>{summary}</summary>
      <div style={{ marginTop: '8px', lineHeight: 1.55 }}>{children}</div>
    </details>
  );
}

// ── Aide par PAGE — texte centralisé, rendu une fois par App.tsx selon la route. ──
// Clé = route.name. Pas d'entrée = pas de bulle (rendu null).
const PAGE_HELP: Record<string, { title: string; body: ReactNode }> = {
  home: {
    title: 'C’est quoi cette page ?',
    body: (
      <>
        <p style={{ margin: '0 0 6px' }}>Ton point de départ. Les pastilles te disent ce qu’il reste à configurer — clique dessus pour aller droit au but.</p>
        <p style={{ margin: 0 }}><strong>Parcours type :</strong> Profil → CV → Réglages (email) → Scraping (trouver des entreprises) → Campagnes (candidater).</p>
      </>
    ),
  },
  stats: {
    title: 'À quoi sert le tableau de bord ?',
    body: <p style={{ margin: 0 }}>Vue d’ensemble de tes candidatures : combien envoyées, taux de réponse, par secteur. C’est de la <strong>lecture</strong> — pour voir ce qui marche, pas pour agir.</p>,
  },
  campaigns: {
    title: 'C’est quoi une campagne ?',
    body: (
      <>
        <p style={{ margin: '0 0 6px' }}>Une campagne = un <strong>lot de candidatures spontanées</strong> vers des entreprises ciblées.</p>
        <p style={{ margin: 0 }}>Tu crées une campagne, tu y ajoutes des entreprises (depuis <strong>Leads</strong>), l’app rédige une lettre par entreprise, puis tu envoies.</p>
      </>
    ),
  },
  campaign: {
    title: 'Que faire sur cette page ?',
    body: <p style={{ margin: 0 }}>Le détail d’une campagne : la liste des entreprises, la lettre générée pour chacune, et l’envoi. <strong>Relis une lettre avant d’envoyer</strong> — tu peux la régénérer si elle ne te plaît pas.</p>,
  },
  replies: {
    title: 'C’est quoi cette page ?',
    body: <p style={{ margin: 0 }}>Les <strong>réponses reçues</strong> à tes candidatures, lues automatiquement dans ta boîte mail (IMAP). Tu peux marquer : entretien, refus, offre. Nécessite l’IMAP configuré dans Réglages.</p>,
  },
  todo: {
    title: 'C’est quoi « À traiter » ?',
    body: <p style={{ margin: 0 }}>Ta <strong>liste d’actions</strong> : relances à faire, réponses à traiter. Tout ce qui demande une action de ta part atterrit ici — commence ta journée par cette page.</p>,
  },
  scraping: {
    title: 'À quoi sert le scraping ? (lis-moi)',
    body: (
      <>
        <p style={{ margin: '0 0 6px' }}>Ici tu pars <strong>chercher des entreprises</strong> (et leurs emails) à qui candidater. Tu choisis un métier, une zone, des sources, puis tu lances. Le résultat va dans <strong>Leads</strong>.</p>
        <p style={{ margin: 0 }}>👉 <strong>Conseil débutant :</strong> coche d’abord les <strong>job boards</strong> (WTTJ / APEC / Indeed) dans « Sources ». Ils donnent bien plus d’emails que le registre SIRENE (Société.com) seul.</p>
      </>
    ),
  },
  leads: {
    title: 'C’est quoi les Leads ?',
    body: <p style={{ margin: 0 }}>Les entreprises trouvées par le scraping (le fichier maître). Tu <strong>filtres</strong>, tu vérifies les « <strong>Mails exclus</strong> » (adresses devinées), et tu <strong>importes</strong> les bonnes dans une campagne.</p>,
  },
  cv: {
    title: 'À quoi sert cette page ?',
    body: <p style={{ margin: 0 }}>Ton <strong>CV (PDF)</strong> : joint aux candidatures et utilisé pour personnaliser les lettres. Ajoute-le une fois ; tu peux en avoir plusieurs et choisir lequel par campagne.</p>,
  },
  coverletter: {
    title: 'C’est quoi cette page ?',
    body: <p style={{ margin: 0 }}>Génère une <strong>lettre de motivation pour une annonce précise</strong> : choisis un CV, colle le texte de l’annonce, l’IA rédige. Différent des <strong>campagnes</strong> (candidatures spontanées en lot). Rien n’est envoyé ni stocké — tu copies la lettre.</p>,
  },
  profile: {
    title: 'Pourquoi commencer ici ?',
    body: <p style={{ margin: 0 }}>Qui tu es : identité, coordonnées, et surtout les <strong>consignes données à l’IA</strong> pour rédiger tes lettres (ton, type de contrat…). <strong>À remplir en premier</strong> — tout le reste s’appuie dessus.</p>,
  },
  settings: {
    title: 'C’est quoi les Réglages ?',
    body: (
      <>
        <p style={{ margin: '0 0 6px' }}>La <strong>plomberie</strong> de l’app : envoi d’emails (<strong>SMTP</strong>), réception (<strong>IMAP</strong>), clés IA.</p>
        <p style={{ margin: 0 }}>⚠️ Sans <strong>SMTP</strong> configuré, aucun envoi n’est possible. Les badges « à configurer » te montrent ce qui manque.</p>
      </>
    ),
  },
};

/** Bulle d'aide de la page courante. Rendue une fois par App.tsx ; null si pas de texte. */
export function PageHelp({ page }: { page: string }) {
  const h = PAGE_HELP[page];
  if (!h) return null;
  return (
    <HelpNote summary={`💡 ${h.title}`} defaultOpen={page === 'scraping'}>
      {h.body}
    </HelpNote>
  );
}
