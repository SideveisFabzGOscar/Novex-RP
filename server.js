'use strict';
/*
 * Project Novex RP – nettside og spillerpanel
 * Ingen npm-pakker: bare Node.js 22.13+ (innebygd SQLite og fetch).
 * Start: node server.js
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Skjul advarselen om at SQLite er "experimental" i Node 22
const emitWarning = process.emitWarning;
process.emitWarning = (w, ...a) => { if (String(w).includes('SQLite')) return; emitWarning.call(process, w, ...a); };
const { DatabaseSync } = require('node:sqlite');

/* ------------------------------------------------------------------ */
/* Konfigurasjon                                                       */
/* ------------------------------------------------------------------ */
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnv(path.join(__dirname, '.env'));

const env = process.env;
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
const PORT = Number(env.PORT) || 3000;
const CFG = {
  base: (env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, ''),
  clientId: env.DISCORD_CLIENT_ID || '',
  clientSecret: env.DISCORD_CLIENT_SECRET || '',
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
  heroCredit: env.HERO_CREDIT || '',
  trustProxy: env.TRUST_PROXY === 'true',
  dbFile: env.DATABASE_FILE || path.join(__dirname, 'data', 'novex.db')
};
CFG.secure = CFG.base.startsWith('https://');
CFG.loginEnabled = !!(CFG.clientId && CFG.clientSecret);

const { FORMS, JOBS, CATS, validate } = require('./public/forms.js');

/* ------------------------------------------------------------------ */
/* Database                                                            */
/* ------------------------------------------------------------------ */
fs.mkdirSync(path.dirname(CFG.dbFile), { recursive: true });
const db = new DatabaseSync(CFG.dbFile);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  name TEXT,
  avatar TEXT,
  is_staff INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  form TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'utkast',
  answers TEXT NOT NULL DEFAULT '{}',
  reply TEXT,
  decided_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  submitted_at INTEGER,
  decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS apps_user ON applications(user_id);
CREATE INDEX IF NOT EXISTS apps_status ON applications(status);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'apen',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tickets_user ON tickets(user_id);
CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  is_staff INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS msgs_ticket ON ticket_messages(ticket_id);
`);
// Nye kolonner for Discord-synk (legges til automatisk i eksisterende databaser)
const hasCol = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
if (!hasCol('tickets', 'channel_id')) db.exec('ALTER TABLE tickets ADD COLUMN channel_id TEXT');
if (!hasCol('ticket_messages', 'source')) db.exec("ALTER TABLE ticket_messages ADD COLUMN source TEXT NOT NULL DEFAULT 'web'");
db.exec('CREATE INDEX IF NOT EXISTS tickets_channel ON tickets(channel_id)');
const stmts = new Map();
const S = (sql) => { let s = stmts.get(sql); if (!s) { s = db.prepare(sql); stmts.set(sql, s); } return s; };

/* ------------------------------------------------------------------ */
/* Hjelpere                                                            */
/* ------------------------------------------------------------------ */
class HttpError extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; } }
const fail = (status, msg, extra) => { throw new HttpError(status, msg, extra); };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const str = (v, max) => String(v == null ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, max);

function json(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}
function redirect(res, location, cookies) {
  const h = { Location: location, 'Cache-Control': 'no-store' };
  if (cookies) h['Set-Cookie'] = cookies;
  res.writeHead(302, h);
  res.end();
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) { try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch { /* ignorer */ } }
  });
  return out;
}
const cookie = (name, val, maxAge) => `${name}=${encodeURIComponent(val)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${CFG.secure ? '; Secure' : ''}`;
function clientIp(req) {
  if (CFG.trustProxy && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || '?';
}
async function readJson(req) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 100_000) fail(413, 'Forespørselen er for stor.'); chunks.push(c); }
  if (!size) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v;
  } catch { fail(400, 'Ugyldig JSON.'); }
}

/* enkel rate-begrensning i minnet */
const buckets = new Map();
function limit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  if (++b.n > max) fail(429, 'For mange forespørsler. Vent litt og prøv igjen.');
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
  S('DELETE FROM sessions WHERE expires_at < ?').run(now);
}, 10 * 60 * 1000).unref();

/* ------------------------------------------------------------------ */
/* Brukere og sesjoner                                                 */
/* ------------------------------------------------------------------ */
const SESSION_MS = 30 * 24 * 3600 * 1000;
function getUser(req) {
  const sid = parseCookies(req).novex_sid;
  if (!sid) return null;
  const row = S('SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?').get(sha(sid));
  if (!row) return null;
  if (row.expires_at < Date.now()) { S('DELETE FROM sessions WHERE id = ?').run(sha(sid)); return null; }
  row.is_staff = row.is_staff || CFG.staffIds.includes(row.id) ? 1 : 0;
  return row;
}
function avatarUrl(id, avatar) {
  if (avatar) return `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=128`;
  let n = 0; try { n = Number((BigInt(id) >> 22n) % 6n); } catch { /* ignorer */ }
  return `https://cdn.discordapp.com/embed/avatars/${n}.png`;
}
const isStaffId = (u) => !!u && (u.is_staff || CFG.staffIds.includes(u.id));
const hasWhitelist = (id) => !!S("SELECT 1 FROM applications WHERE user_id = ? AND form = 'whitelist' AND status = 'godkjent' LIMIT 1").get(id);
function publicUser(u) {
  return {
    id: u.id, username: u.username, name: u.name || u.username, avatarUrl: avatarUrl(u.id, u.avatar),
    isStaff: !!u.is_staff, whitelisted: !!u.is_staff || hasWhitelist(u.id), createdAt: u.created_at
  };
}
function appOut(a) {
  let answers = {}; try { answers = JSON.parse(a.answers); } catch { /* ignorer */ }
  return {
    id: a.id, form: a.form, status: a.status, answers, reply: a.reply || '',
    createdAt: a.created_at, updatedAt: a.updated_at, submittedAt: a.submitted_at, decidedAt: a.decided_at
  };
}
const ticketOut = (t) => ({
  id: t.id, subject: t.subject, category: t.category, status: t.status, createdAt: t.created_at, updatedAt: t.updated_at,
  channelUrl: t.channel_id && CFG.guildId ? `https://discord.com/channels/${CFG.guildId}/${t.channel_id}` : null
});

