#!/usr/bin/env node
'use strict';
/* Три архива для проверки на Windows без Node (docs/tasks/windows-exe.md), в dist/windows-exe/:
   KIBERone-Games-<версия>-win-x64.zip   программа ученика (папка dist/win-unpacked)
   KIBERone-Server-<версия>-win-x64.zip  программа тьютора (папка dist/tutor/win-unpacked)
   K1-test-games.zip                     то, что на Windows делали npm run dev-catalog и команда «плохие файлы»:
                                         Киберпочта, Сейф, «Три режима» под ключом разработки k1-dev, trusted-keys.json,
                                         bitaya.kibgames и poddelka.kibgames
   Сначала выполните npm run build:win-dir и npm run build:tutor-win-dir. */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yazl = require('yazl');

const APP = path.resolve(__dirname, '..');
const OUT = path.join(APP, 'dist', 'windows-exe');
const { version } = require('../package.json');

/* Встроенная в electron-builder упаковка 7za на этой сборке падает, поэтому ZIP собираем сами.
   Внутри архива одна папка top, чтобы при распаковке файлы не рассыпались. */
async function zipFolder(folder, target, top) {
  const zip = new yazl.ZipFile();
  const walk = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else zip.addFile(full, [top, ...path.relative(folder, full).split(path.sep)].join('/'));
    }
  };
  walk(folder);
  zip.end();
  await new Promise((resolve, reject) => {
    zip.outputStream.pipe(fs.createWriteStream(target)).on('close', resolve).on('error', reject);
  });
}

async function main() {
  const student = path.join(APP, 'dist', 'win-unpacked');
  const tutor = path.join(APP, 'dist', 'tutor', 'win-unpacked');
  if (!fs.existsSync(path.join(student, 'kiberone-games.exe'))) throw new Error('Нет сборки ученика. Сначала npm run build:win-dir');
  if (!fs.existsSync(path.join(tutor, 'kiberone-server.exe'))) throw new Error('Нет сборки тьютора. Сначала npm run build:tutor-win-dir');

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const names = [`KIBERone-Games-${version}-win-x64.zip`, `KIBERone-Server-${version}-win-x64.zip`, 'K1-test-games.zip'];
  await zipFolder(student, path.join(OUT, names[0]), 'KIBERone-Games');
  await zipFolder(tutor, path.join(OUT, names[1]), 'KIBERone-Server');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'k1-games-'));
  try {
    const kit = path.join(tmp, 'K1-test-games');
    const games = path.join(kit, 'games');
    const r = spawnSync(process.execPath, [path.join(__dirname, 'make-dev-catalog.js'), '--out', games, '--profile', kit], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('make-dev-catalog.js не отработал');
    const bad = path.join(kit, 'bad');
    fs.mkdirSync(bad);
    fs.writeFileSync(path.join(bad, 'bitaya.kibgames'), 'это не игра');
    const flipped = fs.readFileSync(path.join(games, 'kiberpochta.kibgames'));
    flipped[Math.floor(flipped.length / 2)] ^= 0xff; // тот же байт, что портит команда из windows-m1.md
    fs.writeFileSync(path.join(bad, 'poddelka.kibgames'), flipped);
    await zipFolder(kit, path.join(OUT, names[2]), 'K1-test-games');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const sums = names.map((f) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(OUT, f))).digest('hex').toUpperCase()}  ${f}`);
  fs.writeFileSync(path.join(OUT, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
  for (const f of names) console.log(`${f}: ${(fs.statSync(path.join(OUT, f)).size / 1048576).toFixed(1)} МБ`);
  console.log(`Готово: ${OUT}`);
}

main().catch((err) => { console.error(`Ошибка: ${err.message}`); process.exit(1); });
