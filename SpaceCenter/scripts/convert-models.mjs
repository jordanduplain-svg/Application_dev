// Conversion unique OBJ → GLB des modèles Quaternius référencés par buildings.json.
// Usage : node scripts/convert-models.mjs
import obj2gltf from 'obj2gltf';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const PACK = 'Ultimate Modular Sci-Fi - Feb 2021-20260710T190326Z-2-001';
const OUT = 'public/models';

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const objByName = new Map();
for await (const p of walk(PACK)) {
  if (p.toLowerCase().endsWith('.obj')) objByName.set(basename(p, '.obj'), p);
}

const buildings = JSON.parse(await readFile('src/data/buildings.json', 'utf8')).buildings;
const wanted = buildings
  .map((b) => b.model)
  .filter((m) => m && m.endsWith('.glb')) // les .gltf sont copiés tels quels, pas convertis
  .map((m) => basename(m, '.glb'));

await mkdir(OUT, { recursive: true });
for (const name of wanted) {
  const src = objByName.get(name);
  if (!src) {
    console.error(`INTROUVABLE : ${name}`);
    process.exitCode = 1;
    continue;
  }
  const glb = await obj2gltf(src, { binary: true });
  await writeFile(join(OUT, `${name}.glb`), Buffer.from(glb));
  console.log(`OK ${name}`);
}
