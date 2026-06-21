/**
 * Seed de test : rattache 10 entreprises RÉELLES (scrapées, depuis le master
 * candio_leads.csv) à la campagne « Campagne Data Test », en ne gardant que des
 * leads ayant À LA FOIS une fiche entreprise ET une fiche actualité.
 *
 * Tous les emails sont remplacés par du +addressing Gmail
 * (jordantestcandio+slug@gmail.com) → ils arrivent TOUS dans la boîte
 * jordantestcandio@gmail.com, mais restent uniques en base
 * (contrainte @@unique([campaignId, contactEmail])).
 *
 * Lancer depuis apps/desktop :  node ../../scripts/seed-datatest.cjs
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const MASTER_CSV = path.resolve(__dirname, 'data', 'candio_leads.csv');
const TEST_INBOX = 'jordantestcandio';
const NEWS_MARKER = 'Actualités récentes';

function parseCsv(content) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (q) {
      if (ch === '"') { if (content[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === ',') { row.push(f); f = ''; }
      else if (ch === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else if (ch === '\r') { /* skip */ }
      else f += ch;
    }
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'lead';

async function main() {
  const rows = parseCsv(fs.readFileSync(MASTER_CSV, 'utf8'));
  const h = rows[0].map((x) => x.trim().toLowerCase());
  const ci = (n) => h.indexOf(n.toLowerCase());
  const I = {
    name: ci('name'), email: ci('contactemail'), website: ci('website'),
    contactName: ci('contactname'), contactRole: ci('contactrole'),
    region: ci('region'), country: ci('country'), regionAdmin: ci('regionadmin'),
    dept: ci('dept'), deptName: ci('deptname'), city: ci('city'),
    activityDomain: ci('activitydomain'), sector: ci('sector'),
    desc: ci('companydescription'), companySize: ci('companysize'),
    companySizeBucket: ci('companysizebucket'),
  };
  const at = (r, i) => (i >= 0 ? (r[i] ?? '').trim() : '');
  const isEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

  // On ne retient que les leads avec email valide + fiche entreprise + fiche actu.
  const candidates = rows.slice(1)
    .map((r) => ({
      name: at(r, I.name), email: at(r, I.email), website: at(r, I.website),
      contactName: at(r, I.contactName), contactRole: at(r, I.contactRole),
      region: at(r, I.region), country: at(r, I.country), regionAdmin: at(r, I.regionAdmin),
      dept: at(r, I.dept), deptName: at(r, I.deptName), city: at(r, I.city),
      activityDomain: at(r, I.activityDomain), sector: at(r, I.sector),
      description: at(r, I.desc), companySize: at(r, I.companySize),
      companySizeBucket: at(r, I.companySizeBucket),
    }))
    .filter((c) => c.name && isEmail(c.email) && c.description && c.description.includes(NEWS_MARKER));

  const picked = candidates.slice(0, 10);
  if (picked.length < 10) {
    console.warn(`Attention : seulement ${picked.length} leads avec fiche entreprise + actu trouvés.`);
  }

  const dbPath = path.join(process.env.APPDATA, 'desktop', 'carreerops.db');
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });

  const campaign = await prisma.campaign.findFirst({ where: { name: 'Campagne Data Test' } });
  if (!campaign) { console.error('Campagne « Campagne Data Test » introuvable.'); process.exit(1); }

  // On repart d'une campagne propre : on retire les entreprises précédentes
  // (les 10 fictives notamment), sauf celles ayant déjà une candidature.
  const del = await prisma.company.deleteMany({
    where: { campaignId: campaign.id, application: null },
  });
  console.log(`Entreprises retirées (sans candidature) : ${del.count}`);

  let added = 0;
  const seen = new Set();
  for (const c of picked) {
    let slug = slugify(c.name);
    while (seen.has(slug)) slug += 'x';
    seen.add(slug);
    try {
      await prisma.company.create({
        data: {
          campaignId: campaign.id,
          name: c.name,
          website: c.website || null,
          contactEmail: `${TEST_INBOX}+${slug}@gmail.com`, // TEST : tout arrive sur jordantestcandio@gmail.com
          contactName: c.contactName || null,
          contactRole: c.contactRole || null,
          emailSource: 'manual',
          region: c.region || null,
          country: c.country || null,
          regionAdmin: c.regionAdmin || null,
          dept: c.dept || null,
          deptName: c.deptName || null,
          city: c.city || null,
          activityDomain: c.activityDomain || null,
          sector: c.sector || null,
          description: c.description || null, // fiche entreprise + 📰 fiche actualité
          companySize: c.companySize || null,
          companySizeBucket: c.companySizeBucket || null,
        },
      });
      added++;
      console.log(`+ ${c.name}  →  ${TEST_INBOX}+${slug}@gmail.com`);
    } catch (e) {
      if (e.code === 'P2002') { console.log(`= ${c.name} déjà présente, ignorée`); continue; }
      throw e;
    }
  }

  const total = await prisma.company.count({ where: { campaignId: campaign.id } });
  console.log(`\nAjoutées : ${added} | total dans la campagne : ${total}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
