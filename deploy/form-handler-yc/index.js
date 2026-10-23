'use strict';
/*
 * Приём заявок с сайта med-local.ru в Yandex Cloud Functions (замена Formspree).
 * Заявка принимается и пересылается письмом на ящик компании через SMTP Timeweb.
 * Ничего, кроме письма, не сохраняется. В лог не пишутся имя, телефон и IP.
 * Внешних зависимостей нет: SMTP-клиент (implicit TLS, порт 465, AUTH LOGIN) встроен.
 *
 * Точка входа: index.handler. Среда выполнения: Node.js 18 и новее.
 *
 * Переменные окружения функции:
 *   SMTP_USER, SMTP_PASS  логин и пароль ящика, с которого уходят письма (info@med-local.ru)
 *   MAIL_TO               куда присылать заявки (по умолчанию равен SMTP_USER)
 *   MAIL_FROM             по умолчанию равен SMTP_USER
 *   SMTP_HOST             по умолчанию smtp.timeweb.ru
 *   SMTP_PORT             по умолчанию 465
 *   ALLOWED_ORIGINS       через запятую; по умолчанию https://med-local.ru,https://www.med-local.ru
 *   POLICY_DATE           редакция Политики, попадает в письмо; по умолчанию 23.10.2026
 *   RATE_LIMIT            заявок с одного IP за 10 минут на один экземпляр функции; по умолчанию 5
 *   DRY_RUN=1             не отправлять письмо (для проверки)
 *   SMTP_INSECURE=1       не проверять сертификат SMTP (только для локальных тестов)
 */
const tls = require('tls');

const MAX_BODY = 10 * 1024;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const hits = new Map();

function cfg() {
  const env = process.env;
  const user = env.SMTP_USER || '';
  return {
    allowed: (env.ALLOWED_ORIGINS || 'https://med-local.ru,https://www.med-local.ru')
      .split(',').map((s) => s.trim()).filter(Boolean),
    host: env.SMTP_HOST || 'smtp.timeweb.ru',
    port: Number(env.SMTP_PORT) || 465,
    user,
    pass: env.SMTP_PASS || '',
    to: env.MAIL_TO || user,
    from: env.MAIL_FROM || user,
    policyDate: env.POLICY_DATE || '23.10.2026',
    rateLimit: Number(env.RATE_LIMIT) || 5,
    dry: env.DRY_RUN === '1',
    insecure: env.SMTP_INSECURE === '1',
  };
}

const clean = (v, max) => {
  if (v === null || v === undefined || typeof v === 'object') return '';
  return String(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
};

const log = (result) => console.log(JSON.stringify({ ts: new Date().toISOString(), result }));

function limited(ip, limit) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => t > now - RATE_WINDOW_MS);
  const blocked = list.length >= limit;
  if (!blocked) list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) { // не даём карте расти бесконечно
    for (const [k, v] of hits) if (!v.some((t) => t > now - RATE_WINDOW_MS)) hits.delete(k);
  }
  return blocked;
}

function reply(status, body, origin, allowed) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
  }
  return { statusCode: status, headers, body: JSON.stringify(body) };
}

/* ---------- SMTP поверх TLS (порт 465), без зависимостей ---------- */

function smtpSend(c, message) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const sock = tls.connect({ host: c.host, port: c.port, servername: c.host, rejectUnauthorized: !c.insecure });
    const queue = [];
    const waiters = [];
    let buf = '';
    let lines = [];

    const fail = (e) => {
      if (finished) return;
      finished = true;
      sock.destroy();
      reject(e);
    };
    sock.setTimeout(15000, () => fail(new Error('smtp_timeout')));
    sock.on('error', fail);
    sock.on('close', () => fail(new Error('smtp_closed')));
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        lines.push(line);
        if (/^\d{3}( |$)/.test(line)) { // последняя строка ответа
          const r = { code: Number(line.slice(0, 3)), text: lines.join('\n') };
          lines = [];
          const w = waiters.shift();
          if (w) w(r); else queue.push(r);
        }
      }
    });

    const read = () => new Promise((res) => { const r = queue.shift(); if (r) res(r); else waiters.push(res); });
    const expect = async (...codes) => {
      const r = await read();
      if (!codes.includes(r.code)) throw new Error('smtp_' + r.code);
    };
    const cmd = (s) => sock.write(s + '\r\n');
    const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

    (async () => {
      await expect(220);
      cmd('EHLO med-local.ru'); await expect(250);
      cmd('AUTH LOGIN'); await expect(334);
      cmd(b64(c.user)); await expect(334);
      cmd(b64(c.pass)); await expect(235);
      cmd('MAIL FROM:<' + c.from + '>'); await expect(250);
      cmd('RCPT TO:<' + c.to + '>'); await expect(250, 251);
      cmd('DATA'); await expect(354);
      sock.write(message.replace(/\r\n\./g, '\r\n..') + '\r\n.\r\n'); await expect(250);
      finished = true;
      cmd('QUIT');
      sock.end();
      resolve();
    })().catch(fail);
  });
}

