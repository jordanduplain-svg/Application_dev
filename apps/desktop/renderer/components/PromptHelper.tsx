import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

// Compose le matériel saisi en texte lisible (envoyé à l'IA pour enrichissement).
function composeMaterial(i: PromptHelperInput): string {
  const lines: string[] = [`Poste visé : ${i.jobTitle}`];
  if (i.training)     lines.push(`Formation / situation : ${i.training}`);
  if (i.contractInfo) lines.push(`Contrat / disponibilité : ${i.contractInfo}`);
  if (i.experience)   lines.push(`Expérience clé : ${i.experience}`);
  if (i.skills)       lines.push(`Compétences : ${i.skills}`);
  if (i.financialArg) lines.push(`Argument financier : ${i.financialArg}`);
  if (i.mobility)     lines.push(`Mobilité : ${i.mobility}`);
  return lines.join('\n');
}

/**
 * PROMPT-HELPER : assistant de rédaction de prompt pour les candidatures spontanées.
 *
 * Conçu à partir de l'analyse des 37 emails générés par la plateforme Kandijobs
 * (cf. [[Module Scraping Carreer-ops]] / data/kandijobs_pitches_raw.txt). La
 * structure gagnante observée est constante en 4 paragraphes :
 *   1. Accroche : situation (reconversion/formation) + disponibilité + rythme
 *   2. Expérience + stack technique RELIÉS aux besoins de l'entreprise (le seul
 *      paragraphe réellement personnalisé — c'est lui qui déclenche les réponses)
 *   3. Argument financier OPCO (coût réduit pour l'employeur)
 *   4. Appel à l'action : CV joint + demande d'entretien + disponibilité
 *
 * L'utilisateur saisit son "matériel factuel" une seule fois, et on génère deux
 * variantes de prompt (= directives pour l'IA, pas l'email lui-même) avec deux
 * angles différents pour le test A/B :
 *   - Variante A : orientée IMPACT / résultats concrets
 *   - Variante B : orientée MOTIVATION / adéquation avec l'entreprise
 */

export interface PromptHelperInput {
  jobTitle: string;       // métier visé — ex: "Data Analyst"
  training: string;       // formation / école — ex: "Campus Numérique In The Alps"
  contractInfo: string;   // contrat + dispo — ex: "alternance 12 mois, dispo janvier 2026, rythme 1 sem cours / 3 sem entreprise"
  experience: string;     // expérience clé — ex: "5 ans en gestion de projet chez Airbus Atlantic (40+ projets), Dassault, Daher"
  skills: string;         // stack — ex: "Python (pandas, NumPy), SQL, Power BI, Excel"
  financialArg: string;   // argument OPCO — ex: "coût réduit via OPCO, ~5000€ pris en charge"
  mobility: string;       // mobilité — ex: "Grenoble, mobile Lyon/Paris, présentiel ou télétravail"
}

const EMPTY: PromptHelperInput = {
  jobTitle: '', training: '', contractInfo: '', experience: '',
  skills: '', financialArg: '', mobility: '',
};

// Construit les deux variantes de directives à partir du matériel saisi.
export function buildPrompts(input: PromptHelperInput): { promptA: string; promptB: string } {
  const lines: string[] = [];
  if (input.training)     lines.push(`- Formation / situation : ${input.training}`);
  if (input.contractInfo) lines.push(`- Contrat recherché : ${input.contractInfo}`);
  if (input.experience)   lines.push(`- Expérience clé : ${input.experience}`);
  if (input.skills)       lines.push(`- Compétences techniques : ${input.skills}`);
  if (input.financialArg) lines.push(`- Argument financier : ${input.financialArg}`);
  if (input.mobility)     lines.push(`- Mobilité / disponibilité : ${input.mobility}`);
  const profile = lines.join('\n');

  // Socle commun : structure en 4 paragraphes + consigne de personnalisation.
  const base = (angle: string) => `Rédige un email de candidature spontanée pour un poste de ${input.jobTitle || '[poste]'}.

Mon profil :
${profile}

Structure l'email en 4 paragraphes courts :
1. Accroche : ma situation actuelle (formation/reconversion) + ma disponibilité et le type de contrat.
2. Mon expérience et mes compétences clés, EXPLICITEMENT reliées à l'activité et aux besoins de l'entreprise destinataire (c'est le paragraphe le plus important — fais un lien concret entre mes compétences et ce que fait l'entreprise).
3. ${input.financialArg ? "L'argument financier : le coût réduit de l'alternance pour l'employeur grâce à l'OPCO." : "Une phrase montrant ma connaissance ou mon intérêt pour le secteur de l'entreprise."}
4. Un appel à l'action : CV en pièce jointe, proposition d'échange en entretien, et ma disponibilité.

${angle}

Contraintes :
- Ton professionnel et concret.
- Maximum 180 mots.
- Pas de variables non résolues type [Nom].
- Vouvoie le contact.`;

  const promptA = base(
    "Angle de cette version : METS L'ACCENT SUR L'IMPACT ET LES RÉSULTATS CONCRETS — chiffre mes réalisations quand c'est possible (nombre de projets, gains de temps, tableaux de bord livrés) et montre la valeur opérationnelle immédiate que j'apporterais."
  );
  const promptB = base(
    "Angle de cette version : METS L'ACCENT SUR LA MOTIVATION ET L'ADÉQUATION — explique pourquoi cette entreprise précise m'attire, ce qui me motive dans son secteur, et comment ma reconversion s'aligne avec sa mission. Ton plus personnel."
  );

  return { promptA, promptB };
}

