#!/usr/bin/env node
// Общая проверка сайта med-local.ru перед коммитом.
//
//   node scripts/check-site.js            — проверить весь репозиторий
//
// Что проверяется:
//   1. JSON-LD: каждый <script type="application/ld+json"> — валидный JSON.
//   2. Внутренние ссылки <a href="/..."> ведут на существующую страницу или файл.
//   3. Таблицы: каждая <table> лежит внутри обёртки с горизонтальной прокруткой
//      (<div style="overflow-x:auto"> или класс .table-wrap) — иначе ОШИБКА (на узких экранах таблица ломает страницу).
//   4. sitemap.xml: каждый <loc> указывает на существующую страницу, нет дублей, <lastmod> — корректная дата,
//      у каждой статьи blog/<slug>/ есть запись.
//   5. blog/index.html: у каждой карточки есть статья, у каждой статьи — карточка, нет дублей карточек,
//      у карточки data-tags (1–3 рубрики из pp719 krov bally gisp goszakupki, без повторов),
//      карточки идут от новых к старым (по дате в карточке).
//   7. Служебные файлы (.md, .bak, .sh, скрипты сборки .js, папки с точкой) вне .vercelignore — ОШИБКА: их отдаёт сайт.
//   6. FAQPage в JSON-LD совпадает с видимым FAQ (форматы — см. visibleFaq): число вопросов, текст вопросов и ответов.
//      Видимый текст — первоисточник. Отсутствие видимого FAQ при наличии FAQPage — тоже ошибка.
//
// Код возврата: 0 — ошибок нет (предупреждения возможны), 1 — есть ошибки.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);
const ORIGIN = 'https://med-local.ru';
const RUBRICS = ['pp719', 'krov', 'bally', 'gisp', 'goszakupki'];
const SKIP = new Set(['.git', 'node_modules', '.claude', 'drafts']); // drafts/ — черновики вне публикации (см. .vercelignore)

// Статьи blog/<slug>/, которые НАМЕРЕННО не должны быть ни в sitemap.xml, ни среди карточек /blog (каждая — с причиной).
// Сюда нельзя добавлять статью только затем, чтобы заглушить ошибку: у неё должна быть причина не быть в блоге.
const NOT_IN_BLOG = {
  'gemokonteynery': 'дубль статьи gemokonteynery-pp719: <link rel="canonical"> ведёт на неё, на страницу нет внутренних ссылок; в sitemap и блоге нужна только оригинальная статья',
};
const MONTHS = { 'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4, 'мая': 5, 'июня': 6, 'июля': 7, 'августа': 8, 'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12 };

const errors = [];
const warnings = [];
const err = (f, m) => errors.push(f + ': ' + m);
const warn = (f, m) => warnings.push(f + ': ' + m);

