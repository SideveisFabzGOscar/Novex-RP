/*
 * Project Novex RP – API for Netlify Functions
 *
 * Samme API som server.js, men laget for Netlify:
 *  - lagring i Netlify Blobs (ingen egen database trengs)
 *  - Discord-ticket-boten svarer på knapper og skjemaer over HTTP
 *    (Interactions Endpoint), så den trenger ingen server som alltid er på
 *
 * Alle ruter under /api/* og /auth/* går hit (se config nederst).
 */
import crypto from 'node:crypto';
import formsModule from '../../public/forms.js';

const { FORMS, JOBS, CATS, validate } = formsModule;

/* ------------------------------------------------------------------ */
/* Konfigurasjon                                                       */
/* ------------------------------------------------------------------ */
const env = process.env;
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
function loadConfig() {
  const base = (env.BASE_URL || env.URL || 'http://localhost:8888').replace(/\/+$/, '');
  return {
    base,
    secure: base.startsWith('https://'),
    clientId: env.DISCORD_CLIENT_ID || '',
    clientSecret: env.DISCORD_CLIENT_SECRET || '',
    publicKey: env.DISCORD_PUBLIC_KEY || '',
    guildId: env.DISCORD_GUILD_ID || '',
    requireGuild: env.REQUIRE_DISCORD_MEMBER === 'true',
    staffIds: list(env.STAFF_DISCORD_IDS),
    staffRoles: list(env.DISCORD_STAFF_ROLE_IDS),
    botToken: env.DISCORD_BOT_TOKEN || '',
    wlRole: env.DISCORD_WHITELIST_ROLE_ID || '',
    ticketCategory: env.DISCORD_TICKET_CATEGORY_ID || '',
    webhook: env.DISCORD_WEBHOOK_URL || '',
    fivemKey: env.FIVEM_API_KEY || '',
    fivemUrl: (env.FIVEM_SERVER_URL || '').replace(/\/+$/, ''),
    connect: env.CONNECT_ADDRESS || 'play.novexrp.no',
    invite: env.DISCORD_INVITE || '',
    trailer: env.YOUTUBE_TRAILER_ID || '',
    heroYoutube: env.HERO_YOUTUBE_ID ?? 'Yaba1xgSJ2k',
    heroCredit: env.HERO_CREDIT || ''
  };
}

/* ------------------------------------------------------------------ */
/* Lagring (Netlify Blobs, eller en erstatning i tester)               */
/* ------------------------------------------------------------------ */
let storeOverride = null;
export function _setStore(s) { storeOverride = s; }
async function getDb() {
  if (storeOverride) return storeOverride;
  const { getStore } = await import('@netlify/blobs');
  return getStore({ name: 'novex', consistency: 'strong' });
}
const DB = {
  async get(db, key) { return (await db.get(key, { type: 'json' })) || null; },
  async set(db, key, val) { await db.setJSON(key, val); return val; },
  async del(db, key) { await db.delete(key); },
  async keys(db, prefix) {
    const out = []; let cursor;
    do {
      const r = await db.list({ prefix, cursor });
      (r.blobs || []).forEach((b) => out.push(b.key));
      cursor = r.cursor;
    } while (cursor);
    return out;
  },
  async all(db, prefix) {
    const keys = await DB.keys(db, prefix);
    const vals = await Promise.all(keys.map((k) => DB.get(db, k)));
    return vals.filter(Boolean);
  }
};
async function nextId(db, prefix) {
  const keys = await DB.keys(db, prefix);
  let max = 0;
  keys.forEach((k) => { const n = Number(k.split('/').pop()); if (n > max) max = n; });
  return max + 1;
}

/* ------------------------------------------------------------------ */
/* Hjelpere                                                            */
/* ------------------------------------------------------------------ */
class HttpError extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; } }
const fail = (status, msg, extra) => { throw new HttpError(status, msg, extra); };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const str = (v, max) => String(v == null ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, max);
const json = (status, data, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
function redirect(location, cookies = []) {
  const h = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  cookies.forEach((c) => h.append('Set-Cookie', c));
  return new Response(null, { status: 302, headers: h });
}
function parseCookies(req) {
  const out = {};
  (req.headers.get('cookie') || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) { try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch { /* ignorer */ } }
  });
  return out;
}
const cookie = (C, name, val, maxAge) => `${name}=${encodeURIComponent(val)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${C.secure ? '; Secure' : ''}`;

/* enkel rate-begrensning per funksjonsinstans */
const buckets = new Map();
function limit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  if (++b.n > max) fail(429, 'For mange forespørsler. Vent litt og prøv igjen.');
  if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
}

