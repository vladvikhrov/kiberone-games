#!/usr/bin/env node
'use strict';
/* Три архива для проверки на Windows без Node (docs/tasks/windows-exe.md), в dist/windows-exe/:
   KIBERone-Games-<версия>-win-x64.zip   программа ученика (папка dist/win-unpacked)
   KIBERone-Server-<версия>-win-x64.zip  программа тьютора (папка dist/tutor/win-unpacked)
   K1-test-games.zip                     то, что на Windows делали npm run dev-catalog и команда «плохие файлы»:
                                         Киберпочта, Сейф, «Три режима» под ключом разработки k1-dev, trusted-keys.json,
                                         bitaya.kibgames и poddelka.kibgames
   K1-big-games.zip                      этап М3 (windows-m3.md): игры на 50 и 200 МБ под тем же ключом k1-dev,
                                         со звуком, который можно перемотать к концу (проверка Range в serveGame)
   Сначала выполните npm run build:win-dir и npm run build:tutor-win-dir. Ключ --no-big пропускает большие игры. */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yazl = require('yazl');
const { keygen, pack, defaultKeyDir } = require('../kibpack/pack');

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

/* Большая игра для замера: файлы видео из случайных байт и WAV с тихим шумом (его можно перематывать). Вместе mb МБ. */
async function bigGame(dir, id, mb, keyPath) {
  const src = path.join(dir, `src-${id}`);
  fs.mkdirSync(src, { recursive: true });
  const MB = 1024 * 1024;
  const wavBytes = Math.min(49, Math.floor(mb / 4)) * MB;
  fs.writeFileSync(path.join(src, 'kibgame.json'), JSON.stringify({ id, version: '1.0.0', title: `Большая игра ${mb} МБ`,
    description: 'Проверка этапа М3: загрузка, докачка, запуск и перемотка звука', authors: ['KIBERone'], grades: '4–5 класс',
    minutes: 30, topic: 'Проверка', minAppVersion: '1.0.0', entry: 'index.html' }));
  fs.writeFileSync(path.join(src, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Большая игра ${mb} МБ</title>
<style>body{font:24px sans-serif;background:#2B4C7E;color:#fff;padding:40px}audio{width:80%}</style>
<h1>Большая игра ${mb} МБ</h1><p>Игра открылась. Перетащите ползунок звука в самый конец: он должен остаться там, а не вернуться в начало.</p>
<audio controls src="zvuk.wav"></audio>`);
  const rate = 22050;
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + wavBytes, 4); head.write('WAVE', 8); head.write('fmt ', 12);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate, 28); head.writeUInt16LE(1, 32); head.writeUInt16LE(8, 34); head.write('data', 36); head.writeUInt32LE(wavBytes, 40);
  const noise = crypto.randomBytes(wavBytes);
  for (let i = 0; i < noise.length; i += 1) noise[i] = 120 + (noise[i] & 15);
  fs.writeFileSync(path.join(src, 'zvuk.wav'), Buffer.concat([head, noise]));
  let rest = mb * MB - wavBytes;
  for (let i = 1; rest > 0; i += 1) {
    const part = Math.min(rest, 49 * MB);
    fs.writeFileSync(path.join(src, `video${i}.webm`), crypto.randomBytes(part));
    rest -= part;
  }
  const out = path.join(dir, `${id}.kibgames`);
  await pack(src, { key: keyPath, out });
  fs.rmSync(src, { recursive: true, force: true });
  return out;
}

async function main() {
  const student = path.join(APP, 'dist', 'win-unpacked');
  const tutor = path.join(APP, 'dist', 'tutor', 'win-unpacked');
  if (!fs.existsSync(path.join(student, 'kiberone-games.exe'))) throw new Error('Нет сборки ученика. Сначала npm run build:win-dir');
  if (!fs.existsSync(path.join(tutor, 'kiberone-server.exe'))) throw new Error('Нет сборки тьютора. Сначала npm run build:tutor-win-dir');

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const big = !process.argv.includes('--no-big');
  const names = [`KIBERone-Games-${version}-win-x64.zip`, `KIBERone-Server-${version}-win-x64.zip`, 'K1-test-games.zip', ...(big ? ['K1-big-games.zip'] : [])];
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
    if (big) {
      const keyPath = path.join(defaultKeyDir(), 'k1-dev.key.pem');
      if (!fs.existsSync(keyPath)) keygen('k1-dev');
      const bigKit = path.join(tmp, 'K1-big-games');
      fs.mkdirSync(bigKit);
      await bigGame(bigKit, 'bolshaya-50', 50, keyPath);
      await bigGame(bigKit, 'bolshaya-200', 195, keyPath); // предел распаковки 200 МБ
      await zipFolder(bigKit, path.join(OUT, names[3]), 'K1-big-games');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const sums = names.map((f) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(OUT, f))).digest('hex').toUpperCase()}  ${f}`);
  fs.writeFileSync(path.join(OUT, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
  for (const f of names) console.log(`${f}: ${(fs.statSync(path.join(OUT, f)).size / 1048576).toFixed(1)} МБ`);
  console.log(`Готово: ${OUT}`);
}

main().catch((err) => { console.error(`Ошибка: ${err.message}`); process.exit(1); });
