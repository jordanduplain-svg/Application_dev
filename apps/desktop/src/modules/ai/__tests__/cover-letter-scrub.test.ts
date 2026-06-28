import { describe, it, expect } from 'vitest';
import { scrubCoverLetterTics } from '../ai.service';

describe('scrubCoverLetterTics', () => {
  it('retire la conclusion-paraphrase « C\'est ce que je fais »', () => {
    expect(scrubCoverLetterTics('…autonomes. C\'est ce que je fais.')).toBe('…autonomes.');
    expect(scrubCoverLetterTics('…autonomes. C’est ce que je fais !')).toBe('…autonomes.');
  });

  it('retire le niveau de langue (C1/B2) en gardant la langue', () => {
    expect(scrubCoverLetterTics('Mon niveau C1 en anglais me suffit.'))
      .toBe('Mon niveau en anglais me suffit.');
    expect(scrubCoverLetterTics('un anglais C1 et du français'))
      .toBe('un anglais et du français');
    expect(scrubCoverLetterTics('Anglais (C1) sur le CV')).toBe('Anglais sur le CV');
  });

  it('remplace les anglicismes/buzzwords (stakeholders, actionnable)', () => {
    expect(scrubCoverLetterTics('faire monter les stakeholders en autonomie'))
      .toBe('faire monter les parties prenantes en autonomie');
    expect(scrubCoverLetterTics('des reportings actionnables'))
      .toBe('des reportings exploitables');
  });

  it('ne casse pas un texte sans tic', () => {
    const ok = 'Je travaille sans difficulté en anglais.';
    expect(scrubCoverLetterTics(ok)).toBe(ok);
  });
});
