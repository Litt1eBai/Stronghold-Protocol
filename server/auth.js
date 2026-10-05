// Closed account service for the hosted edition. Accounts are provisioned by the administrator;
// there is deliberately no public registration endpoint. The small JSON store keeps the first
// deployment dependency-free. It can be replaced by PostgreSQL behind the same interface later.
import fs from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const b64 = (v) => Buffer.from(v).toString('base64url');
const unb64 = (v) => Buffer.from(String(v), 'base64url');
const nowSec = () => Math.floor(Date.now() / 1000);

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
  constructor({ file = process.env.SP_ACCOUNTS_FILE || path.resolve('.cache/accounts.json'), secret = process.env.SP_AUTH_SECRET || '', ttlSec = 30 * 24 * 3600, required = false, log = console } = {}) {
    this.file = path.resolve(file);
    this.secret = String(secret);
    this.ttlSec = Math.max(300, Number(ttlSec) || 30 * 24 * 3600);
    this.required = !!required;
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

  createUser({ username, password, displayName = username, role = 'member' }) {
    const name = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{1,11}$/.test(name)) throw new Error('username must be 2-12 ASCII letters, digits, ., _, -');
    if (String(password || '').length < 8) throw new Error('password must be at least 8 characters');
    if (this.users.has(name)) throw new Error('username already exists');
    const user = { id: randomBytes(12).toString('hex'), username: name, displayName: String(displayName || name).slice(0, 12),
      role: role === 'admin' ? 'admin' : 'member', status: 'active', createdAt: Date.now(), lastLoginAt: 0, passwordHash: passwordHash(password) };
    this.users.set(name, user); this._save(); return cleanUser(user);
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
    const payload = { sub: user.id, username: user.username, role: user.role, exp: nowSec() + this.ttlSec, nonce: randomBytes(12).toString('hex') };
    const body = b64(JSON.stringify(payload));
    const sig = b64(createHmac('sha256', this.secret).update(body).digest());
    return `${body}.${sig}`;
  }

  verify(token) {
    if (!this.secret || typeof token !== 'string') return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    try {
      const expected = createHmac('sha256', this.secret).update(body).digest();
      const actual = unb64(sig);
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
      const p = JSON.parse(unb64(body).toString('utf8'));
      if (!p || p.exp < nowSec()) return null;
      const user = [...this.users.values()].find((u) => u.id === p.sub && u.status === 'active');
      return user ? cleanUser(user) : null;
    } catch { return null; }
  }
}

export function authMode(value = process.env.SP_AUTH) {
  return /^(1|true|required|on)$/i.test(String(value || '')) ? 'required' : 'off';
}
