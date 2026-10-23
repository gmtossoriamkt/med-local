#!/usr/bin/env node
// Проверка развёрнутого сайта (временный домен Timeweb, боевой домен или Vercel для сравнения).
// Запуск: node scripts/check-live.js --base https://<адрес> [--resolve ip] [--limit N]
// Проверяет: все URL из sitemap.xml (200, HTML, размер по сети), редиректы, настоящий 404, картинки,
// видео (Range → 206), robots/sitemap, заголовки кэша и X-Robots-Tag, отсутствие служебных файлов.
// Код возврата 1 — есть ошибки.
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const BASE = (opt('base', '') || '').replace(/\/$/, '');
if (!BASE) { console.error('Укажите --base https://адрес'); process.exit(2); }
const RESOLVE = opt('resolve', '');
const LIMIT = parseInt(opt('limit', '0'), 10);
const ROOT = path.resolve(__dirname, '..');

function req(p, o = {}) {
  return new Promise(resolve => {
    const u = new URL(p.startsWith('http') ? p : BASE + p);
    const lib = u.protocol === 'https:' ? https : http;
    const t0 = Date.now();
    const r = lib.request({
      host: RESOLVE || u.hostname, servername: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method: o.method || 'GET', timeout: 30000,
      headers: Object.assign({ Host: u.host, 'User-Agent': 'check-live', 'Accept-Encoding': o.enc || 'identity' }, o.headers || {}),
    }, res => {
      let n = 0; const chunks = [];
      res.on('data', c => { n += c.length; if (o.body) chunks.push(c); else if (chunks.length < 1 && c.length) chunks.push(c.slice(0, 2048)); if (o.maxBytes && n >= o.maxBytes) res.destroy(); });
      const done = () => resolve({ status: res.statusCode, headers: res.headers, bytes: n, ms: Date.now() - t0, body: Buffer.concat(chunks).toString('utf8') });
      res.on('end', done); res.on('close', done);
    });
    r.on('timeout', () => { r.destroy(); resolve({ status: 0, headers: {}, bytes: 0, ms: 30000, body: '', error: 'timeout' }); });
    r.on('error', e => resolve({ status: 0, headers: {}, bytes: 0, ms: Date.now() - t0, body: '', error: e.message }));
    r.end();
  });
}

let errors = 0, warns = 0;
const bad = (m) => { errors++; console.log('ОШИБКА  ' + m); };
const warn = (m) => { warns++; console.log('внимание ' + m); };

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const x = items[i++]; await fn(x); } }));
}

