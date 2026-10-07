#!/usr/bin/env node
// Добавляет карточку статьи в blog/index.html на её место по дате (новые первыми; свежая статья — первой) и запись в sitemap.xml.
// Правила рубрик и формат карточки — в CLAUDE.md («Как добавлять карточку статьи в блог»).
//
// Пример:
//   node scripts/add-blog-card.js --slug firmware-medizdeliya-pp719-reestr-po \
//     --title "Firmware в локализации медизделий: баллы ПП №719, реестр Минцифры и РУ" \
//     --desc "Как firmware влияет на локализацию медизделия: …" \
//     --date 2026-10-06 --label "ПП 719 · Баллы · ПО" --tags "pp719 bally"
//
// Параметры:
//   --slug   папка статьи в blog/ (должна существовать, иначе ошибка; --no-check отключает проверку)
//   --title  заголовок карточки (H1 статьи)
//   --desc   описание карточки (description статьи)
//   --date   дата публикации, ГГГГ-ММ-ДД (в карточке выводится как «6 октября 2026», в sitemap — lastmod)
//   --label  метка над заголовком, например «ПП 719 · Баллы · ПО»
//   --tags   рубрики через пробел, 1–3 из: pp719 krov bally gisp goszakupki
//   --dry-run  ничего не записывать, только проверить и показать результат

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RUBRICS = ['pp719', 'krov', 'bally', 'gisp', 'goszakupki'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function fail(msg) {
  console.error('add-blog-card: ' + msg);
  process.exit(1);
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) fail('неожиданный аргумент: ' + k);
    const name = k.slice(2);
    if (name === 'dry-run' || name === 'no-check') { a[name] = true; continue; }
    if (i + 1 >= argv.length) fail('у параметра --' + name + ' нет значения');
    a[name] = argv[++i];
  }
  return a;
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const args = parseArgs(process.argv.slice(2));
for (const k of ['slug', 'title', 'desc', 'date', 'label', 'tags']) {
  if (!args[k] || !args[k].trim()) fail('не указан параметр --' + k);
}
const slug = args.slug.trim();
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) fail('slug должен состоять из латиницы, цифр и дефисов: ' + slug);

const tags = args.tags.trim().split(/\s+/);
const bad = tags.filter(t => !RUBRICS.includes(t));
if (bad.length) fail('неизвестные рубрики: ' + bad.join(', ') + ' (допустимо: ' + RUBRICS.join(' ') + ')');
if (new Set(tags).size !== tags.length) fail('рубрики повторяются: ' + tags.join(' '));
if (tags.length < 1 || tags.length > 3) fail('у статьи должно быть от 1 до 3 рубрик, указано ' + tags.length);

const dm = args.date.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
if (!dm) fail('дата должна быть в формате ГГГГ-ММ-ДД: ' + args.date);
const [, yy, mm, dd] = dm;
const month = +mm;
if (month < 1 || month > 12 || +dd < 1 || +dd > 31) fail('некорректная дата: ' + args.date);
const dateIso = yy + '-' + mm + '-' + dd;
const dateRu = +dd + ' ' + MONTHS[month - 1] + ' ' + yy;

if (!args['no-check'] && !fs.existsSync(path.join(ROOT, 'blog', slug, 'index.html'))) {
  fail('не найдена статья blog/' + slug + '/index.html (сначала создайте статью или используйте --no-check)');
}

function read(file) {
  const raw = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return { crlf: raw.includes('\r\n'), text: raw.replace(/\r\n/g, '\n') };
}
function write(file, doc) {
  fs.writeFileSync(path.join(ROOT, file), doc.crlf ? doc.text.replace(/\n/g, '\r\n') : doc.text);
}

// --- blog/index.html ---
const idx = read('blog/index.html');
if (idx.text.includes('href="/blog/' + slug + '"')) fail('карточка со slug ' + slug + ' уже есть в blog/index.html');
const GRID = '<div class="grid g3" id="blog-grid">\n';
if (idx.text.split(GRID).length !== 2) fail('в blog/index.html не найден (или найден не один) контейнер #blog-grid');

const card =
  '    <a class="card" href="/blog/' + slug + '" data-tags="' + tags.join(' ') + '" style="display:flex;flex-direction:column;gap:9px;transition:.2s;text-decoration:none">' +
  '<span style="font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:var(--blue)">' + esc(args.label.trim()) + '</span>' +
  '<h3 style="font-size:16.5px;line-height:1.35">' + esc(args.title.trim()) + '</h3>' +
  '<p style="font-size:13.5px;color:var(--muted);margin:0;line-height:1.6;flex:1">' + esc(args.desc.trim()) + '</p>' +
  '<span style="font-size:12px;color:var(--muted)">' + dateRu + '</span>' +
  '<span style="font-size:13px;font-weight:700;color:var(--orange)">Читать →</span></a>\n';
// карточка встаёт на своё место по дате (новые первыми): перед первой карточкой с более ранней датой,
// при равных датах — после существующих; если более ранних нет — в конец сетки (после последней карточки)
const dateKey = t => { const m = t.match(/^(\d+) (\S+) (\d{4})$/); const i = m ? MONTHS.indexOf(m[2]) : -1; return i < 0 ? null : +m[3] * 10000 + (i + 1) * 100 + +m[1]; };
const newKey = dateKey(dateRu);
const gridStart = idx.text.indexOf(GRID) + GRID.length;
const lines = idx.text.slice(gridStart).split('\n');
let at = -1, lastCard = -1;
for (let i = 0; i < lines.length; i++) {
  if (!lines[i].includes('<a class="card"')) { if (lastCard >= 0 && lines[i].trim()) break; continue; } // пустые строки между карточками пропускаем
  lastCard = i;
  const m = lines[i].match(/<span style="font-size:12px;color:var\(--muted\)">([^<]*)<\/span><span style="font-size:13px/);
  const k = m ? dateKey(m[1]) : null;
  if (at < 0 && k !== null && k < newKey) at = i;
}
if (at < 0) at = lastCard + 1;
lines.splice(at, 0, card.replace(/\n$/, ''));
idx.text = idx.text.slice(0, gridStart) + lines.join('\n');

// --- sitemap.xml ---
const sm = read('sitemap.xml');
// запись в sitemap уже может быть (статья попала в sitemap раньше, чем получила карточку) — тогда sitemap не трогаем, добавляется только карточка
const inSitemap = sm.text.includes('<loc>https://med-local.ru/blog/' + slug + '</loc>');
const entries = [...sm.text.matchAll(/ {2}<url><loc>https:\/\/med-local\.ru\/blog\/[^<]+<\/loc>.*?<\/url>/g)];
if (!entries.length) fail('в sitemap.xml не найдены записи блога, не за что зацепиться');
const last = entries[entries.length - 1][0];
const entry = '  <url><loc>https://med-local.ru/blog/' + slug + '</loc><changefreq>monthly</changefreq><priority>0.8</priority><lastmod>' + dateIso + '</lastmod></url>';
if (!inSitemap) sm.text = sm.text.replace(last, () => last + '\n' + entry);

if (args['dry-run']) {
  console.log('add-blog-card: dry-run, файлы не изменены');
  console.log(card.trim());
  console.log(entry.trim());
  process.exit(0);
}
write('blog/index.html', idx);
if (!inSitemap) write('sitemap.xml', sm);
console.log('add-blog-card: добавлено ' + slug + ' (рубрики: ' + tags.join(' ') + ', дата: ' + dateRu + ')' + (inSitemap ? '; запись в sitemap.xml уже была — не менял' : ''));
console.log('Напомните себе: обратные ссылки в «Читайте также», проверка diff, push только по команде.');
