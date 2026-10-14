#!/usr/bin/env node
// Сборка dist/ для хостинга (Timeweb App Platform): копирует сайт без служебных файлов.
// Запуск: node scripts/build-dist.js   → папка публикации dist
// Исключения берутся из .vercelignore (единый список), плюс всегда: .git*, .claude, node_modules, vercel.json, dist, *.md, *.bak, *.sh.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist');

const ALWAYS_SKIP = new Set(['dist', 'node_modules', 'vercel.json', 'package.json', 'package-lock.json']);
const SKIP_EXT = /\.(md|bak|sh|log|tmp)$/i;

// .vercelignore: по одной записи в строке; «dir/» — папка, остальное — файл верхнего уровня
const ignore = new Set();
const ign = path.join(ROOT, '.vercelignore');
if (fs.existsSync(ign)) {
  for (const line of fs.readFileSync(ign, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (s && !s.startsWith('#')) ignore.add(s.replace(/\/$/, ''));
  }
}

function skip(rel, name) {
  if (name.startsWith('.')) return true; // .git, .githooks, .claude, .github и т. п.
  if (ALWAYS_SKIP.has(name) && !rel.includes(path.sep)) return true;
  if (ignore.has(rel.split(path.sep).join('/'))) return true;
  if (SKIP_EXT.test(name)) return true;
  return false;
}

let files = 0, bytes = 0;
function copy(dir, rel) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? path.join(rel, ent.name) : ent.name;
    if (skip(r, ent.name)) continue;
    const from = path.join(dir, ent.name);
    const to = path.join(OUT, r);
    if (ent.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copy(from, r);
    } else if (ent.isFile()) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      files++; bytes += fs.statSync(from).size;
    }
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
copy(ROOT, '');

// Обязательные файлы: без них деплой не должен считаться успешным
const need = ['index.html', '404.html', 'sitemap.xml', 'robots.txt', 'video.mp4'];
const miss = need.filter(f => !fs.existsSync(path.join(OUT, f)));
if (miss.length) { console.error('build-dist: в dist нет обязательных файлов: ' + miss.join(', ')); process.exit(1); }

// Служебное в dist попасть не должно
const bad = [];
(function walk(d) {
  for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, ent.name);
    const rel = path.relative(OUT, p).split(path.sep).join('/');
    if (/^(scripts|drafts|\.git|\.claude)/.test(rel) || /(^|\/)(CLAUDE|README)\.md$/.test(rel)) bad.push(rel);
    if (ent.isDirectory()) walk(p);
  }
})(OUT);
if (bad.length) { console.error('build-dist: в dist попало служебное: ' + bad.join(', ')); process.exit(1); }

console.log('build-dist: файлов ' + files + ', ' + (bytes / 1048576).toFixed(1) + ' МБ → dist/');
