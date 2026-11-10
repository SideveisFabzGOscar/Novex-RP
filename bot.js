'use strict';
/*
 * Novex ticket-bot for Discord.
 * Kjører inne i server.js og bruker samme database som nettsiden.
 * Ingen npm-pakker: Discord Gateway via innebygd WebSocket, REST via fetch.
 *
 *  /ticket          spilleren velger kategori og fyller ut et skjema
 *  /ticket-panel    staff legger ut en fast knapp for å opprette tickets
 *  Hver ticket får en privat kanal. Meldinger synkes med nettsiden begge veier.
 */
const API = 'https://discord.com/api/v10';
const VIEW = 1024n, SEND = 2048n, EMBED = 16384n, ATTACH = 32768n, HISTORY = 65536n;
const MEMBER_ALLOW = String(VIEW | SEND | EMBED | ATTACH | HISTORY);
const INTENTS = (1 << 0) | (1 << 9) | (1 << 15); // GUILDS, GUILD_MESSAGES, MESSAGE_CONTENT
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = function createBot(ctx) {
  const { CFG, CATS } = ctx;
  const off = { enabled: false, start() {}, ticketCreated() {}, messageAdded() {}, statusChanged() {} };
  if (!CFG.botToken || !CFG.guildId || !CFG.clientId) return off;

  let botId = null, ws = null, seq = null, sessionId = null, resumeUrl = null;
  let hbTimer = null, acked = true, stopped = false;
  const pending = new Map();
  const log = (...a) => console.log('[bot]', ...a);
  const warn = (e) => console.error('[bot]', e && e.message ? e.message : e);

  /* ---------------- REST ---------------- */
  async function rest(method, path, body, retry = true) {
    const r = await fetch(API + path, {
      method,
      headers: { Authorization: 'Bot ' + CFG.botToken, 'Content-Type': 'application/json', 'User-Agent': 'NovexRP-bot (1.0)' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000)
    });
    if (r.status === 429 && retry) {
      const j = await r.json().catch(() => ({}));
      await sleep(Math.ceil((j.retry_after || 1) * 1000));
      return rest(method, path, body, false);
    }
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* ignorer */ }
    if (!r.ok) {
      const e = new Error(`${method} ${path} → ${r.status} ${text.slice(0, 200)}`);
      e.status = r.status; e.data = data;
      throw e;
    }
    return data;
  }

  /* ---------------- Gateway ---------------- */
  async function connect(resume) {
    if (stopped) return;
    let url = resume && resumeUrl ? resumeUrl : null;
    if (!url) {
      try { url = (await rest('GET', '/gateway/bot')).url; }
      catch (e) { warn('Får ikke kontakt med Discord: ' + e.message); setTimeout(() => connect(false), 15000); return; }
    }
    ws = new WebSocket(url + '/?v=10&encoding=json');
    ws.onmessage = (ev) => { let p; try { p = JSON.parse(ev.data); } catch { return; } onPayload(p, resume); };
    ws.onerror = () => {};
    ws.onclose = (ev) => {
      clearInterval(hbTimer);
      if (stopped) return;
      const hint = { 4004: 'DISCORD_BOT_TOKEN er feil.', 4013: 'Ugyldige intents.', 4014: 'Slå på «Message Content Intent» under Bot i Discord Developer Portal.' }[ev.code];
      if ([4004, 4010, 4011, 4012, 4013, 4014].includes(ev.code)) { console.error(`[bot] Discord avviste boten (${ev.code}). ${hint || ''}`); return; }
      const canResume = !!sessionId && ![4007, 4009].includes(ev.code);
      if (!canResume) { sessionId = null; seq = null; }
      setTimeout(() => connect(canResume), 2000 + Math.random() * 3000);
    };
  }
  const send = (op, d) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ op, d })); };
  function onPayload(p, resume) {
    if (p.s != null) seq = p.s;
    switch (p.op) {
      case 10: {
        const iv = p.d.heartbeat_interval;
        acked = true; clearInterval(hbTimer);
        setTimeout(() => send(1, seq), Math.random() * iv);
        hbTimer = setInterval(() => {
          if (!acked) { try { ws.close(4000); } catch { /* ignorer */ } return; }
          acked = false; send(1, seq);
        }, iv);
        if (resume && sessionId) send(6, { token: CFG.botToken, session_id: sessionId, seq });
        else send(2, { token: CFG.botToken, intents: INTENTS, properties: { os: 'linux', browser: 'novex', device: 'novex' } });
        break;
      }
      case 11: acked = true; break;
      case 1: send(1, seq); break;
      case 7: try { ws.close(4000); } catch { /* ignorer */ } break;
      case 9:
        if (!p.d) { sessionId = null; seq = null; }
        setTimeout(() => { try { ws.close(4000); } catch { /* ignorer */ } }, 1000 + Math.random() * 4000);
        break;
      case 0: dispatch(p.t, p.d).catch(warn); break;
    }
  }
  async function dispatch(type, d) {
    if (type === 'READY') {
      botId = d.user.id; sessionId = d.session_id; resumeUrl = d.resume_gateway_url;
      log(`Logget inn som ${d.user.username}`);
      registerCommands().catch((e) => warn('Kunne ikke registrere kommandoer: ' + e.message));
      return;
    }
    if (type === 'RESUMED') { log('Koblet til igjen'); return; }
    if (type === 'INTERACTION_CREATE') return onInteraction(d);
    if (type === 'MESSAGE_CREATE') return onMessage(d);
  }
  function registerCommands() {
    return rest('PUT', `/applications/${CFG.clientId}/guilds/${CFG.guildId}/commands`, [
      { name: 'ticket', description: 'Opprett en ticket til staff', type: 1 },
      { name: 'ticket-panel', description: 'Legg ut knappen for å opprette tickets i denne kanalen', type: 1, default_member_permissions: '32' }
    ]);
  }

  /* ---------------- Meldinger og komponenter ---------------- */
  const tno = ctx.tno;
  const siteUrl = (CFG.base.startsWith('http://localhost') ? null : CFG.base + '/#tickets');
  const panelMessage = () => ({
    embeds: [{
      title: 'Trenger du hjelp?',
      description: 'Trykk på knappen under for å opprette en ticket. Du får en privat kanal med staff, og saken vises også under Tickets på nettsiden.',
      color: 0xe0141f
    }],
    components: [{ type: 1, components: [{ type: 2, style: 1, label: 'Opprett ticket', custom_id: 'nx:open' }] }]
  });
  const categoryPicker = () => ({
    content: 'Hva gjelder saken?', flags: 64,
    components: [{ type: 1, components: [{ type: 3, custom_id: 'nx:cat', placeholder: 'Velg kategori', options: CATS.map((c, i) => ({ label: c, value: String(i) })) }] }]
  });
  const createModal = (ci) => ({
    type: 9,
    data: {
      custom_id: 'nx:create:' + ci,
      title: ('Ny ticket: ' + CATS[ci]).slice(0, 45),
      components: [
        { type: 1, components: [{ type: 4, custom_id: 'subject', label: 'Emne', style: 1, min_length: 3, max_length: 80, required: true }] },
        { type: 1, components: [{ type: 4, custom_id: 'body', label: 'Beskriv saken', style: 2, min_length: 10, max_length: 4000, required: true, placeholder: 'Hva skjedde? Ta med tidspunkt, navn og lenke til klipp.' }] }
      ]
    }
  });
  function buttons(t, closed) {
    const row = closed
      ? [{ type: 2, style: 3, label: 'Åpne igjen', custom_id: 'nx:reopen:' + t.id }, { type: 2, style: 4, label: 'Slett kanal', custom_id: 'nx:delete:' + t.id }]
      : [{ type: 2, style: 4, label: 'Lukk ticket', custom_id: 'nx:close:' + t.id }];
    if (siteUrl) row.push({ type: 2, style: 5, label: 'Åpne på nettsiden', url: siteUrl });
    return [{ type: 1, components: row }];
  }

  /* ---------------- Kanaler ---------------- */
  function ensureChannel(t) {
    if (t.channel_id) return Promise.resolve(t.channel_id);
    if (pending.has(t.id)) return pending.get(t.id);
    const p = createChannel(t).finally(() => pending.delete(t.id));
    pending.set(t.id, p);
    return p;
  }
  async function createChannel(t) {
    const fresh = ctx.getTicket(t.id);
    if (fresh && fresh.channel_id) { t.channel_id = fresh.channel_id; return fresh.channel_id; }
    const base = { name: `ticket-${tno(t.id)}`, type: 0, topic: `${t.category} · ${t.subject}`.slice(0, 1024) };
    if (CFG.ticketCategory) base.parent_id = CFG.ticketCategory;
    const ov = [{ id: CFG.guildId, type: 0, deny: String(VIEW) }];
    if (botId) ov.push({ id: botId, type: 1, allow: MEMBER_ALLOW });
    CFG.staffRoles.forEach((r) => ov.push({ id: r, type: 0, allow: MEMBER_ALLOW }));
    let ch, inGuild = true;
    try {
      ch = await rest('POST', `/guilds/${CFG.guildId}/channels`, { ...base, permission_overwrites: [...ov, { id: t.user_id, type: 1, allow: MEMBER_ALLOW }] });
    } catch (e) {
      if (e.status !== 400 && e.status !== 404) throw e;
      // Spilleren er ikke med i Discord-serveren: lag kanalen bare for staff
      inGuild = false;
      ch = await rest('POST', `/guilds/${CFG.guildId}/channels`, { ...base, permission_overwrites: ov });
    }
    ctx.setChannel(t.id, ch.id);
    t.channel_id = ch.id;
    const first = ctx.firstMessage(t.id);
    const mentionRoles = CFG.staffRoles.map((r) => `<@&${r}>`).join(' ');
    await rest('POST', `/channels/${ch.id}/messages`, {
      content: [inGuild ? `<@${t.user_id}>` : '', mentionRoles].filter(Boolean).join(' ') || undefined,
      allowed_mentions: { users: inGuild ? [t.user_id] : [], roles: CFG.staffRoles },
      embeds: [{
        title: `Ticket #${tno(t.id)}: ${t.subject}`.slice(0, 256),
        description: (first ? first.body : '').slice(0, 4000) || undefined,
        color: 0xe0141f,
        fields: [
          { name: 'Kategori', value: t.category, inline: true },
          { name: 'Fra', value: `<@${t.user_id}>`, inline: true },
          { name: 'Opprettet', value: `<t:${Math.floor(t.created_at / 1000)}:f>`, inline: true }
        ],
        footer: { text: inGuild ? 'Skriv i denne kanalen for å svare. Svarene vises også på nettsiden.' : 'Spilleren er ikke med i Discord-serveren. Svar her, så ser spilleren svaret på nettsiden.' }
      }],
      components: buttons(t, false)
    });
    return ch.id;
  }

  /* ---------------- Interaksjoner ---------------- */
  const respond = (i, data) => rest('POST', `/interactions/${i.id}/${i.token}/callback`, data);
  const ephemeral = (i, content) => respond(i, { type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });
  const editOriginal = (i, content) => rest('PATCH', `/webhooks/${CFG.clientId}/${i.token}/messages/@original`, { content, allowed_mentions: { parse: [] } });

  async function onInteraction(i) {
    if (i.guild_id !== CFG.guildId || !i.member) return ephemeral(i, 'Tickets fungerer bare i Novex-serveren.');
    const user = i.member.user, roles = i.member.roles || [];
    const staff = ctx.isStaff(user.id, roles);

    if (i.type === 2) {
      if (i.data.name === 'ticket') return respond(i, { type: 4, data: categoryPicker() });
      if (i.data.name === 'ticket-panel') {
        if (!staff) return ephemeral(i, 'Bare staff kan legge ut ticket-panelet.');
        try { await rest('POST', `/channels/${i.channel_id}/messages`, panelMessage()); }
        catch (e) { warn(e); return ephemeral(i, 'Boten får ikke skrive i denne kanalen. Sjekk rettighetene.'); }
        return ephemeral(i, 'Ticket-panelet er lagt ut.');
      }
      return;
    }

    if (i.type === 3) {
      const id = i.data.custom_id;
      if (id === 'nx:open') return respond(i, { type: 4, data: categoryPicker() });
      if (id === 'nx:cat') return respond(i, createModal(Math.min(CATS.length - 1, Math.max(0, Number(i.data.values[0]) || 0))));
      const m = id.match(/^nx:(close|reopen|delete):(\d+)$/);
      if (!m) return;
      const t = ctx.getTicket(Number(m[2]));
      if (!t) return ephemeral(i, 'Fant ikke ticketen.');
      if (t.user_id !== user.id && !staff) return ephemeral(i, 'Du har ikke tilgang til denne ticketen.');
      if (m[1] === 'delete') {
        if (!staff) return ephemeral(i, 'Bare staff kan slette kanalen.');
        await respond(i, { type: 6 });
        await rest('DELETE', `/channels/${t.channel_id}`).catch(warn);
        ctx.setChannel(t.id, null);
        return;
      }
      ctx.upsertUser(user, staff);
      await respond(i, { type: 6 });
      ctx.setStatus(t, m[1] === 'close' ? 'lukket' : 'apen', { source: 'discord', byName: user.global_name || user.username });
      return;
    }

    if (i.type === 5) {
      const m = i.data.custom_id.match(/^nx:create:(\d+)$/);
      if (!m) return;
      const f = {};
      i.data.components.forEach((row) => row.components.forEach((c) => { f[c.custom_id] = c.value; }));
      await respond(i, { type: 5, data: { flags: 64 } });
      let msg;
      try {
        const u = ctx.upsertUser(user, staff);
        const t = ctx.createTicket(u, CATS[Number(m[1])] || 'Annet', f.subject, f.body, { source: 'discord' });
        const ch = await ensureChannel(t);
        msg = `Ticket **#${tno(t.id)}** er opprettet: <#${ch}>`;
      } catch (e) {
        msg = e instanceof ctx.HttpError ? e.message : 'Kunne ikke opprette ticketen. Prøv igjen, eller bruk nettsiden.';
        if (!(e instanceof ctx.HttpError)) warn(e);
      }
      await editOriginal(i, msg).catch(warn);
    }
  }

  async function onMessage(d) {
    if (!d.guild_id || d.guild_id !== CFG.guildId || !d.author || d.author.bot || d.webhook_id) return;
    const t = ctx.ticketByChannel(d.channel_id);
    if (!t || t.status === 'lukket') return;
    let body = (d.content || '').trim();
    if (d.attachments && d.attachments.length) body += (body ? '\n' : '') + d.attachments.map((a) => a.url).join('\n');
    if (!body) return;
    const staff = ctx.isStaff(d.author.id, d.member ? d.member.roles || [] : []);
    const u = ctx.upsertUser(d.author, staff);
    ctx.addMessage(t, u, body.slice(0, 4000), staff && t.user_id !== d.author.id, { source: 'discord' });
  }

  /* ---------------- Kalles fra nettsiden ---------------- */
  return {
    enabled: true,
    start() { log('Starter …'); connect(false); },
    stop() { stopped = true; try { ws && ws.close(1000); } catch { /* ignorer */ } },
    ticketCreated(t) { ensureChannel(t).catch(warn); },
    messageAdded(t, m) {
      if (m.source === 'discord') return;
      (async () => {
        const ch = await ensureChannel(t);
        await rest('POST', `/channels/${ch}/messages`, {
          embeds: [{ author: { name: `${m.staff ? 'Novex Staff' : m.name} · fra nettsiden` }, description: m.body.slice(0, 4000), color: m.staff ? 0x0f0c0c : 0xe0141f }],
          allowed_mentions: { parse: [] }
        });
      })().catch(warn);
    },
    statusChanged(t, status, by) {
      if (!t.channel_id) return;
      const ch = t.channel_id, closed = status === 'lukket';
      (async () => {
        await rest('PUT', `/channels/${ch}/permissions/${t.user_id}`, closed ? { type: 1, allow: String(VIEW | HISTORY), deny: String(SEND) } : { type: 1, allow: MEMBER_ALLOW }).catch(() => {});
        await rest('PATCH', `/channels/${ch}`, { name: `${closed ? 'lukket' : 'ticket'}-${tno(t.id)}` }).catch(() => {});
        await rest('POST', `/channels/${ch}/messages`, {
          content: closed ? `Ticketen ble lukket${by ? ' av ' + by : ''}.` : `Ticketen ble åpnet igjen${by ? ' av ' + by : ''}.`,
          allowed_mentions: { parse: [] },
          components: buttons(t, closed)
        });
      })().catch(warn);
    },
    /* for testing */
    _test: { onInteraction, onMessage, ensureChannel, setBotId: (id) => { botId = id; } }
  };
};
