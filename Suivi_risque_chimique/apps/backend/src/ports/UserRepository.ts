import type { Role } from "../domain/authorization/types.js";

/**
 * Port `UserRepository` — gestion des comptes applicatifs et de leurs
 * rattachements (rôle, matricule, secteurs gérés par un manager).
 *
 * Le hachage du mot de passe (argon2id) est une responsabilité de
 * l'adaptateur : le domaine/l'application ne manipulent JAMAIS de hash ni de
 * mot de passe en clair au-delà de l'entrée de création/édition.
 */
export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  matricule: string | null;
  isActive: boolean;
  /** Secteurs supervisés (pertinent pour le rôle MANAGER). */
  managedSectors: string[];
}

export interface CreateUserInput {
  email: string;
  displayName: string;
  role: Role;
  matricule: string | null;
  password: string;
  isActive: boolean;
  managedSectors: string[];
}

export interface UpdateUserInput {
  displayName: string;
  role: Role;
  matricule: string | null;
  isActive: boolean;
  managedSectors: string[];
  /** Nouveau mot de passe, ou `undefined` pour conserver l'actuel. */
  password?: string;
}

/** L'email est déjà pris dans ce tenant (contrainte unique). */
export class EmailAlreadyExistsError extends Error {
  constructor() {
    super("Un compte utilise déjà cette adresse email.");
    this.name = "EmailAlreadyExistsError";
  }
}

export interface UserRepository {
  listUsers(tenantId: string): Promise<UserSummary[]>;
  /** Crée un compte. Lève `EmailAlreadyExistsError` si l'email est pris. */
  createUser(tenantId: string, input: CreateUserInput): Promise<{ id: string }>;
  /** Met à jour un compte ; false s'il n'existe pas dans ce tenant. */
  updateUser(id: string, tenantId: string, input: UpdateUserInput): Promise<boolean>;
  /** Supprime un compte ; false s'il n'existe pas dans ce tenant. */
  deleteUser(id: string, tenantId: string): Promise<boolean>;
}
