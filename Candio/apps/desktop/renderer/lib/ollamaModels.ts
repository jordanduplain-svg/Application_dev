// ── Catalogue des modèles Ollama + helpers de compatibilité hardware ──────────
// Partagé entre Réglages (rédaction emails/CV) et Scraping (descriptions d'activité).
// qualité : note /5 spécifique au français business (ton, grammaire, pertinence).
// vramGb  : VRAM minimale pour inférence GPU quantifiée Q4.
// ramGb   : RAM minimale pour inférence CPU seul.

import type { HardwareInfo } from '@candio/shared';

export interface ModelSpec {
  id: string;
  name: string;
  vramGb: number;
  ramGb: number;
  quality: number;   // /5 — APTITUDE À LA TÂCHE (rédaction FR pour les lettres,
                     // extraction/résumé pour le scraping selon le catalogue)
  speed?: number;    // /5 — rapidité d'inférence (compte pour le scraping à grande échelle)
  badge?: string;
  note: string;
  sizeLabel: string; // taille du modèle à télécharger
}

export const MODEL_CATALOG: ModelSpec[] = [
  {
    id: 'mistral:7b',
    name: 'Mistral 7B',
    vramGb: 4.5, ramGb: 9, quality: 5,
    badge: '⭐ Recommandé',
    note: 'Entraîné sur beaucoup de français · ton professionnel · excellent pour les lettres',
    sizeLabel: '4.1 GB',
  },
  {
    id: 'phi4:14b',
    name: 'Phi-4 14B',
    vramGb: 9, ramGb: 18, quality: 5,
    badge: '🏆 Haut de gamme',
    note: 'Meilleure qualité rédactionnelle du catalogue · instructions très bien suivies',
    sizeLabel: '8.9 GB',
  },
  {
    id: 'mistral-nemo:12b',
    name: 'Mistral Nemo 12B',
    vramGb: 7.5, ramGb: 15, quality: 5,
    badge: '🏆 Haut de gamme',
    note: 'Successeur de Mistral 7B · meilleur français · excellent pour les longues lettres',
    sizeLabel: '7.1 GB',
  },
  {
    id: 'qwen2.5:7b',
    name: 'Qwen 2.5 7B',
    vramGb: 4.5, ramGb: 9, quality: 4,
    note: 'Très bon suivi d\'instructions · style clair · multilingue performant',
    sizeLabel: '4.7 GB',
  },
  {
    id: 'llama3.1:8b',
    name: 'Llama 3.1 8B',
    vramGb: 5, ramGb: 10, quality: 4,
    note: 'Polyvalent · bon français · bonne gestion du contexte long',
    sizeLabel: '4.9 GB',
  },
  {
    id: 'gemma3:4b',
    name: 'Gemma 3 4B',
    vramGb: 3, ramGb: 6, quality: 4,
    note: 'Excellent rapport taille/qualité · bon pour les machines moins puissantes',
    sizeLabel: '3.3 GB',
  },
  {
    id: 'llama3.2:3b',
    name: 'Llama 3.2 3B',
    vramGb: 2, ramGb: 5, quality: 3,
    note: 'Correct mais formulations parfois génériques · acceptable sur petite config',
    sizeLabel: '2.0 GB',
  },
  {
    id: 'qwen2.5:3b',
    name: 'Qwen 2.5 3B',
    vramGb: 2, ramGb: 5, quality: 3,
    note: 'Suit bien les instructions · style un peu neutre · petit format',
    sizeLabel: '1.9 GB',
  },
  {
    id: 'llama3.2:1b',
    name: 'Llama 3.2 1B',
    vramGb: 0.8, ramGb: 2, quality: 1,
    note: '⚠️ Trop petit — résultats insuffisants pour des candidatures professionnelles',
    sizeLabel: '1.3 GB',
  },
];

// ── Catalogue dédié au SCRAPING / ENRICHISSEMENT ──────────────────────────────
// Critères ≠ rédaction de lettres : ici on veut un bon SUIVI D'INSTRUCTIONS, une
// SORTIE JSON FIABLE (le pipeline parse du JSON via ask_json), une compréhension
// factuelle du texte FR, et de la VITESSE (le crawl appelle le LLM page par page ;
// les descriptions, 1 fois par entreprise). La qualité rédactionnelle ne compte pas.
// `quality` = aptitude extraction/résumé ; `speed` = rapidité d'inférence.
export const SCRAPING_MODEL_CATALOG: ModelSpec[] = [
  {
    id: 'qwen2.5:7b',
    name: 'Qwen 2.5 7B',
    vramGb: 4.5, ramGb: 9, quality: 5, speed: 3,
    badge: '⭐ Recommandé descriptions',
    note: 'Suivi d\'instructions au top + JSON très fiable · résumés FR factuels · le meilleur pour les descriptions',
    sizeLabel: '4.7 GB',
  },
  {
    id: 'qwen2.5:3b',
    name: 'Qwen 2.5 3B',
    vramGb: 2, ramGb: 5, quality: 4, speed: 5,
    badge: '⚡ Rapide (crawl)',
    note: 'JSON fiable et très rapide · idéal pour l\'extraction email/contact en masse (crawl) · résumés corrects',
    sizeLabel: '1.9 GB',
  },
  {
    id: 'mistral:7b',
    name: 'Mistral 7B',
    vramGb: 4.5, ramGb: 9, quality: 4, speed: 3,
    note: 'Bonne compréhension du FR · résumés naturels · JSON un peu moins strict que Qwen sur cas tordus',
    sizeLabel: '4.1 GB',
  },
  {
    id: 'gemma3:4b',
    name: 'Gemma 3 4B',
    vramGb: 3, ramGb: 6, quality: 4, speed: 4,
    note: 'Léger et rapide · correct pour résumés courts et extraction simple · bon sur petite config',
    sizeLabel: '3.3 GB',
  },
  {
    id: 'llama3.1:8b',
    name: 'Llama 3.1 8B',
    vramGb: 5, ramGb: 10, quality: 3, speed: 2,
    note: 'Polyvalent mais plus lourd · sans avantage net ici face à Qwen 7B',
    sizeLabel: '4.9 GB',
  },
  {
    id: 'llama3.2:3b',
    name: 'Llama 3.2 3B',
    vramGb: 2, ramGb: 5, quality: 3, speed: 5,
    note: 'Très rapide mais structuration JSON moins fiable · dépannage sur machine modeste',
    sizeLabel: '2.0 GB',
  },
  {
    id: 'llama3.2:1b',
    name: 'Llama 3.2 1B',
    vramGb: 0.8, ramGb: 2, quality: 1, speed: 5,
    note: '⚠️ Trop petit — extraction/résumé peu fiables · à éviter sauf machine très limitée',
    sizeLabel: '1.3 GB',
  },
];

export function qualityStars(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

export function compatLabel(spec: ModelSpec, hw: HardwareInfo): 'gpu' | 'cpu' | 'incompatible' {
  if (hw.gpuVramGb !== null && hw.gpuVramGb >= spec.vramGb) return 'gpu';
  if (hw.totalRamGb >= spec.ramGb) return 'cpu';
  return 'incompatible';
}
