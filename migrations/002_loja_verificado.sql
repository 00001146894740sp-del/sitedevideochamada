-- NEW GG — verificação, carteira GG, loja de cosméticos e anúncios recompensados

ALTER TABLE users ADD COLUMN verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN gg_balance integer NOT NULL DEFAULT 100 CHECK (gg_balance >= 0);
-- cópia da configuração do item equipado (evita JOIN em toda listagem de usuários)
ALTER TABLE users ADD COLUMN equipped_frame jsonb;
ALTER TABLE users ADD COLUMN equipped_effect jsonb;

ALTER TABLE communities ADD COLUMN verified boolean NOT NULL DEFAULT false;

CREATE TABLE gg_transactions (
  id         bigserial PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     integer NOT NULL,
  reason     text NOT NULL,
  ref        text,
  balance_after integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gg_transactions_user ON gg_transactions(user_id, id DESC);

CREATE TABLE shop_items (
  id          bigserial PRIMARY KEY,
  type        text NOT NULL CHECK (type IN ('frame','effect')),
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  price       integer NOT NULL CHECK (price >= 0),
  rarity      text NOT NULL DEFAULT 'comum' CHECK (rarity IN ('comum','raro','epico','lendario')),
  config      jsonb NOT NULL DEFAULT '{}',
  active      boolean NOT NULL DEFAULT true,
  created_by  bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_items (
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id     bigint NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
  price_paid  integer NOT NULL DEFAULT 0,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE ads (
  id            bigserial PRIMARY KEY,
  title         text NOT NULL,
  description   text NOT NULL DEFAULT '',
  file_id       uuid REFERENCES files(id) ON DELETE SET NULL,
  link_url      text,
  watch_seconds integer NOT NULL CHECK (watch_seconds BETWEEN 3 AND 600),
  reward        integer NOT NULL CHECK (reward BETWEEN 1 AND 100000),
  daily_limit   integer NOT NULL DEFAULT 3 CHECK (daily_limit BETWEEN 1 AND 100),
  active        boolean NOT NULL DEFAULT true,
  created_by    bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ad_views (
  id          bigserial PRIMARY KEY,
  ad_id       bigint NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at  timestamptz NOT NULL DEFAULT now(),
  claimed_at  timestamptz,
  reward      integer
);
CREATE INDEX ad_views_user ON ad_views(user_id, ad_id, started_at DESC);

-- itens iniciais da loja
INSERT INTO shop_items (type, name, description, price, rarity, config) VALUES
 ('frame','Aro Dourado','Um aro de ouro clássico.',150,'comum','{"kind":"ring","colors":["#ffe08a","#f5c542","#b8860b"]}'),
 ('frame','Neon Roxo','Brilho neon com pulsação.',250,'raro','{"kind":"pulse","colors":["#c18bff","#9d4dff"]}'),
 ('frame','Arco-íris','Cores girando sem parar.',400,'epico','{"kind":"spin","colors":["#ff4d6d","#f5c542","#3ddc97","#4d7cff","#c18bff","#ff4d6d"]}'),
 ('frame','Chama','Aro de fogo animado.',500,'epico','{"kind":"spin","colors":["#ff3d00","#ff9100","#ffd600","#ff3d00"]}'),
 ('frame','Gelo Eterno','Frio, cristalino e brilhante.',350,'raro','{"kind":"pulse","colors":["#e0f7ff","#4dd0ff"]}'),
 ('frame','Galáxia GG','A moldura lendária do NEW GG.',1000,'lendario','{"kind":"spin","colors":["#9d4dff","#f5c542","#ff4dd8","#4d7cff","#9d4dff"]}'),
 ('effect','Brilhos Dourados','Estrelas douradas sobem ao abrir seu perfil.',200,'comum','{"kind":"sparkles","colors":["#f5c542","#ffe08a","#ffffff"]}'),
 ('effect','Confete','Uma festa a cada visita.',300,'raro','{"kind":"confetti","colors":["#ff4d6d","#f5c542","#3ddc97","#4d7cff","#c18bff"]}'),
 ('effect','Corações','Corações flutuando.',300,'raro','{"kind":"emoji","emoji":["💜","💛","❤️"],"direction":"up"}'),
 ('effect','Nevasca','Neve caindo suavemente.',250,'comum','{"kind":"snow","colors":["#ffffff","#e0f7ff"]}'),
 ('effect','Chuva de Fogo','🔥 por todo lado.',450,'epico','{"kind":"emoji","emoji":["🔥","✨"],"direction":"down"}'),
 ('effect','Fogos de Artifício','Explosões de cor no seu perfil.',800,'lendario','{"kind":"fireworks","colors":["#f5c542","#9d4dff","#ff4dd8","#4dd0ff"]}');

