// Socket.IO: autenticação, salas, presença, digitação, confirmações e sinalização WebRTC
const { Server } = require('socket.io');
const db = require('./db');
const hub = require('./hub');
const config = require('./config');
const { loadSessionByToken, parseCookieHeader, COOKIE } = require('./security');
const { accessibleConversationIds, conversationAccess } = require('./permissions');
const { createMessage } = require('./messages');
const { notify, awardBadge } = require('./notify');
const { emitPresence } = require('./routes/users');
const { DEFAULT_PRIVACY, mergeDeep, publicUser } = require('./util');

const MAX_CALL_PARTICIPANTS = 8;
const RING_TIMEOUT_MS = 45000;
const activeCalls = new Map(); // callId -> { convId, media, joined:Set, invited:Set, timer, initiator }

async function setup(server) {
  const io = new Server(server, {
    path: '/socket.io',
    cors: { origin: config.appUrl, credentials: true },
    maxHttpBufferSize: 1e6,
    pingInterval: 20000,
    pingTimeout: 25000
  });

  if (config.redisUrl) {
    const { createClient } = require('redis');
    const { createAdapter } = require('@socket.io/redis-adapter');
    const pub = createClient({ url: config.redisUrl });
    const sub = pub.duplicate();
    await Promise.all([pub.connect(), sub.connect()]);
    io.adapter(createAdapter(pub, sub));
    const presence = pub.duplicate(); await presence.connect();
    hub.setRedis(presence);
    console.log('[realtime] adaptador Redis ativo (múltiplas instâncias)');
  }
  hub.setIO(io);

  hub.resync = async userId => {
    const ids = new Set((await accessibleConversationIds(userId)).map(id => `conv:${id}`));
    const sockets = await io.in(`user:${userId}`).fetchSockets();
    for (const s of sockets) {
      for (const room of s.rooms) if (room.startsWith('conv:') && !ids.has(room)) s.leave(room);
      s.join([...ids]);
    }
  };
  hub.disconnectSession = async sid => {
    const sockets = await io.fetchSockets();
    sockets.filter(s => s.data.sid === sid).forEach(s => s.disconnect(true));
  };

  // autenticação pelo cookie de sessão + verificação de origem
  io.use(async (socket, next) => {
    try {
      const origin = socket.handshake.headers.origin;
      if (origin && origin !== new URL(config.appUrl).origin && config.isProd) return next(new Error('origem'));
      const cookies = parseCookieHeader(socket.handshake.headers.cookie);
      const r = await loadSessionByToken(cookies[COOKIE]);
      if (!r?.user) return next(new Error('unauthorized'));
      socket.data.user = r.user;
      socket.data.sid = r.session.id;
      next();
    } catch (e) { next(e); }
  });

  io.on('connection', async socket => {
    const user = socket.data.user;
    const uid = user.id;
    socket.join(`user:${uid}`);
    try {
      const ids = await accessibleConversationIds(uid);
      socket.join(ids.map(id => `conv:${id}`));
    } catch (e) { console.error('[socket] rooms', e.message); }

    const n = await hub.incPresence(uid);
    if (n === 1) {
      await db.query('UPDATE users SET last_seen_at=now() WHERE id=$1', [uid]);
      emitPresence(uid).catch(() => {});
    }
    socket.emit('ready', { userId: uid });

    // limite simples de eventos por socket (anti-flood)
    let bucket = 0;
    const tick = setInterval(() => { bucket = 0; }, 5000);
    const allow = () => ++bucket <= 120;

    socket.on('typing', async ({ conversationId, typing } = {}) => {
      if (!allow()) return;
      const room = `conv:${Number(conversationId)}`;
      if (!socket.rooms.has(room)) return;
      socket.to(room).emit('typing', { conversationId: Number(conversationId), userId: uid, name: user.display_name, typing: !!typing });
    });

    socket.on('delivered', async ({ conversationId, messageId } = {}) => {
      if (!allow()) return;
      const cid = Number(conversationId); const mid = Number(messageId);
      if (!socket.rooms.has(`conv:${cid}`) || !Number.isInteger(mid)) return;
      const r = await db.query(`UPDATE conversation_members SET last_delivered_id=$1 WHERE conversation_id=$2 AND user_id=$3 AND last_delivered_id < $1
        AND $1 <= (SELECT coalesce(max(id),0) FROM messages WHERE conversation_id=$2)`, [mid, cid, uid]);
      if (r.rowCount) hub.toConv(cid, 'receipt', { conversationId: cid, userId: uid, lastDeliveredId: mid });
    });

    socket.on('presence:get', async ({ userIds } = {}, cb) => {
      if (!allow() || typeof cb !== 'function' || !Array.isArray(userIds)) return;
      const ids = userIds.map(Number).filter(Number.isInteger).slice(0, 200);
      const online = await hub.onlineSet(ids);
      const users = await db.many('SELECT id, presence, privacy FROM users WHERE id = ANY($1)', [ids]);
      cb(Object.fromEntries(users.map(u => {
        const priv = mergeDeep(DEFAULT_PRIVACY, u.privacy);
        return [u.id, online.has(u.id) && u.presence !== 'invisible' && priv.showOnline ? u.presence : 'offline'];
      })));
    });

    // ===================== CHAMADAS =====================
    socket.on('call:start', async ({ conversationId, media } = {}, cb = () => {}) => {
      try {
        if (!allow()) return cb({ error: 'Muitas ações.' });
        const a = await conversationAccess(Number(conversationId), uid);
        if (a.conv.type === 'channel') return cb({ error: 'Chamadas estão disponíveis em conversas e grupos.' });
        if (!a.canSend) return cb({ error: 'Você não pode ligar nesta conversa.' });
        for (const [, c] of activeCalls) if (c.convId === a.conv.id) return cb({ error: 'Já existe uma chamada em andamento nesta conversa.', callId: c.id });
        const members = (await db.many(`SELECT user_id FROM conversation_members WHERE conversation_id=$1 AND status='active'`, [a.conv.id])).map(m => m.user_id);
        if (members.length > MAX_CALL_PARTICIPANTS) return cb({ error: `Chamadas em grupo suportam até ${MAX_CALL_PARTICIPANTS} participantes.` });
        const m = media === 'video' ? 'video' : 'audio';
        const call = await db.one(`INSERT INTO calls (conversation_id, initiator_id, media) VALUES ($1,$2,$3) RETURNING *`, [a.conv.id, uid, m]);
        for (const mid of members) {
          await db.query(`INSERT INTO call_participants (call_id, user_id, state, joined_at) VALUES ($1,$2,$3,$4)`,
            [call.id, mid, mid === uid ? 'joined' : 'invited', mid === uid ? new Date() : null]);
        }
        const state = { id: call.id, convId: a.conv.id, convType: a.conv.type, media: m, initiator: uid, joined: new Set([uid]), invited: new Set(members.filter(x => x !== uid)) };
        state.timer = setTimeout(() => ringTimeout(call.id), RING_TIMEOUT_MS);
        activeCalls.set(call.id, state);
        const payload = { callId: call.id, conversationId: a.conv.id, media: m, from: publicUser(user), convType: a.conv.type, convName: a.conv.type === 'group' ? a.conv.name : user.display_name };
        hub.toUsers([...state.invited], 'call:incoming', payload);
        for (const inv of state.invited) notify(inv, 'call', uid, { callId: call.id, conversationId: a.conv.id, media: m }).catch(() => {});
        awardBadge(uid, 'caller').catch(() => {});
        cb({ ok: true, callId: call.id, participants: [uid] });
      } catch (e) { cb({ error: e.message || 'Falha ao iniciar chamada.' }); }
    });

    socket.on('call:accept', async ({ callId } = {}, cb = () => {}) => {
      const c = activeCalls.get(Number(callId));
      if (!c || (!c.invited.has(uid) && !c.joined.has(uid))) return cb({ error: 'Chamada não encontrada ou encerrada.' });
      c.invited.delete(uid);
      const existing = [...c.joined].filter(x => x !== uid);
      c.joined.add(uid);
      socket.data.callId = c.id;
      clearTimeout(c.timer);
      await db.query(`UPDATE call_participants SET state='joined', joined_at=now() WHERE call_id=$1 AND user_id=$2`, [c.id, uid]);
      await db.query(`UPDATE calls SET status='ongoing', answered_at=coalesce(answered_at, now()) WHERE id=$1`, [c.id]);
      hub.toUsers(existing, 'call:participant-joined', { callId: c.id, user: publicUser(user) });
      hub.toUser(uid, 'call:answered-elsewhere', { callId: c.id, socketId: socket.id });
      cb({ ok: true, callId: c.id, media: c.media, conversationId: c.convId, participants: existing });
    });

    // reingressar em chamada em andamento (ex.: após queda)
    socket.on('call:join', async ({ callId } = {}, cb = () => {}) => {
      const c = activeCalls.get(Number(callId));
      if (!c) return cb({ error: 'Chamada encerrada.' });
      try { await conversationAccess(c.convId, uid); } catch { return cb({ error: 'Sem acesso.' }); }
      if (c.joined.size >= MAX_CALL_PARTICIPANTS && !c.joined.has(uid)) return cb({ error: 'Chamada cheia.' });
      c.invited.add(uid);
      await db.query(`INSERT INTO call_participants (call_id, user_id, state) VALUES ($1,$2,'invited') ON CONFLICT DO NOTHING`, [c.id, uid]);
      socket.emit('call:incoming', { callId: c.id, conversationId: c.convId, media: c.media, from: publicUser(user), autoAccept: true });
      cb({ ok: true });
    });

    socket.on('call:decline', async ({ callId } = {}) => {
      const c = activeCalls.get(Number(callId));
      if (!c || !c.invited.has(uid)) return;
      c.invited.delete(uid);
      await db.query(`UPDATE call_participants SET state='declined' WHERE call_id=$1 AND user_id=$2`, [c.id, uid]);
      hub.toUsers([...c.joined], 'call:declined', { callId: c.id, userId: uid, name: user.display_name });
      if (c.convType === 'dm' || (c.invited.size === 0 && c.joined.size <= 1)) await endCall(c.id, c.joined.size > 1 ? 'ended' : 'declined');
    });

    socket.on('call:leave', async ({ callId } = {}) => leaveCall(Number(callId), uid));

    socket.on('call:signal', ({ callId, to, data } = {}) => {
      if (!allow()) return;
      const c = activeCalls.get(Number(callId));
      if (!c || !c.joined.has(uid) || !c.joined.has(Number(to))) return;
      if (!data || typeof data !== 'object' || JSON.stringify(data).length > 100000) return;
      hub.toUser(Number(to), 'call:signal', { callId: c.id, from: uid, data });
    });

    socket.on('call:media', ({ callId, audio, video, screen } = {}) => {
      const c = activeCalls.get(Number(callId));
      if (!c || !c.joined.has(uid)) return;
      hub.toUsers([...c.joined].filter(x => x !== uid), 'call:media', { callId: c.id, userId: uid, audio: !!audio, video: !!video, screen: !!screen });
    });

    socket.on('call:active', async (_ = {}, cb = () => {}) => {
      const out = [];
      for (const [, c] of activeCalls) {
        if (c.joined.has(uid) || c.invited.has(uid)) out.push({ callId: c.id, conversationId: c.convId, media: c.media, joined: c.joined.has(uid) });
      }
      cb(out);
    });

    socket.on('disconnect', async () => {
      clearInterval(tick);
      const left = await hub.decPresence(uid);
      if (left === 0) {
        await db.query('UPDATE users SET last_seen_at=now() WHERE id=$1', [uid]).catch(() => {});
        emitPresence(uid).catch(() => {});
        for (const [id, c] of activeCalls) if (c.joined.has(uid)) await leaveCall(id, uid);
      } else if (socket.data.callId) {
        // se o socket que estava na chamada caiu, mas o usuário segue conectado em outro dispositivo
        const c = activeCalls.get(socket.data.callId);
        const still = c && (await io.in(`user:${uid}`).fetchSockets()).some(s => s.data.callId === c.id);
        if (c && !still) await leaveCall(c.id, uid);
      }
    });
  });

  return io;
}

