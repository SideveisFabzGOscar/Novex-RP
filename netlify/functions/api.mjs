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
import shopModule from '../../public/shop.js';

const { FORMS, JOBS, CATS, validate, PERMS, PERM_KEYS, appPerm } = formsModule;
const SHOP = shopModule;

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
    rolePerms: list(env.DISCORD_STAFF_ROLE_PERMS).filter((p) => PERM_KEYS.includes(p)),
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
    tebexStore: (env.TEBEX_STORE_URL || '').replace(/\/+$/, ''),
    tebexSecret: env.TEBEX_WEBHOOK_SECRET || '',
    shopEmail: env.SHOP_CONTACT_EMAIL || ''
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
  return withStaff(C, db, u);
}

/* ------------------------------------------------------------------ */
/* Staff og rettigheter                                                */
/* ------------------------------------------------------------------ */
const ROLE_DEFAULT = ['tickets.view', 'tickets.close', 'apps.whitelist'];
/* Hvem er staff, og hva får de gjøre?
   1. Eiere (STAFF_DISCORD_IDS) har alltid alt.
   2. Staff lagt til på nettsiden har rettighetene som er valgt der.
   3. Har noen bare staff-rollen i Discord, får de standardrettigheter. */
async function staffInfo(C, db, id, roleStaff) {
  if (C.staffIds.includes(id)) return { owner: true, title: 'Eier', perms: PERM_KEYS.slice(), source: 'eier' };
  const r = await DB.get(db, 'staff/' + id);
  if (r) return { owner: false, title: r.title || 'Staff', perms: (r.perms || []).filter((p) => PERM_KEYS.includes(p)), source: 'nettside' };
  if (roleStaff) return { owner: false, title: 'Staff', perms: C.rolePerms.length ? C.rolePerms : ROLE_DEFAULT, source: 'rolle' };
  return null;
}
async function withStaff(C, db, u) {
  const info = await staffInfo(C, db, u.id, !!u.role_staff);
  u.staff = info; u.perms = info ? info.perms : []; u.is_staff = info ? 1 : 0;
  return u;
}
const can = (u, p) => !!(u && u.perms && u.perms.includes(p));
const need = (u, p, msg) => { if (!can(u, p)) fail(403, msg || 'Du har ikke tilgang til dette.'); };
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
    isStaff: !!u.is_staff, isOwner: !!(u.staff && u.staff.owner), staffTitle: u.staff ? u.staff.title : null, perms: u.perms || [],
    whitelisted: !!u.is_staff || await hasWhitelist(db, u.id), createdAt: u.created_at
  };
}
const appOut = (a) => ({
  id: a.id, form: a.form, status: a.status, answers: a.answers || {}, reply: a.reply || '',
  createdAt: a.created_at, updatedAt: a.updated_at, submittedAt: a.submitted_at || null, decidedAt: a.decided_at || null
});
const ticketOut = (C, t) => ({
  id: t.id, subject: t.subject, category: t.category, status: t.status, createdAt: t.created_at, updatedAt: t.updated_at,
  channelUrl: t.channel_id && C.guildId ? `https://discord.com/channels/${C.guildId}/${t.channel_id}` : null,
  messages: (t.msgs || []).length, replies: (t.msgs || []).filter((m) => m.is_staff).length
});
/* siste melding i en ticket, til forhåndsvisning i listene */
function lastOut(t, people, showStaffName) {
  const m = (t.msgs || [])[(t.msgs || []).length - 1];
  if (!m) return null;
  const p = people[m.user_id];
  return { staff: !!m.is_staff, name: m.is_staff ? (showStaffName && p ? p.name || p.username : 'Novex Staff') : (p ? p.name || p.username : 'Spiller'), body: m.body.slice(0, 160), at: m.created_at, source: m.source || 'web' };
}
async function peopleOf(db, ids) {
  return Object.fromEntries((await Promise.all([...new Set(ids)].map((id) => DB.get(db, 'users/' + id)))).filter(Boolean).map((u) => [u.id, u]));
}
async function upsertDiscordUser(db, d, roleStaff) {
  const now = Date.now();
  const old = await DB.get(db, 'users/' + d.id);
  const u = { id: d.id, username: d.username, name: d.global_name || d.username, avatar: d.avatar || null, role_staff: roleStaff ? 1 : 0, created_at: old ? old.created_at : now, last_login: old ? old.last_login : now };
  return DB.set(db, 'users/' + d.id, u);
}
const hasStaffRole = (C, roles = []) => roles.some((r) => C.staffRoles.includes(r));

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
  (await ticketViewers(C, db)).filter((id) => id !== t.user_id).forEach((id) => ov.push({ id, type: 1, allow: MEMBER_ALLOW }));
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
/* staff som er lagt til på nettsiden, har ikke nødvendigvis staff-rollen i Discord,
   så de får tilgang til ticket-kanalene hver for seg */
