const crypto = require('node:crypto');
require('./config');

const FALLBACK_SECRET = 'st25-evrima-vietnam-auth-secret-key-2026-safe-fallback';
const secret = process.env.SESSION_SECRET || FALLBACK_SECRET;
const SESSION_MS = 30 * 24 * 3600 * 1000;
const configured = true;
function sign(data) {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
function verify(token) {
  try {
    const [payload, signature, extra] = String(token || '').split('.');
    if (!payload || !signature || extra) return null;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isFinite(data.expires) && data.expires > Date.now() ? data : null;
  } catch { return null; }
}
function parseCookies(req) {
  const cookies = Object.create(null);
  for (const item of String(req.headers.cookie || '').split(';')) {
    const equals = item.indexOf('=');
    if (equals < 0) continue;
    try { cookies[item.slice(0, equals).trim()] = decodeURIComponent(item.slice(equals + 1)); } catch {}
  }
  return cookies;
}
function getRequestSteamId(req) {
  if (!configured) return null;
  const session = verify(parseCookies(req).st25_session_token);
  return session?.kind === 'session' && /^\d{17}$/.test(session.steamId) ? session.steamId : null;
}
function safeRedirect(value) {
  return typeof value === 'string' && /^\/(?!\/)/.test(value) && !/[\\\r\n]/.test(value)
    ? value : '/lien-ket-steam.html';
}
function cookieOptions(req, maxAge = SESSION_MS) {
  return { maxAge, path: '/', httpOnly: true, sameSite: 'lax', secure: req.secure || process.env.NODE_ENV === 'production' || !!process.env.VERCEL };
}
module.exports = { sign, verify, parseCookies, getRequestSteamId, safeRedirect, cookieOptions, SESSION_MS, configured };
