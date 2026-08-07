import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createSecretCipher } from "./secretCipher.js";

const key = randomBytes(32).toString("base64");

describe("secretCipher", () => {
  it("chiffre puis déchiffre (round-trip)", () => {
    const c = createSecretCipher(key);
    const secret = "postgresql://user:p@ss@host:5432/db";
    expect(c.decrypt(c.encrypt(secret))).toBe(secret);
  });

  it("produit un chiffré différent à chaque fois (IV aléatoire)", () => {
    const c = createSecretCipher(key);
    expect(c.encrypt("x")).not.toBe(c.encrypt("x"));
  });

  it("détecte une altération (GCM)", () => {
    const c = createSecretCipher(key);
    const payload = Buffer.from(c.encrypt("secret"), "base64");
    const last = payload.length - 1;
    payload[last] = (payload[last] ?? 0) ^ 0xff; // on corrompt le dernier octet
    expect(() => c.decrypt(payload.toString("base64"))).toThrow();
  });

  it("refuse une clé de mauvaise taille", () => {
    expect(() => createSecretCipher(Buffer.from("trop court").toString("base64"))).toThrow();
  });

  it("ne déchiffre pas avec une autre clé", () => {
    const enc = createSecretCipher(key).encrypt("secret");
    const other = createSecretCipher(randomBytes(32).toString("base64"));
    expect(() => other.decrypt(enc)).toThrow();
  });
});