/* ------------------------------------------------------------------ */
/* Brukere                                                             */
/* ------------------------------------------------------------------ */
const SESSION_MS = 30 * 24 * 3600 * 1000;
async function getUser(C, db, req) {
  const sid = parseCookies(req).novex_sid;
  if (!sid) return null;
  const s = await DB.get(db, 'sessions/' + sha(sid));
  if (!s) return null;
  if (s.expires_at < Date.now()) { await DB.del(db, 'sessions/' + sha(sid)); return null; }
  const u = await DB.get(db, 'users/' + s.user_id);
  if (!u) return null;
  u.is_staff = u.is_staff || C.staffIds.includes(u.id) ? 1 : 0;
  return u;
}
function avatarUrl(id, avatar) {
  if (avatar) return `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=128`;
  let n = 0; try { n = Number((BigInt(id) >> 22n) % 6n); } catch { /* ignorer */ }
  return `https://cdn.discordapp.com/embed/avatars/${n}.png`;
}
const userApps = (db, uid) => DB.all(db, `apps/${uid}/`);
const hasWhitelist = async (db, uid) => (await userApps(db, uid)).some((a) => a.form === 'whitelist' && a.status === 'godkjent');
async function publicUser(db, u) {
  return {
    id: u.id, username: u.username, name: u.name || u.username, avatarUrl: avatarUrl(u.id, u.avatar),
    isStaff: !!u.is_staff, whitelisted: !!u.is_staff || await hasWhitelist(db, u.id), createdAt: u.created_at
  };
}
const appOut = (a) => ({
  id: a.id, form: a.form, status: a.status, answers: a.answers || {}, reply: a.reply || '',
  createdAt: a.created_at, updatedAt: a.updated_at, submittedAt: a.submitted_at || null, decidedAt: a.decided_at || null
});
const ticketOut = (C, t) => ({
  id: t.id, subject: t.subject, category: t.category, status: t.status, createdAt: t.created_at, updatedAt: t.updated_at,
  channelUrl: t.channel_id && C.guildId ? `https://discord.com/channels/${C.guildId}/${t.channel_id}` : null
});
async function upsertDiscordUser(db, d, staff) {
  const now = Date.now();
  const old = await DB.get(db, 'users/' + d.id);
  const u = { id: d.id, username: d.username, name: d.global_name || d.username, avatar: d.avatar || null, is_staff: staff ? 1 : 0, created_at: old ? old.created_at : now, last_login: old ? old.last_login : now };
  return DB.set(db, 'users/' + d.id, u);
}
const isStaffDiscord = (C, id, roles = []) => C.staffIds.includes(id) || roles.some((r) => C.staffRoles.includes(r));

/* ------------------------------------------------------------------ */
/* Discord REST                                                        */
/* ------------------------------------------------------------------ */
async function discord(C, path, { token, bot, method = 'GET', body, form } = {}) {
  const headers = { 'User-Agent': `NovexRP (${C.base}, 1.0)` };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (bot) headers.Authorization = 'Bot ' + C.botToken;
  let payload;
  if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString(); }
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  try {
    let r = await fetch('https://discord.com/api/v10' + path, { method, headers, body: payload, signal: AbortSignal.timeout(8000) });
    if (r.status === 429) {
      const j = await r.json().catch(() => ({}));
      await new Promise((res) => setTimeout(res, Math.min(3000, Math.ceil((j.retry_after || 1) * 1000))));
      r = await fetch('https://discord.com/api/v10' + path, { method, headers, body: payload, signal: AbortSignal.timeout(8000) });
    }
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* ignorer */ }
    if (!r.ok) console.error('Discord', method, path, r.status, text.slice(0, 200));
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    console.error('Discord-kall feilet:', path, e.message);
    return { ok: false, status: 0, data: null };
  }
}
async function notify(C, title, description, color = 0xe0141f) {
  if (!C.webhook) return;
  try {
    await fetch(C.webhook, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ embeds: [{ title: title.slice(0, 256), description: description.slice(0, 2000), url: C.base + '/#staff', color, timestamp: new Date().toISOString() }] })
    });
  } catch (e) { console.error('Webhook feilet:', e.message); }
}

