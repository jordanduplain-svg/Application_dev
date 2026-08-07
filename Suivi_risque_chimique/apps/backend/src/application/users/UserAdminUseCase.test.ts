import { describe, expect, it, vi } from "vitest";

import { AccessDeniedError } from "../../domain/authorization/errors.js";
import type { AuthenticatedUser } from "../../domain/authorization/types.js";
import type { AuditLogger } from "../../ports/AuditLogger.js";
import type { Clock } from "../../ports/Clock.js";
import type { UpdateUserInput, UserRepository } from "../../ports/UserRepository.js";
import { UserAdminUseCase } from "./UserAdminUseCase.js";

const clock: Clock = { now: () => new Date("2026-06-23T00:00:00Z") };
const audit: AuditLogger = { record: vi.fn(async () => undefined), list: vi.fn(async () => []) };

const admin: AuthenticatedUser = {
  id: "admin-1",
  role: "ADMIN",
  tenantId: "default",
  matricule: null,
  managedSectors: [],
};

const baseUpdate: UpdateUserInput = {
  displayName: "X",
  role: "ADMIN",
  matricule: null,
  isActive: true,
  managedSectors: [],
};

function repo(over: Partial<UserRepository> = {}): UserRepository {
  return {
    listUsers: vi.fn(async () => []),
    createUser: vi.fn(async () => ({ id: "new" })),
    updateUser: vi.fn(async () => true),
    deleteUser: vi.fn(async () => true),
    ...over,
  };
}

describe("UserAdminUseCase — garde anti-auto-verrouillage", () => {
  it("refuse à un admin de se retirer le rôle ADMIN", async () => {
    const r = repo();
    const uc = new UserAdminUseCase(r, audit, clock);
    await expect(uc.update(admin, "admin-1", { ...baseUpdate, role: "RH" })).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    expect(r.updateUser).not.toHaveBeenCalled();
  });

  it("refuse à un admin de se désactiver", async () => {
    const r = repo();
    const uc = new UserAdminUseCase(r, audit, clock);
    await expect(
      uc.update(admin, "admin-1", { ...baseUpdate, isActive: false }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("refuse à un admin de se supprimer", async () => {
    const r = repo();
    const uc = new UserAdminUseCase(r, audit, clock);
    await expect(uc.remove(admin, "admin-1")).rejects.toBeInstanceOf(AccessDeniedError);
    expect(r.deleteUser).not.toHaveBeenCalled();
  });

  it("autorise la modification d'un AUTRE compte", async () => {
    const r = repo();
    const uc = new UserAdminUseCase(r, audit, clock);
    await expect(uc.update(admin, "autre", { ...baseUpdate, role: "RH" })).resolves.toBe(true);
    expect(r.updateUser).toHaveBeenCalledOnce();
  });
});
