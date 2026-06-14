import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CampaignService } from './campaign.service';
import { prisma } from '../../lib/prisma';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    campaign: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
  },
}));

describe('CampaignService', () => {
  let campaignService: CampaignService;

  beforeEach(() => {
    campaignService = new CampaignService();
    vi.clearAllMocks();
  });

  describe('createCampaign', () => {
    it('should create a campaign with calculated budget', async () => {
      const mockCampaign = { id: '1', name: 'Test', userId: 'user1', budget: 100 };
      (prisma.campaign.create as any).mockResolvedValue(mockCampaign);

      const result = await campaignService.createCampaign('user1', {
        name: 'Test',
        jobTitle: 'Dev',
        location: 'Paris',
        contractTypes: ['CDI'],
        prompt: 'Search devs',
        applicationQuota: 50,
      });

      expect(prisma.campaign.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
            budget: 100 // 50 * 2.0
        })
      }));
      expect(result.id).toBe('1');
    });
  });

  describe('getCampaigns', () => {
    it('should return paginated campaigns', async () => {
      (prisma.campaign.findMany as any).mockResolvedValue([{ id: '1' }]);
      (prisma.campaign.count as any).mockResolvedValue(1);

      const result = await campaignService.getCampaigns('user1', 1, 10);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });
});
