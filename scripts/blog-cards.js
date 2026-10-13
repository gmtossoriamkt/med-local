// Общая логика списка карточек блога (используется add-blog-card.js и check-site.js).
//
// Как устроено хранение карточек:
//   blog/index.html          — первые FIRST карточек (самые новые) прямо в HTML внутри #blog-grid;
//                              атрибуты контейнера data-total (всего карточек) и data-chunks (сколько файлов-«порций»);
//   blog/_cards/1.html …     — остальные карточки порциями по CHUNK штук (чистый HTML-фрагмент, одна карточка на строку);
//                              браузер подгружает их кнопкой «Показать ещё» или при выборе рубрики;
//   блок для пользователей без JS — между маркерами blog-archive:start/end в index.html: <noscript> со ссылками на
//                              файлы порций (обычные HTML-страницы со ссылками на статьи).
//
// Зачем: вес HTML /blog по сети не должен приближаться к ~14–20 КБ (см. CLAUDE.md).

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FIRST = 12;   // карточек в первом HTML-ответе (каждая добавляет ~0,16 КБ к весу по сети)
const CHUNK = 24;   // карточек в одной подгружаемой порции
const INDEX = 'blog/index.html';
const CARDS_DIR = 'blog/_cards';
const ARCH_START = '<!-- blog-archive:start -->';
const ARCH_END = '<!-- blog-archive:end -->';
const GRID_OPEN = /<div class="grid g3" id="blog-grid"[^>]*>\n/;
const IS_CARD = l => l.includes('<a class="card"');

function readDoc(rel) {
  const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  return { crlf: raw.includes('\r\n'), text: raw.replace(/\r\n/g, '\n') };
}
function writeDoc(rel, doc) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, doc.crlf ? doc.text.replace(/\n/g, '\r\n') : doc.text);
}

const slugOf = card => (card.match(/href="\/blog\/([^"]+)"/) || [])[1];
const titleHtmlOf = card => (card.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1] || '';
const dateTextOf = card => {
  const m = card.match(/<span style="font-size:12px;color:var\(--muted\)">([^<]*)<\/span><span style="font-size:13px/);
  return m ? m[1] : null;
};

// границы списка карточек внутри #blog-grid: [start, end) в массиве строк, где start — первая строка после открывающего тега
function gridRegion(lines, openLineIdx) {
  let end = openLineIdx + 1;
  while (end < lines.length && (IS_CARD(lines[end]) || !lines[end].trim())) end++;
  return [openLineIdx + 1, end];
}

function chunkFiles() {
  const files = [];
  for (let i = 1; fs.existsSync(path.join(ROOT, CARDS_DIR, i + '.html')); i++) files.push(CARDS_DIR + '/' + i + '.html');
  return files;
}

// все карточки по порядку: сначала из index.html, затем из порций; каждая — строка без отступа
function readAllCards() {
  const idx = readDoc(INDEX);
  const lines = idx.text.split('\n');
  const open = lines.findIndex(l => GRID_OPEN.test(l + '\n'));
  if (open < 0) throw new Error('в ' + INDEX + ' не найден контейнер #blog-grid');
  const [s, e] = gridRegion(lines, open);
  const cards = lines.slice(s, e).filter(IS_CARD).map(l => l.trim());
  for (const f of chunkFiles()) {
    cards.push(...readDoc(f).text.split('\n').filter(IS_CARD).map(l => l.trim()));
  }
  return cards;
}

function archiveBlock(older, nChunks) {
  if (!older.length) return '';
  const links = [];
  for (let i = 1; i <= nChunks; i++) links.push('<a href="/' + CARDS_DIR + '/' + i + '">часть ' + (i + 1) + '</a>');
  return '<noscript><p class="more-status">Остальные статьи (' + older.length + '): ' + links.join(' · ') + '</p></noscript>';
}

// записывает карточки: первые FIRST — в index.html, остальные — в blog/_cards/N.html; обновляет data-*, архив-список
function writeAllCards(cards) {
  const first = cards.slice(0, FIRST);
  const older = cards.slice(FIRST);
  const chunks = [];
  for (let i = 0; i < older.length; i += CHUNK) chunks.push(older.slice(i, i + CHUNK));

  const idx = readDoc(INDEX);
  const lines = idx.text.split('\n');
  const open = lines.findIndex(l => GRID_OPEN.test(l + '\n'));
  if (open < 0) throw new Error('в ' + INDEX + ' не найден контейнер #blog-grid');
  lines[open] = lines[open].replace(/<div class="grid g3" id="blog-grid"[^>]*>/, '<div class="grid g3" id="blog-grid" data-total="' + cards.length + '" data-chunks="' + chunks.length + '">');
  const [s, e] = gridRegion(lines, open);
  lines.splice(s, e - s, ...first.map(c => '    ' + c));

  // блок архива: заменить между маркерами или вставить сразу после закрывающей строки сетки
  let text = lines.join('\n');
  const block = archiveBlock(older, chunks.length);
  const withMarkers = '  ' + ARCH_START + '\n' + (block ? '  ' + block.replace(/\n/g, '\n  ') + '\n' : '') + '  ' + ARCH_END;
  const re = new RegExp('[ ]*' + ARCH_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + ARCH_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (re.test(text)) text = text.replace(re, () => withMarkers);
  else {
    const L = text.split('\n');
    const o = L.findIndex(l => GRID_OPEN.test(l + '\n'));
    const [, end] = gridRegion(L, o);           // end — строка закрывающего </div> сетки
    L.splice(end + 1, 0, withMarkers);
    text = L.join('\n');
  }
  idx.text = text;
  writeDoc(INDEX, idx);

  // порции
  const had = chunkFiles();
  chunks.forEach((c, i) => {
    const rel = CARDS_DIR + '/' + (i + 1) + '.html';
    writeDoc(rel, { crlf: false, text: c.join('\n') + '\n' });
  });
  for (let i = chunks.length; i < had.length; i++) fs.unlinkSync(path.join(ROOT, had[i]));
  return { total: cards.length, first: first.length, chunks: chunks.length, older: older.length };
}

module.exports = { FIRST, CHUNK, INDEX, CARDS_DIR, ARCH_START, ARCH_END, readDoc, writeDoc, slugOf, titleHtmlOf, dateTextOf, readAllCards, writeAllCards, chunkFiles };
