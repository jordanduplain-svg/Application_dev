/**
 * Validation du nom de contact avant de le donner à l'IA.
 *
 * POURQUOI : l'extracteur de recruteurs du scraper ramène du bruit de page web —
 * « Antoine Responsable », « None None », « About Us », « Page Not Found »,
 * « Mario Kart ». La consigne de salutation (« Bonjour Monsieur [Nom] ») produit
 * alors « Bonjour Monsieur Responsable » dans un vrai mail envoyé à un recruteur.
 *
 * Règle : au moindre doute on renvoie null → le prompt salue « Bonjour, » seul,
 * ce qui est TOUJOURS correct. Un faux négatif coûte une salutation générique ;
 * un faux positif coûte une candidature grillée.
 */

// Mots qui ne sont JAMAIS un nom de famille : titres/fonctions, navigation de site,
// artefacts techniques. Comparés sans accents ni casse, token par token.
const NOT_A_NAME = new Set([
  // fonctions / titres
  'responsable', 'directeur', 'directrice', 'president', 'presidente', 'gerant', 'gerante',
  'manager', 'chef', 'chief', 'ceo', 'cto', 'cfo', 'coo', 'rh', 'drh', 'recruteur', 'recruteuse',
  'contact', 'service', 'equipe', 'team', 'staff', 'direction', 'bureau', 'siege',
  'monsieur', 'madame', 'mr', 'mme', 'dr', 'prof',
  // navigation / contenu de page
  'about', 'us', 'home', 'accueil', 'page', 'not', 'found', 'error', 'menu', 'login',
  'sign', 'signin', 'signup', 'register', 'search', 'cookie', 'cookies', 'privacy',
  'legal', 'mentions', 'cgv', 'cgu', 'newsletter', 'blog', 'news', 'actualites',
  'resources', 'resource', 'learn', 'more', 'read', 'click', 'here', 'toggle', 'open',
  'close', 'next', 'previous', 'testimonials', 'pricing', 'tarifs', 'devis', 'profile',
  'linkedin', 'facebook', 'twitter', 'instagram', 'youtube', 'english', 'francais',
  'deutsch', 'espanol', 'italiano', 'contactez', 'nous', 'notre', 'nos', 'votre',
  // vocabulaire de service / support (structurellement identique à un nom :
  // « Call Desk », « Drive Cost » — seul le lexique les distingue)
  'call', 'desk', 'help', 'helpdesk', 'support', 'sales', 'info', 'infos', 'admin',
  'office', 'hello', 'welcome', 'customer', 'customers', 'client', 'clients',
  'drive', 'cost', 'costs', 'solutions', 'solution', 'services', 'group', 'groupe',
  'company', 'societe', 'agence', 'agency', 'contacts', 'mail', 'email', 'phone', 'tel',
  // artefacts techniques
  'none', 'null', 'undefined', 'nan', 'true', 'false', 'test', 'lorem', 'ipsum',
]);

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Renvoie le nom de contact s'il ressemble VRAIMENT à un nom de personne, sinon null.
 * ponytail: liste de mots-clés + heuristiques de forme ; pas de NER — un modèle de
 * noms propres serait disproportionné pour une garde dont l'échec coûte « Bonjour, ».
 */
export function cleanContactName(raw: string | null | undefined): string | null {
  const name = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return null;

  // Longueur plausible d'un nom humain.
  if (name.length < 3 || name.length > 60) return null;

  // Un vrai nom n'a ni chiffre, ni @, ni URL, ni ponctuation exotique.
  if (/[0-9@/\\|<>{}[\]()*#_=+$%^~`]/.test(name)) return null;

  const tokens = name.split(/[\s'-]+/).filter(Boolean);
  // Prénom + nom (2 à 4 tokens). Un token seul est ambigu (« Contact », « Dupont ») ;
  // au-delà de 4, c'est une phrase récupérée d'une page, pas un nom.
  if (tokens.length < 2 || tokens.length > 4) return null;

  // UN SEUL token interdit suffit à rejeter : « Antoine Responsable » est aussi
  // faux que « None None » — on ne peut pas savoir quelle moitié est le vrai nom.
  for (const t of tokens) {
    if (NOT_A_NAME.has(norm(t))) return null;
  }

  // Chaque token doit être alphabétique (accents/tirets admis) et commencer par une
  // majuscule — « bonjour ceci est un test » ou du texte en capitales ne passent pas.
  for (const t of tokens) {
    if (!/^[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ]+$/.test(t)) return null;
  }

  return name;
}
