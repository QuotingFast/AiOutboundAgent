// ── Platform Security ──────────────────────────────────────────────
// Session-based authentication with RBAC for the dashboard and APIs,
// Twilio webhook signature validation, and shared-secret verification
// for lead-ingestion webhooks.
//
// Activation model (deliberately safe for existing deployments):
//   • Auth is enforced when ADMIN_PASSWORD is set (or users exist in
//     the store). Without it, the platform behaves as before but logs
//     a prominent warning on startup.
//   • Twilio signature validation is enforced when
//     TWILIO_VALIDATE_SIGNATURE=true (needs a correct public BASE_URL).
//   • Weblead HMAC is enforced when WEBLEAD_SHARED_SECRET is set.

import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import twilio from 'twilio';
import { loadData, scheduleSave } from '../db/persistence';
import { config } from '../config';
import { recordEvent } from './events';
import { logger } from '../utils/logger';

export type Role = 'admin' | 'operator' | 'compliance' | 'viewer';

const ROLE_RANK: Record<Role, number> = { viewer: 0, compliance: 1, operator: 2, admin: 3 };

export interface User {
  id: string;
  username: string;
  role: Role;
  scryptHash: string;    // salt:hash hex
  createdAt: string;
  lastLoginAt?: string;
}

interface SecurityState {
  users: User[];
}

const STORE_KEY = 'platform_users';
let state: SecurityState = { users: [] };

interface Session {
  token: string;
  userId: string;
  role: Role;
  username: string;
  createdAt: number;
  expiresAt: number;
}

const SESSION_TTL_MS = 12 * 3600 * 1000;
const sessions = new Map<string, Session>();

// Simple fixed-window login throttle per IP.
const loginAttempts = new Map<string, { count: number; windowStart: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export function loadSecurity(): void {
  const saved = loadData<SecurityState>(STORE_KEY);
  if (saved && Array.isArray(saved.users)) state = saved;

  // Bootstrap the admin account from ADMIN_PASSWORD if provided.
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminPassword) {
    const existing = state.users.find(u => u.username === 'admin');
    if (!existing) {
      state.users.push({
        id: `usr_${crypto.randomBytes(4).toString('hex')}`,
        username: 'admin',
        role: 'admin',
        scryptHash: hashPassword(adminPassword),
        createdAt: new Date().toISOString(),
      });
      persist();
      logger.info('security', 'Bootstrapped admin user from ADMIN_PASSWORD');
    } else if (!verifyPassword(adminPassword, existing.scryptHash)) {
      // Env var is the source of truth for the bootstrap admin.
      existing.scryptHash = hashPassword(adminPassword);
      persist();
      logger.info('security', 'Admin password rotated from ADMIN_PASSWORD');
    }
  }

  if (!authEnabled()) {
    logger.warn('security', '⚠️  AUTH DISABLED — set ADMIN_PASSWORD to protect the dashboard and APIs');
  }
}

function persist(): void { scheduleSave(STORE_KEY, () => state); }

export function authEnabled(): boolean {
  return state.users.length > 0;
}

export function createUser(username: string, password: string, role: Role, actor: string): User | { error: string } {
  if (state.users.some(u => u.username === username)) return { error: 'username already exists' };
  if (password.length < 8) return { error: 'password must be at least 8 characters' };
  const user: User = {
    id: `usr_${crypto.randomBytes(4).toString('hex')}`,
    username, role,
    scryptHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  state.users.push(user);
  persist();
  recordEvent('config.changed', { scope: 'user', action: 'created', username, role }, { actor });
  return user;
}

export function deleteUser(id: string, actor: string): boolean {
  const user = state.users.find(u => u.id === id);
  if (!user) return false;
  if (user.role === 'admin' && state.users.filter(u => u.role === 'admin').length === 1) return false; // keep at least one admin
  state.users = state.users.filter(u => u.id !== id);
  for (const [token, s] of sessions) if (s.userId === id) sessions.delete(token);
  persist();
  recordEvent('config.changed', { scope: 'user', action: 'deleted', username: user.username }, { actor });
  return true;
}

export function listUsers(): Array<Omit<User, 'scryptHash'>> {
  return state.users.map(({ scryptHash: _hash, ...u }) => u);
}

export function login(username: string, password: string, ip: string): { token: string; role: Role; username: string } | { error: string } {
  const now = Date.now();
  const attempts = loginAttempts.get(ip) || { count: 0, windowStart: now };
  if (now - attempts.windowStart > LOGIN_WINDOW_MS) { attempts.count = 0; attempts.windowStart = now; }
  attempts.count += 1;
  loginAttempts.set(ip, attempts);
  if (attempts.count > LOGIN_MAX_ATTEMPTS) {
    recordEvent('auth.denied', { reason: 'rate_limited', ip }, { actor: username });
    return { error: 'too many attempts — try again later' };
  }

  const user = state.users.find(u => u.username === username);
  if (!user || !verifyPassword(password, user.scryptHash)) {
    recordEvent('auth.denied', { reason: 'bad_credentials', ip }, { actor: username });
    return { error: 'invalid credentials' };
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    token, userId: user.id, role: user.role, username: user.username,
    createdAt: now, expiresAt: now + SESSION_TTL_MS,
  });
  user.lastLoginAt = new Date().toISOString();
  persist();
  recordEvent('auth.login', { ip }, { actor: username });
  return { token, role: user.role, username: user.username };
}

