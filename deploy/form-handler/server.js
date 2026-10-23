'use strict';
/*
 * Приём заявок с сайта med-local.ru вместо Formspree.
 * Заявка принимается и пересылается только на российских серверах: письмо уходит через SMTP
 * ящика на Timeweb. Ничего, кроме письма, не сохраняется. В лог пишутся время, результат и
 * страница, но не имя, телефон и IP.
 *
 * Переменные окружения (задаются в панели Timeweb, в репозиторий не кладутся):
 *   SMTP_USER, SMTP_PASS  логин и пароль ящика, с которого уходят письма (например info@med-local.ru)
 *   MAIL_TO               куда присылать заявки
 *   SMTP_HOST             по умолчанию smtp.timeweb.ru
 *   SMTP_PORT             по умолчанию 465 (SSL)
 *   MAIL_FROM             по умолчанию равен SMTP_USER
 *   ALLOWED_ORIGINS       через запятую; по умолчанию https://med-local.ru,https://www.med-local.ru
 *   POLICY_DATE           дата актуальной Политики, попадает в письмо как подтверждение согласия
 *   DRY_RUN=1             не отправлять письма, а печатать в консоль (для проверки)
 *   RATE_LIMIT            заявок с одного IP за 10 минут, по умолчанию 5
 *   PORT                  по умолчанию 8080
 */
const http = require('http');

const PORT = Number(process.env.PORT) || 8080;
const DRY = process.env.DRY_RUN === '1';
const ALLOWED = (process.env.ALLOWED_ORIGINS || 'https://med-local.ru,https://www.med-local.ru')
  .split(',').map((s) => s.trim()).filter(Boolean);
const RATE_LIMIT = Number(process.env.RATE_LIMIT) || 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_BODY = 10 * 1024;
const POLICY_DATE = process.env.POLICY_DATE || '23.10.2026';

let transporter = null;
if (!DRY) {
  const nodemailer = require('nodemailer');
  for (const k of ['SMTP_USER', 'SMTP_PASS', 'MAIL_TO']) {
    if (!process.env[k]) { console.error('Не задана переменная окружения ' + k); process.exit(1); }
  }
  const port = Number(process.env.SMTP_PORT) || 465;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.timeweb.ru',
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10000,
    socketTimeout: 15000,
  });
}

const hits = new Map();
setInterval(() => {
  const limit = Date.now() - RATE_WINDOW_MS;
  for (const [ip, list] of hits) {
    const fresh = list.filter((t) => t > limit);
    if (fresh.length) hits.set(ip, fresh); else hits.delete(ip);
  }
}, 60 * 1000).unref();

function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => t > now - RATE_WINDOW_MS);
  if (list.length >= RATE_LIMIT) { hits.set(ip, list); return true; }
  list.push(now);
  hits.set(ip, list);
  return false;
}

const clean = (v, max) =>
  String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);

const log = (o) => console.log(JSON.stringify(Object.assign({ ts: new Date().toISOString() }, o)));

function send(res, status, body, origin) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (origin && ALLOWED.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { status: 413 })); req.pause(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parse(raw, type) {
  if (type.includes('application/json')) return JSON.parse(raw);
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  throw Object.assign(new Error('unsupported'), { status: 415 });
}

async function handleLead(req, res, origin) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
  if (limited(ip)) { log({ result: 'rate_limited' }); return send(res, 429, { ok: false, error: 'rate_limited' }, origin); }

  let data;
  try {
    data = parse(await readBody(req), String(req.headers['content-type'] || ''));
  } catch (e) {
    const status = e.status || 400;
    log({ result: 'bad_body', status });
    if (status === 413) {
      res.setHeader('Connection', 'close');
      res.on('finish', () => req.destroy());
    }
    return send(res, status, { ok: false, error: status === 413 ? 'too_large' : status === 415 ? 'unsupported' : 'bad_request' }, origin);
  }

  if (clean(data.website, 200)) { log({ result: 'honeypot' }); return send(res, 200, { ok: true }, origin); }

  const name = clean(data.name, 200);
  const phone = clean(data.phone, 50);
  const device = clean(data.device, 500);
  const email = clean(data.email, 200);
  const page = clean(data.page, 200);
  const lang = clean(data.lang, 5) === 'en' ? 'en' : 'ru';
  const consent = ['1', 'true', 'on', 'yes'].includes(String(data.consent).toLowerCase());
  const digits = phone.replace(/\D/g, '');

  if (!name || digits.length < 6 || digits.length > 18) { log({ result: 'invalid' }); return send(res, 422, { ok: false, error: 'invalid' }, origin); }
  if (!consent) { log({ result: 'no_consent' }); return send(res, 422, { ok: false, error: 'no_consent' }, origin); }

  const text = [
    'Заявка с сайта med-local.ru',
    '',
    'Имя / компания: ' + name,
    'Телефон: ' + phone,
    'Изделие / задача: ' + (device || '—'),
    'Email: ' + (email || '—'),
    '',
    'Версия сайта: ' + lang,
    'Страница: ' + (page || '—'),
    'Согласие на обработку персональных данных: дано, ' + new Date().toISOString() + ' (UTC)',
    'Редакция Политики: ' + POLICY_DATE,
    'IP: ' + ip,
  ].join('\n');
  const subject = 'Заявка с сайта: ' + name.slice(0, 80);

  try {
    if (DRY) console.log('--- DRY_RUN, письмо не отправлено ---\nSubject: ' + subject + '\n' + text + '\n---');
    else await transporter.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to: process.env.MAIL_TO, subject, text });
    log({ result: 'sent', page });
    return send(res, 200, { ok: true }, origin);
  } catch (e) {
    log({ result: 'mail_error', error: String(e && e.code || e && e.message || e).slice(0, 120) });
    return send(res, 502, { ok: false, error: 'mail_failed' }, origin);
  }
}

const server = http.createServer(async (req, res) => {
  const url = (req.url || '').split('?')[0];
  const origin = req.headers.origin || '';

  if (req.method === 'GET' && url === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }

  if (url !== '/lead') return send(res, 404, { ok: false, error: 'not_found' });

  if (!ALLOWED.includes(origin)) { log({ result: 'bad_origin' }); return send(res, 403, { ok: false, error: 'forbidden' }); }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    });
    return res.end();
  }
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' }, origin);

  try { await handleLead(req, res, origin); }
  catch (e) { log({ result: 'error' }); if (!res.headersSent) send(res, 500, { ok: false, error: 'server_error' }, origin); }
});

server.listen(PORT, () => log({ result: 'listening', port: PORT, dry_run: DRY }));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
