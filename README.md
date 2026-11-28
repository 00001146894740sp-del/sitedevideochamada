# NEW GG

Plataforma de comunicação em tempo real: conversas privadas, grupos, comunidades com cargos e canais, chamadas de voz/vídeo (WebRTC), stories, amigos, notificações, pesquisa global, central de suporte e painel administrativo.

**Stack:** Node.js 20+ · Express · Socket.IO · PostgreSQL · WebRTC · front-end em JavaScript puro (sem etapa de build).

---

## Recursos

| Área | O que está implementado |
|---|---|
| Contas | Cadastro (usuário + e-mail), senha com bcrypt, login/logout, sessão persistente (cookie httpOnly), verificação de e-mail, recuperação de senha, login com Google e Discord (e vínculo/desvínculo), lista de dispositivos conectados com encerramento remoto, histórico de acessos, bloqueio após tentativas excessivas |
| Perfil | Foto, banner, nome de exibição, @usuário exclusivo, bio (com *negrito*, _itálico_ e links), status personalizado, presença (online/ausente/ocupado/invisível), cor do perfil, links sociais, conquistas automáticas, insígnias especiais (concedidas pela equipe), histórico de atividades configurável |
| Conversas | Envio em tempo real, respostas com citação, encaminhar, editar, apagar (para mim / para todos), reações, fixar, favoritar, enviada/entregue/visualizada, “digitando…”, histórico paginado, pesquisa na conversa, imagens, vídeos, documentos, áudios, gravação de voz, pré-visualização de links (com proteção SSRF), menções @, seleção múltipla, limpar histórico, arquivar, silenciar |
| Grupos | Nome, foto, banner, descrição, dono/admins/moderadores/membros, link de convite, aprovação de entrada, permissões individuais, remoção, silenciamento temporário, aviso fixo, mensagens fixadas, histórico de participantes, grupos públicos/privados, modo “só admins enviam” |
| Comunidades | Logo, banner, descrição, proprietário, cargos com hierarquia e 14 permissões, canais por categoria (geral, conversas, anúncios, suporte, mídia, memes, notícias, privados), canais privados por cargo, convites com limite/expiração, expulsão, banimento, denúncias, registro de atividades, transferência de propriedade |
| Canais de voz | Estilo Discord: categoria “Canais de voz” nas comunidades, entrar/sair com um clique, até 12 pessoas por sala, quem está falando acende, mutar, ensurdecer, câmera e compartilhar tela dentro da sala, barra “Voz conectada” enquanto navega por outros canais |
| Loja GG | Moeda GG, molduras e **efeitos de perfil em GIF** (enviados e configurados pelo dono: posição avatar/banner/tela inteira e duração), anúncios recompensados com tempo e prêmio configuráveis, extrato. Sem pagamento real |
| Selos e tags | Selos de verificado e de cargo (Dono, Admin, Moderador, Suporte) em **interface** (texto + cores) ou **PNG** próprio, configuráveis em Admin → Tags, selos e impulso |
| Impulso de servidor | Só o **Dono** da plataforma dá impulso (nível 1–3) e a **tag do servidor** (2 a 4 letras, ex.: `#CPX`, em interface ou PNG). Membros escolhem usar a tag ao lado do nome; sair da comunidade remove a tag. Clicar na tag de alguém mostra o servidor de origem e dá para entrar por ela — só se o servidor for público (privado exige convite) |
| Chamadas | Voz e vídeo 1:1 e em grupo (até 8, malha P2P), tocar/atender/recusar/encerrar, silenciar microfone, câmera liga/desliga, compartilhar tela, histórico, notificação de chamada recebida |
| Stories | Foto, vídeo ou texto; duração de 6 a 48 h; privacidade (amigos, amigos favoritos, público); visualizações, reações, respostas privadas (viram mensagem no privado), exclusão e arquivo pessoal |
| Amigos | Solicitações (enviar/aceitar/recusar/cancelar), remover, bloquear, online, favoritos, sugestões (amigos em comum e comunidades), pesquisa |
| Notificações | Tempo real + persistentes: mensagens, solicitações, chamadas, convites, menções, respostas, reações, avisos; preferências por tipo; notificações do navegador e sons |
| Pesquisa | Global (Ctrl+K): usuários, conversas, mensagens, grupos, comunidades, canais e arquivos, com filtros |
| Privacidade | Quem pode enviar mensagem / adicionar, ocultar online, confirmação de leitura recíproca, visibilidade do perfil, bloqueios, denúncias, sessões, exportação de dados (JSON), exclusão de conta (anonimização após 7 dias, cancelável) |
| Administração | Estatísticas e gráficos, usuários (busca/filtros), suspender, banir, desbanir, níveis (Dono, Administrador, Moderador, Suporte, Usuário), insígnias, denúncias com ações, comunidades e grupos (remover/restaurar), remoção de conteúdo, comunicados para todos, registros administrativos, configurações gerais |
| Suporte | Abrir chamado com categoria, descrição e imagens; respostas da equipe; status aberto/em andamento/resolvido/encerrado |
| Mídia | Validação pelo conteúdo real do arquivo (assinatura), bloqueio de executáveis/SVG/HTML, limite configurável, controle de acesso por conversa, download, exclusão dos próprios arquivos, suporte a *Range* (vídeo/áudio) |
| Figurinhas/GIFs | Biblioteca de emojis com favoritos e recentes, figurinhas personalizadas (upload) e favoritas, GIFs via GIPHY, reações rápidas |
| Personalização | Tema (noite violeta, meia-noite, claro), cor de destaque, plano de fundo das conversas, estilo das mensagens, tamanho da interface, reduzir movimento, alto contraste, sons, notificações |

