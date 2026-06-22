import { taskRunner } from '../lib/task-runner';
import { extractPdfText } from '../pdf/pdf-extract';
import { parseCV, reviewCv } from '../modules/ai/ai.service';
import { setCvParsed } from '../modules/cv/cv.service';

/**
 * M1 (revue 6) : limite la taille du texte extrait avant envoi à OpenAI.
 * Un CV de 20 pages → ~30 000 tokens → timeout 60 s dépassé + facture élevée.
 * 15 000 caractères ≈ 4 000 tokens, suffisant pour un CV complet.
 */
const MAX_CV_CHARS = 15_000;

/**
 * enqueueCvParse — ROUAGE de l'analyse de CV. Chaîne PDF → IA → base, en 3 temps :
 *   1. extractPdfText : texte brut du PDF. Si vide (CV scanné en IMAGE) → on échoue net
 *      plutôt que d'envoyer du vide à l'IA (qui produirait un CV inexploitable) ;
 *   2. parseCV ← LE rouage : l'IA transforme le texte libre en JSON structuré (expériences,
 *      compétences…). C'est ce JSON (`parsed`) qui nourrira ensuite generatePitch ;
 *   3. reviewCv : score qualité (best-effort — si l'IA est muette, l'UI a un score heuristique).
 * Le texte est tronqué à MAX_CV_CHARS avant l'IA → borne le timeout et la facture sur un gros PDF.
 */
export function enqueueCvParse(cvId: string, cvPath: string): void {
  taskRunner.enqueue({
    type: 'cv-parse',
    label: 'Analyse du CV',
    run: async () => {
      const rawText = await extractPdfText(cvPath);
      // PDF scanné (image) ou vide : on échoue clairement plutôt que d'envoyer
      // un texte vide à l'IA, qui produirait un CV inexploitable.
      if (!rawText.trim()) {
        throw new Error('PDF vide ou illisible — votre CV est-il scanné en image ?');
      }
      // M1 : tronquer pour éviter de dépasser le timeout OpenAI ou de générer
      // une facture excessive sur un PDF de très nombreuses pages.
      const text = rawText.length > MAX_CV_CHARS
        ? rawText.slice(0, MAX_CV_CHARS) + '\n[texte tronqué]'
        : rawText;
      const parsed = await parseCV(text);
      // CV-REVIEW : évaluation IA (best-effort). Si elle échoue, l'UI affiche un
      // score heuristique calculé localement → un score est toujours visible.
      const review = await reviewCv(parsed);
      await setCvParsed(cvId, review ? { ...parsed, review } : parsed);
    },
  });
}