function buildMessage(c, subject, text) {
  const wrap = (s) => s.replace(/(.{76})/g, '$1\r\n');
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
  return [
    'From: ' + c.from,
    'To: ' + c.to,
    'Subject: =?UTF-8?B?' + b64(subject) + '?=',
    'Date: ' + new Date().toUTCString(),
    'Message-ID: <' + Date.now().toString(36) + Math.random().toString(36).slice(2) + '@med-local.ru>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(b64(text)),
  ].join('\r\n');
}

/* ---------- обработчик запроса ---------- */

module.exports.handler = async function handler(event) {
  const c = cfg();
  const method = String(event.httpMethod || '').toUpperCase();
  const h = {};
  for (const k of Object.keys(event.headers || {})) h[k.toLowerCase()] = String(event.headers[k]);
  const origin = h.origin || '';
  const q = event.queryStringParameters || {};

  if (method === 'GET' && q.health !== undefined) {
    return { statusCode: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'ok' };
  }

  if (!c.allowed.includes(origin)) { log('bad_origin'); return reply(403, { ok: false, error: 'forbidden' }, '', c.allowed); }

  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      },
      body: '',
    };
  }
  if (method !== 'POST') return reply(405, { ok: false, error: 'method_not_allowed' }, origin, c.allowed);

  const ip = ((event.requestContext && event.requestContext.identity && event.requestContext.identity.sourceIp)
    || (h['x-forwarded-for'] || '').split(',')[0].trim() || '');
  if (limited(ip, c.rateLimit)) { log('rate_limited'); return reply(429, { ok: false, error: 'rate_limited' }, origin, c.allowed); }

  let raw = event.body || '';
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY) { log('too_large'); return reply(413, { ok: false, error: 'too_large' }, origin, c.allowed); }

  const type = (h['content-type'] || '').toLowerCase();
  let data;
  if (type.includes('application/json')) {
    try { data = JSON.parse(raw); } catch (e) { data = null; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) { log('bad_request'); return reply(400, { ok: false, error: 'bad_request' }, origin, c.allowed); }
  } else if (type.includes('application/x-www-form-urlencoded')) {
    data = Object.fromEntries(new URLSearchParams(raw));
  } else {
    log('unsupported');
    return reply(415, { ok: false, error: 'unsupported' }, origin, c.allowed);
  }

  if (clean(data.website, 200)) { log('honeypot'); return reply(200, { ok: true }, origin, c.allowed); }

  const name = clean(data.name, 200);
  const phone = clean(data.phone, 50);
  const device = clean(data.device, 500);
  const email = clean(data.email, 200);
  const page = clean(data.page, 200);
  const lang = clean(data.lang, 5) === 'en' ? 'en' : 'ru';
  const consent = ['1', 'true', 'on', 'yes'].includes(String(data.consent).toLowerCase());
  const digits = phone.replace(/\D/g, '').length;

  if (!name || digits < 6 || digits > 18) { log('invalid'); return reply(422, { ok: false, error: 'invalid' }, origin, c.allowed); }
  if (!consent) { log('no_consent'); return reply(422, { ok: false, error: 'no_consent' }, origin, c.allowed); }

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
    'Редакция Политики: ' + c.policyDate,
    'IP: ' + ip,
  ].join('\n');
  const subject = 'Заявка с сайта: ' + name.slice(0, 80);

  if (c.dry) {
    console.log('--- DRY_RUN, письмо не отправлено ---\nSubject: ' + subject + '\n' + text + '\n---');
    log('sent');
    return reply(200, { ok: true }, origin, c.allowed);
  }
  if (!c.user || !c.pass || !c.to) { log('not_configured'); return reply(500, { ok: false, error: 'server_error' }, origin, c.allowed); }

  try {
    await smtpSend(c, buildMessage(c, subject, text));
    log('sent');
    return reply(200, { ok: true }, origin, c.allowed);
  } catch (e) {
    log('mail_error ' + String((e && e.message) || e).slice(0, 60));
    return reply(502, { ok: false, error: 'mail_failed' }, origin, c.allowed);
  }
};
