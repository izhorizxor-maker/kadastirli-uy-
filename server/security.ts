import crypto from 'node:crypto';
import type { AuthUser } from '../src/types.ts';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(keyHex, 'hex');
  if (derivedBuf.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derivedBuf, storedBuf);
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export interface ScopeFilter {
  sql: string;
  params: (number | string)[];
}

/**
 * Enforces strict server-side regional isolation (TZ Section 3 & 4 & 16):
 * - Admin: full access (or scoped viloyat if set)
 * - Inspector: restricted strictly to assigned tuman_id (and/or mahalla_id if specified)
 * - Mahalla rep: restricted strictly to assigned mahalla_id
 */
export function buildPropertyScopeClause(user: AuthUser, tableAlias = 'p'): ScopeFilter {
  const prefix = tableAlias ? `${tableAlias}.` : '';
  if (user.role === 'admin') {
    if (user.viloyat_id) {
      return { sql: `${prefix}viloyat_id = ?`, params: [user.viloyat_id] };
    }
    return { sql: '1 = 1', params: [] };
  }

  if (user.role === 'inspector') {
    if (user.mahalla_id) {
      return { sql: `${prefix}mahalla_id = ?`, params: [user.mahalla_id] };
    }
    if (user.tuman_id) {
      return { sql: `${prefix}tuman_id = ?`, params: [user.tuman_id] };
    }
    return { sql: '1 = 0', params: [] };
  }

  if (user.role === 'mahalla') {
    if (user.mahalla_id) {
      return { sql: `${prefix}mahalla_id = ?`, params: [user.mahalla_id] };
    }
    return { sql: '1 = 0', params: [] };
  }

  return { sql: '1 = 0', params: [] };
}

export function canUserAccessRegion(
  user: AuthUser,
  target: { viloyat_id?: number | null; tuman_id?: number | null; mahalla_id?: number | null }
): boolean {
  if (user.role === 'admin') {
    if (user.viloyat_id && target.viloyat_id && user.viloyat_id !== target.viloyat_id) {
      return false;
    }
    return true;
  }

  if (user.role === 'inspector') {
    if (!user.tuman_id) return false;
    if (target.tuman_id !== user.tuman_id) return false;
    if (user.mahalla_id && target.mahalla_id && user.mahalla_id !== target.mahalla_id) {
      return false;
    }
    return true;
  }

  if (user.role === 'mahalla') {
    if (!user.mahalla_id) return false;
    return target.mahalla_id === user.mahalla_id;
  }

  return false;
}

export function canUserConfirmOfficialCadastre(user: AuthUser): boolean {
  // Mahalla vakili rasmiy tasdiqlangan kadastr holatini o'zboshimchalik bilan o'zgartira olmaydi (TZ 3.3 & 16)
  return user.role === 'admin' || user.role === 'inspector';
}