function listHtml(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) out.push(...listHtml(path.join(dir, e.name))); }
    else if (e.name.endsWith('.html')) out.push(path.join(dir, e.name).replace(/\\/g, '/'));
  }
  return out;
}
const files = listHtml('.').map(f => f.replace(/^\.\//, '')).sort();
const read = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

const unent = s => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
// текст без тегов: переносы и блочные теги дают пробел, строчные (<a>, <strong>…) исчезают без пробела
const strip = s => unent(s.replace(/<\/?(?:br|p|li|ul|ol|div|h[1-6])\b[^>]*>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

// текст из JSON-LD — это обычный текст, не HTML: только нормализуем пробелы (угловые скобки вроде «<1>» остаются)
const norm = s => String(s).replace(/\s+/g, ' ').trim();

// видимый FAQ в любом из форматов, которые есть на сайте:
//   <details class="faq-item"><summary>вопрос</summary><p>ответ</p></details>
//   <div class="faq-item"><h4>вопрос</h4><p>ответ</p></div>
//   пары <h3>/<h4> вопрос + <p> ответ под заголовком <h2>FAQ… / Частые вопросы…</h2>
const faqPairs = re => [...re].map(m => [strip(m[1]), strip(m[2])]);
function visibleFaq(h) {
  const det = faqPairs(h.matchAll(/<details\b[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>\s*<p[^>]*>([\s\S]*?)<\/p>/g));
  if (det.length) return det;
  const item = faqPairs(h.matchAll(/<div class=["']faq-item["']>\s*<h4[^>]*>([\s\S]*?)<\/h4>\s*<p[^>]*>([\s\S]*?)<\/p>/g));
  if (item.length) return item;
  const hm = h.match(/<h2[^>]*>[^<]*(?:FAQ|Частые вопросы)[^<]*<\/h2>/i);
  if (!hm) return [];
  let seg = h.slice(hm.index + hm[0].length);
  const end = seg.search(/<h2[\s>]|<\/section>/i);
  if (end >= 0) seg = seg.slice(0, end);
  return faqPairs(seg.matchAll(/<h([34])[^>]*>([\s\S]*?)<\/h\1>\s*<p[^>]*>([\s\S]*?)<\/p>/g)).length
    ? [...seg.matchAll(/<h([34])[^>]*>([\s\S]*?)<\/h\1>\s*<p[^>]*>([\s\S]*?)<\/p>/g)].map(m => [strip(m[2]), strip(m[3])])
    : [];
}

const pageExists = u => {
  const p = u.split('#')[0].split('?')[0].replace(/^\//, '').replace(/\/$/, '');
  if (!p) return true;
  if (fs.existsSync(p) && fs.statSync(p).isFile()) return true;
  if (fs.existsSync(p + '.html')) return true;
  return fs.existsSync(path.join(p, 'index.html'));
};

// таблица внутри обёртки с горизонтальной прокруткой: ближайший предшествующий <div> — обёртка, и между ним и <table> ничего нет
const WRAP = /overflow-x\s*:\s*(?:auto|scroll)|\btable-wrap\b/;
function unwrappedTables(h) {
  let n = 0;
  for (const m of h.matchAll(/<table\b/g)) {
    const before = h.slice(0, m.index);
    const i = before.lastIndexOf('<div');
    const tail = i >= 0 ? before.slice(i) : '';
    const ok = i >= 0 && /<div[^>]*>\s*$/.test(tail) && WRAP.test(tail.slice(0, tail.indexOf('>') + 1));
    if (!ok) n++;
  }
  return n;
}

// Статьи, снятые с публикации: 301-редирект на другую статью, черновик лежит в drafts/ и ждёт проверки.
// Для каждой проверяется: редирект со статусом 301 в vercel.json ведёт на существующую страницу, статьи нет в blog/,
// её нет в sitemap.xml и на неё нет внутренних ссылок. Причину указывать обязательно.
const REDIRECTED_ARTICLES = {
  'multipleksny-proryv': { to: '/blog/pcr-panely-pp1875-vtoroy-lishniy', reason: '301 на pcr-panely-pp1875-vtoroy-lishniy, черновик в drafts/ ждёт проверки по ПП 719' },
};

// ---------- 1, 2, 3, 6: по страницам ----------
let ldCount = 0, faqPages = 0, tableCount = 0;
for (const f of files) {
  const h = read(f);
  const lds = [];
  for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    ldCount++;
    try { lds.push(JSON.parse(m[1])); } catch (e) { err(f, 'невалидный JSON-LD (' + e.message + ')'); }
  }
  for (const m of h.matchAll(/<a\s[^>]*?href="(\/[^"]*)"/g)) {
    const u = m[1];
    if (u.startsWith('//')) continue;
    if (!pageExists(u)) err(f, 'битая внутренняя ссылка ' + u);
  }
  const tc = (h.match(/<table\b/g) || []).length;
  tableCount += tc;
  if (tc) {
    const bad = unwrappedTables(h);
    if (bad) err(f, 'таблиц вне обёртки с overflow-x:auto: ' + bad + ' (оберните в <div style="overflow-x:auto">…</div>)');
  }
  const faq = lds.find(j => j && j['@type'] === 'FAQPage');
  if (faq) {
    faqPages++;
    const vis = visibleFaq(h);
    const ent = faq.mainEntity || [];
    const msgs = [];
    if (!vis.length) msgs.push('на странице нет видимого FAQ — разметка FAQPage есть только в JSON-LD');
    else if (vis.length !== ent.length) msgs.push('вопросов в видимом блоке ' + vis.length + ', в JSON-LD ' + ent.length);
    ent.forEach((q, i) => {
      if (!vis[i]) return;
      if (vis[i][0] !== norm(q.name)) msgs.push('вопрос ' + (i + 1) + ' отличается');
      else if (vis[i][1] !== norm(q.acceptedAnswer && q.acceptedAnswer.text || '')) msgs.push('ответ ' + (i + 1) + ' отличается');
    });
    if (msgs.length) {
      const text = 'FAQPage ≠ видимый FAQ (' + msgs.slice(0, 3).join('; ') + (msgs.length > 3 ? '; … всего ' + msgs.length : '') + ')';
      err(f, text);
    }
  }
}

// ---------- 4: sitemap ----------
const smRaw = fs.existsSync('sitemap.xml') ? read('sitemap.xml') : null;
const allBlogDirs = fs.existsSync('blog') ? fs.readdirSync('blog', { withFileTypes: true }).filter(e => e.isDirectory() && fs.existsSync(path.join('blog', e.name, 'index.html'))).map(e => e.name) : [];
const blogDirs = allBlogDirs.filter(d => !(d in NOT_IN_BLOG));
for (const d of Object.keys(NOT_IN_BLOG)) if (!allBlogDirs.includes(d)) err('scripts/check-site.js', 'в NOT_IN_BLOG указана несуществующая статья ' + d + ' — удалите запись');
// canonical статьи должен вести на неё же; иначе это дубль и ему место в NOT_IN_BLOG
for (const d of blogDirs) {
  const c = (read(path.join('blog', d, 'index.html')).match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
  if (c !== ORIGIN + '/blog/' + d) err('blog/' + d + '/index.html', 'canonical «' + c + '» не совпадает с адресом статьи (дубль? тогда добавьте в NOT_IN_BLOG с причиной)');
}
let smCount = 0;
if (!smRaw) err('sitemap.xml', 'файл не найден');
else {
  const entries = [...smRaw.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(m => m[1]);
  const seen = new Set();
  for (const e of entries) {
    smCount++;
    const loc = (e.match(/<loc>([^<]*)<\/loc>/) || [])[1];
    if (!loc) { err('sitemap.xml', 'запись без <loc>'); continue; }
    if (loc !== ORIGIN && !loc.startsWith(ORIGIN + '/')) err('sitemap.xml', 'адрес вне ' + ORIGIN + ': ' + loc);
    if (seen.has(loc)) err('sitemap.xml', 'дубль ' + loc);
    seen.add(loc);
    if (loc.startsWith(ORIGIN) && !pageExists(loc.slice(ORIGIN.length) || '/')) err('sitemap.xml', 'страницы нет в репозитории: ' + loc);
    const lm = (e.match(/<lastmod>([^<]*)<\/lastmod>/) || [])[1];
    if (lm !== undefined) {
      const d = lm.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const ok = d && !isNaN(Date.parse(lm)) && new Date(lm).toISOString().slice(0, 10) === lm;
      if (!ok) err('sitemap.xml', 'некорректный lastmod ' + lm + ' у ' + loc);
    }
  }
  for (const s of blogDirs) if (!seen.has(ORIGIN + '/blog/' + s)) err('sitemap.xml', 'нет записи для статьи blog/' + s);
  if (!seen.has(ORIGIN + '/blog')) err('sitemap.xml', 'нет записи для /blog');
}

// ---------- 5: blog/index.html ----------
let cardCount = 0;
if (fs.existsSync('blog/index.html')) {
  const idx = read('blog/index.html');
  const cards = idx.split('<a class="card"').slice(1).map(x => '<a class="card"' + x.split('</a>')[0] + '</a>').map(c => ({
    url: (c.match(/href="(\/blog\/[^"]+)"/) || [])[1],
    tags: (c.match(/data-tags="([^"]*)"/) || [])[1],
    date: [...c.matchAll(/<span style="font-size:12px;color:var\(--muted\)">([^<]*)<\/span>/g)].map(m => m[1]).pop(),
  }));
  cardCount = cards.length;
  const dateOf = s => { const m = (s || '').match(/^(\d+) (\S+) (\d{4})$/); return m && MONTHS[m[2]] ? +m[3] * 10000 + MONTHS[m[2]] * 100 + +m[1] : null; };
  const slugs = new Set();
  cards.forEach((c, i) => {
    if (!c.url) { err('blog/index.html', 'карточка №' + (i + 1) + ' без ссылки /blog/…'); return; }
    const s = c.url.replace(/^\/blog\//, '');
    if (slugs.has(s)) err('blog/index.html', 'дубль карточки ' + s);
    slugs.add(s);
    if (!fs.existsSync(path.join('blog', s, 'index.html'))) err('blog/index.html', 'карточка без статьи: ' + s);
    if (c.tags === undefined) err('blog/index.html', 'у карточки ' + s + ' нет data-tags (старый data-tag не поддерживается)');
    else {
      const t = c.tags.trim().split(/\s+/).filter(Boolean);
      const bad = t.filter(x => !RUBRICS.includes(x));
      if (bad.length) err('blog/index.html', 'карточка ' + s + ': неизвестные рубрики ' + bad.join(', '));
      if (t.length < 1 || t.length > 3) err('blog/index.html', 'карточка ' + s + ': рубрик ' + t.length + ' (нужно от 1 до 3)');
      if (new Set(t).size !== t.length) err('blog/index.html', 'карточка ' + s + ': рубрики повторяются');
    }
    const d = dateOf(c.date);
    if (d === null) err('blog/index.html', 'не удалось разобрать дату карточки «' + c.date + '» (' + s + ')');
    else if (i > 0) { const p = dateOf(cards[i - 1].date); if (p !== null && d > p) err('blog/index.html', 'нарушен порядок «от новых к старым»: ' + s + ' новее предыдущей карточки'); }
  });
  for (const s of blogDirs) if (!slugs.has(s)) err('blog/index.html', 'у статьи blog/' + s + ' нет карточки');
} else err('blog/index.html', 'файл не найден');

// ---------- снятые с публикации статьи ----------
{
  let rules = [];
  try { rules = JSON.parse(fs.readFileSync('vercel.json', 'utf8')).redirects || []; } catch (e) { err('vercel.json', 'не удалось прочитать: ' + e.message); }
  for (const [slug, info] of Object.entries(REDIRECTED_ARTICLES)) {
    const from = '/blog/' + slug;
    const r = rules.find(x => x.source === from);
    if (!r) err('vercel.json', 'нет редиректа для снятой статьи ' + from + ' (' + info.reason + ')');
    else {
      if (r.statusCode !== 301) err('vercel.json', 'редирект ' + from + ' должен быть со statusCode 301, сейчас ' + (r.statusCode || (r.permanent ? 'permanent' : 'не задан')));
      if (r.destination !== info.to) err('vercel.json', 'редирект ' + from + ' ведёт на ' + r.destination + ', ожидалось ' + info.to);
    }
    if (!pageExists(info.to)) err('scripts/check-site.js', 'цель редиректа не существует: ' + info.to);
    if (fs.existsSync(path.join('blog', slug))) err('blog/' + slug, 'снятая с публикации статья всё ещё лежит в blog/ — должна быть в drafts/');
    if (smRaw && smRaw.includes('<loc>' + ORIGIN + from + '</loc>')) err('sitemap.xml', 'снятая статья ' + slug + ' осталась в sitemap');
    for (const f of files) if (new RegExp('href="' + from + '["#?/]').test(read(f))) err(f, 'ссылка на снятую статью ' + from + ' — замените на ' + info.to);
  }
}

// черновики не должны отдаваться на сайте: .vercelignore + редирект /drafts/* (Git-деплои Vercel могут не учитывать .vercelignore)
if (fs.existsSync('drafts')) {
  let rules = [];
  try { rules = JSON.parse(fs.readFileSync('vercel.json', 'utf8')).redirects || []; } catch (e) { /* ошибка уже выведена выше */ }
  if (!rules.some(x => x.source === '/drafts/:path*')) err('vercel.json', 'есть папка drafts/, но нет редиректа /drafts/:path* — черновики могут оказаться на сайте');
  if (!fs.existsSync('.vercelignore') || !/^drafts\/?$/m.test(fs.readFileSync('.vercelignore', 'utf8'))) err('.vercelignore', 'нет строки drafts/');
}

// ---------- служебные файлы в публикуемых папках ----------
// Всё, что лежит в репозитории и не перечислено в .vercelignore, отдаётся сайтом. Поэтому .md, .bak/.orig/.tmp, .sh/.ps1,
// .js-скрипты сборки (то есть .js, которые не подключены ни одной страницей через <script src>), файлы с «draft/черновик/backup»
// в имени и всё внутри папок, начинающихся с точки (.githooks и т. п.), должны быть либо удалены, либо исключены из публикации через .vercelignore.
{
  const ignore = (fs.existsSync('.vercelignore') ? fs.readFileSync('.vercelignore', 'utf8') : '').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  const ignored = f => ignore.some(p => {
    const q = p.replace(/^\//, '');
    if (q.endsWith('/')) return f.startsWith(q);
    if (q.includes('*')) return new RegExp('^' + q.split('*').map(x => x.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$').test(f);
    return f === q || f.startsWith(q + '/');
  });
  let tracked;
  try { tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean); }
  catch (e) { tracked = []; const walk = d => { for (const e2 of fs.readdirSync(d, { withFileTypes: true })) { if (['.git', 'node_modules', '.claude'].includes(e2.name)) continue; const p = path.join(d, e2.name).replace(/\\/g, '/'); e2.isDirectory() ? walk(p) : tracked.push(p); } }; walk('.'); }
  const usedJs = new Set();
  for (const f of files) for (const m of read(f).matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) if (m[1].startsWith('/')) usedJs.add(m[1].slice(1).split('?')[0]);
  for (const f of tracked) {
    if (ignored(f) || f.startsWith('.well-known/')) continue;
    const base = path.basename(f);
    let why = null;
    if (/\.(md|bak|orig|tmp|swp|log|sh|ps1|py)$/i.test(f) || /~$/.test(f)) why = 'служебный/черновой файл';
    else if (/\.js$/i.test(f) && !usedJs.has(f)) why = 'скрипт, не подключённый ни одной страницей (скрипты сборки не должны отдаваться сайтом)';
    else if (/(draft|черновик|backup)/i.test(base)) why = 'похоже на черновик/бэкап';
    else if (f.split('/').slice(0, -1).some(d => d.startsWith('.'))) why = 'файл внутри служебной папки с точкой';
    if (why) err(f, 'публикуемый файл: ' + why + ' — удалите или добавьте в .vercelignore');
  }
}

// ---------- итог ----------
console.log('check-site: страниц ' + files.length + ', JSON-LD ' + ldCount + ', таблиц ' + tableCount + ', страниц с FAQPage ' + faqPages + ', карточек ' + cardCount + ', URL в sitemap ' + smCount);
if (warnings.length) {
  console.log('\nПредупреждения (' + warnings.length + '), не блокируют:');
  warnings.forEach(w => console.log('  ! ' + w));
}
if (errors.length) {
  console.error('\nОшибки (' + errors.length + '):');
  errors.forEach(e => console.error('  ✗ ' + e));
  console.error('\ncheck-site: найдены ошибки');
  process.exit(1);
}
console.log('check-site: ошибок нет' + (warnings.length ? ' (предупреждений: ' + warnings.length + ')' : ''));
