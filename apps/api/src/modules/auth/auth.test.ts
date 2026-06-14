import { test, describe, expect, beforeAll, afterAll } from 'vitest';
import { app, buildServer } from '../../server';
import { prisma } from '../../lib/prisma';

beforeAll(async () => {
  await buildServer();
});

afterAll(async () => {
  await app.close();
});

describe('Authentification et Profil (AuthRoutes)', () => {
  test('POST /auth/register — données valides (201)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'valid@test.com', password: 'Password123!', firstName: 'Alice', lastName: 'Benoit', acceptTos: true }
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().accessToken).toBeDefined();
    expect(res.json().user.email).toBe('valid@test.com');
  });

  test('POST /auth/register — email déjà existant (409)', async () => {
    await prisma.user.create({ data: { email: 'exist@test.com', passwordHash: 'hash', firstName: 'Alice', lastName: 'Benoit' }});
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'exist@test.com', password: 'Password123!', firstName: 'Alice', lastName: 'Benoit', acceptTos: true }
    });
    expect(res.statusCode).toBe(409);
  });

  test('POST /auth/register — email malformé (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'bad-email', password: 'Password123!', firstName: 'Alice', lastName: 'Benoit', acceptTos: true }
    });
    expect(res.statusCode).toBe(400);
  });

  test('POST /auth/register — mot de passe trop court (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'short@test.com', password: '123', firstName: 'Alice', lastName: 'Benoit', acceptTos: true }
    });
    expect(res.statusCode).toBe(400);
  });

  test('POST /auth/login — bon mot de passe (200)', async () => {
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'login@test.com', password: 'Password123!', firstName: 'Alice', lastName: 'Benoit', acceptTos: true }});
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'login@test.com', password: 'Password123!' }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accessToken).toBeDefined();
  });

  test('POST /auth/login — mauvais mot de passe (401)', async () => {
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'wrong@test.com', password: 'Password123!', firstName: 'Alice', lastName: 'Benoit', acceptTos: true }});
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'wrong@test.com', password: 'Bad' }
    });
    expect(res.statusCode).toBe(401);
  });

  test('POST /auth/login — email inexistant (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ghost@test.com', password: 'Bad' }
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Invalid credentials'); // Same message as bad password
  });

  test('GET /api/me — sans token (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
  });

  test('GET /api/me — avec token valide (200)', async () => {
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'me@test.com', password: 'Password123!', firstName: 'Alice', lastName: 'Benoit', acceptTos: true }});
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { Authorization: `Bearer ${reg.json().accessToken}` }
    });
    expect(res.statusCode).toBe(200);
  });

  test('POST /auth/refresh — invalide (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { refreshToken: 'invalid-token' }
    });
    expect(res.statusCode).toBe(401);
  });

  test('POST /auth/logout (200)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(res.statusCode).toBe(200);
  });
});
