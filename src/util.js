const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const err = (status, message, code) => new HttpError(status, message, code);

// envolve handlers async para encaminhar erros ao middleware de erro
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function str(v, { name = 'campo', min = 0, max = 500, required = true, trim = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required && min > 0) throw err(400, `${name} é obrigatório.`);
    return '';
  }
  if (typeof v !== 'string') throw err(400, `${name} inválido.`);
  const s = trim ? v.trim() : v;
  if (s.length < min) throw err(400, `${name} precisa ter pelo menos ${min} caracteres.`);
  if (s.length > max) throw err(400, `${name} pode ter no máximo ${max} caracteres.`);
  // remove caracteres de controle (exceto quebra de linha/tab)
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}
function int(v, { name = 'número', min = -Infinity, max = Infinity, def } = {}) {
  if ((v === undefined || v === null || v === '') && def !== undefined) return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw err(400, `${name} inválido.`);
  return n;
}
function bool(v, def = false) {
  if (v === undefined || v === null) return def;
  if (typeof v === 'boolean') return v;
  return v === 'true' || v === '1' || v === 1;
}
function oneOf(v, list, name = 'valor', def) {
  if ((v === undefined || v === null || v === '') && def !== undefined) return def;
  if (!list.includes(v)) throw err(400, `${name} inválido.`);
  return v;
}
function idArray(v, name = 'lista') {
  if (!Array.isArray(v)) throw err(400, `${name} inválida.`);
  return [...new Set(v.map(x => int(x, { name, min: 1 })))];
}

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,24}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

const fileUrl = id => (id ? `/api/files/${id}` : null);

function publicUser(u, { full = false } = {}) {
  if (!u) return null;
  const o = {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    avatar: fileUrl(u.avatar_file_id),
    color: u.profile_color,
    role: u.global_role,
    verified: !!u.verified,
    frame: u.equipped_frame || null,
    tag: u.server_tag || null
  };
  if (full) {
    Object.assign(o, {
      effect: u.equipped_effect || null,
      bio: u.bio,
      customStatus: u.custom_status,
      banner: fileUrl(u.banner_file_id),
      links: u.links,
      createdAt: u.created_at
    });
  }
  return o;
}

const ROLE_RANK = { user: 0, support: 1, moderator: 2, admin: 3, owner: 4 };

const DEFAULT_SETTINGS = {
  theme: 'dark',
  accent: '#9d4dff',
  chatBg: 'aurora',
  bubbleStyle: 'rounded',
  fontScale: 1,
  compact: false,
  sounds: true,
  reduceMotion: false,
  highContrast: false,
  emojiFavorites: ['🔥', '😂', '❤️', '👍', '😮', '😢'],
  notifications: {
    messages: true, friendRequests: true, calls: true, groupInvites: true,
    mentions: true, replies: true, reactions: true, communityInvites: true, admin: true
  }
};
const DEFAULT_PRIVACY = {
  whoCanMessage: 'everyone',   // everyone | friends | nobody
  whoCanAdd: 'everyone',       // everyone | friends_of_friends | nobody
  showOnline: true,
  readReceipts: true,
  profileVisibility: 'everyone', // everyone | friends
  activityVisible: true
};

function mergeDeep(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && base[k] && typeof base[k] === 'object') {
      out[k] = mergeDeep(base[k], over[k]);
    } else out[k] = over[k];
  }
  return out;
}

const clientIp = req => req.ip || req.socket?.remoteAddress || '';

module.exports = {
  HttpError, err, ah, str, int, bool, oneOf, idArray, USERNAME_RE, EMAIL_RE,
  randomToken, sha256, fileUrl, publicUser, ROLE_RANK, DEFAULT_SETTINGS, DEFAULT_PRIVACY,
  mergeDeep, clientIp
};