(async () => {
  console.log('check-live: ' + BASE + (RESOLVE ? ' (--resolve ' + RESOLVE + ')' : ''));

  // 1. sitemap (из локального файла: источник правды) + все страницы
  const sm = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  let urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].replace(/^https?:\/\/[^/]+/, '') || '/');
  if (LIMIT) urls = urls.slice(0, LIMIT);
  const rows = [];
  await pool(urls, 6, async u => {
    const r = await req(u, { enc: 'br, gzip', body: false });
    rows.push({ u, r });
    if (r.status !== 200) bad(u + ' → ' + r.status + (r.error ? ' ' + r.error : ''));
    else if (!/text\/html/.test(r.headers['content-type'] || '')) bad(u + ' content-type ' + r.headers['content-type']);
    else if (/<title>[^<]*(Страница не найдена)/.test(r.body)) bad(u + ' отдаёт страницу 404 со статусом 200');
  });
  console.log('страниц из sitemap: ' + urls.length + ', ошибок на них: ' + rows.filter(x => x.r.status !== 200).length);
  const heavy = rows.filter(x => x.r.bytes > 13.6 * 1024 && /gzip|br|zstd/.test(x.r.headers['content-encoding'] || ''));
  if (rows.length) console.log('сжатый вес: макс ' + (Math.max(...rows.map(x => x.r.bytes)) / 1024).toFixed(1) + ' КБ, страниц >13,6 КБ: ' + rows.filter(x => x.r.bytes > 13.6 * 1024).length);

  // 2. редиректы
  const redirs = [
    ['/blog/multipleksny-proryv', 301, '/blog/pcr-panely-pp1875-vtoroy-lishniy'],
    ['/about/', [301, 308], '/about'],
    ['/about.html', [301, 308], '/about'],
    ['/about/index.html', [301, 308], '/about'],
    ['/blog/', [301, 308], '/blog'],
    ['/index.html', [301, 308], '/'],
    ['/drafts/multipleksny-proryv/', [301, 302, 307, 308], '/blog'],
  ];
  for (const [from, code, to] of redirs) {
    const r = await req(from);
    const loc = (r.headers.location || '').replace(/^https?:\/\/[^/]+/, '');
    const codes = [].concat(code);
    if (!codes.includes(r.status) || loc !== to) bad('редирект ' + from + ' → ' + r.status + ' ' + (loc || '—') + ', ожидалось ' + codes.join('/') + ' ' + to);
  }

  // 3. настоящий 404
  for (const p of ['/net-takoj-stranicy-12345', '/blog/net-takoj-stati-777', '/uslugi/zzz.html', '/images/net.jpg']) {
    const r = await req(p, { body: true });
    if (r.status !== 404) bad('404: ' + p + ' → ' + r.status + ' (ожидалось 404)');
    else if (!/text\/html/.test(r.headers['content-type'] || '') && !/images/.test(p)) bad('404: ' + p + ' не HTML');
    else if (!/images/.test(p) && !/Страница не найдена/.test(r.body)) bad('404: ' + p + ' без страницы 404.html');
  }
  const x404 = await req('/404'); if (x404.status === 200 && false) warn('/404 открыт');

  // 4. служебные файлы не отдаются
  for (const p of ['/CLAUDE.md', '/README.md', '/scripts/check-site.js', '/scripts/build-dist.js', '/.githooks/pre-commit', '/vercel.json', '/drafts/multipleksny-proryv/index.html', '/deploy/Caddyfile', '/.github/workflows/checks.yml']) {
    const r = await req(p, { body: true });
    if (r.status === 200 && !/Страница не найдена/.test(r.body) && !/<html/i.test(r.body.slice(0, 400))) bad('служебный файл отдаётся: ' + p);
    else if (r.status === 200) warn(p + ' → 200 (проверьте, что это не служебный файл)');
  }

  // 5. статика: картинки, favicon, og-image
  const imgs = new Set();
  for (const f of ['index.html', 'localization/index.html']) {
    const h = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of h.matchAll(/(?:src|href|srcset)="(\/(?:images)\/[^"\s,]+)/g)) imgs.add(m[1]);
    for (const m of h.matchAll(/(\/images\/[^\s",]+\.(?:webp|jpg|png))/g)) imgs.add(m[1]);
  }
  for (const p of ['/favicon.ico', '/favicon.svg', '/og-image.png', '/apple-touch-icon.png', '/site.webmanifest', '/cookie-consent.js', '/robots.txt', '/sitemap.xml', '/llms.txt']) imgs.add(p);
  let imgCount = 0;
  await pool([...imgs], 6, async p => {
    const r = await req(p, { maxBytes: 4096 });
    imgCount++;
    if (r.status !== 200) bad('файл ' + p + ' → ' + r.status);
    const cc = r.headers['cache-control'] || '';
    if (/^\/(images\/|favicon|og-image|apple)/.test(p) && !/max-age=(\d{6,})/.test(cc)) warn('кэш ' + p + ': ' + (cc || 'нет Cache-Control'));
    if (/\.webp$/.test(p) && !/image\/webp/.test(r.headers['content-type'] || '')) bad(p + ' content-type ' + r.headers['content-type']);
  });
  console.log('файлов статики проверено: ' + imgCount);

  // 6. видео: Range → 206
  const v = await req('/video.mp4', { headers: { Range: 'bytes=0-1023' }, maxBytes: 4096 });
  if (v.status !== 206) bad('video.mp4 Range → ' + v.status + ' (ожидалось 206), Accept-Ranges: ' + v.headers['accept-ranges']);
  else if (!/video\/mp4/.test(v.headers['content-type'] || '')) bad('video.mp4 content-type ' + v.headers['content-type']);
  const vh = await req('/video.mp4', { method: 'HEAD' });
  const want = fs.statSync(path.join(ROOT, 'video.mp4')).size;
  if (parseInt(vh.headers['content-length'] || '0', 10) !== want) bad('video.mp4 размер ' + vh.headers['content-length'] + ', ожидалось ' + want);

  // 7. заголовки
  // порции блога: загрузчик берёт /blog/_cards/N.html (на статике — 200 сразу, на Vercel/Caddy — через 308 на адрес без .html)
  let cards = await req('/blog/_cards/1.html', { body: true });
  let cardsPath = '/blog/_cards/1.html';
  if ([301, 308].includes(cards.status) && cards.headers.location) {
    cardsPath = cards.headers.location.replace(/^https?:\/\/[^/]+/, '');
    cards = await req(cardsPath, { body: true });
  }
  if (cards.status !== 200) bad(cardsPath + ' → ' + cards.status + ' («Показать ещё» в блоге не подгрузится)');
  else if (!/<a class="card"/.test(cards.body)) bad(cardsPath + ' не содержит карточек (отдан не файл порции)');
  else if (!/noindex/.test(cards.headers['x-robots-tag'] || '') && !/<meta name="robots" content="noindex/.test(cards.body)) bad(cardsPath + ' без noindex (ни X-Robots-Tag, ни meta в файле)');
  const home = await req('/', { enc: 'br, gzip, zstd' });
  const hc = home.headers['cache-control'] || '';
  if (!/max-age=0/.test(hc) && !/no-cache/.test(hc)) warn('HTML кэшируется: Cache-Control ' + (hc || 'нет'));
  if (!home.headers['content-encoding']) warn('главная отдана без сжатия');

  console.log('\ncheck-live: ошибок ' + errors + ', предупреждений ' + warns);
  process.exit(errors ? 1 : 0);
})();