/* ------------------------------------------------------------------ */
/* Ticket-kanaler i Discord                                            */
/* ------------------------------------------------------------------ */
const VIEW = 1024n, SEND = 2048n, EMBED = 16384n, ATTACH = 32768n, HISTORY = 65536n;
const MEMBER_ALLOW = String(VIEW | SEND | EMBED | ATTACH | HISTORY);
const tno = (id) => 1000 + Number(id);
const botOn = (C) => !!(C.botToken && C.guildId && C.clientId);
function ticketButtons(C, t) {
  const closed = t.status === 'lukket';
  const row = closed
    ? [{ type: 2, style: 3, label: 'Åpne igjen', custom_id: 'nx:reopen:' + t.id }, { type: 2, style: 4, label: 'Slett kanal', custom_id: 'nx:delete:' + t.id }]
    : [{ type: 2, style: 1, label: 'Svar', custom_id: 'nx:reply:' + t.id }, { type: 2, style: 4, label: 'Lukk ticket', custom_id: 'nx:close:' + t.id }];
  if (C.secure) row.push({ type: 2, style: 5, label: 'Åpne på nettsiden', url: C.base + '/#tickets' });
  return [{ type: 1, components: row }];
}
async function ensureChannel(C, db, t) {
  if (!botOn(C)) return null;
  if (t.channel_id) return t.channel_id;
  const base = { name: `ticket-${tno(t.id)}`, type: 0, topic: `${t.category} · ${t.subject}`.slice(0, 1024) };
  if (C.ticketCategory) base.parent_id = C.ticketCategory;
  const ov = [{ id: C.guildId, type: 0, deny: String(VIEW) }, { id: C.clientId, type: 1, allow: MEMBER_ALLOW }];
  C.staffRoles.forEach((r) => ov.push({ id: r, type: 0, allow: MEMBER_ALLOW }));
  let inGuild = true;
  let r = await discord(C, `/guilds/${C.guildId}/channels`, { bot: true, method: 'POST', body: { ...base, permission_overwrites: [...ov, { id: t.user_id, type: 1, allow: MEMBER_ALLOW }] } });
  if (!r.ok && (r.status === 400 || r.status === 404)) {
    inGuild = false;
    r = await discord(C, `/guilds/${C.guildId}/channels`, { bot: true, method: 'POST', body: { ...base, permission_overwrites: ov } });
  }
  if (!r.ok || !r.data) return null;
  t.channel_id = r.data.id;
  await DB.set(db, `tickets/${t.user_id}/${t.id}`, t);
  const first = (t.msgs || [])[0];
  await discord(C, `/channels/${t.channel_id}/messages`, {
    bot: true, method: 'POST', body: {
      content: [inGuild ? `<@${t.user_id}>` : '', C.staffRoles.map((x) => `<@&${x}>`).join(' ')].filter(Boolean).join(' ') || undefined,
      allowed_mentions: { users: inGuild ? [t.user_id] : [], roles: C.staffRoles },
      embeds: [{
        title: `Ticket #${tno(t.id)}: ${t.subject}`.slice(0, 256),
        description: first ? first.body.slice(0, 4000) : undefined,
        color: 0xe0141f,
        fields: [{ name: 'Kategori', value: t.category, inline: true }, { name: 'Fra', value: `<@${t.user_id}>`, inline: true }],
        footer: { text: 'Trykk «Svar» for å svare. Svarene vises også på nettsiden.' }
      }],
      components: ticketButtons(C, t)
    }
  });
  return t.channel_id;
}
async function postToChannel(C, db, t, m) {
  if (!botOn(C)) return;
  const ch = await ensureChannel(C, db, t);
  if (!ch) return;
  await discord(C, `/channels/${ch}/messages`, {
    bot: true, method: 'POST', body: {
      embeds: [{ author: { name: `${m.staff ? 'Novex Staff' : m.name}${m.source === 'discord' ? '' : ' · fra nettsiden'}` }, description: m.body.slice(0, 4000), color: m.staff ? 0x0f0c0c : 0xe0141f }],
      components: ticketButtons(C, t), allowed_mentions: { parse: [] }
    }
  });
}
async function channelStatus(C, t, by) {
  if (!botOn(C) || !t.channel_id) return;
  const closed = t.status === 'lukket';
  await discord(C, `/channels/${t.channel_id}/permissions/${t.user_id}`, { bot: true, method: 'PUT', body: closed ? { type: 1, allow: String(VIEW | HISTORY), deny: String(SEND) } : { type: 1, allow: MEMBER_ALLOW } });
  await discord(C, `/channels/${t.channel_id}`, { bot: true, method: 'PATCH', body: { name: `${closed ? 'lukket' : 'ticket'}-${tno(t.id)}` } });
  await discord(C, `/channels/${t.channel_id}/messages`, { bot: true, method: 'POST', body: { content: `Ticketen ble ${closed ? 'lukket' : 'åpnet igjen'}${by ? ' av ' + by : ''}.`, allowed_mentions: { parse: [] }, components: ticketButtons(C, t) } });
}

/* ------------------------------------------------------------------ */
/* Tickets (felles for nettsiden og Discord)                           */
/* ------------------------------------------------------------------ */
async function findTicket(db, id) {
  const keys = await DB.keys(db, 'tickets/');
  const k = keys.find((x) => x.split('/').pop() === String(Number(id) || 0));
  return k ? DB.get(db, k) : null;
}
async function createTicket(C, db, user, category, subject, text, opt = {}) {
  subject = str(subject, 80); text = str(text, 4000);
  category = CATS.includes(category) ? category : 'Annet';
  if (!subject || !text) fail(400, 'Fyll ut emne og beskrivelse.');
  const mine = await DB.all(db, `tickets/${user.id}/`);
  if (mine.filter((t) => t.status !== 'lukket').length >= 5) fail(409, 'Du har allerede 5 åpne tickets. Lukk en før du oppretter en ny.');
  limit('ticket:' + user.id, 5, 10 * 60 * 1000);
  const now = Date.now(), id = await nextId(db, 'tickets/');
  const t = { id, user_id: user.id, category, subject, status: 'apen', created_at: now, updated_at: now, channel_id: null, msgs: [{ id: 1, user_id: user.id, is_staff: 0, body: text, created_at: now, source: opt.source || 'web' }] };
  await DB.set(db, `tickets/${user.id}/${id}`, t);
  await Promise.all([
    notify(C, `Ny ticket #${tno(id)}: ${subject}`, `**${user.name || user.username}** · ${category}${opt.source === 'discord' ? ' · via Discord' : ''}\n\n${text.slice(0, 500)}`, 0x2b2425),
    ensureChannel(C, db, t)
  ]);
  return t;
}
async function addTicketMessage(C, db, t, user, text, asStaff, opt = {}) {
  const now = Date.now(), status = asStaff ? 'besvart' : 'apen';
  t.msgs = t.msgs || [];
  t.msgs.push({ id: t.msgs.length + 1, user_id: user.id, is_staff: asStaff ? 1 : 0, body: text, created_at: now, source: opt.source || 'web' });
  t.status = status; t.updated_at = now;
  await DB.set(db, `tickets/${t.user_id}/${t.id}`, t);
  const tasks = [postToChannel(C, db, t, { body: text, name: user.name || user.username, staff: asStaff, source: opt.source || 'web' })];
  if (!asStaff && opt.source !== 'discord') tasks.push(notify(C, `Svar på ticket #${tno(t.id)}`, `**${user.name || user.username}**: ${text.slice(0, 500)}`, 0x2b2425));
  await Promise.all(tasks);
}
async function setTicketStatus(C, db, t, status, byName) {
  t.status = status; t.updated_at = Date.now();
  await DB.set(db, `tickets/${t.user_id}/${t.id}`, t);
  await channelStatus(C, t, byName);
}

