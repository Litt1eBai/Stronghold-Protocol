// server/http/routes.js — the node:http request listener. Every response gets the security headers (common.js), then:
// (i18n-ignore-file: the error pages are bilingual by design, 中文 · English — docs/I18N.md)
//
//   * a URL longer than 4096 characters → 414; one that does not parse → 400;
//   * any method but GET / HEAD → 405 with `Allow: GET, HEAD`;
//   * GET /healthz → JSON status (protocol `version`, release `app`, uptime, the served `build`, sockets, sessions,
//     rooms, matches), never cached;
//   * everything else → the static files (static.js).
// A route that throws is logged and answers 500.

import { clientAddress } from '../net.js';
import { PROTOCOL_VERSION, APP_VERSION } from '../../shared/constants.js';
import { buildTag } from './buildTag.js';
import { setSecurityHeaders, sendError, sendJson, splitUrl } from './common.js';

/** Read a small JSON request body without buffering unbounded input. */
function readJsonBody(req, maxBytes = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { reject(Object.assign(new Error('body too large'), { code: 'BODY_TOO_LARGE' })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('invalid json'), { code: 'BAD_JSON' })); }
    });
    req.on('error', reject);
  });
}

const MAX_URL_LENGTH = 4096;

/**
 * The GET /healthz body.
 * @param {{ startedAt: number, network: import('../net.js').Network, registry: import('../net.js').SessionRegistry,
 *           lobby: import('../lobby.js').Lobby }} health
 */
export function healthReport({ startedAt, network, registry, lobby, auth }) {
  return {
    ok: true, version: PROTOCOL_VERSION, app: APP_VERSION, uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    // the runtime the server is serving right now (public/js/ui/buildGuard.js): a page whose own build is
    // older than this reloads itself, so a deploy reaches clients that never reload
    build: buildTag(),
    ...(auth ? { auth: { required: auth.enabled(), users: auth.count() } } : {}),
    sockets: network.connectionCount, sessions: registry.size, ...lobby.stats(),
  };
}

/**
 * The request listener for `http.createServer`.
 * @param {{ serveStatic: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse,
 *             rawPath: string, query: string) => Promise<void>,
 *           health: Parameters<typeof healthReport>[0], log: object }} deps
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
export function createRequestHandler({ serveStatic, health, log }) {
  const auth = health.auth;
  const netOptions = health.network.opts;
  const registrationBuckets = new Map();
  const allowRegistrationAttempt = (req) => {
    const key = clientAddress(req, netOptions.trustProxy).key || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const cur = registrationBuckets.get(key);
    if (!cur || now - cur.startedAt >= 10 * 60_000) { registrationBuckets.set(key, { startedAt: now, count: 1 }); return true; }
    cur.count += 1;
    return cur.count <= 10;
  };

  async function handleRequest(req, res) {
    const url = req.url || '/';
    if (url.length > MAX_URL_LENGTH) { sendError(req, res, 414, '请求地址过长 · URI too long'); return; }
    const parts = splitUrl(url);
    if (!parts) { sendError(req, res, 400, '请求地址无效 · Bad request'); return; }
    if (auth && parts.rawPath === '/api/auth/config' && (req.method === 'GET' || req.method === 'HEAD')) {
      sendJson(req, res, 200, { authRequired: auth.enabled(), registration: auth.registrationEnabled() });
      return;
    }
    if (auth && parts.rawPath === '/api/auth/register' && req.method === 'POST') {
      if (!auth.registrationEnabled()) { sendJson(req, res, 403, { ok: false, error: 'REGISTRATION_DISABLED' }); return; }
      if (!allowRegistrationAttempt(req)) { sendJson(req, res, 429, { ok: false, error: 'RATE' }); return; }
      let body;
      try { body = await readJsonBody(req); } catch (e) {
        sendJson(req, res, e?.code === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'BAD_REQUEST' }); return;
      }
      const fields = body && typeof body === 'object' ? body : {};
      const username = typeof fields.username === 'string' ? fields.username : '';
      const password = typeof fields.password === 'string' ? fields.password : '';
      const displayName = typeof fields.displayName === 'string' ? fields.displayName : username;
      const qq = typeof fields.qq === 'string' ? fields.qq : '';
      try {
        const account = auth.registerUser({ username, password, displayName, qq });
        sendJson(req, res, 201, { ok: true, auth: auth.issue(account), account: { username: account.username, displayName: account.displayName, role: account.role } });
      } catch (e) {
        const message = String(e?.message || '');
        const conflict = /already exists|already registered/i.test(message);
        const invalid = /must be|required|not allowed|registration disabled/i.test(message);
        sendJson(req, res, conflict ? 409 : invalid ? 400 : 500, { ok: false, error: conflict ? 'ALREADY_EXISTS' : invalid ? 'INVALID_REGISTRATION' : 'INTERNAL' });
      }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD, POST');
      sendError(req, res, 405, '不支持的请求方法 · Method not allowed');
      return;
    }
    if (parts.rawPath === '/healthz') {
      sendJson(req, res, 200, healthReport(health));
      return;
    }
    await serveStatic(req, res, parts.rawPath, parts.query);
  }

  return (req, res) => {
    setSecurityHeaders(res);
    handleRequest(req, res).catch((e) => {
      log.error('[http] request failed', e);
      sendError(req, res, 500, '服务器内部错误 · Internal error');
    });
  };
}
