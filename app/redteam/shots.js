#!/usr/bin/env node
'use strict';
/* Снимки настоящих игр в песочнице, чтобы посмотреть на них глазами (критерий К1).
   Запуск: node redteam/shots.js <папка для снимков>. На экране ненадолго появятся окна игр. */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { keygen, pack } = require('../kibpack/pack');

async function main() {
  const shotDir = path.resolve(process.argv[2] || '.');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-'));
  const key = keygen('shots', path.join(tmp, 'keys')).keyPath;
  const app = path.resolve(__dirname, '..');
  const realGames = [];
  for (const name of ['kiberpochta', 'vzlomai-seif']) {
    realGames.push((await pack(path.join(app, '..', name), { key, out: path.join(tmp, `${name}.kibgames`) })).target);
  }
  const out = path.join(tmp, 'out.json');
  fs.mkdirSync(shotDir, { recursive: true });
  const run = spawnSync(path.join(app, 'node_modules/electron/dist/electron'), [`--user-data-dir=${path.join(tmp, 'profile')}`, path.join(__dirname, 'harness.js')], {
    env: { ...process.env, REDTEAM_CONFIG: JSON.stringify({ mode: 'screenshot', realGames, shotDir, out }) }, timeout: 60000,
  });
  console.log(fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : `Снимков нет, код ${run.status}\n${run.stderr}`);
  fs.rmSync(tmp, { recursive: true, force: true });
}
main();