/* ------------------------------------------------------------------ */
/* Discord-interaksjoner (ticket-boten)                                */
/* ------------------------------------------------------------------ */
function verifyDiscord(C, raw, sig, ts) {
  if (!C.publicKey || !sig || !ts) return false;
  try {
    const key = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(C.publicKey, 'hex').toString('base64url') }, format: 'jwk' });
    return crypto.verify(null, Buffer.from(ts + raw), key, Buffer.from(sig, 'hex'));
  } catch { return false; }
}
const ephemeral = (content) => json(200, { type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });
const categoryPicker = () => ({ type: 4, data: { content: 'Hva gjelder saken?', flags: 64, components: [{ type: 1, components: [{ type: 3, custom_id: 'nx:cat', placeholder: 'Velg kategori', options: CATS.map((c, i) => ({ label: c, value: String(i) })) }] }] } });
const textModal = (custom_id, title, fields) => ({ type: 9, data: { custom_id, title: title.slice(0, 45), components: fields.map((f) => ({ type: 1, components: [{ type: 4, required: true, ...f }] })) } });
async function interactions(C, db, req) {
  const raw = await req.text();
  if (!verifyDiscord(C, raw, req.headers.get('x-signature-ed25519'), req.headers.get('x-signature-timestamp'))) return new Response('Ugyldig signatur', { status: 401 });
  let i; try { i = JSON.parse(raw); } catch { return new Response('Ugyldig JSON', { status: 400 }); }
  if (i.type === 1) return json(200, { type: 1 });
  if (i.guild_id !== C.guildId || !i.member) return ephemeral('Tickets fungerer bare i Novex-serveren.');
  const user = i.member.user, roles = i.member.roles || [];
  const staff = isStaffDiscord(C, user.id, roles);
  const fields = () => { const f = {}; (i.data.components || []).forEach((row) => (row.components || []).forEach((c) => { f[c.custom_id] = c.value; })); return f; };

  if (i.type === 2) {
    if (i.data.name === 'ticket') return json(200, categoryPicker());
    if (i.data.name === 'ticket-panel') {
      if (!staff) return ephemeral('Bare staff kan legge ut ticket-panelet.');
      const r = await discord(C, `/channels/${i.channel_id}/messages`, { bot: true, method: 'POST', body: {
        embeds: [{ title: 'Trenger du hjelp?', description: 'Trykk på knappen under for å opprette en ticket. Du får en privat kanal med staff, og saken vises også under Tickets på nettsiden.', color: 0xe0141f }],
        components: [{ type: 1, components: [{ type: 2, style: 1, label: 'Opprett ticket', custom_id: 'nx:open' }] }] } });
      return ephemeral(r.ok ? 'Ticket-panelet er lagt ut.' : 'Boten får ikke skrive i denne kanalen. Sjekk rettighetene.');
    }
    return ephemeral('Ukjent kommando.');
  }

  if (i.type === 3) {
    const id = i.data.custom_id;
    if (id === 'nx:open') return json(200, categoryPicker());
    if (id === 'nx:cat') {
      const ci = Math.min(CATS.length - 1, Math.max(0, Number((i.data.values || [])[0]) || 0));
      return json(200, textModal('nx:create:' + ci, 'Ny ticket: ' + CATS[ci], [
        { type: 4, custom_id: 'subject', label: 'Emne', style: 1, min_length: 3, max_length: 80 },
        { type: 4, custom_id: 'body', label: 'Beskriv saken', style: 2, min_length: 10, max_length: 4000, placeholder: 'Hva skjedde? Ta med tidspunkt, navn og lenke til klipp.' }
      ]));
    }
    const m = id.match(/^nx:(reply|close|reopen|delete):(\d+)$/);
    if (!m) return ephemeral('Ukjent knapp.');
    const t = await findTicket(db, m[2]);
    if (!t) return ephemeral('Fant ikke ticketen.');
    if (t.user_id !== user.id && !staff) return ephemeral('Du har ikke tilgang til denne ticketen.');
    if (m[1] === 'reply') {
      if (t.status === 'lukket') return ephemeral('Ticketen er lukket. Åpne den igjen for å svare.');
      return json(200, textModal('nx:replym:' + t.id, `Svar på ticket #${tno(t.id)}`, [{ type: 4, custom_id: 'body', label: 'Svaret ditt', style: 2, min_length: 1, max_length: 4000 }]));
    }
    if (m[1] === 'delete') {
      if (!staff) return ephemeral('Bare staff kan slette kanalen.');
      if (t.channel_id) await discord(C, `/channels/${t.channel_id}`, { bot: true, method: 'DELETE' });
      t.channel_id = null; await DB.set(db, `tickets/${t.user_id}/${t.id}`, t);
      return json(200, { type: 6 });
    }
    await upsertDiscordUser(db, user, staff);
    const status = m[1] === 'close' ? 'lukket' : 'apen';
    if (t.status !== status) await setTicketStatus(C, db, t, status, user.global_name || user.username);
    return json(200, { type: 6 });
  }

  if (i.type === 5) {
    const id = i.data.custom_id, f = fields();
    const u = await upsertDiscordUser(db, user, staff);
    let mm = id.match(/^nx:create:(\d+)$/);
    if (mm) {
      try {
        const t = await createTicket(C, db, u, CATS[Number(mm[1])] || 'Annet', f.subject, f.body, { source: 'discord' });
        return ephemeral(t.channel_id ? `Ticket **#${tno(t.id)}** er opprettet: <#${t.channel_id}>` : `Ticket **#${tno(t.id)}** er opprettet. Du finner den under Tickets på nettsiden.`);
      } catch (e) {
        if (e instanceof HttpError) return ephemeral(e.message);
        console.error(e); return ephemeral('Kunne ikke opprette ticketen. Prøv igjen, eller bruk nettsiden.');
      }
    }
    mm = id.match(/^nx:replym:(\d+)$/);
    if (mm) {
      const t = await findTicket(db, mm[1]);
      if (!t) return ephemeral('Fant ikke ticketen.');
      if (t.user_id !== user.id && !staff) return ephemeral('Du har ikke tilgang til denne ticketen.');
      if (t.status === 'lukket') return ephemeral('Ticketen er lukket.');
      const text = str(f.body, 4000);
      if (!text) return ephemeral('Skriv et svar.');
      await addTicketMessage(C, db, t, u, text, staff && t.user_id !== user.id, { source: 'discord' });
      return ephemeral('Svaret er sendt og vises også på nettsiden.');
    }
  }
  return ephemeral('Ukjent handling.');
}

