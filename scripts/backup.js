// Backup lógico do banco com pg_dump (formato custom, comprimido).
// Uso: npm run backup  -> gera backups/newgg-AAAA-MM-DD-HHMM.dump
// Restaurar: pg_restore --clean --no-owner -d "$DATABASE_URL" backups/arquivo.dump
require('dotenv').config();
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL não definida.'); process.exit(1); }
const dir = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const file = path.join(dir, `newgg-${stamp}.dump`);

const p = spawn('pg_dump', ['--format=custom', '--no-owner', '--file', file, url], { stdio: 'inherit' });
p.on('error', e => { console.error('pg_dump não encontrado. Instale o cliente PostgreSQL.', e.message); process.exit(1); });
p.on('exit', code => {
  if (code !== 0) { console.error('Backup falhou.'); process.exit(code); }
  // mantém apenas os 14 backups mais recentes
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.dump')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - Number(process.env.BACKUP_KEEP || 14)))) fs.unlinkSync(path.join(dir, f));
  console.log(`✔ Backup criado: ${file}`);
});
