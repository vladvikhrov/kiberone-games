#!/usr/bin/env node
'use strict';
/* Снимки витрины для docs/img (В1). Запуск: node redteam/vitrina-shots.js [папка]
   Оценки на снимках тестовые: файл ratings.json заполняется здесь же. Окна не показываются на экране. */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { keygen, pack } = require('../kibpack/pack');
const { readPackage } = require('../shared/package-format');

const APP = path.resolve(__dirname, '..');

async function main() {
  const shotDir = path.resolve(process.argv[2] || path.join(APP, '..', 'docs', 'img'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vshots-'));
  const key = keygen('shots', path.join(tmp, 'keys')).keyPath;
  const stranger = keygen('stranger', path.join(tmp, 'keys')).keyPath;
  const catalogDir = path.join(tmp, 'games');
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(catalogDir);
  fs.mkdirSync(dataDir);
  let keyId;
  for (const folder of [path.join(APP, '..', 'games', 'kiberpochta'), path.join(APP, '..', 'games', 'vzlomai-seif'), path.join(APP, 'testgames', 'tri-rezhima')]) {
    const { target } = await pack(folder, { key, out: path.join(catalogDir, `${path.basename(folder)}.kibgames`) });
    keyId = (await readPackage(target)).trust.keyId;
  }
  // Игра без обложки от автора не из списка школы: видно заглушку и состояние «автор не проверен»
  await pack(path.join(APP, 'testgames', 'bez-oblozhki'), { key: stranger, out: path.join(catalogDir, 'bez-oblozhki.kibgames') });
  fs.writeFileSync(path.join(dataDir, 'ratings.json'), JSON.stringify({ format: 1, games: {
    kiberpochta: { default: { 1: 1, 2: 1, 3: 4, 4: 12, 5: 19 } },
    'vzlomai-seif': { default: { 1: 0, 2: 1, 3: 2, 4: 6, 5: 22 } },
    'tri-rezhima': { training: { 1: 0, 2: 1, 3: 3, 4: 5, 5: 7 }, timed: { 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 } },
  } }));
  fs.mkdirSync(shotDir, { recursive: true });
  const out = path.join(tmp, 'out.json');
  const cfg = { mode: 'shots', catalogDir, dataDir, trustedKeys: { [keyId]: 'Влад, тьютор' }, shotDir, out };
  const electron = path.join(APP, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
  const args = [`--user-data-dir=${path.join(tmp, 'profile')}`, path.join(__dirname, 'vitrina-harness.js')];
  if (process.platform === 'linux') args.unshift('--ozone-platform=headless');
  const run = spawnSync(electron, args, { env: { ...process.env, REDTEAM_CONFIG: JSON.stringify(cfg) }, timeout: 120000, encoding: 'utf8' });
  console.log(fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : `Снимков нет, код ${run.status}\n${run.stderr}`);
  fs.rmSync(tmp, { recursive: true, force: true });
}
main();
