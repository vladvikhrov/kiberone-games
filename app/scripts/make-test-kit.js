#!/usr/bin/env node
'use strict';
/* Собирает папку dist/KIBERone-Test для проверки на Windows: приложение, игры, плохие файлы, исходники, задание.
   Сначала выполните npm run build:win-dir. Игры подписываются одноразовым ключом, который тут же удаляется. */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yazl = require('yazl');
const { keygen, pack } = require('../kibpack/pack');
const { keyId, readPackage } = require('../shared/package-format');

const APP = path.resolve(__dirname, '..');
const ROOT = path.resolve(APP, '..');
const KIT = path.join(APP, 'dist', 'KIBERone-Test');
const GAMES = path.join(KIT, 'games');

const HANG_PAGE = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Тест зависания</title></head>
<body style="font:24px sans-serif;text-align:center;padding-top:20vh">
<h1>Тест зависания</h1><p>Кнопка намертво вешает страницу. После неё нажмите Esc и выберите «Выйти».</p>
<button id="b" style="font-size:24px;padding:16px">Зависнуть</button>
<script>document.getElementById('b').onclick = function () { for (;;) { /* вечный цикл */ } };</script>
</body></html>`;

/* Встроенная в electron-builder упаковка 7za падает на этой сборке, поэтому ZIP собираем сами. */
async function zipFolder(folder, target) {
  const zip = new yazl.ZipFile();
  const walk = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else zip.addFile(full, path.relative(folder, full).split(path.sep).join('/'));
    }
  };
  walk(folder);
  zip.end();
  await new Promise((resolve, reject) => {
    zip.outputStream.pipe(fs.createWriteStream(target)).on('close', resolve).on('error', reject);
  });
}

async function main() {
  const built = path.join(APP, 'dist', 'win-unpacked');
  if (!fs.existsSync(path.join(built, 'kiberone-games.exe'))) throw new Error('Нет сборки. Сначала выполните npm run build:win-dir');

  fs.rmSync(KIT, { recursive: true, force: true });
  fs.mkdirSync(GAMES, { recursive: true });
  const { version } = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  const zipName = `KIBERone-Games-${version}-win-x64.zip`;
  await zipFolder(built, path.join(KIT, zipName));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-'));
  let id;
  try {
    const key = keygen('kit', path.join(tmp, 'keys')).keyPath;
    const packTo = async (folder) => {
      const { target, manifest } = await pack(folder, { key, out: path.join(tmp, 'pending.kibgames') });
      const final = path.join(GAMES, `${manifest.id}-${manifest.version}.kibgames`);
      fs.renameSync(target, final);
      id = keyId(manifest.publicKey);
      return final;
    };
    const pochta = await packTo(path.join(ROOT, 'games', 'kiberpochta'));
    await packTo(path.join(ROOT, 'games', 'vzlomai-seif'));

    const hang = path.join(tmp, 'hang');
    fs.mkdirSync(hang);
    fs.writeFileSync(path.join(hang, 'index.html'), HANG_PAGE);
    fs.writeFileSync(path.join(hang, 'kibgame.json'), JSON.stringify({
      id: 'test-zavisanie', version: '1.0.0', title: 'Тест зависания', description: 'Проверка выхода из зависшей игры.',
      authors: ['Тест'], grades: 'тест', minutes: 1, topic: 'Проверка', entry: 'index.html', minAppVersion: '1.0.0',
    }));
    await packTo(hang);

    // Поддельный файл: другая игра под чужими хешами. Портим байт в середине архива
    const flipped = fs.readFileSync(pochta);
    flipped[Math.floor(flipped.length / 2)] ^= 0xff;
    fs.writeFileSync(path.join(GAMES, 'poddelka.kibgames'), flipped);
    fs.writeFileSync(path.join(GAMES, 'bitaya.kibgames'), 'это не игра');
    await readPackage(pochta); // настоящая игра должна оставаться рабочей
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true }); // ключ одноразовый
  }

  const source = path.join(KIT, 'source');
  for (const item of ['desktop', 'kibpack', 'redteam', 'scripts', 'shared', 'test', 'package.json', 'package-lock.json', 'README.md']) {
    fs.cpSync(path.join(APP, item), path.join(source, 'app', item), { recursive: true });
  }
  for (const game of ['kiberpochta', 'vzlomai-seif']) fs.cpSync(path.join(ROOT, 'games', game), path.join(source, 'games', game), { recursive: true });

  const prompt = fs.readFileSync(path.join(ROOT, 'docs/tasks/windows-test-prompt.md'), 'utf8').replaceAll('{{KEY_ID}}', id);
  fs.writeFileSync(path.join(KIT, 'ПРОМПТ-ДЛЯ-ПРОВЕРКИ.md'), prompt);

  const sums = [zipName, ...fs.readdirSync(GAMES).map((f) => `games/${f}`)].map((f) => {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(KIT, f))).digest('hex');
    return `${hash}  ${f}`;
  });
  fs.writeFileSync(path.join(KIT, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
  console.log(`Готово: ${KIT}\nОтпечаток тестового ключа: ${id}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