/* ------------------------------------------------------------------ */
/* FiveM-status                                                        */
/* ------------------------------------------------------------------ */
let statusCache = { at: 0, data: null };
async function serverStatus(C) {
  if (!C.fivemUrl) return { online: null };
  if (Date.now() - statusCache.at < 30000 && statusCache.data) return statusCache.data;
  let data;
  try {
    const signal = AbortSignal.timeout(4000);
    const [players, dyn] = await Promise.all([
      fetch(C.fivemUrl + '/players.json', { signal }).then((r) => r.json()),
      fetch(C.fivemUrl + '/dynamic.json', { signal }).then((r) => r.json())
    ]);
    data = { online: true, players: Array.isArray(players) ? players.length : 0, max: Number(dyn.sv_maxclients) || 0 };
  } catch { data = { online: false }; }
  statusCache = { at: Date.now(), data };
  return data;
}

/* ------------------------------------------------------------------ */
/* Ruter                                                               */
/* ------------------------------------------------------------------ */
const routes = [];
function route(method, pattern, handler, opt = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, opt });
}

/* ---- innlogging ---- */
route('GET', '/auth/discord', ({ C }) => {
  if (!C.clientId || !C.clientSecret) return redirect('/?feil=oppsett#panel');
  const state = crypto.randomBytes(16).toString('hex');
  const scope = ['identify']; if (C.guildId) scope.push('guilds.members.read');
  const u = new URL('https://discord.com/oauth2/authorize');
  u.search = new URLSearchParams({ client_id: C.clientId, redirect_uri: C.base + '/auth/callback', response_type: 'code', scope: scope.join(' '), state, prompt: 'none' }).toString();
  return redirect(u.toString(), [cookie(C, 'novex_state', state, 600)]);
});
route('GET', '/auth/callback', async ({ C, db, req, url, ip }) => {
  const clear = cookie(C, 'novex_state', '', 0);
  const back = (feil) => redirect(`/?feil=${feil}#panel`, [clear]);
  if (url.searchParams.get('error')) return back('avbrutt');
  const code = url.searchParams.get('code'), state = url.searchParams.get('state'), saved = parseCookies(req).novex_state;
  if (!code || !state || !saved || !safeEq(state, saved)) return back('state');
  limit('login:' + ip, 20, 10 * 60 * 1000);
  const tok = await discord(C, '/oauth2/token', { method: 'POST', form: { client_id: C.clientId, client_secret: C.clientSecret, grant_type: 'authorization_code', code, redirect_uri: C.base + '/auth/callback' } });
  if (!tok.ok || !tok.data || !tok.data.access_token) return back('discord');
  const token = tok.data.access_token;
  const me = await discord(C, '/users/@me', { token });
  if (!me.ok || !me.data || !me.data.id) return back('discord');
  let roles = [], member = false;
  if (C.guildId) {
    const m = await discord(C, `/users/@me/guilds/${C.guildId}/member`, { token });
    if (m.ok && m.data) { member = true; roles = m.data.roles || []; }
  }
  if (C.guildId && C.requireGuild && !member) return back('medlem');
  const d = me.data, now = Date.now();
  const old = await DB.get(db, 'users/' + d.id);
  await DB.set(db, 'users/' + d.id, { id: d.id, username: d.username, name: d.global_name || d.username, avatar: d.avatar || null, is_staff: isStaffDiscord(C, d.id, roles) ? 1 : 0, created_at: old ? old.created_at : now, last_login: now });
  const sid = crypto.randomBytes(32).toString('hex');
  await DB.set(db, 'sessions/' + sha(sid), { user_id: d.id, expires_at: now + SESSION_MS });
  return redirect('/#panel', [clear, cookie(C, 'novex_sid', sid, SESSION_MS / 1000)]);
});
route('POST', '/auth/logout', async ({ C, db, req }) => {
  const sid = parseCookies(req).novex_sid;
  if (sid) await DB.del(db, 'sessions/' + sha(sid));
  return json(200, { ok: true }, { 'Set-Cookie': cookie(C, 'novex_sid', '', 0) });
});