/* ------------------------------------------------------------------ */
/* Discord                                                             */
/* ------------------------------------------------------------------ */
async function discord(pathname, { token, bot, method = 'GET', body, form } = {}) {
  const headers = { 'User-Agent': `NovexRP (${CFG.base}, 1.0)` };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (bot) headers.Authorization = 'Bot ' + CFG.botToken;
  let payload;
  if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString(); }
  else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  else if (method === 'PUT') headers['Content-Length'] = '0';
  try {
    const r = await fetch('https://discord.com/api/v10' + pathname, { method, headers, body: payload, signal: AbortSignal.timeout(8000) });
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* ignorer */ }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    console.error('Discord-kall feilet:', pathname, e.message);
    return { ok: false, status: 0, data: null };
  }
}
function notify(title, description, color = 0xe0141f) {
  if (!CFG.webhook) return;
  fetch(CFG.webhook, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [{ title: title.slice(0, 256), description: description.slice(0, 2000), url: CFG.base + '/#staff', color, timestamp: new Date().toISOString() }] })
  }).catch((e) => console.error('Webhook feilet:', e.message));
}

async function authStart(ctx) {
  if (!CFG.loginEnabled) return redirect(ctx.res, '/?feil=oppsett#panel');
  const state = crypto.randomBytes(16).toString('hex');
  const scope = ['identify']; if (CFG.guildId) scope.push('guilds.members.read');
  const u = new URL('https://discord.com/oauth2/authorize');
  u.search = new URLSearchParams({ client_id: CFG.clientId, redirect_uri: CFG.base + '/auth/callback', response_type: 'code', scope: scope.join(' '), state, prompt: 'none' }).toString();
  redirect(ctx.res, u.toString(), [cookie('novex_state', state, 600)]);
}
async function authCallback(ctx) {
  const { url, req, res } = ctx;
  const clear = cookie('novex_state', '', 0);
  const back = (feil) => redirect(res, `/?feil=${feil}#panel`, [clear]);
  if (url.searchParams.get('error')) return back('avbrutt');
  const code = url.searchParams.get('code'), state = url.searchParams.get('state'), saved = parseCookies(req).novex_state;
  if (!code || !state || !saved || !safeEq(state, saved)) return back('state');
  limit('login:' + ctx.ip, 20, 10 * 60 * 1000);

  const tok = await discord('/oauth2/token', { method: 'POST', form: { client_id: CFG.clientId, client_secret: CFG.clientSecret, grant_type: 'authorization_code', code, redirect_uri: CFG.base + '/auth/callback' } });
  if (!tok.ok || !tok.data || !tok.data.access_token) return back('discord');
  const token = tok.data.access_token;
  const me = await discord('/users/@me', { token });
  if (!me.ok || !me.data || !me.data.id) return back('discord');

  let roles = [], member = false;
  if (CFG.guildId) {
    const m = await discord(`/users/@me/guilds/${CFG.guildId}/member`, { token });
    if (m.ok && m.data) { member = true; roles = m.data.roles || []; }
  }
  if (CFG.guildId && CFG.requireGuild && !member) return back('medlem');

  const d = me.data, now = Date.now();
  const staff = CFG.staffIds.includes(d.id) || roles.some((r) => CFG.staffRoles.includes(r)) ? 1 : 0;
  S(`INSERT INTO users (id, username, name, avatar, is_staff, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET username = excluded.username, name = excluded.name, avatar = excluded.avatar, is_staff = excluded.is_staff, last_login = excluded.last_login`)
    .run(d.id, d.username, d.global_name || d.username, d.avatar || null, staff, now, now);
  const sid = crypto.randomBytes(32).toString('hex');
  S('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(sha(sid), d.id, now + SESSION_MS);
  redirect(res, '/#panel', [clear, cookie('novex_sid', sid, SESSION_MS / 1000)]);
}
function authLogout(ctx) {
  const sid = parseCookies(ctx.req).novex_sid;
  if (sid) S('DELETE FROM sessions WHERE id = ?').run(sha(sid));
  json(ctx.res, 200, { ok: true }, { 'Set-Cookie': cookie('novex_sid', '', 0) });
}

/* ------------------------------------------------------------------ */
/* Tickets (felles for nettsiden og Discord-boten)                     */
/* ------------------------------------------------------------------ */
const getTicket = (id) => S('SELECT * FROM tickets WHERE id = ?').get(Number(id) || 0);
const isStaffDiscord = (id, roles = []) => CFG.staffIds.includes(id) || roles.some((r) => CFG.staffRoles.includes(r));
function upsertDiscordUser(d, staff) {
  const now = Date.now();
  S(`INSERT INTO users (id, username, name, avatar, is_staff, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET username = excluded.username, name = excluded.name, avatar = excluded.avatar, is_staff = excluded.is_staff`)
    .run(d.id, d.username, d.global_name || d.username, d.avatar || null, staff ? 1 : 0, now, now);
  return S('SELECT * FROM users WHERE id = ?').get(d.id);
}
function createTicket(user, category, subject, text, opt = {}) {
  subject = str(subject, 80); text = str(text, 4000);
  category = CATS.includes(category) ? category : 'Annet';
  if (!subject || !text) fail(400, 'Fyll ut emne og beskrivelse.');
  const open = S("SELECT COUNT(*) AS n FROM tickets WHERE user_id = ? AND status != 'lukket'").get(user.id).n;
  if (open >= 5) fail(409, 'Du har allerede 5 åpne tickets. Lukk en før du oppretter en ny.');
  limit('ticket:' + user.id, 5, 10 * 60 * 1000);
  const now = Date.now();
  const r = S("INSERT INTO tickets (user_id, category, subject, status, created_at, updated_at) VALUES (?, ?, ?, 'apen', ?, ?)").run(user.id, category, subject, now, now);
  S('INSERT INTO ticket_messages (ticket_id, user_id, is_staff, body, created_at, source) VALUES (?, ?, 0, ?, ?, ?)').run(r.lastInsertRowid, user.id, text, now, opt.source || 'web');
  const t = getTicket(r.lastInsertRowid);
  notify(`Ny ticket #${1000 + t.id}: ${subject}`, `**${user.name || user.username}** · ${category}${opt.source === 'discord' ? ' · via Discord' : ''}\n\n${text.slice(0, 500)}`, 0x2b2425);
  bot.ticketCreated(t);
  return t;
}
function addTicketMessage(t, user, text, asStaff, opt = {}) {
  const now = Date.now(), status = asStaff ? 'besvart' : 'apen';
  S('INSERT INTO ticket_messages (ticket_id, user_id, is_staff, body, created_at, source) VALUES (?, ?, ?, ?, ?, ?)').run(t.id, user.id, asStaff ? 1 : 0, text, now, opt.source || 'web');
  S('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?').run(status, now, t.id);
  t.status = status;
  if (!asStaff && opt.source !== 'discord') notify(`Svar på ticket #${1000 + t.id}`, `**${user.name || user.username}**: ${text.slice(0, 500)}`, 0x2b2425);
  bot.messageAdded(t, { body: text, name: user.name || user.username, staff: asStaff, source: opt.source || 'web' });
}
function setTicketStatus(t, status, opt = {}) {
  S('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), t.id);
  t.status = status;
  bot.statusChanged(t, status, opt.byName);
}
const bot = require('./bot.js')({
  CFG, CATS, HttpError, tno: (id) => 1000 + Number(id),
  isStaff: isStaffDiscord, upsertUser: upsertDiscordUser, getTicket,
  ticketByChannel: (ch) => S('SELECT * FROM tickets WHERE channel_id = ?').get(ch),
  setChannel: (id, ch) => S('UPDATE tickets SET channel_id = ? WHERE id = ?').run(ch, id),
  firstMessage: (id) => S('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY id LIMIT 1').get(id),
  createTicket, addMessage: addTicketMessage, setStatus: setTicketStatus
});

/* ------------------------------------------------------------------ */
/* FiveM-status                                                        */
/* ------------------------------------------------------------------ */
let statusCache = { at: 0, data: null };
async function serverStatus() {
  if (!CFG.fivemUrl) return { online: null };
  if (Date.now() - statusCache.at < 30000 && statusCache.data) return statusCache.data;
  let data;
  try {
    const signal = AbortSignal.timeout(4000);
    const [players, dyn] = await Promise.all([
      fetch(CFG.fivemUrl + '/players.json', { signal }).then((r) => r.json()),
      fetch(CFG.fivemUrl + '/dynamic.json', { signal }).then((r) => r.json())
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
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, opt });
}

route('GET', '/auth/discord', authStart);
route('GET', '/auth/callback', authCallback);
route('POST', '/auth/logout', authLogout);

route('GET', '/api/config', () => ({ connect: CFG.connect, invite: CFG.invite, trailer: CFG.trailer, heroYoutube: CFG.heroYoutube, heroCredit: CFG.heroCredit, loginEnabled: CFG.loginEnabled, discordTickets: bot.enabled }));
route('GET', '/api/me', ({ req }) => { const u = getUser(req); return { user: u ? publicUser(u) : null }; });
route('GET', '/api/status', () => serverStatus());

/* ---- søknader ---- */
function cleanAnswers(form, input) {
  const out = {};
  const src = input && typeof input === 'object' ? input : {};
  for (const q of FORMS[form].q) {
    if (src[q.id] == null) continue;
    const v = String(src[q.id]).slice(0, q.type === 'textarea' ? 5000 : 200);
    if (q.type === 'select' && v && !q.options.includes(v)) continue;
    out[q.id] = v;
  }
  return out;
}
function ownApp(user, id) {
  const a = S('SELECT * FROM applications WHERE id = ? AND user_id = ?').get(Number(id) || 0, user.id);
  if (!a) fail(404, 'Fant ikke søknaden.');
  return a;
}
route('GET', '/api/apps', ({ user }) => ({ apps: S('SELECT * FROM applications WHERE user_id = ? ORDER BY created_at DESC').all(user.id).map(appOut) }), { auth: 'user' });

route('POST', '/api/apps', ({ user, body }) => {
  const form = String(body.form || '');
  if (!FORMS[form]) fail(400, 'Ukjent søknadstype.');
  const job = JOBS.find((j) => j.k === form);
  if (job && !job.open) fail(409, 'Denne stillingen er stengt.');
  if (form === 'whitelist' && hasWhitelist(user.id)) fail(409, 'Du er allerede whitelistet.');
  const existing = S("SELECT * FROM applications WHERE user_id = ? AND form = ? AND status IN ('utkast', 'sendt') ORDER BY created_at DESC LIMIT 1").get(user.id, form);
  if (existing) return { app: appOut(existing), existing: true };
  limit('newapp:' + user.id, 20, 3600 * 1000);
  const now = Date.now();
  const r = S("INSERT INTO applications (user_id, form, status, answers, created_at, updated_at) VALUES (?, ?, 'utkast', '{}', ?, ?)").run(user.id, form, now, now);
  return { app: appOut(S('SELECT * FROM applications WHERE id = ?').get(r.lastInsertRowid)) };
}, { auth: 'user' });

route('PUT', '/api/apps/:id', ({ user, params, body }) => {
  const a = ownApp(user, params.id);
  if (a.status !== 'utkast') fail(409, 'Søknaden er allerede sendt og kan ikke endres.');
  S('UPDATE applications SET answers = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(cleanAnswers(a.form, body.answers)), Date.now(), a.id);
  return { ok: true };
}, { auth: 'user' });

route('POST', '/api/apps/:id/submit', ({ user, params, body }) => {
  const a = ownApp(user, params.id);
  if (a.status !== 'utkast') fail(409, 'Søknaden er allerede sendt.');
  const answers = body.answers ? cleanAnswers(a.form, body.answers) : JSON.parse(a.answers);
  const errors = validate(a.form, answers);
  if (Object.keys(errors).length) {
    S('UPDATE applications SET answers = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(answers), Date.now(), a.id);
    fail(422, 'Noen felt mangler.', { errors });
  }
  if (a.form !== 'whitelist' && !user.is_staff && !hasWhitelist(user.id)) fail(409, 'Du må være whitelistet før du kan sende denne søknaden.');
  const now = Date.now();
  S("UPDATE applications SET answers = ?, status = 'sendt', submitted_at = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(answers), now, now, a.id);
  notify(`Ny søknad: ${FORMS[a.form].title}`, `**${user.name || user.username}** (${user.id}) har sendt en ${FORMS[a.form].title.toLowerCase()}-søknad.`);
  return { app: appOut(S('SELECT * FROM applications WHERE id = ?').get(a.id)) };
}, { auth: 'user' });

route('DELETE', '/api/apps/:id', ({ user, params }) => {
  const a = ownApp(user, params.id);
  if (a.status !== 'utkast') fail(409, 'Bare utkast kan slettes.');
  S('DELETE FROM applications WHERE id = ?').run(a.id);
  return { ok: true };
}, { auth: 'user' });

/* ---- tickets ---- */
function accessTicket(user, id) {
  const t = S('SELECT * FROM tickets WHERE id = ?').get(Number(id) || 0);
  if (!t || (t.user_id !== user.id && !user.is_staff)) fail(404, 'Fant ikke ticketen.');
  return t;
}
route('GET', '/api/tickets', ({ user }) => ({ tickets: S('SELECT * FROM tickets WHERE user_id = ? ORDER BY updated_at DESC').all(user.id).map(ticketOut) }), { auth: 'user' });

route('POST', '/api/tickets', ({ user, body }) => ({ ticket: ticketOut(createTicket(user, body.category, body.subject, body.body)) }), { auth: 'user' });

route('GET', '/api/tickets/:id', ({ user, params }) => {
  const t = accessTicket(user, params.id);
  const msgs = S('SELECT m.*, u.name, u.username FROM ticket_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.ticket_id = ? ORDER BY m.id').all(t.id);
  const owner = S('SELECT * FROM users WHERE id = ?').get(t.user_id);
  return {
    ticket: ticketOut(t),
    isOwner: t.user_id === user.id,
    owner: user.is_staff && owner ? { id: owner.id, name: owner.name || owner.username, username: owner.username } : undefined,
    messages: msgs.map((m) => ({
      id: m.id, staff: !!m.is_staff, body: m.body, createdAt: m.created_at, source: m.source || 'web',
      name: m.is_staff ? 'Novex Staff' : (m.name || m.username || 'Spiller'),
      staffName: user.is_staff && m.is_staff ? (m.name || m.username) : undefined
    }))
  };
}, { auth: 'user' });

route('POST', '/api/tickets/:id/messages', ({ user, params, body }) => {
  const t = accessTicket(user, params.id);
  if (t.status === 'lukket') fail(409, 'Ticketen er lukket. Åpne den igjen for å svare.');
  const text = str(body.body, 4000);
  if (!text) fail(400, 'Skriv en melding.');
  limit('msg:' + user.id, 30, 10 * 60 * 1000);
  addTicketMessage(t, user, text, !!user.is_staff && t.user_id !== user.id);
  return { ok: true };
}, { auth: 'user' });

route('PATCH', '/api/tickets/:id', ({ user, params, body }) => {
  const t = accessTicket(user, params.id);
  if (!['apen', 'lukket'].includes(body.status)) fail(400, 'Ugyldig status.');
  if (body.status !== t.status) setTicketStatus(t, body.status, { byName: user.name || user.username });
  return { ok: true };
}, { auth: 'user' });

/* ---- staff ---- */
route('GET', '/api/staff/overview', () => ({
  pending: S("SELECT COUNT(*) AS n FROM applications WHERE status = 'sendt'").get().n,
  openTickets: S("SELECT COUNT(*) AS n FROM tickets WHERE status = 'apen'").get().n,
  users: S('SELECT COUNT(*) AS n FROM users').get().n,
  whitelisted: S("SELECT COUNT(DISTINCT user_id) AS n FROM applications WHERE form = 'whitelist' AND status = 'godkjent'").get().n
}), { auth: 'staff' });

route('GET', '/api/staff/apps', ({ url }) => {
  const done = url.searchParams.get('vis') === 'behandlet';
  const rows = S(`SELECT a.*, u.username, u.name AS uname, u.avatar, d.name AS dname, d.username AS dusername
    FROM applications a JOIN users u ON u.id = a.user_id LEFT JOIN users d ON d.id = a.decided_by
    WHERE ${done ? "a.status IN ('godkjent', 'avslatt')" : "a.status = 'sendt'"}
    ORDER BY ${done ? 'a.decided_at DESC' : 'a.submitted_at ASC'} LIMIT 200`).all();
  return {
    apps: rows.map((r) => ({
      ...appOut(r),
      user: { id: r.user_id, username: r.username, name: r.uname || r.username, avatarUrl: avatarUrl(r.user_id, r.avatar) },
      decidedBy: r.dname || r.dusername || null
    }))
  };
}, { auth: 'staff' });

route('POST', '/api/staff/apps/:id/decide', async ({ user, params, body }) => {
  const a = S('SELECT * FROM applications WHERE id = ?').get(Number(params.id) || 0);
  if (!a) fail(404, 'Fant ikke søknaden.');
  if (a.status !== 'sendt') fail(409, 'Søknaden er allerede behandlet.');
  if (!['godkjent', 'avslatt'].includes(body.status)) fail(400, 'Ugyldig status.');
  const reply = str(body.reply, 2000) || (body.status === 'godkjent' ? 'Søknaden er godkjent. Velkommen!' : 'Søknaden er dessverre avslått. Du kan søke på nytt.');
  const now = Date.now();
  S('UPDATE applications SET status = ?, reply = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?').run(body.status, reply, user.id, now, now, a.id);
  let roleNote = '';
  if (body.status === 'godkjent' && a.form === 'whitelist' && CFG.botToken && CFG.guildId && CFG.wlRole) {
    const r = await discord(`/guilds/${CFG.guildId}/members/${a.user_id}/roles/${CFG.wlRole}`, { bot: true, method: 'PUT' });
    roleNote = r.ok ? 'Whitelist-rollen er gitt i Discord.' : 'Kunne ikke gi whitelist-rollen i Discord. Er spilleren med i Discord-serveren?';
  }
  return { ok: true, roleNote };
}, { auth: 'staff' });

route('GET', '/api/staff/tickets', ({ url }) => {
  const all = url.searchParams.get('vis') === 'alle';
  const rows = S(`SELECT t.*, u.username, u.name AS uname FROM tickets t JOIN users u ON u.id = t.user_id
    ${all ? '' : "WHERE t.status != 'lukket'"}
    ORDER BY CASE t.status WHEN 'apen' THEN 0 WHEN 'besvart' THEN 1 ELSE 2 END, t.updated_at DESC LIMIT 200`).all();
  return { tickets: rows.map((r) => ({ ...ticketOut(r), user: { id: r.user_id, name: r.uname || r.username } })) };
}, { auth: 'staff' });

/* ---- FiveM ---- */
route('GET', '/api/fivem/whitelist/:discord', ({ req, params }) => {
  if (!CFG.fivemKey || !safeEq(req.headers['x-api-key'] || '', CFG.fivemKey)) fail(401, 'Ugyldig API-nøkkel.');
  const id = params.discord.replace(/^discord:/, '');
  if (!/^\d{15,21}$/.test(id)) fail(400, 'Ugyldig Discord-ID.');
  const u = S('SELECT * FROM users WHERE id = ?').get(id);
  const staff = isStaffId(u) || CFG.staffIds.includes(id);
  return { whitelisted: staff || hasWhitelist(id), registered: !!u, staff };
});

/* ------------------------------------------------------------------ */
/* Statiske filer                                                      */
/* ------------------------------------------------------------------ */
const PUBLIC = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2'
};
function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { rel = '/'; }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  const notFound = () => { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Fant ikke siden.'); };
  if (!file.startsWith(PUBLIC + path.sep) || path.basename(file).startsWith('.')) return notFound();
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return notFound();
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Cache-Control': type.startsWith('text/html') ? 'no-cache' : 'public, max-age=3600', 'Accept-Ranges': 'bytes' };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
      if (start < 0) start = 0;
      if (start >= st.size || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      end = Math.min(end, st.size - 1);
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://cdn.discordapp.com",
  "media-src 'self'",
  "connect-src 'self'",
  "frame-src https://www.youtube-nocookie.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  if (CFG.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); return res.end(); }
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      const ctx = { req, res, url, params, ip: clientIp(req) };
      const mutating = req.method !== 'GET' && req.method !== 'HEAD';
      if (mutating) {
        // Egendefinert header stopper CSRF fra andre nettsteder
        if (req.headers['x-novex'] !== '1') fail(403, 'Ugyldig forespørsel.');
        limit('w:' + ctx.ip, 120, 60 * 1000);
      }
      if (r.opt.auth) {
        ctx.user = getUser(req);
        if (!ctx.user) fail(401, 'Du må logge inn.');
        if (r.opt.auth === 'staff' && !ctx.user.is_staff) fail(403, 'Bare staff har tilgang.');
      }
      ctx.body = mutating ? await readJson(req) : {};
      const out = await r.handler(ctx);
      if (out !== undefined && !res.headersSent) json(res, 200, out);
      return;
    }
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) fail(404, 'Fant ikke ressursen.');
    if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'Metoden er ikke tillatt.');
    serveStatic(req, res, url.pathname);
  } catch (e) {
    if (res.headersSent) return;
    if (e instanceof HttpError) return json(res, e.status, { error: e.message, ...(e.extra || {}) });
    console.error(e);
    json(res, 500, { error: 'Noe gikk galt på serveren.' });
  }
});

server.listen(PORT, () => {
  console.log(`Novex RP kjører på ${CFG.base} (port ${PORT})`);
  if (!CFG.loginEnabled) console.warn('⚠  DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET mangler. Innlogging er slått av.');
  if (!CFG.staffIds.length && !CFG.staffRoles.length) console.warn('⚠  Ingen staff satt opp. Legg inn STAFF_DISCORD_IDS eller DISCORD_STAFF_ROLE_IDS.');
  if (!CFG.fivemKey) console.warn('⚠  FIVEM_API_KEY mangler. Whitelist-sjekken i FiveM vil avvise alle.');
  if (!CFG.secure && !CFG.base.includes('localhost')) console.warn('⚠  BASE_URL bruker ikke https. Bruk https i produksjon.');
  if (bot.enabled) bot.start(); else console.log('Ticket-boten er av (trenger DISCORD_BOT_TOKEN, DISCORD_GUILD_ID og DISCORD_CLIENT_ID).');
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { if (bot.stop) bot.stop(); server.close(); db.close(); process.exit(0); });
