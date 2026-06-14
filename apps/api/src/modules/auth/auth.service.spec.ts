import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from './auth.service';
import { prisma } from '../../lib/prisma';
import bcrypt from 'bcryptjs';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    refreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(),
    compare: vi.fn(),
  },
}));

describe('AuthService', () => {
  let authService: AuthService;

  beforeEach(() => {
    authService = new AuthService(); // No constructor param in actual class
    vi.clearAllMocks();
  });

  describe('register', () => {
    it('should create a new user', async () => {
      const mockUser = { id: '1', email: 'test@example.com', passwordHash: 'hashed' };
      (prisma.user.findUnique as any).mockResolvedValue(null);
      (bcrypt.hash as any).mockResolvedValue('hashed');
      (prisma.user.create as any).mockResolvedValue(mockUser);

      const result = await authService.register({
        email: 'test@example.com',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe',
        acceptTos: true,
      });

      expect(prisma.user.create).toHaveBeenCalled();
      expect(result.email).toBe('test@example.com');
    });

    it('should throw error if user exists', async () => {
      (prisma.user.findUnique as any).mockResolvedValue({ id: '1' });

      await expect(authService.register({
        email: 'test@example.com',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe',
        acceptTos: true,
      })).rejects.toThrow('Email already in use');
    });
  });

  describe('login', () => {
    it('should return user for valid credentials', async () => {
      const mockUser = { id: '1', email: 'test@example.com', passwordHash: 'hashed' };
      (prisma.user.findUnique as any).mockResolvedValue(mockUser);
      (bcrypt.compare as any).mockResolvedValue(true);

      const result = await authService.login({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.id).toBe('1');
    });

    it('should throw error for invalid credentials', async () => {
      (prisma.user.findUnique as any).mockResolvedValue(null);

      await expect(authService.login({
        email: 'test@example.com',
        password: 'password123',
      })).rejects.toThrow('Invalid credentials');
    });
  });
});