/**
 * Composant repliable. Appelle onGenerate(promptA, promptB) quand l'utilisateur
 * valide — le parent remplit alors ses champs Prompt A / Prompt B.
 */
export default function PromptHelper({
  onGenerate,
  cvId,
  jobTitle,
  contractInfo,
}: {
  onGenerate: (promptA: string, promptB: string) => void;
  cvId?: string | null;   // CV de la campagne — l'IA l'exploite pour enrichir
  // Auto-remplissage depuis le formulaire campagne (poste + types de contrat/dispo du haut).
  // Évite la double saisie : ces champs suivent le haut tant que l'utilisateur ne les a pas édités.
  jobTitle?: string;
  contractInfo?: string;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState<PromptHelperInput>(() => ({
    ...EMPTY,
    jobTitle: jobTitle ?? '',
    contractInfo: contractInfo ?? '',
  }));
  const [done, setDone] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [usedAi, setUsedAi] = useState(false);
  const [usedCv, setUsedCv] = useState(false);

  // Champs auto-remplis depuis le haut du formulaire : on les resynchronise quand
  // le haut change, SAUF si l'utilisateur les a édités à la main ici (son choix prime).
  const touched = useRef<Set<keyof PromptHelperInput>>(new Set());
  useEffect(() => {
    setInput((prev) => {
      const next = { ...prev };
      if (!touched.current.has('jobTitle'))     next.jobTitle = jobTitle ?? '';
      if (!touched.current.has('contractInfo')) next.contractInfo = contractInfo ?? '';
      return next;
    });
  }, [jobTitle, contractInfo]);

  const set = (k: keyof PromptHelperInput) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => { touched.current.add(k); setInput({ ...input, [k]: e.target.value }); setDone(false); };

  const canGenerate = input.jobTitle.trim() && input.experience.trim() && input.skills.trim();

  // Génère via l'IA (enrichie par le CV) ; repli sur le template local si l'IA
  // est indisponible ou échoue.
  const handleGenerate = async () => {
    setGenerating(true);
    setDone(false);
    let result: { promptA: string; promptB: string; usedCv?: boolean } | null = null;
    try {
      result = await api.invoke('ai:generateCampaignPrompts', {
        material: composeMaterial(input),
        cvId: cvId ?? null,
      });
    } catch { /* IA indisponible — on bascule sur le template */ }
    if (result) {
      setUsedAi(true);
      setUsedCv(!!result.usedCv);
    } else {
      result = buildPrompts(input);   // repli template
      setUsedAi(false);
      setUsedCv(false);
    }
    onGenerate(result.promptA, result.promptB);
    setDone(true);
    setGenerating(false);
  };

  const fieldStyle: React.CSSProperties = { width: '100%', marginTop: '2px', marginBottom: '8px' };
  const labelStyle: React.CSSProperties = { fontSize: '13px', display: 'block', fontWeight: 500 };
  const hintStyle: React.CSSProperties = { fontSize: '11px', color: '#888', fontWeight: 400 };

  return (
    <div style={{
      border: '1px solid #d0d0d8', borderRadius: '8px', marginBottom: '12px',
      background: '#fafafe', overflow: 'hidden',
    }}>
      {/* En-tête repliable */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', textAlign: 'left', padding: '10px 14px',
          background: 'transparent', border: 'none', cursor: 'pointer',
          fontSize: '14px', fontWeight: 600, display: 'flex',
          alignItems: 'center', justifyContent: 'space-between', color: '#333',
        }}
      >
        <span>💡 Aide à la rédaction de prompt</span>
        <span style={{ fontSize: '12px', color: '#888' }}>{open ? '▲ Replier' : '▼ Déplier'}</span>
      </button>

      {open && (
        <div style={{ padding: '4px 14px 14px' }}>
          <p style={{ fontSize: '12px', color: '#555', marginTop: 0, lineHeight: 1.5 }}>
            Renseigne ton profil ci-dessous : <strong>l'IA génère 2 versions de prompt</strong> (A et B)
            pour le test A/B, <strong>enrichies à partir de ces infos et de ton CV analysé</strong>
            (tes vraies forces et expériences). Tu pourras les ajuster ensuite.
          </p>

          <label style={labelStyle}>
            Poste visé <span style={hintStyle}>· obligatoire</span>
            <input style={fieldStyle} value={input.jobTitle} onChange={set('jobTitle')}
              placeholder="Ex : Data Analyst" />
          </label>

          <label style={labelStyle}>
            Formation / situation actuelle
            <input style={fieldStyle} value={input.training} onChange={set('training')}
              placeholder="Ex : reconversion au Campus Numérique In The Alps (Grenoble)" />
          </label>

          <label style={labelStyle}>
            Contrat & disponibilité <span style={hintStyle}>· pré-rempli depuis le haut (types de contrat + disponibilité)</span>
            <input style={fieldStyle} value={input.contractInfo} onChange={set('contractInfo')}
              placeholder="Ex : alternance 12 mois, dispo janvier 2026, rythme 1 sem cours / 3 sem entreprise" />
          </label>

          <label style={labelStyle}>
            Expérience clé <span style={hintStyle}>· obligatoire</span>
            <textarea style={fieldStyle} rows={2} value={input.experience} onChange={set('experience')}
              placeholder="Ex : 5 ans en gestion de projet et amélioration continue chez Airbus Atlantic (40+ projets, A350), Dassault, Daher" />
          </label>

          <label style={labelStyle}>
            Compétences techniques / stack <span style={hintStyle}>· obligatoire</span>
            <input style={fieldStyle} value={input.skills} onChange={set('skills')}
              placeholder="Ex : Python (pandas, NumPy), SQL, Power BI, Excel, data cleaning, tableaux de bord" />
          </label>

          <label style={labelStyle}>
            Argument financier (optionnel)
            <input style={fieldStyle} value={input.financialArg} onChange={set('financialArg')}
              placeholder="Ex : coût réduit pour l'employeur via l'OPCO (~5000€ pris en charge)" />
          </label>

          <label style={labelStyle}>
            Mobilité (optionnel)
            <input style={fieldStyle} value={input.mobility} onChange={set('mobility')}
              placeholder="Ex : basé à Grenoble, mobile Lyon/Paris, présentiel ou télétravail" />
          </label>

          <button
            type="button"
            onClick={() => { void handleGenerate(); }}
            disabled={!canGenerate || generating}
            style={{
              background: (!canGenerate || generating) ? '#c5c5cc' : '#0a84ff', color: '#fff',
              border: 'none', borderRadius: '6px', padding: '8px 16px',
              cursor: (!canGenerate || generating) ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600,
            }}
          >
            {generating ? '✨ Génération par l\'IA…' : '✨ Générer Prompt A + B avec l\'IA'}
          </button>
          <small style={{ display: 'block', marginTop: '6px', color: '#888' }}>
            {cvId
              ? "L'IA enrichit les prompts à partir de ces infos ET du CV de la campagne."
              : "Astuce : choisis un CV pour cette campagne — l'IA s'en servira pour enrichir les prompts."}
          </small>
          {!canGenerate && (
            <small style={{ display: 'block', marginTop: '4px', color: '#888' }}>
              Renseigne au moins le poste, l'expérience et les compétences.
            </small>
          )}
          {done && (
            <div style={{ marginTop: '8px' }}>
              <small style={{ display: 'block', color: '#34c759', fontWeight: 600 }}>
                ✅ Prompts insérés ci-dessous ({usedAi ? 'enrichis par l\'IA' : 'modèle local — IA indisponible'}).
                Tu peux les ajuster à la main.
              </small>
              {usedAi && !usedCv && (
                <small style={{ display: 'block', marginTop: '4px', color: '#ff9500' }}>
                  ⚠️ Le CV n'a pas été exploité (aucun CV analysé sélectionné pour cette campagne).
                  Choisis un CV <strong>analysé</strong> plus haut pour des prompts qui citent tes vraies expériences.
                </small>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