### Segurança
- Senhas com bcrypt (custo 12); tokens de sessão aleatórios guardados como HMAC no banco.
- Cookies `httpOnly`, `SameSite=Lax` e `Secure` em produção; token CSRF por sessão exigido em toda requisição que altera dados + checagem de `Origin`.
- Consultas 100% parametrizadas (sem SQL Injection); a interface monta o DOM sem `innerHTML` com dados de usuário e há CSP estrita (contra XSS).
- Limite de requisições, bloqueio de login por tentativas, limite anti-spam de mensagens e de eventos de socket.
- Permissões sempre verificadas no servidor; hierarquia de cargos impede escalada de privilégios; o **Dono não pode ser alvo** de ações de outros administradores.
- Uploads validados pelo conteúdo, servidos com `nosniff`, `Content-Disposition` e CSP `sandbox`.

> **Sobre criptografia:** as mensagens são protegidas **em trânsito** (HTTPS/WSS) e armazenadas com controle de acesso. O NEW GG **não** usa criptografia de ponta a ponta — a própria interface informa isso ao usuário.

---

## Rodando localmente

Requisitos: Node.js 20+ e PostgreSQL 13+.

```bash
npm install
cp .env.example .env        # edite DATABASE_URL e SESSION_SECRET (NODE_ENV=development para testar sem HTTPS)
npm run dev                 # aplica as migrações e sobe em http://localhost:3000
```

As migrações rodam sozinhas a cada inicialização (`migrations/*.sql`, controladas pela tabela `schema_migrations`). Para rodar só as migrações: `npm run migrate`.

### Teste de ponta a ponta
Com o servidor rodando:
```bash
BASE_URL=http://localhost:3000 OWNER_SETUP_TOKEN=<seu token> npm test
```
O teste cria usuários e verifica cadastro, login, CSRF, perfil, uploads (inclusive bloqueio de arquivo malicioso), amizade, WebSocket, digitação, mensagens em tempo real, confirmações, respostas, edição, reações, fixar/favoritar, pesquisa, anexos com controle de acesso, exclusão, grupos (convite, cargos, silenciamento, remoção), comunidades (canais, cargos, canal privado, convites, denúncia, auditoria), stories, sinalização de chamada, notificações, bloqueio, suporte e painel administrativo (38 verificações).

---

## Publicando no Render

### Opção A — Blueprint (recomendado)
1. Suba este projeto para um repositório no GitHub (o `.gitignore` já exclui `.env` e `node_modules`).
2. No Render: **New + → Blueprint** e escolha o repositório. O `render.yaml` cria o banco `newgg-db` e o serviço web `newgg`, gera `SESSION_SECRET` e `OWNER_SETUP_TOKEN` automaticamente e liga o `DATABASE_URL`.
3. Preencha as variáveis marcadas como “sync: false” (opcionais: SMTP, Google, Discord, TURN, GIPHY, OWNER_EMAIL).
4. Faça o deploy. Ao abrir o site, crie sua conta e vire o dono (veja abaixo).

### Opção B — Manual
1. **New + → PostgreSQL**: crie o banco e copie a *Internal Database URL*.
2. **New + → Web Service**: conecte o repositório.
   - Runtime: Node · Build: `npm ci --omit=dev` · Start: `npm start` · Health check: `/healthz`
3. Em **Environment**, cadastre no mínimo: `NODE_ENV=production`, `DATABASE_URL`, `SESSION_SECRET` (32+ caracteres), `OWNER_SETUP_TOKEN` ou `OWNER_EMAIL`.

### Tornando-se o Dono
- **Com token:** entre no site, vá em *Configurações → Minha conta → Configuração inicial* e informe o `OWNER_SETUP_TOKEN` (só funciona enquanto não houver dono).
- **Com e-mail:** defina `OWNER_EMAIL`; ao cadastrar e confirmar esse e-mail (ou entrar com Google), a conta vira Dono.
- **Pelo terminal:** `npm run make-owner -- seu_usuario` (Render Shell, planos pagos).