async function ticketViewers(C, db) {
  const recs = await DB.all(db, 'staff/');
  return [...new Set([...C.staffIds, ...recs.filter((r) => (r.perms || []).includes('tickets.view')).map((r) => r.id)])].slice(0, 80);
}
async function syncStaffChannels(C, db, id, canView) {
  if (!botOn(C)) return;
  const tickets = (await DB.all(db, 'tickets/')).filter((t) => t.channel_id && t.user_id !== id).sort((a, b) => b.updated_at - a.updated_at).slice(0, 40);
  for (let i = 0; i < tickets.length; i += 5) {
    await Promise.all(tickets.slice(i, i + 5).map((t) => canView
      ? discord(C, `/channels/${t.channel_id}/permissions/${id}`, { bot: true, method: 'PUT', body: { type: 1, allow: MEMBER_ALLOW } })
      : discord(C, `/channels/${t.channel_id}/permissions/${id}`, { bot: true, method: 'DELETE' })));
  }
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
  const roleStaff = hasStaffRole(C, roles);
  const info = await staffInfo(C, db, user.id, roleStaff);
  const perms = info ? info.perms : [];
  const staff = perms.includes('tickets.view'), closer = perms.includes('tickets.close');
  const fields = () => { const f = {}; (i.data.components || []).forEach((row) => (row.components || []).forEach((c) => { f[c.custom_id] = c.value; })); return f; };

  if (i.type === 2) {
    if (i.data.name === 'ticket') return json(200, categoryPicker());
    if (i.data.name === 'ticket-panel') {
      if (!perms.includes('discord.manage')) return ephemeral('Du trenger rettigheten «Discord-oppsett» for å legge ut ticket-panelet.');
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
      if (!closer) return ephemeral('Du har ikke rettighet til å slette ticket-kanaler.');
      if (t.channel_id) await discord(C, `/channels/${t.channel_id}`, { bot: true, method: 'DELETE' });
      t.channel_id = null; await DB.set(db, `tickets/${t.user_id}/${t.id}`, t);
      return json(200, { type: 6 });
    }
    if (t.user_id !== user.id && !closer) return ephemeral('Du har ikke rettighet til å lukke eller åpne andres tickets.');
    await upsertDiscordUser(db, user, roleStaff);
    const status = m[1] === 'close' ? 'lukket' : 'apen';
    if (t.status !== status) await setTicketStatus(C, db, t, status, user.global_name || user.username);
    return json(200, { type: 6 });
  }

  if (i.type === 5) {
    const id = i.data.custom_id, f = fields();
    const u = await upsertDiscordUser(db, user, roleStaff);
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
  await DB.set(db, 'users/' + d.id, { id: d.id, username: d.username, name: d.global_name || d.username, avatar: d.avatar || null, role_staff: hasStaffRole(C, roles) ? 1 : 0, created_at: old ? old.created_at : now, last_login: now });
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
route('GET', '/api/config', ({ C }) => ({ connect: C.connect, invite: C.invite, trailer: C.trailer, heroYoutube: C.heroYoutube, heroCredit: C.heroCredit, loginEnabled: !!(C.clientId && C.clientSecret), discordTickets: botOn(C) && !!C.publicKey, shopOpen: shopOpen(C), shopEmail: C.shopEmail }));
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
  if (!t || (t.user_id !== user.id && !can(user, 'tickets.view'))) fail(404, 'Fant ikke ticketen.');
  return t;
}
route('GET', '/api/tickets', async ({ C, db, user }) => {
  const list = (await DB.all(db, `tickets/${user.id}/`)).sort((a, b) => b.updated_at - a.updated_at);
  const people = await peopleOf(db, list.map((t) => { const m = (t.msgs || []).slice(-1)[0]; return m ? m.user_id : t.user_id; }));
  return { tickets: list.map((t) => ({ ...ticketOut(C, t), last: lastOut(t, people, false) })) };
}, { auth: 'user' });
route('POST', '/api/tickets', async ({ C, db, user, body }) => ({ ticket: ticketOut(C, await createTicket(C, db, user, body.category, body.subject, body.body)) }), { auth: 'user' });
route('GET', '/api/tickets/:id', async ({ C, db, user, params }) => {
  const t = await accessTicket(db, user, params.id);
  const ids = [...new Set((t.msgs || []).map((m) => m.user_id))];
  const people = Object.fromEntries((await Promise.all(ids.map((id) => DB.get(db, 'users/' + id)))).filter(Boolean).map((u) => [u.id, u]));
  const owner = people[t.user_id] || await DB.get(db, 'users/' + t.user_id);
  return {
    ticket: ticketOut(C, t),
    isOwner: t.user_id === user.id,
    owner: can(user, 'tickets.view') && owner ? { id: owner.id, name: owner.name || owner.username, username: owner.username } : undefined,
    messages: (t.msgs || []).map((m) => {
      const p = people[m.user_id];
      return { id: m.id, staff: !!m.is_staff, body: m.body, createdAt: m.created_at, source: m.source || 'web', name: m.is_staff ? 'Novex Staff' : (p ? p.name || p.username : 'Spiller'), staffName: can(user, 'tickets.view') && m.is_staff && p ? p.name || p.username : undefined };
    })
  };
}, { auth: 'user' });
route('POST', '/api/tickets/:id/messages', async ({ C, db, user, params, body }) => {
  const t = await accessTicket(db, user, params.id);
  if (t.status === 'lukket') fail(409, 'Ticketen er lukket. Åpne den igjen for å svare.');
  const text = str(body.body, 4000);
  if (!text) fail(400, 'Skriv en melding.');
  limit('msg:' + user.id, 30, 10 * 60 * 1000);
  await addTicketMessage(C, db, t, user, text, can(user, 'tickets.view') && t.user_id !== user.id);
  return { ok: true };
}, { auth: 'user' });
route('PATCH', '/api/tickets/:id', async ({ C, db, user, params, body }) => {
  const t = await accessTicket(db, user, params.id);
  if (!['apen', 'lukket'].includes(body.status)) fail(400, 'Ugyldig status.');
  if (t.user_id !== user.id) need(user, 'tickets.close', 'Du har ikke rettighet til å lukke eller åpne andres tickets.');
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
route('GET', '/api/staff/apps', async ({ db, url, user }) => {
  const done = url.searchParams.get('vis') === 'behandlet';
  let apps = (await DB.all(db, 'apps/')).filter((a) => can(user, appPerm(a.form)) && (done ? a.status === 'godkjent' || a.status === 'avslatt' : a.status === 'sendt'));
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
  need(user, appPerm(a.form), 'Du har ikke rettighet til å behandle denne typen søknad.');
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
route('GET', '/api/staff/tickets', async ({ C, db, url, user }) => {
  if (!can(user, 'tickets.view')) return { tickets: [] };
  /* alle tickets, også lukkede, så staff kan gå tilbake i historikken. Filtrering og sortering skjer i panelet. */
  let tickets = (await DB.all(db, 'tickets/')).sort((a, b) => b.updated_at - a.updated_at).slice(0, 3000);
  const people = await peopleOf(db, tickets.flatMap((t) => [t.user_id, ((t.msgs || []).slice(-1)[0] || {}).user_id].filter(Boolean)));
  return { tickets: tickets.map((t) => { const u = people[t.user_id]; return { ...ticketOut(C, t), last: lastOut(t, people, true), user: { id: t.user_id, name: u ? u.name || u.username : 'Ukjent', username: u ? u.username : '', avatarUrl: avatarUrl(t.user_id, u && u.avatar) } }; }) };
}, { auth: 'staff' });
route('POST', '/api/staff/discord/register', async ({ C, user }) => {
  need(user, 'discord.manage', 'Du trenger rettigheten «Discord-oppsett».');
  if (!botOn(C)) fail(400, 'Boten er ikke satt opp. Legg inn DISCORD_BOT_TOKEN, DISCORD_GUILD_ID og DISCORD_CLIENT_ID.');
  const r = await discord(C, `/applications/${C.clientId}/guilds/${C.guildId}/commands`, { bot: true, method: 'PUT', body: [
    { name: 'ticket', description: 'Opprett en ticket til staff', type: 1 },
    { name: 'ticket-panel', description: 'Legg ut knappen for å opprette tickets i denne kanalen', type: 1, default_member_permissions: '32' }
  ] });
  if (!r.ok) fail(502, 'Discord avviste registreringen. Sjekk bot-tokenet og at boten er invitert til serveren.');
  return { ok: true };
}, { auth: 'staff' });

/* ---- staff-teamet ---- */
const ID_RE = /^\d{15,21}$/;
async function staffLog(db, by, target, action, perms) {
  const at = Date.now();
  await DB.set(db, `stafflog/${at}-${crypto.randomBytes(3).toString('hex')}`, { at, by: by.id, byName: by.name || by.username, target: target.id, targetName: target.name || target.username || target.id, action, perms: perms || [] });
}
/* sjekker at den som endrer, får lov til å endre denne personen */
async function checkTarget(C, db, user, id) {
  need(user, 'staff.manage', 'Du har ikke rettighet til å administrere staff.');
  if (!ID_RE.test(id)) fail(400, 'Ugyldig Discord-ID. Den skal være 17–20 siffer.');
  if (id === user.id) fail(409, 'Du kan ikke endre dine egne rettigheter.');
  if (C.staffIds.includes(id)) fail(409, 'Eiere styres i Netlify (STAFF_DISCORD_IDS) og kan ikke endres her.');
  const old = await DB.get(db, 'staff/' + id);
  if (old && !user.staff.owner) {
    if ((old.perms || []).includes('staff.manage')) fail(403, 'Bare eieren kan endre staff som selv kan administrere staff.');
    if ((old.perms || []).some((p) => !user.perms.includes(p))) fail(403, 'Denne personen har rettigheter du ikke har selv, så du kan ikke endre dem.');
  }
  return old;
}
route('GET', '/api/staff/team', async ({ C, db, user }) => {
  need(user, 'staff.manage', 'Du har ikke rettighet til å administrere staff.');
  const [recs, logKeys] = await Promise.all([DB.all(db, 'staff/'), DB.keys(db, 'stafflog/')]);
  const ids = [...new Set([...C.staffIds, ...recs.map((r) => r.id)])];
  const users = Object.fromEntries((await Promise.all(ids.map((id) => DB.get(db, 'users/' + id)))).filter(Boolean).map((u) => [u.id, u]));
  const person = (id, r) => { const u = users[id] || {}; const name = u.name || (r && r.name) || u.username || (r && r.username) || 'Ukjent'; return { id, name, username: u.username || (r && r.username) || '', avatarUrl: avatarUrl(id, u.avatar || (r && r.avatar)), lastLogin: u.last_login || null }; };
  const team = [
    ...C.staffIds.map((id) => ({ ...person(id), title: 'Eier', perms: PERM_KEYS, owner: true })),
    ...recs.filter((r) => !C.staffIds.includes(r.id)).map((r) => ({ ...person(r.id, r), title: r.title || 'Staff', perms: (r.perms || []).filter((p) => PERM_KEYS.includes(p)), owner: false, addedAt: r.added_at, updatedAt: r.updated_at }))
  ];
  const logs = (await Promise.all(logKeys.sort().reverse().slice(0, 25).map((k) => DB.get(db, k)))).filter(Boolean);
  return { team, log: logs, roleStaff: C.staffRoles.length ? (C.rolePerms.length ? C.rolePerms : ROLE_DEFAULT) : null };
}, { auth: 'staff' });
route('GET', '/api/staff/players', async ({ C, db, user, url }) => {
  need(user, 'staff.manage', 'Du har ikke rettighet til å administrere staff.');
  const q = str(url.searchParams.get('q'), 40).toLowerCase();
  const staffIds = new Set([...C.staffIds, ...(await DB.keys(db, 'staff/')).map((k) => k.split('/').pop())]);
  const keys = (await DB.keys(db, 'users/')).filter((k) => !staffIds.has(k.split('/').pop())).slice(0, 1500);
  const users = (await Promise.all(keys.map((k) => DB.get(db, k)))).filter(Boolean);
  const hit = users.filter((u) => !q || u.id.includes(q) || (u.name || '').toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q));
  hit.sort((a, b) => (b.last_login || 0) - (a.last_login || 0));
  return { players: hit.slice(0, 20).map((u) => ({ id: u.id, name: u.name || u.username, username: u.username, avatarUrl: avatarUrl(u.id, u.avatar) })) };
}, { auth: 'staff' });
route('PUT', '/api/staff/team/:id', async ({ C, db, user, params, body }) => {
  const id = params.id;
  const old = await checkTarget(C, db, user, id);
  const perms = [...new Set(Array.isArray(body.perms) ? body.perms.map(String) : [])].filter((p) => PERM_KEYS.includes(p));
  if (!user.staff.owner) {
    const extra = perms.filter((p) => !user.perms.includes(p));
    if (extra.length) fail(403, 'Du kan bare gi rettigheter du har selv.');
    if (perms.includes('staff.manage')) fail(403, 'Bare eieren kan gi rettigheten «Administrere staff».');
  }
  const title = str(body.title, 30) || 'Staff';
  let u = await DB.get(db, 'users/' + id);
  let profile = u ? { name: u.name || u.username, username: u.username, avatar: u.avatar } : old ? { name: old.name, username: old.username, avatar: old.avatar } : null;
  if (!profile) {
    if (!botOn(C)) fail(404, 'Personen har ikke logget inn på nettsiden ennå. Be dem logge inn først, eller sett opp boten så siden kan slå opp Discord-ID-en.');
    const d = await discord(C, '/users/' + id, { bot: true });
    if (!d.ok || !d.data || !d.data.id) fail(404, 'Fant ingen Discord-bruker med den ID-en.');
    if (d.data.bot) fail(400, 'Du kan ikke gjøre en bot til staff.');
    profile = { name: d.data.global_name || d.data.username, username: d.data.username, avatar: d.data.avatar || null };
  }
  const now = Date.now();
  const rec = { id, title, perms, ...profile, added_by: old ? old.added_by : user.id, added_at: old ? old.added_at : now, updated_by: user.id, updated_at: now };
  await DB.set(db, 'staff/' + id, rec);
  const hadView = !!(old && (old.perms || []).includes('tickets.view')), hasView = perms.includes('tickets.view');
  if (hadView !== hasView) await syncStaffChannels(C, db, id, hasView);
  await staffLog(db, user, { id, name: profile.name }, old ? 'endret' : 'la til', perms);
  await notify(C, old ? 'Staff-rettigheter endret' : 'Ny staff', `**${user.name || user.username}** ${old ? 'endret rettighetene til' : 'la til'} **${profile.name}** som ${title}.`, 0x2b2425);
  return { ok: true };
}, { auth: 'staff' });
route('DELETE', '/api/staff/team/:id', async ({ C, db, user, params }) => {
  const id = params.id;
  const old = await checkTarget(C, db, user, id);
  if (!old) fail(404, 'Personen er ikke staff på nettsiden.');
  await DB.del(db, 'staff/' + id);
  if ((old.perms || []).includes('tickets.view')) await syncStaffChannels(C, db, id, false);
  await staffLog(db, user, { id, name: old.name }, 'fjernet', []);
  await notify(C, 'Staff fjernet', `**${user.name || user.username}** fjernet **${old.name || id}** fra staff.`, 0x2b2425);
  return { ok: true };
}, { auth: 'staff' });

/* ---- butikk (bedrifter som selges via Tebex) ---- */
const shopOpen = (C) => !!(C.tebexStore && C.tebexSecret);
const listingDef = (id) => SHOP.LISTINGS.find((l) => l.id === id);
async function listingState(db, id) {
  const st = (await DB.get(db, 'shop/' + id)) || { id, status: 'ledig' };
  if (st.status === 'reservert' && st.reserved_until < Date.now()) { st.status = 'ledig'; st.reserved_by = null; }
  return st;
}
async function allListings(db) {
  const states = await Promise.all(SHOP.LISTINGS.map((l) => listingState(db, l.id)));
  return SHOP.LISTINGS.map((l, i) => ({ def: l, st: states[i] }));
}
const ownedBy = (all, uid) => all.filter((x) => x.st.status === 'solgt' && x.st.owner === uid);
function listingOut(C, def, st, user) {
  const mine = !!(user && (st.owner === user.id || st.reserved_by === user.id));
  return {
    id: def.id, type: def.type, name: def.name, area: def.area, price: def.price, note: def.note, ready: !!SHOP.packageOf(def),
    status: st.status, mine, reservedUntil: st.status === 'reservert' && st.reserved_by === (user && user.id) ? st.reserved_until : null
  };
}
route('GET', '/api/shop', async ({ C, db, user }) => {
  const all = await allListings(db);
  return {
    open: shopOpen(C), email: C.shopEmail, maxPerPlayer: SHOP.MAX_PER_PLAYER,
    listings: all.map((x) => listingOut(C, x.def, x.st, user)),
    owned: user ? ownedBy(all, user.id).map((x) => ({ id: x.def.id, name: x.def.name, type: x.def.type, since: x.st.sold_at })) : []
  };
}, { auth: 'optional' });
route('POST', '/api/shop/:id/reserve', async ({ C, db, user, params, body }) => {
  if (!shopOpen(C)) fail(409, 'Butikken er ikke åpnet ennå.');
  const def = listingDef(params.id);
  if (!def) fail(404, 'Fant ikke bedriften.');
  if (!SHOP.packageOf(def)) fail(409, 'Denne bedriften er ikke koblet til betaling ennå.');
  if (body.terms !== true) fail(400, 'Du må godta vilkårene før du kjøper.');
  if (!user.is_staff && !await hasWhitelist(db, user.id)) fail(409, 'Du må være whitelistet før du kan kjøpe en bedrift.');
  limit('reserve:' + user.id, 10, 10 * 60 * 1000);
  const all = await allListings(db);
  if (ownedBy(all, user.id).length >= SHOP.MAX_PER_PLAYER) fail(409, SHOP.MAX_PER_PLAYER === 1 ? 'Du eier allerede en bedrift. Hver spiller kan eie én.' : `Du kan eie maks ${SHOP.MAX_PER_PLAYER} bedrifter.`);
  const st = all.find((x) => x.def.id === def.id).st;
  if (st.status === 'solgt') fail(409, 'Bedriften er allerede solgt.');
  if (st.status === 'reservert' && st.reserved_by !== user.id) fail(409, 'Noen andre holder på å kjøpe denne bedriften. Prøv igjen om litt.');
  /* bare én reservasjon om gangen per spiller */
  for (const x of all) if (x.def.id !== def.id && x.st.status === 'reservert' && x.st.reserved_by === user.id) await DB.set(db, 'shop/' + x.def.id, { ...x.st, status: 'ledig', reserved_by: null, reserved_until: 0 });
  const until = Date.now() + SHOP.RESERVE_MINUTES * 60 * 1000;
  await DB.set(db, 'shop/' + def.id, { ...st, id: def.id, status: 'reservert', reserved_by: user.id, reserved_until: until });
  return { checkout: `${C.tebexStore}/package/${encodeURIComponent(SHOP.packageOf(def))}`, reservedUntil: until };
}, { auth: 'user' });
route('POST', '/api/shop/:id/cancel', async ({ db, user, params }) => {
  const def = listingDef(params.id);
  if (!def) fail(404, 'Fant ikke bedriften.');
  const st = await listingState(db, def.id);
  if (st.status === 'reservert' && st.reserved_by === user.id) await DB.set(db, 'shop/' + def.id, { ...st, status: 'ledig', reserved_by: null, reserved_until: 0 });
  return { ok: true };
}, { auth: 'user' });

/* Tebex sender beskjed hit når noen har betalt, fått pengene tilbake eller startet en tvist.
   Signaturen sjekkes med TEBEX_WEBHOOK_SECRET, så ingen andre kan late som de er Tebex. */
function verifyTebex(C, raw, sig) {
  if (!C.tebexSecret || !sig) return false;
  const digest = crypto.createHash('sha256').update(raw).digest('hex');
  const mac = crypto.createHmac('sha256', C.tebexSecret).update(digest).digest('hex');
  return safeEq(String(sig).toLowerCase(), mac);
}
async function tebexWebhook(C, db, req) {
  const raw = await req.text();
  if (!verifyTebex(C, raw, req.headers.get('x-signature'))) return json(401, { error: 'Ugyldig signatur.' });
  let ev; try { ev = JSON.parse(raw); } catch { return json(400, { error: 'Ugyldig JSON.' }); }
  if (ev.type === 'validation.webhook') return json(200, { id: ev.id });
  const p = ev.subject || {};
  const txn = str(p.transaction_id, 80);
  if (!txn) return json(200, { ok: true });
  const products = Array.isArray(p.products) ? p.products : [];
  const buyerId = String((p.customer && p.customer.username && p.customer.username.id) || '');

  if (ev.type === 'payment.completed') {
    if (await DB.get(db, 'purchases/' + txn)) return json(200, { ok: true, duplicate: true });
    const items = [];
    for (const prod of products) {
      /* pakken kan gjelde ett bestemt sted, eller en hel type der spilleren valgte sted på nettsiden */
      const cands = SHOP.LISTINGS.filter((l) => SHOP.packageOf(l) && String(SHOP.packageOf(l)) === String(prod.id));
      if (!cands.length) continue;
      const pid = String((prod.username && prod.username.id) || buyerId || '');
      const known = /^\d{15,21}$/.test(pid) && await DB.get(db, 'users/' + pid) ? pid : null;
      const qty = Math.max(1, Math.min(5, Number(prod.quantity) || 1));
      for (let n = 0; n < qty; n++) {
        const raws = await Promise.all(cands.map(async (l) => ({ def: l, st: (await DB.get(db, 'shop/' + l.id)) || { id: l.id, status: 'ledig' } })));
        const open = raws.filter((x) => x.st.status !== 'solgt');
        /* finn stedet: det kjøperen holdt av. Er kjøperen ukjent, brukes den eneste som holder av et sted av denne typen. */
        let pick = known ? open.find((x) => x.st.reserved_by === known) : null;
        if (!pick && !known) { const held = open.filter((x) => x.st.reserved_by); if (held.length === 1) pick = held[0]; }
        if (!pick && cands.length === 1) pick = raws[0];
        const owner = known || (pick && pick.st.reserved_by) || null;
        const T = SHOP.TYPES[cands[0].type];
        if (!pick || !owner) { items.push({ listing: pick ? pick.def.id : null, type: cands[0].type, name: pick ? pick.def.name : T.label + ' (sted ikke valgt)', owner, tebex_user: pid, result: owner ? 'velg-sted' : 'mangler-kjoper' }); continue; }
        if (pick.st.status === 'solgt' && pick.st.owner !== owner) { items.push({ listing: pick.def.id, type: pick.def.type, name: pick.def.name, owner, tebex_user: pid, result: 'konflikt' }); continue; }
        await DB.set(db, 'shop/' + pick.def.id, { id: pick.def.id, status: 'solgt', owner, sold_at: Date.now(), txn, reserved_by: null, reserved_until: 0 });
        items.push({ listing: pick.def.id, type: pick.def.type, name: pick.def.name, owner, tebex_user: pid, result: 'tildelt' });
      }
    }
    const amount = p.price && p.price.amount != null ? `${p.price.amount} ${p.price.currency || ''}`.trim() : '';
    await DB.set(db, 'purchases/' + txn, { txn, at: Date.now(), status: 'betalt', amount, buyer_name: str(p.customer && p.customer.username && p.customer.username.username, 60), items });
    for (const it of items) {
      const msg = it.result === 'tildelt' ? `**${it.name}** er solgt til <@${it.owner}> (${amount}).` : it.result === 'konflikt' ? `**${it.name}** ble betalt, men er allerede eid av noen andre. Refunder kjøpet i Tebex (${txn}).` : it.result === 'velg-sted' ? `<@${it.owner}> betalte for **${it.name}**, men hadde ikke valgt sted. Gi hen et ledig sted under Salg på nettsiden (${txn}).` : `**${it.name}** ble betalt, men kjøperen ble ikke funnet. Tildel bedriften under Salg på nettsiden (${txn}).`;
      await notify(C, it.result === 'tildelt' ? 'Bedrift solgt' : 'Kjøp trenger oppfølging', msg, it.result === 'tildelt' ? 0x11804a : 0xa86a06);
    }
    return json(200, { ok: true });
  }
  if (ev.type === 'payment.refunded' || ev.type === 'payment.dispute.lost' || ev.type === 'payment.dispute.opened') {
    const rec = await DB.get(db, 'purchases/' + txn);
    if (!rec) return json(200, { ok: true });
    const lost = ev.type !== 'payment.dispute.opened';
    rec.status = ev.type === 'payment.refunded' ? 'refundert' : lost ? 'tvist-tapt' : 'tvist';
    rec.updated_at = Date.now();
    await DB.set(db, 'purchases/' + txn, rec);
    if (lost) for (const it of (rec.items || []).filter((i) => i.listing)) {
      const st = await listingState(db, it.listing);
      if (st.txn === txn) await DB.set(db, 'shop/' + it.listing, { id: it.listing, status: 'ledig', owner: null, txn: null, sold_at: 0, reserved_by: null, reserved_until: 0 });
    }
    await notify(C, lost ? 'Bedrift tatt tilbake' : 'Tvist på kjøp', `${(rec.items || []).map((i) => i.name).join(', ')}: ${rec.status} (${txn}).`, 0xc41b1b);
    return json(200, { ok: true });
  }
  return json(200, { ok: true, ignored: ev.type });
}
route('POST', '/api/tebex/webhook', ({ C, db, req }) => tebexWebhook(C, db, req), { raw: true });

/* staff: salg */
route('GET', '/api/staff/shop', async ({ C, db, user }) => {
  need(user, 'shop.manage', 'Du har ikke rettighet til butikken.');
  const [all, purchases] = await Promise.all([allListings(db), DB.all(db, 'purchases/')]);
  purchases.sort((a, b) => b.at - a.at);
  const ids = [...new Set([...all.flatMap((x) => [x.st.owner, x.st.reserved_by]), ...purchases.flatMap((p) => (p.items || []).map((i) => i.owner))].filter(Boolean))];
  const people = await peopleOf(db, ids);
  const who = (id) => id ? { id, name: people[id] ? people[id].name || people[id].username : 'Ukjent' } : null;
  return {
    open: shopOpen(C), store: C.tebexStore, hasSecret: !!C.tebexSecret, email: C.shopEmail,
    listings: all.map((x) => ({ id: x.def.id, name: x.def.name, type: x.def.type, price: x.def.price, tebex: SHOP.packageOf(x.def), area: x.def.area, status: x.st.status, owner: who(x.st.owner), reservedBy: who(x.st.reserved_by), reservedUntil: x.st.reserved_until || null, soldAt: x.st.sold_at || null, txn: x.st.txn || null, manual: !!x.st.manual })),
    purchases: purchases.slice(0, 200).map((p) => ({ txn: p.txn, at: p.at, status: p.status, amount: p.amount, buyerName: p.buyer_name, items: (p.items || []).map((i) => ({ ...i, owner: who(i.owner) })) }))
  };
}, { auth: 'staff' });
route('POST', '/api/staff/shop/:id', async ({ C, db, user, params, body }) => {
  need(user, 'shop.manage', 'Du har ikke rettighet til butikken.');
  const def = listingDef(params.id);
  if (!def) fail(404, 'Fant ikke bedriften.');
  const st = await listingState(db, def.id);
  if (body.action === 'frigi') {
    await DB.set(db, 'shop/' + def.id, { id: def.id, status: 'ledig', owner: null, txn: null, sold_at: 0, reserved_by: null, reserved_until: 0 });
    await notify(C, 'Bedrift frigitt', `**${user.name || user.username}** frigjorde **${def.name}**${st.owner ? ` fra <@${st.owner}>` : ''}.`, 0x2b2425);
    return { ok: true };
  }
  if (body.action === 'tildel') {
    const id = String(body.userId || '').trim();
    if (!/^\d{15,21}$/.test(id)) fail(400, 'Skriv inn en gyldig Discord-ID.');
    const u = await DB.get(db, 'users/' + id);
    if (!u) fail(404, 'Personen har ikke logget inn på nettsiden ennå.');
    await DB.set(db, 'shop/' + def.id, { id: def.id, status: 'solgt', owner: id, txn: st.txn || null, sold_at: Date.now(), manual: true, reserved_by: null, reserved_until: 0 });
    await notify(C, 'Bedrift tildelt', `**${user.name || user.username}** ga **${def.name}** til <@${id}>.`, 0x2b2425);
    return { ok: true };
  }
  fail(400, 'Ukjent handling.');
}, { auth: 'staff' });
/* FiveM: hvem eier hvilken bedrift */
route('GET', '/api/fivem/businesses', async ({ C, db, req }) => {
  if (!C.fivemKey || !safeEq(req.headers.get('x-api-key') || '', C.fivemKey)) fail(401, 'Ugyldig API-nøkkel.');
  const all = await allListings(db);
  return { businesses: all.filter((x) => x.st.status === 'solgt').map((x) => ({ id: x.def.id, type: x.def.type, name: x.def.name, owner: x.st.owner })) };
}, { raw: true });

/* ---- Discord og FiveM ---- */
route('POST', '/api/discord/interactions', ({ C, db, req }) => interactions(C, db, req), { raw: true });
route('GET', '/api/fivem/whitelist/:discord', async ({ C, db, req, params }) => {
  if (!C.fivemKey || !safeEq(req.headers.get('x-api-key') || '', C.fivemKey)) fail(401, 'Ugyldig API-nøkkel.');
  const id = params.discord.replace(/^discord:/, '');
  if (!/^\d{15,21}$/.test(id)) fail(400, 'Ugyldig Discord-ID.');
  const u = await DB.get(db, 'users/' + id);
  const staff = !!(await staffInfo(C, db, id, !!(u && u.role_staff)));
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
