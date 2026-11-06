'use strict';
/* Этап М5, Д1–Д3: документация по ADR-0002, раздел 10. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MAIN = ['README.md', 'docs/ustanovka.md', 'docs/kak-ustroeno.md', 'docs/kak-sdelat-igru.md', 'docs/bezopasnost.md', 'docs/plan.md',
  'app/README.md', 'games/README.md'];
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('Д1: корневой README на один экран, со схемой и тремя шагами установки', () => {
  const text = read('README.md');
  assert.ok(text.split('\n').length <= 45, `строк: ${text.split('\n').length}`);
  assert.match(text, /```mermaid\nflowchart/);
  assert.match(text, /## Установка в трёх шагах\n\n1\. [^\n]+\n2\. [^\n]+\n3\. /);
});

test('Д2: документы из раздела 10 есть, три схемы Mermaid на своих местах', () => {
  for (const p of MAIN) assert.ok(fs.existsSync(path.join(ROOT, p)), p);
  assert.match(read('docs/kak-ustroeno.md'), /```mermaid\nflowchart[\s\S]*```mermaid\nsequenceDiagram/);
  assert.match(read('docs/bezopasnost.md'), /```mermaid\nflowchart/);
});

test('Д2: относительные ссылки ведут на существующие файлы', () => {
  const docs = [...MAIN, ...fs.readdirSync(path.join(ROOT, 'docs/tasks')).filter((f) => /^(windows-m5|pilot-m5|kirill-ustanovka|etap-m5|otchet-m5)\.md$/.test(f)).map((f) => `docs/tasks/${f}`)];
  const broken = [];
  for (const p of docs) {
    const text = read(p);
    for (const m of text.matchAll(/\]\(([^)\s]+)\)|<img src="([^"]+)"/g)) {
      const link = (m[1] || m[2]).split('#')[0];
      if (!link || /^[a-z]+:/i.test(link)) continue;
      if (!fs.existsSync(path.join(ROOT, path.dirname(p), decodeURI(link)))) broken.push(`${p}: ${link}`);
    }
  }
  assert.deepEqual(broken, []);
});

test('Д2: ни один абзац длиннее 200 знаков не повторяется в двух документах', () => {
  const seen = new Map();
  const dup = [];
  for (const p of MAIN) {
    for (const para of read(p).split(/\n\s*\n/).map((x) => x.trim()).filter((x) => x.length > 200 && !x.startsWith('```') && !x.startsWith('|'))) {
      if (seen.has(para) && seen.get(para) !== p) dup.push(`${seen.get(para)} и ${p}: ${para.slice(0, 60)}…`);
      seen.set(para, p);
    }
  }
  assert.deepEqual(dup, []);
});

test('Д3: пульта нет, на него не ссылаются', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'games/pult.py')));
  assert.ok(!fs.existsSync(path.join(ROOT, 'games/pult-config.json')));
  for (const p of [...MAIN, 'games/index.html']) {
    const text = read(p).replace('Пульт `pult.py` для раздачи по сети удалён на этапе М5', '');
    assert.doesNotMatch(text, /pult\.py|status\.json|порт 8000/, p);
  }
});
