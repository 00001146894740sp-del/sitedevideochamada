// Pré-visualização de links com proteção contra SSRF (bloqueia IPs privados/locais, inclusive após DNS)
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const db = require('./db');

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] >= 224;
  }
  const l = ip.toLowerCase();
  if (l.startsWith('::ffff:')) return isPrivateIp(l.slice(7));
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80');
}

function safeLookup(hostname, opts, cb) {
  dns.lookup(hostname, { all: true }, (e, addrs) => {
    if (e) return cb(e);
    const ok = addrs.find(a => !isPrivateIp(a.address));
    if (!ok || addrs.some(a => isPrivateIp(a.address))) return cb(new Error('destino bloqueado'));
    if (opts && opts.all) return cb(null, [ok]);
    cb(null, ok.address, ok.family);
  });
}

function fetchHtml(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error('url')); }
    if (!['http:', 'https:'].includes(u.protocol)) return reject(new Error('protocolo'));
    if (u.port && !['80', '443', ''].includes(u.port)) return reject(new Error('porta'));
    if (net.isIP(u.hostname) && isPrivateIp(u.hostname)) return reject(new Error('ip'));
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(u, {
      lookup: safeLookup, timeout: 4000,
      headers: { 'User-Agent': 'NEWGG-LinkPreview/1.0', Accept: 'text/html' }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(fetchHtml(new URL(res.headers.location, u).toString(), redirects - 1));
      }
      if (res.statusCode !== 200 || !/text\/html/.test(res.headers['content-type'] || '')) {
        res.resume(); return reject(new Error('não-html'));
      }
      let size = 0; const chunks = [];
      res.on('data', c => {
        size += c.length; chunks.push(c);
        if (size > 512 * 1024) { req.destroy(); resolve({ html: Buffer.concat(chunks).toString('utf8'), finalUrl: u.toString() }); }
      });
      res.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8'), finalUrl: u.toString() }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function meta(html, keys) {
  for (const k of keys) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']*)["']`, 'i');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${k}["']`, 'i');
    const m = html.match(re1) || html.match(re2);
    if (m) return decode(m[1]).trim();
  }
  return null;
}

async function getPreview(url) {
  const cached = await db.one(`SELECT data FROM link_previews WHERE url=$1 AND fetched_at > now() - interval '1 day'`, [url]);
  if (cached) return cached.data;
  let data = null;
  try {
    const { html, finalUrl } = await fetchHtml(url);
    const title = meta(html, ['og:title', 'twitter:title']) || (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] && decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)[1]).trim());
    if (title) {
      let image = meta(html, ['og:image', 'twitter:image']);
      if (image) { try { image = new URL(image, finalUrl).toString(); if (!image.startsWith('https://')) image = null; } catch { image = null; } }
      data = {
        url, title: title.slice(0, 200),
        description: (meta(html, ['og:description', 'description', 'twitter:description']) || '').slice(0, 300),
        image, site: (meta(html, ['og:site_name']) || new URL(finalUrl).hostname).slice(0, 80)
      };
    }
  } catch { data = null; }
  await db.query(`INSERT INTO link_previews(url,data,fetched_at) VALUES ($1,$2,now()) ON CONFLICT (url) DO UPDATE SET data=EXCLUDED.data, fetched_at=now()`, [url, data]);
  return data;
}

const URL_RE = /\bhttps?:\/\/[^\s<>"']{3,500}/i;
const firstUrl = text => (text.match(URL_RE) || [null])[0];

module.exports = { getPreview, firstUrl, isPrivateIp };