/* ---- offentlig ---- */
route('GET', '/api/config', ({ C }) => ({ connect: C.connect, invite: C.invite, trailer: C.trailer, heroYoutube: C.heroYoutube, heroCredit: C.heroCredit, loginEnabled: !!(C.clientId && C.clientSecret), discordTickets: botOn(C) && !!C.publicKey }));
route('GET', '/api/me', async ({ db, user }) => ({ user: user ? await publicUser(db, user) : null }), { auth: 'optional' });
route('GET', '/api/status', ({ C }) => serverStatus(C));

/* ---- søknader ---- */
function cleanAnswers(form, input) {
  const out = {}, src = input && typeof input === 'object' ? input : {};
  for (const q of FORMS[form].q) {
    if (src[q.id] == null) continue;
    const v = String(src[q.id]).slice(0, q.type === 'textarea' ? 5000 : 200);
    if (q.type === 'select' && v && !q.options.includes(v)) continue;
    out[q.id] = v;
  }
  return out;
}
async function ownApp(db, user, id) {
  const a = await DB.get(db, `apps/${user.id}/${Number(id) || 0}`);
  if (!a) fail(404, 'Fant ikke søknaden.');
  return a;
}
route('GET', '/api/apps', async ({ db, user }) => ({ apps: (await userApps(db, user.id)).sort((a, b) => b.created_at - a.created_at).map(appOut) }), { auth: 'user' });
route('POST', '/api/apps', async ({ db, user, body }) => {
  const form = String(body.form || '');
  if (!FORMS[form]) fail(400, 'Ukjent søknadstype.');
  const job = JOBS.find((j) => j.k === form);
  if (job && !job.open) fail(409, 'Denne stillingen er stengt.');
  const mine = await userApps(db, user.id);
  if (form === 'whitelist' && mine.some((a) => a.form === 'whitelist' && a.status === 'godkjent')) fail(409, 'Du er allerede whitelistet.');
  const existing = mine.filter((a) => a.form === form && (a.status === 'utkast' || a.status === 'sendt')).sort((a, b) => b.created_at - a.created_at)[0];
  if (existing) return { app: appOut(existing), existing: true };
  limit('newapp:' + user.id, 20, 3600 * 1000);
  const now = Date.now(), id = await nextId(db, 'apps/');
  const a = { id, user_id: user.id, form, status: 'utkast', answers: {}, created_at: now, updated_at: now };
  await DB.set(db, `apps/${user.id}/${id}`, a);
  return { app: appOut(a) };
}, { auth: 'user' });
route('PUT', '/api/apps/:id', async ({ db, user, params, body }) => {
  const a = await ownApp(db, user, params.id);
  if (a.status !== 'utkast') fail(409, 'Søknaden er allerede sendt og kan ikke endres.');
  a.answers = cleanAnswers(a.form, body.answers); a.updated_at = Date.now();
  await DB.set(db, `apps/${user.id}/${a.id}`, a);
  return { ok: true };
}, { auth: 'user' });
route('POST', '/api/apps/:id/submit', async ({ C, db, user, params, body }) => {
  const a = await ownApp(db, user, params.id);
  if (a.status !== 'utkast') fail(409, 'Søknaden er allerede sendt.');
  const answers = body.answers ? cleanAnswers(a.form, body.answers) : a.answers || {};
  const errors = validate(a.form, answers);
  a.answers = answers; a.updated_at = Date.now();
  if (Object.keys(errors).length) { await DB.set(db, `apps/${user.id}/${a.id}`, a); fail(422, 'Noen felt mangler.', { errors }); }
  if (a.form !== 'whitelist' && !user.is_staff && !await hasWhitelist(db, user.id)) fail(409, 'Du må være whitelistet før du kan sende denne søknaden.');
  a.status = 'sendt'; a.submitted_at = Date.now();
  await DB.set(db, `apps/${user.id}/${a.id}`, a);
  await notify(C, `Ny søknad: ${FORMS[a.form].title}`, `**${user.name || user.username}** (${user.id}) har sendt en ${FORMS[a.form].title.toLowerCase()}-søknad.`);
  return { app: appOut(a) };
}, { auth: 'user' });
route('DELETE', '/api/apps/:id', async ({ db, user, params }) => {
  const a = await ownApp(db, user, params.id);
  if (a.status !== 'utkast') fail(409, 'Bare utkast kan slettes.');
  await DB.del(db, `apps/${user.id}/${a.id}`);
  return { ok: true };
}, { auth: 'user' });

