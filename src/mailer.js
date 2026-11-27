const nodemailer = require('nodemailer');
const config = require('./config');

let transport = null;
const enabled = !!(config.smtp.host && config.smtp.user && config.smtp.pass);
if (enabled) {
  transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.pass }
  });
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout(title, body, ctaText, ctaUrl) {
  return `<!doctype html><html><body style="margin:0;background:#0b0614;font-family:Arial,sans-serif;color:#eee">
  <div style="max-width:520px;margin:0 auto;padding:32px">
    <h1 style="color:#f5c542;letter-spacing:2px;margin:0 0 4px">NEW GG</h1>
    <div style="height:3px;background:linear-gradient(90deg,#9d4dff,#f5c542);margin-bottom:24px"></div>
    <h2 style="color:#fff">${esc(title)}</h2>
    <p style="line-height:1.6;color:#cfc3e6">${body}</p>
    <p style="margin:28px 0"><a href="${esc(ctaUrl)}" style="background:#9d4dff;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:bold">${esc(ctaText)}</a></p>
    <p style="font-size:12px;color:#8a7da3">Se você não solicitou isso, ignore este e-mail.</p>
  </div></body></html>`;
}

async function send(to, subject, html, text) {
  if (!enabled) {
    console.log(`[mailer] SMTP não configurado. E-mail para ${to}: ${subject}\n${text}`);
    return false;
  }
  await transport.sendMail({ from: config.smtp.from, to, subject, html, text });
  return true;
}

module.exports = {
  enabled,
  sendVerification: (to, name, url) => send(to, 'Confirme seu e-mail — NEW GG',
    layout(`Olá, ${name}!`, 'Confirme seu e-mail para ativar todos os recursos da sua conta NEW GG.', 'Confirmar e-mail', url),
    `Confirme seu e-mail: ${url}`),
  sendReset: (to, name, url) => send(to, 'Redefinição de senha — NEW GG',
    layout(`Olá, ${name}!`, 'Recebemos um pedido para redefinir sua senha. O link expira em 1 hora.', 'Redefinir senha', url),
    `Redefina sua senha: ${url}`)
};
