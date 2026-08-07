// ESLint flat config — protège la règle de dépendance de l'architecture hexagonale.
// La règle `boundaries/element-types` est ce qui rend mécaniquement impossible
// qu'un fichier du domaine importe de l'infrastructure : si quelqu'un essaie,
// le lint échoue et la CI bloque.

import boundaries from "eslint-plugin-boundaries";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        { type: "domain", pattern: "src/domain/**" },
        { type: "application", pattern: "src/application/**" },
        { type: "ports", pattern: "src/ports/**" },
        { type: "infrastructure", pattern: "src/infrastructure/**" },
        { type: "interface", pattern: "src/interface/**" },
        { type: "config", pattern: "src/config/**" },
        { type: "shared", pattern: "src/shared/**" },
      ],
    },
    rules: {
      // Règle de dépendance : extérieur → intérieur.
      // - domain ne dépend de rien d'autre que de lui-même (pur)
      // - application dépend du domain et des ports
      // - ports ne dépendent de rien (interfaces seules)
      // - infrastructure peut dépendre des ports (pour les implémenter), du domain (entités/value objects) et de l'application si exposé
      // - interface (HTTP) dépend de l'application et des ports/infrastructure pour câbler
      // - config est utilisable partout en bout de chaîne
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            { from: "domain", allow: ["domain", "shared"] },
            { from: "application", allow: ["domain", "application", "ports", "shared"] },
            { from: "ports", allow: ["domain", "ports", "shared"] },
            {
              from: "infrastructure",
              allow: ["domain", "ports", "infrastructure", "config", "shared"],
            },
            {
              from: "interface",
              allow: [
                "domain",
                "application",
                "ports",
                "infrastructure",
                "interface",
                "config",
                "shared",
              ],
            },
            { from: "config", allow: ["config", "shared"] },
            { from: "shared", allow: ["shared"] },
          ],
        },
      ],
    },
  },
);
