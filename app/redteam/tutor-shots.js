#!/usr/bin/env node
'use strict';
/* Снимки программы тьютора для docs/img (Т16). Запуск: node redteam/tutor-shots.js [папка]
   Оценки на снимках тестовые: файл ratings.json заполняется здесь же. Окна не показываются на экране. */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { keygen, pack } = require('../kibpack/pack');

const APP = path.resolve(__dirname, '..');

async function main() {
  const shotDir = path.resolve(process.argv[2] || path.join(APP, '..', 'docs', 'img'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tshots-'));
  const keys = path.join(tmp, 'keys');
  const vlad = keygen('vlad', keys).keyPath;
  const kirill = keygen('kirill', keys).keyPath;
  const stranger = keygen('stranger', keys).keyPath;
  const gamesDir = path.join(tmp, 'games');
  fs.mkdirSync(gamesDir);
  const packed = async (folder, key, name) => (await pack(folder, { key, out: path.join(gamesDir, `${name}.kibgames`) })).target;
  const files = [
    await packed(path.join(APP, '..', 'games', 'kiberpochta'), vlad, 'kiberpochta'),
    await packed(path.join(APP, '..', 'games', 'vzlomai-seif'), kirill, 'vzlomai-seif'),
    await packed(path.join(APP, 'testgames', 'tri-rezhima'), vlad, 'tri-rezhima'),
    await packed(path.join(APP, 'testgames', 'bez-oblozhki'), stranger, 'bez-oblozhki'),
  ];
  // Файл для окна проверки: та же «Три режима», но подписана чужим ключом. Видны оба предупреждения
  const pickFile = await packed(path.join(APP, 'testgames', 'tri-rezhima'), stranger, 'samozvanets');
  const ratings = { format: 1, games: {
    kiberpochta: { default: { 1: 1, 2: 1, 3: 4, 4: 12, 5: 19 } },
    'vzlomai-seif': { default: { 1: 0, 2: 1, 3: 2, 4: 6, 5: 22 } },
    'tri-rezhima': { training: { 1: 0, 2: 1, 3: 1, 4: 4, 5: 8 }, timed: { 1: 0, 2: 0, 3: 0, 4: 3, 5: 12 }, custom: { 1: 0, 2: 0, 3: 1, 4: 2, 5: 1 } },
  } };
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(shotDir, { recursive: true });
  const out = path.join(tmp, 'out.json');
  const cfg = {
    mode: 'tutor-shots', dataDir, files, pickFile, ratings, shotDir, out,
    trustNames: { kiberpochta: 'Влад, тьютор', 'vzlomai-seif': 'Кирилл, тьютор' },
  };
  const electron = path.join(APP, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
  const args = [`--user-data-dir=${path.join(tmp, 'profile')}`, path.join(__dirname, 'tutor-harness.js')];
  if (process.platform === 'linux') args.unshift('--ozone-platform=headless');
  const run = spawnSync(electron, args, { env: { ...process.env, REDTEAM_CONFIG: JSON.stringify(cfg) }, timeout: 120000, encoding: 'utf8' });
  console.log(fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : `Снимков нет, код ${run.status}\n${run.stderr}`);
  fs.rmSync(tmp, { recursive: true, force: true });
}
main();
