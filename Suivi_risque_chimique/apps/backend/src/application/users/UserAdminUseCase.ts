import { AccessDeniedError } from "../../domain/authorization/errors.js";
import type { AuthenticatedUser } from "../../domain/authorization/types.js";
import type { AuditLogger } from "../../ports/AuditLogger.js";
import type { Clock } from "../../ports/Clock.js";
import type {
  CreateUserInput,
  UpdateUserInput,
  UserRepository,
  UserSummary,
} from "../../ports/UserRepository.js";

/**
 * Cas d'usage : administration des comptes (réservé ADMIN — garde au niveau de
 * la route via canManageUsers).
 *
 * Garde-fou anti-auto-verrouillage : un administrateur ne peut pas, sur SON
 * propre compte, retirer son rôle ADMIN, se désactiver, ni se supprimer — sinon
 * une fausse manip pourrait laisser l'instance sans aucun administrateur.
 * Toute mutation est journalisée SANS PII (id technique + rôle uniquement).
 */
export class UserAdminUseCase {
  constructor(
    private readonly repository: UserRepository,
    private readonly audit: AuditLogger,
    private readonly clock: Clock,
  ) {}

  list(actor: AuthenticatedUser): Promise<UserSummary[]> {
    return this.repository.listUsers(actor.tenantId);
  }

  async create(actor: AuthenticatedUser, input: CreateUserInput): Promise<{ id: string }> {
    const created = await this.repository.createUser(actor.tenantId, input);
    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: "user_create",
      detail: { targetUserId: created.id, role: input.role },
      at: this.clock.now(),
    });
    return created;
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateUserInput,
  ): Promise<boolean> {
    if (id === actor.id && (input.role !== "ADMIN" || !input.isActive)) {
      throw new AccessDeniedError("self_lockout_interdit");
    }
    const ok = await this.repository.updateUser(id, actor.tenantId, input);
    if (ok) {
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.id,
        action: "user_update",
        detail: { targetUserId: id, role: input.role },
        at: this.clock.now(),
      });
    }
    return ok;
  }

  async remove(actor: AuthenticatedUser, id: string): Promise<boolean> {
    if (id === actor.id) {
      throw new AccessDeniedError("self_delete_interdit");
    }
    const ok = await this.repository.deleteUser(id, actor.tenantId);
    if (ok) {
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.id,
        action: "user_delete",
        detail: { targetUserId: id },
        at: this.clock.now(),
      });
    }
    return ok;
  }
}
