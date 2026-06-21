import { describe, test, expect, vi, beforeEach } from 'vitest';

// vi.hoisted() : les variables déclarées ici sont disponibles dans les factories
// vi.mock() qui sont hoistées en haut du fichier par vitest (avant les imports).
const { mockGroupBy, mockUpdate } = vi.hoisted(() => ({
  mockGroupBy: vi.fn(),
  mockUpdate:  vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    application: { groupBy: mockGroupBy },
    campaign:    { update: mockUpdate },
  },
}));

// @prisma/client n'est utilisé que pour le check instanceof P2025 (chemin d'erreur).
// On le stubé avec une classe vide pour satisfaire l'import.
vi.mock('@prisma/client', () => ({
  Prisma: {
    PrismaClientKnownRequestError: class extends Error {},
  },
}));

import { refreshCampaignStatus } from '../campaign.service';

describe('refreshCampaignStatus', () => {
  beforeEach(() => {
    mockGroupBy.mockReset();
    mockUpdate.mockReset().mockResolvedValue({});
  });

  // Test 9 : campagne COMPLETED
  test('passe en COMPLETED quand toutes les candidatures sont en état terminal positif', async () => {
    // Scénario : 3 SENT, 2 REPLIED, 0 en attente → COMPLETED.
    mockGroupBy.mockResolvedValue([
      { status: 'SENT',    _count: { _all: 3 } },
      { status: 'REPLIED', _count: { _all: 2 } },
    ]);

    await refreshCampaignStatus('camp-001');

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'camp-001' },
      data:  { status: 'COMPLETED' },
    });
  });

  // Test 10 : campagne RUNNING
  test('reste RUNNING quand des candidatures sont encore en attente (DRAFT)', async () => {
    // Scénario : 2 SENT + 3 DRAFT encore à envoyer → pas encore terminé.
    mockGroupBy.mockResolvedValue([
      { status: 'SENT',  _count: { _all: 2 } },
      { status: 'DRAFT', _count: { _all: 3 } },
    ]);

    await refreshCampaignStatus('camp-002');

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'camp-002' },
      data:  { status: 'RUNNING' },
    });
  });
});
