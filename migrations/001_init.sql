-- NEW GG — esquema inicial
-- Executado automaticamente por src/migrate.js (tabela schema_migrations controla o que já rodou)

-- ============ ARQUIVOS ============
CREATE TABLE files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      bigint,
  filename      text NOT NULL,
  mime          text NOT NULL,
  size          integer NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('image','video','audio','document')),
  scope         text NOT NULL CHECK (scope IN ('public','message','story','ticket')),
  data          bytea NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

-- ============ USUÁRIOS ============
CREATE TABLE users (
  id              bigserial PRIMARY KEY,
  username        text NOT NULL,
  email           text,
  password_hash   text,
  email_verified  boolean NOT NULL DEFAULT false,
  display_name    text NOT NULL,
  bio             text NOT NULL DEFAULT '',
  custom_status   text NOT NULL DEFAULT '',
  presence        text NOT NULL DEFAULT 'online' CHECK (presence IN ('online','away','busy','invisible')),
  avatar_file_id  uuid REFERENCES files(id) ON DELETE SET NULL,
  banner_file_id  uuid REFERENCES files(id) ON DELETE SET NULL,
  profile_color   text NOT NULL DEFAULT '#8b2cff',
  links           jsonb NOT NULL DEFAULT '[]',
  global_role     text NOT NULL DEFAULT 'user' CHECK (global_role IN ('owner','admin','moderator','support','user')),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','banned','deleted')),
  suspended_until timestamptz,
  status_reason   text,
  google_id       text UNIQUE,
  discord_id      text UNIQUE,
  settings        jsonb NOT NULL DEFAULT '{}',
  privacy         jsonb NOT NULL DEFAULT '{}',
  last_seen_at    timestamptz,
  deletion_requested_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_lower ON users (lower(username));
CREATE UNIQUE INDEX users_email_lower ON users (lower(email)) WHERE email IS NOT NULL;
ALTER TABLE files ADD CONSTRAINT files_owner_fk FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE sessions (
  id           bigserial PRIMARY KEY,
  token_hash   text NOT NULL UNIQUE,
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token   text NOT NULL,
  ip           text,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE login_history (
  id         bigserial PRIMARY KEY,
  user_id    bigint REFERENCES users(id) ON DELETE CASCADE,
  identifier text,
  method     text NOT NULL,
  success    boolean NOT NULL,
  ip         text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_history_user ON login_history(user_id, created_at DESC);
CREATE INDEX login_history_ident ON login_history(lower(identifier), created_at DESC);

CREATE TABLE email_tokens (
  id         bigserial PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  type       text NOT NULL CHECK (type IN ('verify','reset')),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============ CONQUISTAS / ATIVIDADE ============
CREATE TABLE badges (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  description text NOT NULL,
  icon        text NOT NULL,
  special     boolean NOT NULL DEFAULT false
);
CREATE TABLE user_badges (
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_code text NOT NULL REFERENCES badges(code) ON DELETE CASCADE,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  awarded_by bigint REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, badge_code)
);
INSERT INTO badges (code,name,description,icon,special) VALUES
 ('pioneer','Pioneiro','Entrou entre os 1000 primeiros usuários','🚀',false),
 ('first_message','Primeira palavra','Enviou a primeira mensagem','💬',false),
 ('social','Social','Fez 5 amizades','🤝',false),
 ('founder','Fundador','Criou uma comunidade','🏰',false),
 ('storyteller','Contador de histórias','Publicou o primeiro story','✨',false),
 ('caller','Na linha','Fez a primeira ligação','📞',false),
 ('staff','Equipe NEW GG','Membro da equipe oficial','🛡️',true),
 ('verified','Verificado','Conta verificada pela equipe','✔️',true),
 ('supporter','Apoiador','Apoiador especial da plataforma','💎',true);

CREATE TABLE user_activity (
  id         bigserial PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       text NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_activity_user ON user_activity(user_id, created_at DESC);

-- ============ AMIGOS / BLOQUEIOS ============
CREATE TABLE friend_requests (
  id         bigserial PRIMARY KEY,
  from_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);
CREATE UNIQUE INDEX friend_requests_pending ON friend_requests(from_id, to_id) WHERE status = 'pending';

CREATE TABLE friends (
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  favorite   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, friend_id)
);

CREATE TABLE blocks (
  blocker_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);

-- ============ COMUNIDADES ============
CREATE TABLE communities (
  id             bigserial PRIMARY KEY,
  name           text NOT NULL,
  description    text NOT NULL DEFAULT '',
  logo_file_id   uuid REFERENCES files(id) ON DELETE SET NULL,
  banner_file_id uuid REFERENCES files(id) ON DELETE SET NULL,
  owner_id       bigint NOT NULL REFERENCES users(id),
  is_public      boolean NOT NULL DEFAULT true,
  removed_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE community_roles (
  id           bigserial PRIMARY KEY,
  community_id bigint NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name         text NOT NULL,
  color        text NOT NULL DEFAULT '#b9a6d9',
  permissions  bigint NOT NULL DEFAULT 0,
  position     integer NOT NULL DEFAULT 0,
  is_default   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE community_members (
  community_id bigint NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname     text,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);

CREATE TABLE community_member_roles (
  community_id bigint NOT NULL,
  user_id      bigint NOT NULL,
  role_id      bigint NOT NULL REFERENCES community_roles(id) ON DELETE CASCADE,
  PRIMARY KEY (community_id, user_id, role_id),
  FOREIGN KEY (community_id, user_id) REFERENCES community_members(community_id, user_id) ON DELETE CASCADE
);

CREATE TABLE community_bans (
  community_id bigint NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason       text,
  banned_by    bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);

CREATE TABLE community_invites (
  code         text PRIMARY KEY,
  community_id bigint NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  created_by   bigint REFERENCES users(id) ON DELETE SET NULL,
  uses         integer NOT NULL DEFAULT 0,
  max_uses     integer,
  expires_at   timestamptz,
  revoked      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE community_audit (
  id           bigserial PRIMARY KEY,
  community_id bigint NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  actor_id     bigint REFERENCES users(id) ON DELETE SET NULL,
  action       text NOT NULL,
  target       text,
  data         jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX community_audit_c ON community_audit(community_id, created_at DESC);

-- ============ CONVERSAS (DM, GRUPOS E CANAIS) ============
CREATE TABLE conversations (
  id               bigserial PRIMARY KEY,
  type             text NOT NULL CHECK (type IN ('dm','group','channel')),
  name             text,
  description      text NOT NULL DEFAULT '',
  avatar_file_id   uuid REFERENCES files(id) ON DELETE SET NULL,
  banner_file_id   uuid REFERENCES files(id) ON DELETE SET NULL,
  owner_id         bigint REFERENCES users(id) ON DELETE SET NULL,
  -- grupos
  privacy          text NOT NULL DEFAULT 'private' CHECK (privacy IN ('public','private')),
  join_approval    boolean NOT NULL DEFAULT false,
  invite_code      text UNIQUE,
  only_admins_send boolean NOT NULL DEFAULT false,
  notice           text NOT NULL DEFAULT '',
  -- canais
  community_id     bigint REFERENCES communities(id) ON DELETE CASCADE,
  category         text CHECK (category IN ('geral','conversas','anuncios','suporte','midia','memes','noticias','privado')),
  is_private       boolean NOT NULL DEFAULT false,
  position         integer NOT NULL DEFAULT 0,
  topic            text NOT NULL DEFAULT '',
  dm_key           text UNIQUE,
  removed_at       timestamptz,
  last_message_at  timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_community ON conversations(community_id) WHERE community_id IS NOT NULL;

CREATE TABLE channel_roles (
  channel_id bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role_id    bigint NOT NULL REFERENCES community_roles(id) ON DELETE CASCADE,
  PRIMARY KEY (channel_id, role_id)
);

CREATE TABLE conversation_members (
  conversation_id   bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id           bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role              text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','moderator','member')),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','left','removed')),
  can_send          boolean NOT NULL DEFAULT true,
  can_send_media    boolean NOT NULL DEFAULT true,
  can_invite        boolean NOT NULL DEFAULT true,
  can_pin           boolean NOT NULL DEFAULT false,
  silenced_until    timestamptz,
  notif_muted       boolean NOT NULL DEFAULT false,
  archived          boolean NOT NULL DEFAULT false,
  cleared_before_id bigint NOT NULL DEFAULT 0,
  last_read_id      bigint NOT NULL DEFAULT 0,
  last_delivered_id bigint NOT NULL DEFAULT 0,
  joined_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_members_user ON conversation_members(user_id) WHERE status = 'active';

-- estado de leitura em canais de comunidade (sem membership explícita)
CREATE TABLE channel_reads (
  channel_id   bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE member_history (
  id              bigserial PRIMARY KEY,
  conversation_id bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id        bigint REFERENCES users(id) ON DELETE SET NULL,
  action          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id               bigserial PRIMARY KEY,
  conversation_id  bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id        bigint REFERENCES users(id) ON DELETE SET NULL,
  type             text NOT NULL DEFAULT 'text' CHECK (type IN ('text','system','sticker','gif','voice','story_reply','call')),
  content          text NOT NULL DEFAULT '',
  reply_to_id      bigint REFERENCES messages(id) ON DELETE SET NULL,
  forwarded        boolean NOT NULL DEFAULT false,
  meta             jsonb NOT NULL DEFAULT '{}',
  link_preview     jsonb,
  edited_at        timestamptz,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  search_tsv       tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content,''))) STORED
);
CREATE INDEX messages_conv ON messages(conversation_id, id DESC);
CREATE INDEX messages_sender ON messages(sender_id);
CREATE INDEX messages_tsv ON messages USING gin(search_tsv);

CREATE TABLE message_attachments (
  message_id bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  file_id    uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  position   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (message_id, file_id)
);
CREATE INDEX message_attachments_file ON message_attachments(file_id);

CREATE TABLE message_reactions (
  message_id bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE message_pins (
  message_id      bigint PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  pinned_by       bigint REFERENCES users(id) ON DELETE SET NULL,
  pinned_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE message_favorites (
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);

CREATE TABLE message_hidden (
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, message_id)
);

CREATE TABLE link_previews (
  url        text PRIMARY KEY,
  data       jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

-- ============ CHAMADAS ============
CREATE TABLE calls (
  id              bigserial PRIMARY KEY,
  conversation_id bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  initiator_id    bigint REFERENCES users(id) ON DELETE SET NULL,
  media           text NOT NULL CHECK (media IN ('audio','video')),
  status          text NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing','ongoing','ended','missed','declined')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  answered_at     timestamptz,
  ended_at        timestamptz
);
CREATE TABLE call_participants (
  call_id   bigint NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  user_id   bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state     text NOT NULL DEFAULT 'invited' CHECK (state IN ('invited','joined','left','declined','missed')),
  joined_at timestamptz,
  left_at   timestamptz,
  PRIMARY KEY (call_id, user_id)
);

-- ============ STORIES ============
CREATE TABLE stories (
  id          bigserial PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('image','video','text')),
  file_id     uuid REFERENCES files(id) ON DELETE SET NULL,
  text        text NOT NULL DEFAULT '',
  bg          text NOT NULL DEFAULT '#3b0a78',
  privacy     text NOT NULL DEFAULT 'friends' CHECK (privacy IN ('public','friends','close')),
  expires_at  timestamptz NOT NULL,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stories_user ON stories(user_id, created_at DESC);
CREATE TABLE story_views (
  story_id  bigint NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id   bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, user_id)
);
CREATE TABLE story_reactions (
  story_id bigint NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, user_id)
);

-- ============ NOTIFICAÇÕES ============
CREATE TABLE notifications (
  id         bigserial PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       text NOT NULL,
  actor_id   bigint REFERENCES users(id) ON DELETE SET NULL,
  data       jsonb NOT NULL DEFAULT '{}',
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user ON notifications(user_id, id DESC);

-- ============ DENÚNCIAS / MODERAÇÃO ============
CREATE TABLE reports (
  id           bigserial PRIMARY KEY,
  reporter_id  bigint REFERENCES users(id) ON DELETE SET NULL,
  target_type  text NOT NULL CHECK (target_type IN ('user','message','group','community','story')),
  target_id    bigint NOT NULL,
  community_id bigint REFERENCES communities(id) ON DELETE CASCADE,
  reason       text NOT NULL,
  details      text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','resolved','dismissed')),
  handled_by   bigint REFERENCES users(id) ON DELETE SET NULL,
  resolution   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bans (
  id         bigserial PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       text NOT NULL CHECK (type IN ('suspend','ban')),
  reason     text,
  actor_id   bigint REFERENCES users(id) ON DELETE SET NULL,
  until      timestamptz,
  lifted_at  timestamptz,
  lifted_by  bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_logs (
  id          bigserial PRIMARY KEY,
  actor_id    bigint REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  target_type text,
  target_id   text,
  data        jsonb NOT NULL DEFAULT '{}',
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE announcements (
  id         bigserial PRIMARY KEY,
  title      text NOT NULL,
  content    text NOT NULL,
  created_by bigint REFERENCES users(id) ON DELETE SET NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE site_settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);
INSERT INTO site_settings (key, value) VALUES
 ('registration_open', 'true'),
 ('max_upload_mb', '25'),
 ('max_message_length', '4000'),
 ('maintenance_notice', '""');

-- ============ SUPORTE ============
CREATE TABLE tickets (
  id          bigserial PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category    text NOT NULL,
  subject     text NOT NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  assigned_to bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz
);
CREATE TABLE ticket_messages (
  id         bigserial PRIMARY KEY,
  ticket_id  bigint NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id  bigint REFERENCES users(id) ON DELETE SET NULL,
  is_staff   boolean NOT NULL DEFAULT false,
  content    text NOT NULL,
  file_ids   uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============ FIGURINHAS ============
CREATE TABLE stickers (
  id         bigserial PRIMARY KEY,
  owner_id   bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id    uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  name       text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sticker_favorites (
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sticker_id bigint NOT NULL REFERENCES stickers(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, sticker_id)
);
