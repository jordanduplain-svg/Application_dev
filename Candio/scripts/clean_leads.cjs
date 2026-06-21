/**
 * B2 (curaté) : supprime du master CSV les leads dont le domaine est, à coup sûr,
 * une AUTRE entité connue (homonyme). Liste explicite vérifiée à la main — pas
 * d'heuristique (qui sur-supprimait les domaines en acronyme légitimes).
 * Sauvegarde candio_leads.csv → .bak avant écriture. Lancer : node scripts/clean_leads.cjs
 */
const fs = require('fs');
const path = require('path');
const CSV = path.resolve(__dirname, 'data', 'candio_leads.csv');

function parse(c) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    if (q) { if (ch === '"') { if (c[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else { if (ch === '"') q = true; else if (ch === ',') { row.push(f); f = ''; } else if (ch === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (ch === '\r') { /* */ } else f += ch; }
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const quote = (v) => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };

// Domaines = autre entité connue, vérifiés à la main.
const DELETE = new Set([
  'SILICON STORE',                  // svb.com = Silicon Valley Bank
  '3 C S I',                        // csis.org = think tank US
  'E S R',                          // esri.com = géant SIG
  'ASCO INDUSTRIES',                // asco.org = société d'oncologie
  'MEDIA DES MASSIFS FRANCAIS',     // media.net = régie publicitaire
  'PARADIGME (PARADIGME)',          // paradigm.com = fonds crypto US
  'GIE AGORA',                      // agora.io = SDK vidéo US/Chine
  'ITER',                           // itero.com = dentaire
  'ALMA',                           // helloalma.com = santé US
]);

const rows = parse(fs.readFileSync(CSV, 'utf8'));
const head = rows[0], iName = head.map((h) => h.trim().toLowerCase()).indexOf('name');
const data = rows.slice(1);
const removed = [], keep = [];
for (const r of data) {
  if (DELETE.has((r[iName] || '').trim())) removed.push((r[iName] || '').trim());
  else keep.push(r);
}
fs.copyFileSync(CSV, CSV + '.bak');
fs.writeFileSync(CSV, [head, ...keep].map((r) => r.map(quote).join(',')).join('\n') + '\n', 'utf8');
console.log('Supprimés:', removed.length, '→', removed.join(', '));
console.log('Restants:', keep.length, '| Backup:', CSV + '.bak');
