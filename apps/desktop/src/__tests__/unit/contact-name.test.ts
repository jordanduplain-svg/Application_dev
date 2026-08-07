/**
 * Garde anti « Bonjour Monsieur Responsable » : le nom de contact issu du scraper
 * ne doit jamais atteindre l'IA s'il n'est pas un vrai nom de personne.
 * Les cas rejetés viennent de la base réelle (colonne Company.contactName).
 */
import { describe, test, expect } from 'vitest';
import { cleanContactName } from '../../lib/contact-name';

describe('cleanContactName', () => {
  test('laisse passer un vrai nom', () => {
    expect(cleanContactName('Pierre-Jean Genin')).toBe('Pierre-Jean Genin');
    expect(cleanContactName('Emmanuel Bertrand')).toBe('Emmanuel Bertrand');
    expect(cleanContactName('Yvonne Cvilak')).toBe('Yvonne Cvilak');
  });

  test('rejette un titre déguisé en nom (le bug MF2I)', () => {
    expect(cleanContactName('Antoine Responsable')).toBeNull();
    expect(cleanContactName('Our CEO')).toBeNull();
    expect(cleanContactName('Call Desk')).toBeNull();
  });

  test('rejette les artefacts techniques et la navigation de page', () => {
    expect(cleanContactName('None None')).toBeNull();
    expect(cleanContactName('About Us')).toBeNull();
    expect(cleanContactName('Page Not Found')).toBeNull();
    expect(cleanContactName('Devis Toggle')).toBeNull();
    expect(cleanContactName('English Deutsch Linkedin')).toBeNull();
  });

  test('rejette le vide, les chiffres, les URLs et les phrases', () => {
    expect(cleanContactName(null)).toBeNull();
    expect(cleanContactName('')).toBeNull();
    expect(cleanContactName('   ')).toBeNull();
    expect(cleanContactName('Dupont')).toBeNull();            // un seul token = ambigu
    expect(cleanContactName('contact@acme.fr')).toBeNull();
    expect(cleanContactName('Service 360')).toBeNull();
    expect(cleanContactName('Private Area Configurateur Colocation Programmer')).toBeNull();
  });
});
