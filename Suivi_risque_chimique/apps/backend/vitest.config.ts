import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Les tests d'intégration partagent UNE base Postgres de dev. Les exécuter
    // en parallèle crée des contentions (lectures/écritures concurrentes sur le
    // même serveur). On sérialise les fichiers : la suite reste rapide (~3 s) et
    // surtout déterministe. Les tests unitaires purs n'en pâtissent pas.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/domain/**/*.ts", "src/application/**/*.ts"],
    },
  },
});
