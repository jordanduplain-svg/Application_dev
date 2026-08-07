import type { PrismaClient } from "@prisma/client";

import type { SecretCipher } from "../crypto/secretCipher.js";
import type { SecretVault } from "../../ports/SecretVault.js";

/**
 * Coffre à secrets sur PostgreSQL : le secret est chiffré (SecretCipher) avant
 * écriture et déchiffré à la lecture. La base ne contient que du chiffré.
 */
export class PrismaSecretVault implements SecretVault {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cipher: SecretCipher,
  ) {}

  async put(tenantId: string, ref: string, plaintext: string): Promise<void> {
    const ciphertext = this.cipher.encrypt(plaintext);
    await this.prisma.connectorSecret.upsert({
      where: { tenantId_ref: { tenantId, ref } },
      create: { tenantId, ref, ciphertext },
      update: { ciphertext },
    });
  }

  async get(tenantId: string, ref: string): Promise<string | null> {
    const row = await this.prisma.connectorSecret.findUnique({
      where: { tenantId_ref: { tenantId, ref } },
    });
    return row !== null ? this.cipher.decrypt(row.ciphertext) : null;
  }

  async remove(tenantId: string, ref: string): Promise<void> {
    await this.prisma.connectorSecret.deleteMany({ where: { tenantId, ref } });
  }
}
