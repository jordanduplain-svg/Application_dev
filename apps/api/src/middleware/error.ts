import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

/**
 * Rôle : Erreurs applicatives typées + gestionnaire d'erreurs global.
 *
 * Toutes les routes peuvent `throw` une de ces erreurs : le gestionnaire
 * `errorHandler` (branché dans server.ts) les convertit en réponse HTTP
 * cohérente, au format `{ error: '...' }`.
 */

/** Erreur applicative de base : porte un code HTTP et un message. */
export class AppError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = this.constructor.name;
    // Conserve une stack trace propre (sans le constructeur AppError lui-même).
    Error.captureStackTrace(this, this.constructor);
  }
}

/** 404 — ressource introuvable. */
export class NotFoundError extends AppError {
  constructor(message = 'Not Found') {
    super(404, message);
  }
}

/** 409 — conflit (ex : email déjà utilisé). */
export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(409, message);
  }
}

/** 400 — requête invalide. */
export class BadRequestError extends AppError {
  constructor(message = 'Bad Request') {
    super(400, message);
  }
}

/** 401 — non authentifié / token invalide. */
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, message);
  }
}

/**
 * Gestionnaire d'erreurs global de Fastify.
 * Traduit chaque type d'erreur en réponse HTTP appropriée.
 */
export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  // Erreur de validation Zod → 400 avec le détail des champs invalides.
  if (error instanceof ZodError || error.name === 'ZodError') {
    return reply.status(400).send({
      error: 'Validation Error',
      details: (error as any).errors || (error as any).issues,
    });
  }

  // Erreur applicative connue → on utilise son statut et son message.
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      error: error.message,
    });
  }

  // Autre erreur portant un statut (ex : erreurs internes de plugins Fastify).
  if (error.statusCode) {
    return reply.status(error.statusCode).send({
      error: error.message,
    });
  }

  // Erreur inattendue → on journalise et on renvoie un 500 générique
  // (sans exposer de détails internes au client).
  request.log.error(error);
  return reply.status(500).send({
    error: 'Internal Server Error',
  });
}
