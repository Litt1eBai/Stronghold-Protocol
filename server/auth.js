// Closed account service for the hosted edition. Registration is opt-in and restricted to an
// administrator-managed QQ allowlist. The small JSON store keeps the first deployment dependency-free.
import fs from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const b64 = (v) => Buffer.from(v).toString('base64url');
const unb64 = (v) => Buffer.from(String(v), 'base64url');
const nowSec = () => Math.floor(Date.now() / 1000);
const normalizeQq = (value) => String(value || '').trim();
const validQq = (value) => /^\d{5,12}$/.test(normalizeQq(value));
const parseQqAllowlist = (value) => new Set(String(value || '').split(/[\s,;]+/).map(normalizeQq).filter(validQq));

function loadQqAllowlist(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : parsed?.qq || parsed?.allowedQq || [];
      return parseQqAllowlist(Array.isArray(list) ? list.join(' ') : list);
    } catch {
      return parseQqAllowlist(raw);
    }
  } catch { return new Set(); }
}

function passwordHash(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

function verifyPassword(password, encoded) {
  const [kind, n, r, p, saltText, hashText] = String(encoded || '').split('$');
  if (kind !== 'scrypt' || !saltText || !hashText) return false;
  try {
    const expected = Buffer.from(hashText, 'base64url');
    const actual = scryptSync(String(password), Buffer.from(saltText, 'base64url'), expected.length, {
      N: Number(n) || 16384, r: Number(r) || 8, p: Number(p) || 1,
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}

function cleanUser(u) {
  return {
    id: String(u.id), username: String(u.username), displayName: String(u.displayName || u.username),
    role: u.role === 'admin' ? 'admin' : 'member', status: u.status === 'disabled' ? 'disabled' : 'active',
    createdAt: Number(u.createdAt) || Date.now(), lastLoginAt: Number(u.lastLoginAt) || 0,
  };
}

export class AuthStore {
  constructor({ file = process.env.SP_ACCOUNTS_FILE || path.resolve('.cache/accounts.json'), secret = process.env.SP_AUTH_SECRET || '', ttlSec = 7 * 24 * 3600,
    required = false, registration = process.env.SP_REGISTRATION || 'off', allowedQq, allowedQqFile = process.env.SP_ALLOWED_QQ_FILE || path.resolve('.cache/allowed-qq.json'), log = console } = {}) {
    this.file = path.resolve(file);
    this.secret = String(secret);
    this.ttlSec = Math.max(300, Number(ttlSec) || 7 * 24 * 3600);
    this.required = !!required;
    this.registration = /^(1|true|on|invite|open)$/i.test(String(registration));
    this.allowedQqFile = path.resolve(allowedQqFile);
    this.allowedQq = allowedQq instanceof Set ? new Set([...allowedQq].filter(validQq))
      : allowedQq != null ? parseQqAllowlist(allowedQq) : loadQqAllowlist(this.allowedQqFile);
    if (this.required && !this.secret) throw new Error('SP_AUTH_SECRET is required when SP_AUTH=required');
    this.log = log;
    this.users = new Map();
    this._load();
  }

  _load() {
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* first boot */ }
    for (const u of Array.isArray(raw?.users) ? raw.users : []) {
      if (u && u.username && u.passwordHash) this.users.set(String(u.username).toLowerCase(), { ...u, ...cleanUser(u) });
    }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, users: [...this.users.values()] }, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    try { fs.chmodSync(this.file, 0o600); } catch { /* best effort on Windows */ }
  }

  enabled() { return this.required; }
  count() { return this.users.size; }
  registrationEnabled() { return this.required && this.registration && this.allowedQq.size > 0; }
  qqAllowed(qq) { return validQq(qq) && this.allowedQq.has(normalizeQq(qq)); }

  createUser({ username, password, displayName = username, role = 'member' }) {
    const name = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{1,11}$/.test(name)) throw new Error('username must be 2-12 ASCII letters, digits, ., _, -');
    if (String(password || '').length < 1) throw new Error('password is required');
    if (this.users.has(name)) throw new Error('username already exists');
    const user = { id: randomBytes(12).toString('hex'), username: name, displayName: String(displayName || name).slice(0, 12),
      role: role === 'admin' ? 'admin' : 'member', status: 'active', createdAt: Date.now(), lastLoginAt: 0, passwordHash: passwordHash(password) };
    this.users.set(name, user); this._save(); return cleanUser(user);
  }

  registerUser({ username, password, displayName = username, qq }) {
    if (!this.registrationEnabled()) throw new Error('registration disabled');
    const normalizedQq = normalizeQq(qq);
    if (!this.qqAllowed(normalizedQq)) throw new Error('qq is not allowed');
    if ([...this.users.values()].some((u) => normalizeQq(u.qq) === normalizedQq)) throw new Error('qq already registered');
    const name = String(username || '').trim().toLowerCase();
    const user = this.createUser({ username: name, password, displayName, role: 'member' });
    const stored = this.users.get(name);
    stored.qq = normalizedQq;
    this._save();
    return user;
  }

  setStatus(username, status) {
    const u = this.users.get(String(username).toLowerCase());
    if (!u) throw new Error('user not found');
    u.status = status === 'disabled' ? 'disabled' : 'active'; this._save(); return cleanUser(u);
  }

  verifyCredentials(username, password) {
    const u = this.users.get(String(username || '').trim().toLowerCase());
    if (!u || u.status !== 'active' || !verifyPassword(password, u.passwordHash)) return null;
    u.lastLoginAt = Date.now(); this._save(); return cleanUser(u);
  }

  issue(user) {
    if (!this.secret) throw new Error('SP_AUTH_SECRET is required when account auth is enabled');
    const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64(JSON.stringify({ sub: user.id, username: user.username, role: user.role, iat: nowSec(), exp: nowSec() + this.ttlSec, jti: randomBytes(12).toString('hex') }));
    const body = `${header}.${payload}`;
    const sig = b64(createHmac('sha256', this.secret).update(body).digest());
    return `${body}.${sig}`;
  }

  verify(token) {
    if (!this.secret || typeof token !== 'string') return null;
    const [headerText, payloadText, sig] = token.split('.');
    if (!headerText || !payloadText || !sig) return null;
    try {
      const header = JSON.parse(unb64(headerText).toString('utf8'));
      if (header?.alg !== 'HS256' || header?.typ !== 'JWT') return null;
      const body = `${headerText}.${payloadText}`;
      const expected = createHmac('sha256', this.secret).update(body).digest();
      const actual = unb64(sig);
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
      const p = JSON.parse(unb64(payloadText).toString('utf8'));
      if (!p || p.exp < nowSec()) return null;
      const user = [...this.users.values()].find((u) => u.id === p.sub && u.status === 'active');
      return user ? cleanUser(user) : null;
    } catch { return null; }
  }
}

export function authMode(value = process.env.SP_AUTH) {
  return /^(1|true|required|on)$/i.test(String(value || '')) ? 'required' : 'off';
}