export function logout(token: string): void {
  sessions.delete(token);
}

export function getSession(token: string | undefined): Session | null {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) { sessions.delete(token); return null; }
  return s;
}

function tokenFromRequest(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const cookie = req.headers.cookie;
  if (cookie) {
    const m = /(?:^|;\s*)qf_session=([a-f0-9]{64})/.exec(cookie);
    if (m) return m[1];
  }
  return undefined;
}

export interface AuthedRequest extends Request {
  auth?: { userId: string; username: string; role: Role };
}

/**
 * Express middleware factory. When auth is not configured this is a
 * pass-through (with the startup warning); when configured, requests
 * must carry a valid session at or above `minRole`.
 */
export function requireAuth(minRole: Role = 'viewer') {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!authEnabled()) { next(); return; }
    const session = getSession(tokenFromRequest(req));
    if (!session) {
      if (req.originalUrl.startsWith('/api')) res.status(401).json({ error: 'authentication required' });
      else res.redirect('/login');
      return;
    }
    if (ROLE_RANK[session.role] < ROLE_RANK[minRole]) {
      recordEvent('auth.denied', { reason: 'insufficient_role', path: req.path, need: minRole, have: session.role }, { actor: session.username });
      res.status(403).json({ error: `requires ${minRole} role` });
      return;
    }
    req.auth = { userId: session.userId, username: session.username, role: session.role };
    next();
  };
}

export function actorOf(req: AuthedRequest): string {
  return req.auth?.username || 'anonymous';
}

// ── Twilio webhook signature validation ─────────────────────────────

export function twilioSignatureEnforced(): boolean {
  return process.env.TWILIO_VALIDATE_SIGNATURE === 'true';
}

export function twilioWebhookGuard() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!twilioSignatureEnforced()) { next(); return; }
    const signature = req.headers['x-twilio-signature'];
    const url = `${config.baseUrl}${req.originalUrl}`;
    const valid = typeof signature === 'string' &&
      twilio.validateRequest(config.twilio.authToken, signature, url, (req.body || {}) as Record<string, string>);
    if (!valid) {
      recordEvent('auth.denied', { reason: 'twilio_signature', path: req.path }, { actor: 'twilio' });
      logger.warn('security', `Rejected unsigned Twilio webhook: ${req.path}`);
      res.status(403).send('invalid signature');
      return;
    }
    next();
  };
}

// ── Weblead ingestion shared secret ─────────────────────────────────

export function webleadSecretEnforced(): boolean {
  return Boolean(process.env.WEBLEAD_SHARED_SECRET);
}

/**
 * Accepts either an HMAC-SHA256 of the raw JSON body in
 * `x-webhook-signature` or the plain secret in `x-webhook-secret` /
 * `?secret=` (for vendors that can't compute HMACs).
 */
export function webleadGuard() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const secret = process.env.WEBLEAD_SHARED_SECRET;
    if (!secret) { next(); return; }
    const plain = (req.headers['x-webhook-secret'] as string) || (req.query.secret as string);
    if (plain && crypto.timingSafeEqual(Buffer.from(plain.padEnd(64).slice(0, 64)), Buffer.from(secret.padEnd(64).slice(0, 64)))) {
      next(); return;
    }
    const sig = req.headers['x-webhook-signature'] as string | undefined;
    if (sig) {
      const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body || {})).digest('hex');
      if (sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        next(); return;
      }
    }
    recordEvent('auth.denied', { reason: 'weblead_secret', path: req.path }, { actor: 'webhook' });
    logger.warn('security', `Rejected weblead webhook without valid secret: ${req.path}`);
    res.status(403).json({ error: 'invalid webhook credentials' });
  };
}

// ── Redaction for restricted views ──────────────────────────────────

export function redactPhoneForRole(phone: string, role?: Role): string {
  if (!role || ROLE_RANK[role] >= ROLE_RANK.operator) return phone;
  return phone.replace(/(\+?\d{1,4})\d{4,}(\d{2})$/, '$1•••••$2');
}
