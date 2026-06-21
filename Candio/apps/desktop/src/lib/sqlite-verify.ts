import { open } from 'fs/promises';

/** Vérifie qu'un fichier est une base SQLite valide (signature binaire). */
export async function assertValidSqliteFile(path: string): Promise<void> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(16);
    await fh.read(buf, 0, 16, 0);
    if (!buf.toString('utf8', 0, 15).startsWith('SQLite format 3')) {
      throw new Error('Le fichier sélectionné n\'est pas une base SQLite valide.');
    }
  } finally {
    await fh.close();
  }
}