/* ---- tickets ---- */
async function accessTicket(db, user, id) {
  const t = await findTicket(db, id);
  if (!t || (t.user_id !== user.id && !user.is_staff)) fail(404, 'Fant ikke ticketen.');
  return t;
}
route('GET', '/api/tickets', async ({ C, db, user }) => ({ tickets: (await DB.all(db, `tickets/${user.id}/`)).sort((a, b) => b.updated_at - a.updated_at).map((t) => ticketOut(C, t)) }), { auth: 'user' });
route('POST', '/api/tickets', async ({ C, db, user, body }) => ({ ticket: ticketOut(C, await createTicket(C, db, user, body.category, body.subject, body.body)) }), { auth: 'user' });
route('GET', '/api/tickets/:id', async ({ C, db, user, params }) => {
  const t = await accessTicket(db, user, params.id);
  const ids = [...new Set((t.msgs || []).map((m) => m.user_id))];
  const people = Object.fromEntries((await Promise.all(ids.map((id) => DB.get(db, 'users/' + id)))).filter(Boolean).map((u) => [u.id, u]));
  const owner = people[t.user_id] || await DB.get(db, 'users/' + t.user_id);
  return {
    ticket: ticketOut(C, t),
    isOwner: t.user_id === user.id,
    owner: user.is_staff && owner ? { id: owner.id, name: owner.name || owner.username, username: owner.username } : undefined,
    messages: (t.msgs || []).map((m) => {
      const p = people[m.user_id];
      return { id: m.id, staff: !!m.is_staff, body: m.body, createdAt: m.created_at, source: m.source || 'web', name: m.is_staff ? 'Novex Staff' : (p ? p.name || p.username : 'Spiller'), staffName: user.is_staff && m.is_staff && p ? p.name || p.username : undefined };
    })
  };
}, { auth: 'user' });
route('POST', '/api/tickets/:id/messages', async ({ C, db, user, params, body }) => {
  const t = await accessTicket(db, user, params.id);
  if (t.status === 'lukket') fail(409, 'Ticketen er lukket. Åpne den igjen for å svare.');
  const text = str(body.body, 4000);
  if (!text) fail(400, 'Skriv en melding.');
  limit('msg:' + user.id, 30, 10 * 60 * 1000);
  await addTicketMessage(C, db, t, user, text, !!user.is_staff && t.user_id !== user.id);
  return { ok: true };
}, { auth: 'user' });
route('PATCH', '/api/tickets/:id', async ({ C, db, user, params, body }) => {
  const t = await accessTicket(db, user, params.id);
  if (!['apen', 'lukket'].includes(body.status)) fail(400, 'Ugyldig status.');
  if (body.status !== t.status) await setTicketStatus(C, db, t, body.status, user.name || user.username);
  return { ok: true };
}, { auth: 'user' });

