import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../lib/prisma';
import nodemailer from 'nodemailer';

/**
 * Tests unitaires de la logique d'envoi d'email (`processSendEmailJob`).
 *
 * On mocke `bullmq` et `ioredis` : importer le module du worker instancie
 * un `new Worker(...)` qui, sans ces mocks, tenterait de se connecter à Redis.
 */
vi.mock('bullmq', () => ({
  Worker: vi.fn(),
  Job: vi.fn(),
}));

vi.mock('ioredis', () => ({
  default: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    application: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// `processSendEmailJob` délègue la complétion de campagne à
// `maybeCompleteCampaign` (qui touche d'autres tables + la facturation). Pour
// un VRAI test unitaire isolé, on remplace cette dépendance par un stub.
vi.mock('../lib/campaign-status', () => ({
  maybeCompleteCampaign: vi.fn(),
}));

const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'test-id' });
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: sendMailMock })),
  },
}));

vi.mock('../lib/crypto', () => ({
  decryptSymmetric: vi.fn().mockReturnValue('decrypted-password'),
}));

import { processSendEmailJob } from './smtp-sender.worker';

// Construit un faux job BullMQ minimal.
const makeJob = (applicationId: string) => ({ data: { applicationId } }) as any;

describe('processSendEmailJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('envoie l\'email et marque la candidature SENT quand la config SMTP existe', async () => {
    (prisma.application.findUnique as any).mockResolvedValue({
      id: 'app-1',
      contactEmail: 'target@example.com',
      subject: 'Hello',
      body: 'World',
      campaign: {
        user: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@doe.com',
          emailSender: null,
          smtpConfig: { host: 'smtp.example.com', port: 587, user: 'u', pass: 'enc' },
        },
      },
    });

    await processSendEmailJob(makeJob('app-1'));

    expect(nodemailer.createTransport).toHaveBeenCalled();
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'target@example.com', subject: 'Hello' })
    );
    // Dernière mise à jour : statut SENT.
    expect(prisma.application.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SENT' }) })
    );
  });

  it('marque la candidature FAILED si l\'utilisateur n\'a pas de config SMTP', async () => {
    (prisma.application.findUnique as any).mockResolvedValue({
      id: 'app-2',
      campaign: { user: { smtpConfig: null } },
    });

    await processSendEmailJob(makeJob('app-2'));

    expect(sendMailMock).not.toHaveBeenCalled();
    expect(prisma.application.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', errorMessage: 'SMTP not configured' }),
      })
    );
  });

  it('lève une erreur si la candidature est introuvable', async () => {
    (prisma.application.findUnique as any).mockResolvedValue(null);

    await expect(processSendEmailJob(makeJob('unknown'))).rejects.toThrow(
      'Application not found'
    );
  });
});
