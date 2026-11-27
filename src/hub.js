// Ponto central de emissão em tempo real (evita dependência circular entre rotas e socket)
let io = null;
let redis = null;
const localPresence = new Map(); // userId -> nº de conexões (fallback sem Redis)

const hub = {
  setIO(i) { io = i; },
  setRedis(r) { redis = r; },
  get io() { return io; },
  toUser(userId, event, data) { if (io) io.to(`user:${userId}`).emit(event, data); },
  toUsers(ids, event, data) { if (io && ids.length) io.to(ids.map(i => `user:${i}`)).emit(event, data); },
  toConv(convId, event, data) { if (io) io.to(`conv:${convId}`).emit(event, data); },
  joinConv(userId, convId) { if (io) io.in(`user:${userId}`).socketsJoin(`conv:${convId}`); },
  leaveConv(userId, convId) { if (io) io.in(`user:${userId}`).socketsLeave(`conv:${convId}`); },
  disconnectUser(userId) { if (io) io.in(`user:${userId}`).disconnectSockets(true); },

  async incPresence(userId) {
    if (redis) return Number(await redis.hIncrBy('ngg:presence', String(userId), 1));
    const n = (localPresence.get(userId) || 0) + 1; localPresence.set(userId, n); return n;
  },
  async decPresence(userId) {
    if (redis) {
      const n = Number(await redis.hIncrBy('ngg:presence', String(userId), -1));
      if (n <= 0) await redis.hDel('ngg:presence', String(userId));
      return Math.max(n, 0);
    }
    const n = Math.max((localPresence.get(userId) || 1) - 1, 0);
    if (n === 0) localPresence.delete(userId); else localPresence.set(userId, n);
    return n;
  },
  async onlineSet(ids) {
    if (!ids.length) return new Set();
    if (redis) {
      const vals = await redis.hmGet('ngg:presence', ids.map(String));
      return new Set(ids.filter((id, i) => Number(vals[i]) > 0));
    }
    return new Set(ids.filter(id => localPresence.get(id) > 0));
  }
};

module.exports = hub;