### Observações de produção
- **Plano gratuito do Render:** o serviço web hiberna sem acesso (derrubando conexões em tempo real) e o banco gratuito expira em 30 dias. Para uso real, use planos pagos (o `render.yaml` já sugere `starter` e `basic-256mb`).
- **Arquivos** ficam no PostgreSQL (persistentes, sem depender do disco efêmero do Render). Para volume grande de mídia, considere migrar o armazenamento para um bucket (S3/R2) — a função `storeFile` em `src/files.js` é o ponto único de troca.
- **Chamadas:** STUN funciona na maioria das redes domésticas; para 4G/redes corporativas configure um servidor **TURN** (ex.: coturn, Twilio, Metered) em `TURN_URLS/TURN_USERNAME/TURN_CREDENTIAL`. Chamadas em grupo usam malha P2P (limite de 8 pessoas); para salas maiores seria necessário um SFU (ex.: LiveKit, mediasoup).
- **Várias instâncias:** defina `REDIS_URL` para sincronizar Socket.IO e presença entre instâncias. O estado de chamadas ativas e os limites anti-spam ficam em memória por instância — com mais de uma instância, use *sticky sessions*.
- **Backup:** o Render faz backups diários nos planos pagos de PostgreSQL. Há também `npm run backup` (usa `pg_dump`, guarda os 14 mais recentes em `BACKUP_DIR`). Restaurar: `pg_restore --clean --no-owner -d "$DATABASE_URL" arquivo.dump`.
- **E-mail:** sem SMTP, links de verificação/recuperação aparecem apenas no log do servidor e a verificação obrigatória fica desligada.

---

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | ✅ | Conexão PostgreSQL |
| `SESSION_SECRET` | ✅ | Segredo das sessões (32+ caracteres) |
| `NODE_ENV` | ✅ | `production` no Render |
| `APP_URL` | recomendada | URL pública (usada em e-mails, OAuth e checagem de origem). No Render usa `RENDER_EXTERNAL_URL` se vazia |
| `PORT` | — | Porta HTTP (Render define) |
| `DATABASE_SSL` | — | Força SSL no banco (`true`/`false`) |
| `OWNER_EMAIL` | — | E-mail que vira Dono ao ser verificado |
| `OWNER_SETUP_TOKEN` | — | Token para reivindicar o papel de Dono pela interface |
| `SESSION_DAYS` | — | Duração da sessão (padrão 30) |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCK_MINUTES` | — | Bloqueio por tentativas (padrão 5 / 15 min) |
| `TRUST_PROXY` | — | Proxies confiáveis (padrão 1 em produção) |
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` `MAIL_FROM` | — | Envio de e-mails |
| `REQUIRE_EMAIL_VERIFICATION` | — | Exige e-mail confirmado para entrar |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | Login com Google |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | — | Login com Discord |
| `STUN_URLS` | — | Servidores STUN (separados por vírgula) |
| `TURN_URLS` `TURN_USERNAME` `TURN_CREDENTIAL` | — | Servidor TURN para chamadas |
| `MAX_UPLOAD_MB` | — | Teto de upload (padrão 50, máx. 100) |
| `GIPHY_API_KEY` | — | GIFs (chave beta gratuita do GIPHY) |
| `REDIS_URL` | — | Múltiplas instâncias |
| `DB_POOL_MAX` | — | Conexões no pool (padrão 10) |
| `BACKUP_DIR` / `BACKUP_KEEP` | — | Script de backup |

URLs de retorno do OAuth: `{APP_URL}/api/auth/oauth/google/callback` e `{APP_URL}/api/auth/oauth/discord/callback`.

---

## Estrutura

```
src/
  server.js          Express, segurança HTTP, rotas, tarefas de manutenção
  realtime.js        Socket.IO: salas, presença, digitação, confirmações, sinalização WebRTC
  config.js db.js migrate.js security.js util.js settings.js
  files.js           upload e validação de arquivos
  messages.js        criação/serialização de mensagens, menções, pré-visualização de links
  permissions.js     permissões de conversas, grupos, canais e cargos
  notify.js hub.js linkpreview.js mailer.js
  routes/            auth, users (perfil/amigos/bloqueios), conversations (DM/grupos/mensagens),
                     communities, stories, misc (notificações/pesquisa/denúncias/arquivos/chamadas/figurinhas),
                     support, admin
migrations/001_init.sql   esquema completo do banco
public/                   interface (index.html, css/app.css, js/*.js, img/)
scripts/                  make-owner.js, backup.js
test/smoke.test.js        teste de ponta a ponta
render.yaml  .env.example
```
