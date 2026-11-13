// Генератор статьи блога из article.md по шаблону опубликованной статьи (не публикуется: scripts/ вне dist).
// Запуск: node scripts/mk-article.js <конфиг.json>
// Конфиг: slug, md, template, title, desc, kicker, crumb, date (ГГГГ-ММ-ДД), dateRu, faqCount, mailSubject, mailButton, related [[href, текст], ...].
// После генерации карточку добавлять только через scripts/add-blog-card.js.
const fs = require('fs');
const path = require('path');
process.chdir(path.resolve(__dirname, '..'));
const C = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const URL = 'https://med-local.ru/blog/' + C.slug + '/';

// адреса страниц сайта — только со слэшем на конце (файлы, корень, якоря и внешние адреса не трогаем)
const slash = u => {
  if (!/^\/(?!\/)/.test(u)) return u;
  const i = u.search(/[?#]/); const p = i < 0 ? u : u.slice(0, i); const s = i < 0 ? '' : u.slice(i);
  if (p === '/' || p.endsWith('/') || p.split('/').pop().includes('.')) return u;
  return p + '/' + s;
};

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = s => {
  s = esc(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, t, h) => '<a href="' + slash(h) + '" style="color:var(--cyan);font-weight:600">' + t + '</a>');
  return s;
};
const plain = s => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// --- разбор markdown
const md = fs.readFileSync(C.md, 'utf8').replace(/\r\n/g, '\n').split('\n');
const h1 = md[0].replace(/^# /, '').trim();
const byline = md[2].trim();
if (!/^А\.-Т\. Танделов/.test(byline)) throw new Error('байлайн не найден');
const blocks = md.slice(3);
const body = [], faq = [], norm = [];
let cta = null, mode = 'body', list = null, listTag = 'ul';
const flushList = arr => { if (list) { arr.push('<' + listTag + '>\n' + list.map(x => '<li>' + inline(x) + '</li>').join('\n') + '\n</' + listTag + '>'); list = null; } };
for (let k = 0; k < blocks.length; k++) {
  const l = blocks[k];
  if (/^### Нормативная база/.test(l)) { flushList(body); mode = 'norm'; continue; }
  if (mode === 'norm') { if (/^- /.test(l)) norm.push(l.slice(2).trim()); continue; }
  if (/^## Частые вопросы/.test(l)) { flushList(body); body.push('<h2>Частые вопросы</h2>'); mode = 'faq'; continue; }
  if (mode === 'faq') {
    if (/^#### /.test(l)) {
      let m = k + 1; while (m < blocks.length && !blocks[m].trim()) m++;
      faq.push({ q: l.slice(5).trim(), a: blocks[m].trim() }); k = m; continue;
    }
    if (/^\*\*[^*]+\*\*$/.test(l.trim())) {
      let m = k + 1; while (m < blocks.length && !blocks[m].trim()) m++;
      cta = { title: l.replace(/\*\*/g, '').trim(), text: blocks[m].trim() }; k = m; continue;
    }
    continue;
  }
  if (!l.trim()) { flushList(body); continue; }
  if (l.startsWith('|')) {
    flushList(body);
    const rows = [];
    while (k < blocks.length && blocks[k].startsWith('|')) { rows.push(blocks[k]); k++; }
    k--;
    const cells = r => r.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    const head = cells(rows[0]);
    const data = rows.slice(2).map(cells);
    body.push('<div style="overflow-x:auto"><table class="compare-table">\n<tr>' + head.map(h => '<th>' + inline(h) + '</th>').join('') + '</tr>\n' + data.map(r => '<tr>' + r.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('\n') + '\n</table></div>');
    continue;
  }
  if (/^## /.test(l)) { flushList(body); body.push('<h2>' + inline(l.slice(3)) + '</h2>'); continue; }
  if (/^### /.test(l)) { flushList(body); body.push('<h3>' + inline(l.slice(4)) + '</h3>'); continue; }
  if (/^\d+\. /.test(l)) { if (list && listTag !== 'ol') flushList(body); listTag = 'ol'; (list = list || []).push(l.replace(/^\d+\. /, '').trim()); continue; }
  if (/^- /.test(l)) { if (list && listTag !== 'ul') flushList(body); listTag = 'ul'; (list = list || []).push(l.slice(2).trim()); continue; }
  flushList(body);
  if (/^\*\*Суть в четырёх предложениях\.\*\*/.test(l)) {
    body.push('<div class="law"><b>Суть в четырёх предложениях.</b>' + inline(l.replace(/^\*\*Суть в четырёх предложениях\.\*\*\s*/, '')) + '</div>');
    continue;
  }
  body.push('<p>' + inline(l.trim()) + '</p>');
}
flushList(body);
if (faq.length !== C.faqCount) throw new Error('FAQ: ' + faq.length + ' вместо ' + C.faqCount);
if (!cta) throw new Error('CTA не найден');
if (!norm.length) throw new Error('нормативная база пуста');

const faqHtml = faq.map(f => '<div class="faq-item"><h4>' + inline(f.q) + '</h4><p>' + inline(f.a) + '</p></div>').join('\n');
const ctaHtml = '<div class="article-cta">\n  <b>' + inline(cta.title) + '</b>\n  <p>' + inline(cta.text) + '</p>\n  <a class="btn pri" href="mailto:info@med-local.ru?subject=' + C.mailSubject + '">' + C.mailButton + '</a>\n</div>';
const normHtml = '<h3>Нормативная база</h3>\n<ul>\n' + norm.map(x => '<li>' + inline(x) + '</li>').join('\n') + '\n</ul>';

// --- шаблон
const raw = fs.readFileSync(C.template, 'utf8');
const crlf = raw.includes('\r\n');
let t = raw.replace(/\r\n/g, '\n');
const sub = (re, val, name) => { if (!re.test(t)) throw new Error('шаблон: не найден ' + name); t = t.replace(re, () => val); };

sub(/<title>[\s\S]*?<\/title>/, '<title>' + esc(C.title) + '</title>', 'title');
sub(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + esc(C.desc) + '">', 'description');
sub(/<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="' + URL + '">', 'canonical');
sub(/<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="' + esc(h1) + '">', 'og:title');
sub(/<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="' + esc(C.desc) + '">', 'og:description');
sub(/<meta property="og:url" content="[^"]*">/, '<meta property="og:url" content="' + URL + '">', 'og:url');

const article = { '@context': 'https://schema.org', '@type': 'Article', headline: h1, description: C.desc, url: URL,
  datePublished: C.date + 'T00:00:00+03:00', dateModified: C.date + 'T00:00:00+03:00',
  author: { '@type': 'Person', name: 'А.-Т. Танделов', url: 'https://med-local.ru/about/' },
  publisher: { '@type': 'Organization', name: 'Инженерный центр', url: 'https://med-local.ru', logo: { '@type': 'ImageObject', url: 'https://med-local.ru/logo.svg' } },
  image: 'https://med-local.ru/og-image.png', inLanguage: 'ru', mainEntityOfPage: { '@type': 'WebPage', '@id': URL } };
const faqLd = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(f => ({ '@type': 'Question', name: plain(inline(f.q)), acceptedAnswer: { '@type': 'Answer', text: plain(inline(f.a)) } })) };
const crumbLd = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
  { '@type': 'ListItem', position: 1, name: 'Главная', item: 'https://med-local.ru/' },
  { '@type': 'ListItem', position: 2, name: 'База знаний', item: 'https://med-local.ru/blog/' },
  { '@type': 'ListItem', position: 3, name: C.crumb, item: URL } ] };
const ldBlock = [article, faqLd, crumbLd].map(o => '<script type="application/ld+json">\n' + JSON.stringify(o) + '\n</script>').join('\n');
sub(/<script type="application\/ld\+json">[\s\S]*?<\/script>\n<script type="application\/ld\+json">[\s\S]*?<\/script>\n<script type="application\/ld\+json">[\s\S]*?<\/script>/, ldBlock, 'JSON-LD x3');

sub(/<nav class="crumbs">[\s\S]*?<\/nav>/, '<nav class="crumbs"><a href="/">Главная</a><span>›</span><a href="/blog/">База знаний</a><span>›</span><b>' + esc(C.crumb) + '</b></nav>', 'crumbs');
sub(/<span class="tag" style="display:inline-flex;margin-bottom:14px">[^<]*<\/span>/, '<span class="tag" style="display:inline-flex;margin-bottom:14px">' + C.kicker + '</span>', 'tag');
sub(/<h1 class="h-xl" style="margin:0 0 16px;max-width:760px">[\s\S]*?<\/h1>/, '<h1 class="h-xl" style="margin:0 0 16px;max-width:760px">' + esc(h1) + '</h1>', 'h1');
sub(/<span>А\.-Т\. Танделов[^<]*<\/span>/, '<span>' + esc(byline.split(' · Опубликовано')[0]) + '</span>', 'byline');
sub(/<time datetime="[^"]*">[^<]*<\/time>/, '<time datetime="' + C.date + '">Опубликовано: ' + C.dateRu + '</time>', 'time');

const bStart = t.indexOf('<div class="article-body">');
const bEnd = t.indexOf('    </div>\n  </div>\n</section>', bStart);
if (bStart < 0 || bEnd < 0) throw new Error('границы article-body');
t = t.slice(0, bStart) + '<div class="article-body">\n' + body.join('\n') + '\n' + faqHtml + '\n\n' + ctaHtml + '\n\n' + normHtml + '\n\n\n' + t.slice(bEnd);

const card = (href, text) => '<a href="' + slash(href) + '" style="display:block;background:#fff;border:1.5px solid var(--line);border-radius:12px;padding:14px 16px;font-size:14px;font-weight:600;color:var(--cyan);text-decoration:none;transition:.15s">' + esc(text) + '</a>';
const cards = C.related.map(c => card(c[0], c[1])).join('');
const gridRe = /(<div style="display:grid;grid-template-columns:repeat\(auto-fit,minmax\(220px,1fr\)\);gap:12px">)[\s\S]*?(<\/div>\n  <\/div>\n<\/section>\n<\/main>)/;
if (!gridRe.test(t)) throw new Error('шаблон: «Читайте также»');
t = t.replace(gridRe, (m, a, b) => a + cards + b);

fs.mkdirSync('blog/' + C.slug, { recursive: true });
fs.writeFileSync('blog/' + C.slug + '/index.html', crlf ? t.replace(/\n/g, '\r\n') : t);
console.log('OK', C.slug, '| title', C.title.length, '| desc', C.desc.length, '| h1', h1.length);
