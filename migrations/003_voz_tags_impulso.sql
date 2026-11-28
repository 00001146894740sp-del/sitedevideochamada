-- NEW GG — canais de voz, impulso e tag de servidor, selos configuráveis e efeitos em GIF

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_category_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_category_check
  CHECK (category IN ('geral','conversas','anuncios','suporte','midia','memes','noticias','privado','voz'));

ALTER TABLE communities ADD COLUMN boost_level integer NOT NULL DEFAULT 0 CHECK (boost_level BETWEEN 0 AND 3);
-- tag do servidor: { text: "CPX", mode: "ui"|"png", colors: [...], textColor, imageUrl }
ALTER TABLE communities ADD COLUMN tag jsonb;

-- tag de servidor que o usuário escolheu exibir (cópia, com communityId)
ALTER TABLE users ADD COLUMN server_tag jsonb;

-- efeitos de emoji saem da loja (quem já comprou continua usando)
UPDATE shop_items SET active = false WHERE type = 'effect' AND config->>'kind' = 'emoji';

-- aparência dos selos ao lado do nome (UI ou PNG), editável pelo dono
INSERT INTO site_settings (key, value) VALUES ('badge_styles', '{
  "verified":  {"mode":"ui","text":"VERIFICADO","colors":["#9d4dff","#f5c542"],"textColor":"#ffffff","icon":"check"},
  "owner":     {"mode":"ui","text":"DONO","colors":["#ffe08a","#f5c542"],"textColor":"#2a1600"},
  "admin":     {"mode":"ui","text":"ADMIN","colors":["#c18bff","#9d4dff"],"textColor":"#ffffff"},
  "moderator": {"mode":"ui","text":"MOD","colors":["#4dd0ff","#4d7cff"],"textColor":"#ffffff"},
  "support":   {"mode":"ui","text":"SUPORTE","colors":["#3ddc97","#1fa971"],"textColor":"#04140c"}
}') ON CONFLICT (key) DO NOTHING;
