import argon2 from "argon2";

import { Prisma, type PrismaClient } from "@prisma/client";

import type { Role } from "../../domain/authorization/types.js";
import {
  EmailAlreadyExistsError,
  type CreateUserInput,
  type UpdateUserInput,
  type UserRepository,
  type UserSummary,
} from "../../ports/UserRepository.js";

/**
 * Adaptateur Prisma du port `UserRepository`. Le mot de passe est haché ici
 * (argon2id, recommandation OWASP) — jamais stocké ni journalisé en clair.
 */
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listUsers(tenantId: string): Promise<UserSummary[]> {
    const rows = await this.prisma.user.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
      include: { managedSectors: true },
    });
    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      role: u.role as Role,
      matricule: u.matricule,
      isActive: u.isActive,
      managedSectors: u.managedSectors.map((s) => s.codeSecteur),
    }));
  }

  async createUser(tenantId: string, input: CreateUserInput): Promise<{ id: string }> {
    const passwordHash = await hash(input.password);
    try {
      const created = await this.prisma.user.create({
        data: {
          tenantId,
          email: input.email.trim(),
          displayName: input.displayName,
          role: input.role,
          matricule: input.matricule,
          isActive: input.isActive,
          passwordHash,
          managedSectors: { create: dedupeSectors(input.managedSectors) },
        },
      });
      return { id: created.id };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new EmailAlreadyExistsError();
      }
      throw err;
    }
  }

  async updateUser(id: string, tenantId: string, input: UpdateUserInput): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findFirst({ where: { id, tenantId } });
      if (existing === null) return false;

      await tx.user.update({
        where: { id },
        data: {
          displayName: input.displayName,
          role: input.role,
          matricule: input.matricule,
          isActive: input.isActive,
          ...(input.password !== undefined ? { passwordHash: await hash(input.password) } : {}),
        },
      });
      // Rattachements secteurs : on remplace l'ensemble (simple et auditable).
      await tx.managerSector.deleteMany({ where: { userId: id } });
      const sectors = dedupeSectors(input.managedSectors);
      if (sectors.length > 0) {
        await tx.managerSector.createMany({
          data: sectors.map((s) => ({ userId: id, codeSecteur: s.codeSecteur })),
        });
      }
      return true;
    });
  }

  async deleteUser(id: string, tenantId: string): Promise<boolean> {
    // managerSectors part en cascade (onDelete: Cascade dans le schéma).
    const result = await this.prisma.user.deleteMany({ where: { id, tenantId } });
    return result.count > 0;
  }
}

function hash(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

/** Évite les doublons de secteurs (la contrainte unique [userId, codeSecteur] les refuserait). */
function dedupeSectors(sectors: string[]): { codeSecteur: string }[] {
  return [...new Set(sectors.map((s) => s.trim()).filter((s) => s !== ""))].map((codeSecteur) => ({
    codeSecteur,
  }));
}
