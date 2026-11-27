// Upload, validação por assinatura (magic bytes) e armazenamento persistente no PostgreSQL
const multer = require('multer');
const db = require('./db');
const { err } = require('./util');
const { getSetting } = require('./settings');
const config = require('./config');

const MAX_HARD_MB = config.maxUploadMb;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_HARD_MB * 1024 * 1024, files: 10 }
});

const startsWith = (buf, bytes, offset = 0) => bytes.every((b, i) => buf[offset + i] === b);
const ascii = (buf, s, offset = 0) => buf.slice(offset, offset + s.length).toString('latin1') === s;

// detecta o tipo real do arquivo pelo conteúdo; nunca confia no mimetype enviado pelo navegador
function sniff(buf, originalName) {
  const name = (originalName || '').toLowerCase();
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', kind: 'image' };
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47])) return { mime: 'image/png', kind: 'image' };
  if (ascii(buf, 'GIF87a') || ascii(buf, 'GIF89a')) return { mime: 'image/gif', kind: 'image' };
  if (ascii(buf, 'RIFF') && ascii(buf, 'WEBP', 8)) return { mime: 'image/webp', kind: 'image' };
  if (ascii(buf, 'RIFF') && ascii(buf, 'WAVE', 8)) return { mime: 'audio/wav', kind: 'audio' };
  if (ascii(buf, 'ftyp', 4)) {
    const brand = buf.slice(8, 12).toString('latin1');
    if (/^(M4A |M4B )/.test(brand)) return { mime: 'audio/mp4', kind: 'audio' };
    if (/^(heic|heix|mif1)/.test(brand)) return { mime: 'image/heic', kind: 'image' };
    if (brand.startsWith('qt')) return { mime: 'video/quicktime', kind: 'video' };
    return { mime: 'video/mp4', kind: 'video' };
  }
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) {
    // WebM/Matroska — pode ser áudio (gravação de voz) ou vídeo
    const audioOnly = name.endsWith('.weba') || name.startsWith('voice') || name.endsWith('.ogg');
    return audioOnly ? { mime: 'audio/webm', kind: 'audio' } : { mime: 'video/webm', kind: 'video' };
  }
  if (ascii(buf, 'OggS')) return { mime: 'audio/ogg', kind: 'audio' };
  if (ascii(buf, 'ID3') || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return { mime: 'audio/mpeg', kind: 'audio' };
  if (ascii(buf, 'fLaC')) return { mime: 'audio/flac', kind: 'audio' };
  if (ascii(buf, '%PDF')) return { mime: 'application/pdf', kind: 'document' };
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    const map = {
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.odt': 'application/vnd.oasis.opendocument.text',
      '.zip': 'application/zip'
    };
    const ext = Object.keys(map).find(e => name.endsWith(e));
    return { mime: ext ? map[ext] : 'application/zip', kind: 'document' };
  }
  if (ascii(buf, 'Rar!')) return { mime: 'application/vnd.rar', kind: 'document' };
  if (startsWith(buf, [0x37, 0x7a, 0xbc, 0xaf])) return { mime: 'application/x-7z-compressed', kind: 'document' };
  // texto puro: sem bytes nulos e com extensão de texto
  if (/\.(txt|md|csv|log|json)$/.test(name) && !buf.slice(0, 8192).includes(0)) {
    const t = { '.csv': 'text/csv', '.json': 'application/json', '.md': 'text/markdown' };
    const ext = Object.keys(t).find(e => name.endsWith(e));
    return { mime: ext ? t[ext] : 'text/plain', kind: 'document' };
  }
  return null; // tipos não reconhecidos (executáveis, SVG, HTML...) são recusados
}

function safeName(n) {
  return (n || 'arquivo').replace(/[\\/\u0000-\u001f"<>|:*?]/g, '_').slice(0, 180) || 'arquivo';
}

async function storeFile(file, ownerId, scope, { allowKinds } = {}) {
  const maxMb = Math.min(Number(await getSetting('max_upload_mb')) || 25, MAX_HARD_MB);
  if (file.size > maxMb * 1024 * 1024) throw err(413, `Arquivo muito grande. Limite: ${maxMb} MB.`);
  const t = sniff(file.buffer, file.originalname);
  if (!t) throw err(415, `Formato de arquivo não permitido: ${safeName(file.originalname)}`);
  if (allowKinds && !allowKinds.includes(t.kind)) throw err(415, `Esse campo aceita apenas: ${allowKinds.join(', ')}.`);
  const row = await db.one(
    `INSERT INTO files (owner_id, filename, mime, size, kind, scope, data) VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, filename, mime, size, kind`,
    [ownerId, safeName(file.originalname), t.mime, file.size, t.kind, scope, file.buffer]
  );
  return fileInfo(row);
}

const fileInfo = r => ({ id: r.id, url: `/api/files/${r.id}`, name: r.filename, mime: r.mime, size: r.size, kind: r.kind });

module.exports = { upload, storeFile, sniff, fileInfo, safeName };