/* ---- staff ---- */
route('GET', '/api/staff/overview', async ({ db }) => {
  const [apps, tickets, users] = await Promise.all([DB.all(db, 'apps/'), DB.all(db, 'tickets/'), DB.keys(db, 'users/')]);
  return {
    pending: apps.filter((a) => a.status === 'sendt').length,
    openTickets: tickets.filter((t) => t.status === 'apen').length,
    users: users.length,
    whitelisted: new Set(apps.filter((a) => a.form === 'whitelist' && a.status === 'godkjent').map((a) => a.user_id)).size
  };
}, { auth: 'staff' });
route('GET', '/api/staff/apps', async ({ db, url }) => {
  const done = url.searchParams.get('vis') === 'behandlet';
  let apps = (await DB.all(db, 'apps/')).filter((a) => done ? a.status === 'godkjent' || a.status === 'avslatt' : a.status === 'sendt');
  apps.sort((a, b) => done ? (b.decided_at || 0) - (a.decided_at || 0) : (a.submitted_at || 0) - (b.submitted_at || 0));
  apps = apps.slice(0, 200);
  const ids = [...new Set(apps.flatMap((a) => [a.user_id, a.decided_by].filter(Boolean)))];
  const people = Object.fromEntries((await Promise.all(ids.map((id) => DB.get(db, 'users/' + id)))).filter(Boolean).map((u) => [u.id, u]));
  return {
    apps: apps.map((a) => {
      const u = people[a.user_id] || { id: a.user_id, username: 'ukjent' }, d = people[a.decided_by];
      return { ...appOut(a), user: { id: a.user_id, username: u.username, name: u.name || u.username, avatarUrl: avatarUrl(a.user_id, u.avatar) }, decidedBy: d ? d.name || d.username : null };
    })
  };
}, { auth: 'staff' });
route('POST', '/api/staff/apps/:id/decide', async ({ C, db, user, params, body }) => {
  const keys = await DB.keys(db, 'apps/');
  const k = keys.find((x) => x.split('/').pop() === String(Number(params.id) || 0));
  const a = k ? await DB.get(db, k) : null;
  if (!a) fail(404, 'Fant ikke søknaden.');
  if (a.status !== 'sendt') fail(409, 'Søknaden er allerede behandlet.');
  if (!['godkjent', 'avslatt'].includes(body.status)) fail(400, 'Ugyldig status.');
  a.reply = str(body.reply, 2000) || (body.status === 'godkjent' ? 'Søknaden er godkjent. Velkommen!' : 'Søknaden er dessverre avslått. Du kan søke på nytt.');
  a.status = body.status; a.decided_by = user.id; a.decided_at = a.updated_at = Date.now();
  await DB.set(db, k, a);
  let roleNote = '';
  if (a.status === 'godkjent' && a.form === 'whitelist' && C.botToken && C.guildId && C.wlRole) {
    const r = await discord(C, `/guilds/${C.guildId}/members/${a.user_id}/roles/${C.wlRole}`, { bot: true, method: 'PUT' });
    roleNote = r.ok ? 'Whitelist-rollen er gitt i Discord.' : 'Kunne ikke gi whitelist-rollen i Discord. Er spilleren med i Discord-serveren?';
  }
  return { ok: true, roleNote };
}, { auth: 'staff' });
route('GET', '/api/staff/tickets', async ({ C, db, url }) => {
  const all = url.searchParams.get('vis') === 'alle';
  const order = { apen: 0, besvart: 1, lukket: 2 };
  let tickets = (await DB.all(db, 'tickets/')).filter((t) => all || t.status !== 'lukket');
  tickets.sort((a, b) => (order[a.status] - order[b.status]) || b.updated_at - a.updated_at);
  tickets = tickets.slice(0, 200);
  const people = Object.fromEntries((await Promise.all([...new Set(tickets.map((t) => t.user_id))].map((id) => DB.get(db, 'users/' + id)))).filter(Boolean).map((u) => [u.id, u]));
  return { tickets: tickets.map((t) => ({ ...ticketOut(C, t), user: { id: t.user_id, name: people[t.user_id] ? people[t.user_id].name || people[t.user_id].username : 'Ukjent' } })) };
}, { auth: 'staff' });
route('POST', '/api/staff/discord/register', async ({ C }) => {
  if (!botOn(C)) fail(400, 'Boten er ikke satt opp. Legg inn DISCORD_BOT_TOKEN, DISCORD_GUILD_ID og DISCORD_CLIENT_ID.');
  const r = await discord(C, `/applications/${C.clientId}/guilds/${C.guildId}/commands`, { bot: true, method: 'PUT', body: [
    { name: 'ticket', description: 'Opprett en ticket til staff', type: 1 },
    { name: 'ticket-panel', description: 'Legg ut knappen for å opprette tickets i denne kanalen', type: 1, default_member_permissions: '32' }
  ] });
  if (!r.ok) fail(502, 'Discord avviste registreringen. Sjekk bot-tokenet og at boten er invitert til serveren.');
  return { ok: true };
}, { auth: 'staff' });

/* ---- Discord og FiveM ---- */
route('POST', '/api/discord/interactions', ({ C, db, req }) => interactions(C, db, req), { raw: true });
route('GET', '/api/fivem/whitelist/:discord', async ({ C, db, req, params }) => {
  if (!C.fivemKey || !safeEq(req.headers.get('x-api-key') || '', C.fivemKey)) fail(401, 'Ugyldig API-nøkkel.');
  const id = params.discord.replace(/^discord:/, '');
  if (!/^\d{15,21}$/.test(id)) fail(400, 'Ugyldig Discord-ID.');
  const u = await DB.get(db, 'users/' + id);
  const staff = !!(u && u.is_staff) || C.staffIds.includes(id);
  return { whitelisted: staff || await hasWhitelist(db, id), registered: !!u, staff };
}, { raw: true });

/* ------------------------------------------------------------------ */
/* Inngang                                                             */
/* ------------------------------------------------------------------ */
export async function handle(req, ctx = {}) {
  const C = loadConfig();
  const url = new URL(req.url);
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      const ip = ctx.ip || req.headers.get('x-nf-client-connection-ip') || '?';
      const db = await getDb();
      const c = { C, db, req, url, params, ip };
      const mutating = req.method !== 'GET' && req.method !== 'HEAD';
      if (mutating && !r.opt.raw) {
        if (req.headers.get('x-novex') !== '1') fail(403, 'Ugyldig forespørsel.');
        limit('w:' + ip, 120, 60 * 1000);
      }
      if (r.opt.auth) {
        c.user = await getUser(C, db, req);
        if (r.opt.auth !== 'optional') {
          if (!c.user) fail(401, 'Du må logge inn.');
          if (r.opt.auth === 'staff' && !c.user.is_staff) fail(403, 'Bare staff har tilgang.');
        }
      }
      if (mutating && !r.opt.raw) {
        const text = await req.text();
        if (text.length > 100_000) fail(413, 'Forespørselen er for stor.');
        try { c.body = text ? JSON.parse(text) : {}; } catch { fail(400, 'Ugyldig JSON.'); }
        if (!c.body || typeof c.body !== 'object' || Array.isArray(c.body)) fail(400, 'Ugyldig JSON.');
      } else c.body = {};
      const out = await r.handler(c);
      return out instanceof Response ? out : json(200, out);
    }
    return json(404, { error: 'Fant ikke ressursen.' });
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message, ...(e.extra || {}) });
    console.error(e);
    return json(500, { error: 'Noe gikk galt på serveren.' });
  }
}

export default async (req, context) => handle(req, { ip: context && context.ip });
export const config = { path: ['/api/*', '/auth/*'] };
