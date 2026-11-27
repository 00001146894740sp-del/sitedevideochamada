const db = require('./db');
const { err } = require('./util');

// Permissões de cargos em comunidades (bitmask)
const P = {
  VIEW_CHANNELS: 1 << 0,
  SEND_MESSAGES: 1 << 1,
  ATTACH_FILES: 1 << 2,
  MANAGE_MESSAGES: 1 << 3,
  MANAGE_CHANNELS: 1 << 4,
  MANAGE_ROLES: 1 << 5,
  KICK_MEMBERS: 1 << 6,
  BAN_MEMBERS: 1 << 7,
  CREATE_INVITES: 1 << 8,
  MANAGE_COMMUNITY: 1 << 9,
  VIEW_AUDIT_LOG: 1 << 10,
  ADMINISTRATOR: 1 << 11,
  POST_ANNOUNCEMENTS: 1 << 12,
  HANDLE_REPORTS: 1 << 13
};
const ALL = Object.values(P).reduce((a, b) => a | b, 0);
const DEFAULT_EVERYONE = P.VIEW_CHANNELS | P.SEND_MESSAGES | P.ATTACH_FILES | P.CREATE_INVITES;

const PERM_LABELS = {
  VIEW_CHANNELS: 'Ver canais', SEND_MESSAGES: 'Enviar mensagens', ATTACH_FILES: 'Enviar arquivos',
  MANAGE_MESSAGES: 'Gerenciar mensagens', MANAGE_CHANNELS: 'Gerenciar canais', MANAGE_ROLES: 'Gerenciar cargos',
  KICK_MEMBERS: 'Expulsar membros', BAN_MEMBERS: 'Banir membros', CREATE_INVITES: 'Criar convites',
  MANAGE_COMMUNITY: 'Gerenciar comunidade', VIEW_AUDIT_LOG: 'Ver registro de atividades',
  ADMINISTRATOR: 'Administrador', POST_ANNOUNCEMENTS: 'Publicar avisos', HANDLE_REPORTS: 'Gerenciar denúncias'
};

async function communityContext(communityId, userId) {
  const c = await db.one('SELECT * FROM communities WHERE id=$1 AND removed_at IS NULL', [communityId]);
  if (!c) throw err(404, 'Comunidade não encontrada.');
  const member = await db.one('SELECT * FROM community_members WHERE community_id=$1 AND user_id=$2', [communityId, userId]);
  let perms = 0; let topPosition = -1; let roleIds = [];
  if (member) {
    const roles = await db.many(
      `SELECT r.* FROM community_roles r
        WHERE r.community_id=$1 AND (r.is_default OR r.id IN
          (SELECT role_id FROM community_member_roles WHERE community_id=$1 AND user_id=$2))`,
      [communityId, userId]);
    for (const r of roles) {
      perms |= Number(r.permissions);
      if (!r.is_default) { topPosition = Math.max(topPosition, r.position); roleIds.push(r.id); }
    }
  }
  const isOwner = Number(c.owner_id) === Number(userId);
  if (isOwner || (perms & P.ADMINISTRATOR)) perms = ALL;
  if (isOwner) topPosition = Infinity;
  return { community: c, member, perms, isOwner, topPosition, roleIds, has: bit => (perms & bit) === bit };
}

async function canViewChannel(channel, ctx) {
  if (!ctx.member) return false;
  if (!ctx.has(P.VIEW_CHANNELS)) return false;
  if (!channel.is_private) return true;
  if (ctx.has(P.ADMINISTRATOR) || ctx.has(P.MANAGE_CHANNELS)) return true;
  if (!ctx.roleIds.length) return false;
  const r = await db.one('SELECT 1 FROM channel_roles WHERE channel_id=$1 AND role_id = ANY($2)', [channel.id, ctx.roleIds]);
  return !!r;
}

// Retorna o nível de acesso do usuário a uma conversa (DM, grupo ou canal)
async function conversationAccess(convId, userId) {
  const conv = await db.one('SELECT * FROM conversations WHERE id=$1 AND removed_at IS NULL', [convId]);
  if (!conv) throw err(404, 'Conversa não encontrada.');
  if (conv.type === 'channel') {
    const ctx = await communityContext(conv.community_id, userId);
    const view = await canViewChannel(conv, ctx);
    if (!view) throw err(403, 'Você não tem acesso a este canal.');
    const isAnn = conv.category === 'anuncios' || conv.category === 'noticias';
    const canSend = ctx.has(P.SEND_MESSAGES) && (!isAnn || ctx.has(P.POST_ANNOUNCEMENTS));
    return {
      conv, ctx, member: null,
      canSend, canSendMedia: canSend && ctx.has(P.ATTACH_FILES),
      canModerate: ctx.has(P.MANAGE_MESSAGES), canPin: ctx.has(P.MANAGE_MESSAGES), canManage: ctx.has(P.MANAGE_CHANNELS)
    };
  }
  const member = await db.one(`SELECT * FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 AND status='active'`, [convId, userId]);
  if (!member) throw err(403, 'Você não participa desta conversa.');
  if (conv.type === 'dm') {
    const other = await db.one(`SELECT user_id FROM conversation_members WHERE conversation_id=$1 AND user_id<>$2`, [convId, userId]);
    const blocked = other && await db.one(
      `SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)`, [userId, other.user_id]);
    const otherUser = other && await db.one(`SELECT status FROM users WHERE id=$1`, [other.user_id]);
    const can = !blocked && otherUser && otherUser.status !== 'deleted';
    return { conv, member, otherId: other?.user_id, blocked: !!blocked, canSend: can, canSendMedia: can, canModerate: false, canPin: true, canManage: false };
  }
  // grupo
  const isStaff = ['owner', 'admin', 'moderator'].includes(member.role);
  const silenced = member.silenced_until && new Date(member.silenced_until) > new Date();
  const canSend = member.can_send && !silenced && (!conv.only_admins_send || ['owner', 'admin'].includes(member.role));
  return {
    conv, member, canSend, canSendMedia: canSend && member.can_send_media,
    canModerate: isStaff, canPin: isStaff || member.can_pin, canManage: ['owner', 'admin'].includes(member.role), silenced
  };
}

// Lista ids de conversas acessíveis (para o socket entrar nas salas)
async function accessibleConversationIds(userId) {
  const direct = await db.many(`SELECT conversation_id AS id FROM conversation_members WHERE user_id=$1 AND status='active'`, [userId]);
  const ids = direct.map(r => r.id);
  const comms = await db.many(`SELECT community_id FROM community_members m JOIN communities c ON c.id=m.community_id WHERE m.user_id=$1 AND c.removed_at IS NULL`, [userId]);
  for (const { community_id } of comms) {
    const ctx = await communityContext(community_id, userId);
    const chans = await db.many(`SELECT * FROM conversations WHERE community_id=$1 AND removed_at IS NULL`, [community_id]);
    for (const ch of chans) if (await canViewChannel(ch, ctx)) ids.push(ch.id);
  }
  return ids;
}

module.exports = { P, ALL, DEFAULT_EVERYONE, PERM_LABELS, communityContext, canViewChannel, conversationAccess, accessibleConversationIds };
