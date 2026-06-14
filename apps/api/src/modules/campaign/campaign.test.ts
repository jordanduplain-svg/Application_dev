import { test, describe, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { app, buildServer } from '../../server';
import { prisma } from '../../lib/prisma';

let accessToken = '';

beforeAll(async () => {
  await buildServer();
});

beforeEach(async () => {
  // La BDD est purgée par vitest.setup.ts (TRUNCATE CASCADE) avant chaque test
  // On crée un utilisateur frais pour obtenir un token valide
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: 'campaign-tester@test.com', password: 'Password123!', firstName: 'Test', lastName: 'Utilisateur', acceptTos: true }
  });
  accessToken = res.json().accessToken;
});

afterAll(async () => {
  await app.close();
});

describe('Campagnes CRUD (CampaignRoutes)', () => {
  
  const createValidPayload = () => ({
    name: 'Job remote devs',
    prompt: 'Recherche les entreprises tech full remote',
    jobTitle: 'Développeur Fullstack',
    location: 'France, Remote',
    contractTypes: ['CDI', 'Freelance'],
    applicationQuota: 50,
  });

  test('POST /api/campaigns — données valides (201)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/campaigns',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: createValidPayload()
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe('Job remote devs');
    // Le budget doit être calculé sécuritairement (50 * 2.0 = 100)
    expect(Number(res.json().budget)).toBe(100); 
    expect(res.json().status).toBe('PENDING');
  });

  test('GET /api/campaigns — lister les campagnes (200)', async () => {
    // Inject first state
    await app.inject({ method: 'POST', url: '/api/campaigns', headers: { Authorization: `Bearer ${accessToken}` }, payload: createValidPayload() });

    const res = await app.inject({
      method: 'GET',
      url: '/api/campaigns',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
    expect(res.json().data.length).toBeGreaterThan(0);
  });

  test('GET /api/campaigns/:id — détails campagne (200)', async () => {
    const postRes = await app.inject({ method: 'POST', url: '/api/campaigns', headers: { Authorization: `Bearer ${accessToken}` }, payload: createValidPayload() });
    const createdCampaignId = postRes.json().id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/campaigns/${createdCampaignId}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(createdCampaignId);
    expect(res.json().name).toBe('Job remote devs');
  });

  test('PATCH /api/campaigns/:id — mise à jour quota (200)', async () => {
    const postRes = await app.inject({ method: 'POST', url: '/api/campaigns', headers: { Authorization: `Bearer ${accessToken}` }, payload: createValidPayload() });
    const createdCampaignId = postRes.json().id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${createdCampaignId}`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { applicationQuota: 100 }
    });
    
    expect(res.statusCode).toBe(200);
    // Vérification de la republication du budget : 100 * 2.0 = 200
    expect(Number(res.json().budget)).toBe(200); 
  });

  test('DELETE /api/campaigns/:id — suppression (204)', async () => {
    const postRes = await app.inject({ method: 'POST', url: '/api/campaigns', headers: { Authorization: `Bearer ${accessToken}` }, payload: createValidPayload() });
    const createdCampaignId = postRes.json().id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/campaigns/${createdCampaignId}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(204);
  });
});
