'use strict';
/* Источник каталога на этапе В0: папка с .kibgames. Каждый файл проверяется тем же readPackage, что и при запуске.
   На этапе М2 его заменит подписанный каталог школы. Окно витрины получает только описания и обложки, без путей к файлам. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readPackage, supportsVersion, gameModes, extensionOf } = require('../../shared/package-format');

const MAX_FILES = 100;
const COVER_MIME = { png: 'image/png', webp: 'image/webp' };

/* Группы школы (claude/как-веду-занятия.md): младшая — дошкольники и 1–3 класс, средняя — 4–5 класс, старшая — 6 класс и старше.
   Берутся из поля grades, другого источника в формате пока нет. Не распознали — игра видна только во «Все». */
function groupsOf(grades) {
  const g = grades.toLowerCase();
  const nums = (g.match(/\d{1,2}/g) || []).map(Number);
  const groups = new Set();
  if (/дошкол/.test(g)) groups.add('junior');
  if (nums.length && /класс/.test(g)) {
    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    if (lo <= 3) groups.add('junior');
    if (lo <= 5 && hi >= 4) groups.add('middle');
    if (hi >= 6) groups.add('senior');
  } else if (nums.length && /(лет|год)/.test(g)) {
    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    if (lo <= 9) groups.add('junior');
    if (lo <= 11 && hi >= 10) groups.add('middle');
    if (hi >= 12) groups.add('senior');
  }
  return ['junior', 'middle', 'senior'].filter((x) => groups.has(x));
}

async function loadCatalog(dir, { trustedKeys = {}, appVersion }) {
  const games = [];
  const skipped = [];
  const covers = new Map(); // sha256 hex -> { data, mime }
  let names;
  try {
    names = (await fs.promises.readdir(dir, { withFileTypes: true }))
      .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.kibgames')).map((d) => d.name).sort();
  } catch {
    return { games, skipped, covers, missing: true };
  }
  for (const name of names.slice(MAX_FILES)) skipped.push({ file: name, reason: `больше ${MAX_FILES} файлов в папке` });

  for (const name of names.slice(0, MAX_FILES)) {
    const file = path.join(dir, name);
    let pkg;
    try { pkg = await readPackage(file, { trustedKeys }); } catch (err) { skipped.push({ file: name, reason: err.message }); continue; }
    const { manifest: m, trust, files } = pkg;
    if (games.some((g) => g.id === m.id)) { skipped.push({ file: name, reason: `игра ${m.id} уже есть в папке` }); continue; }

    const coverId = (p) => {
      if (!p) return null;
      const data = files.get(p);
      const hex = crypto.createHash('sha256').update(data).digest('hex');
      covers.set(hex, { data, mime: COVER_MIME[extensionOf(p)] });
      return hex;
    };
    let state = 'ready';
    if (!trust.trusted) state = 'untrusted';
    else if (!supportsVersion(appVersion, m.minAppVersion)) state = 'update';

    games.push({
      id: m.id, version: m.version, title: m.title, description: m.description, grades: m.grades, minutes: m.minutes,
      topic: m.topic, author: trust.name, keyId: trust.keyId, state, groups: groupsOf(m.grades), cover: coverId(m.cover),
      multiMode: Array.isArray(m.modes),
      modes: gameModes(m).map((x) => ({ id: x.id, title: x.title, about: x.about, cover: coverId(x.cover) })),
      file,
    });
  }
  games.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  return { games, skipped, covers, missing: false };
}

module.exports = { loadCatalog, groupsOf, MAX_FILES };
