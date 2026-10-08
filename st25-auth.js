'use strict';
const crypto = require('crypto');
const STEAM = 'https://steamcommunity.com/openid/login';
function createAuth({ secret, origin, fetchImpl = global.fetch, now = Date.now }) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) throw new Error('Set ST25_AUTH_SECRET to at least 32 random characters.');
  const base = new URL(origin);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/') throw new Error('ST25_PUBLIC_ORIGIN must be an HTTPS origin.');
  origin = base.origin;
  const sign = payload => {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return body + '.' + crypto.createHmac('sha256', secret).update(body).digest('base64url');
  };
  function issue(type, data, ttl) { return sign({ ...data, type, exp: Math.floor(now()/1000)+ttl, jti: crypto.randomBytes(16).toString('hex') }); }
  function verify(token, type) {
    if (typeof token !== 'string' || token.length > 8192) throw new Error('Invalid token');
    const parts = token.split('.');
    if (parts.length !== 2) throw new Error('Invalid token');
    const expected = crypto.createHmac('sha256', secret).update(parts[0]).digest();
    const supplied = Buffer.from(parts[1], 'base64url');
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied,expected)) throw new Error('Invalid token');
    const p = JSON.parse(Buffer.from(parts[0], 'base64url'));
    if (p.type !== type || !Number.isSafeInteger(p.exp) || p.exp <= Math.floor(now()/1000)) throw new Error('Expired or invalid token');
    if (type === 'web' || type === 'launcher') { if (!/^7656119\d{10}$/.test(p.steamId)) throw new Error('Invalid identity'); }
    return p;
  }
  function redirectPath(value) {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value)) return '/lien-ket-steam.html';
    const u = new URL(value,origin);
    return u.origin === origin ? u.pathname+u.search : '/lien-ket-steam.html';
  }
  function callbackAddress(value) {
    const u = new URL(value);
    if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || !u.port || Number(u.port)<1024 || u.pathname !== '/st25-callback' || u.username || u.password || u.search || u.hash) throw new Error('Only a launcher loopback callback is allowed');
    return u.href;
  }
  function begin({ redirect, callback, state }) {
    const data = { redirect:redirectPath(redirect) };
    if (callback) {
      data.callback = callbackAddress(callback);
      if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state)) throw new Error('Invalid launcher state');
      data.state=state;
    }
    const ticket=issue('login',data,300);
    const returnTo=origin+'/api/player/steam/callback?ticket='+encodeURIComponent(ticket);
    const params=new URLSearchParams({ 'openid.ns':'http://specs.openid.net/auth/2.0','openid.mode':'checkid_setup','openid.return_to':returnTo,'openid.realm':origin+'/','openid.identity':'http://specs.openid.net/auth/2.0/identifier_select','openid.claimed_id':'http://specs.openid.net/auth/2.0/identifier_select' });
    return { ticket, url:STEAM+'?'+params, returnTo };
  }
  async function complete(q) {
    const ticket=verify(q.ticket,'login');
    const returnTo=origin+'/api/player/steam/callback?ticket='+encodeURIComponent(q.ticket);
    if (q['openid.mode'] !== 'id_res' || q['openid.ns'] !== 'http://specs.openid.net/auth/2.0' || q['openid.op_endpoint'] !== STEAM || q['openid.return_to'] !== returnTo) throw new Error('Invalid Steam callback');
    const claim=q['openid.claimed_id'];
    if (typeof claim !== 'string' || !/^https:\/\/steamcommunity\.com\/openid\/id\/7656119\d{10}$/.test(claim) || q['openid.identity'] !== claim) throw new Error('Invalid Steam identity');
    const signed = String(q['openid.signed']||'').split(',');
    for (const field of ['op_endpoint','claimed_id','identity','return_to','response_nonce','assoc_handle']) { if (!signed.includes(field)) throw new Error('Unsigned Steam assertion'); }
    const nonce=String(q['openid.response_nonce']||'');
    const date=Date.parse(nonce.slice(0,20));
    if (!Number.isFinite(date) || now()-date>300000 || date-now()>60000) throw new Error('Expired Steam assertion');
    const params=new URLSearchParams();
    for (const [k,v] of Object.entries(q)) if (k.startsWith('openid.')) { if (typeof v !== 'string') throw new Error('Invalid Steam parameters'); params.set(k,v); }
    params.set('openid.mode','check_authentication');
    const response=await fetchImpl(STEAM,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:params.toString(),signal:AbortSignal.timeout(8000),redirect:'error'});
    const text=await response.text();
    if (!response.ok || !/^is_valid:true\s*$/m.test(text)) throw new Error('Steam did not verify this login');
    // Steam rejects reused nonces for check_authentication (OpenID 2.0 section 11.4.2).
    return { ...ticket, steamId:claim.split('/').pop() };
  }
  return { origin,issue,verify,begin,complete,redirectPath };
}
module.exports={createAuth};