async function leaveCall(callId, uid) {
  const c = activeCalls.get(callId);
  if (!c || !c.joined.has(uid)) return;
  c.joined.delete(uid);
  await db.query(`UPDATE call_participants SET state='left', left_at=now() WHERE call_id=$1 AND user_id=$2`, [callId, uid]);
  hub.toUsers([...c.joined], 'call:participant-left', { callId, userId: uid });
  if (c.joined.size <= 1 && (c.convType === 'dm' || c.invited.size === 0 || c.joined.size === 0)) await endCall(callId, 'ended');
}

async function ringTimeout(callId) {
  const c = activeCalls.get(callId);
  if (!c) return;
  if (c.joined.size <= 1) return endCall(callId, 'missed');
  // ninguém mais vai atender; marca convidados como perdidos
  for (const u of c.invited) await db.query(`UPDATE call_participants SET state='missed' WHERE call_id=$1 AND user_id=$2`, [callId, u]);
  hub.toUsers([...c.invited], 'call:ended', { callId, status: 'missed' });
  c.invited.clear();
}

async function endCall(callId, status) {
  const c = activeCalls.get(callId);
  if (!c) return;
  activeCalls.delete(callId);
  clearTimeout(c.timer);
  const call = await db.one(`UPDATE calls SET status=CASE WHEN answered_at IS NOT NULL THEN 'ended' ELSE $2 END, ended_at=now() WHERE id=$1 RETURNING *`, [callId, status]);
  await db.query(`UPDATE call_participants SET state='missed' WHERE call_id=$1 AND state='invited'`, [callId]);
  await db.query(`UPDATE call_participants SET state='left', left_at=now() WHERE call_id=$1 AND state='joined'`, [callId]);
  const all = (await db.many('SELECT user_id FROM call_participants WHERE call_id=$1', [callId])).map(p => p.user_id);
  hub.toUsers(all, 'call:ended', { callId, status: call.status });
  const dur = call.answered_at ? Math.round((new Date(call.ended_at) - new Date(call.answered_at)) / 1000) : 0;
  const label = c.media === 'video' ? 'Chamada de vídeo' : 'Chamada de voz';
  const text = call.status === 'ended' ? `${label} • ${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}` : call.status === 'declined' ? `${label} recusada` : `${label} perdida`;
  await createMessage({ convId: c.convId, senderId: c.initiator, type: 'call', content: text, meta: { callId, status: call.status, media: c.media, duration: dur } }).catch(() => {});
}

module.exports = { setup, activeCalls };
