#!/usr/bin/env node
'use strict';
/* Этап М5, И1, И2, И13: проверка собранных программ для Windows и сбор установщиков в одну папку.
   Запуск после npm run build:win и npm run build:tutor-win (или build:win-dir и build:tutor-win-dir с ключом --dir):
     node scripts/check-installers.js [--dir]
   Проверяет у обеих программ:
   - Electron fuses в exe совпадают с настройками сборки (те же, что на М4);
   - в exe встроен свой значок: байты PNG 256 px из build/icon.ico (или build/tutor/icon.ico) есть в ресурсах exe.
     На Linux без Wine значок не встраивается (signAndEditExecutable=false), поэтому с --dir эта проверка пропускается;
   - (без --dir) установщики есть; они копируются в dist/installers/ вместе с SHA256SUMS.txt. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');

const APP = path.resolve(__dirname, '..');
const DIR_ONLY = process.argv.includes('--dir');
const pkg = require('../package.json');
const tutorCfg = require('../builder-tutor.json');
const version = pkg.version;

const programs = [
  { name: 'ученик', exe: path.join(APP, 'dist', 'win-unpacked', 'kiberone-games.exe'), ico: path.join(APP, 'build', 'icon.ico'),
    fuses: pkg.build.electronFuses, setup: path.join(APP, 'dist', `KIBERone-Games-Setup-${version}.exe`) },
  { name: 'тьютор', exe: path.join(APP, 'dist', 'tutor', 'win-unpacked', 'kiberone-server.exe'), ico: path.join(APP, 'build', 'tutor', 'icon.ico'),
    fuses: tutorCfg.electronFuses, setup: path.join(APP, 'dist', 'tutor', `KIBERone-Server-Setup-${version}.exe`) },
];

const FUSE_NAMES = {
  runAsNode: 'RunAsNode', enableCookieEncryption: 'EnableCookieEncryption',
  enableNodeOptionsEnvironmentVariable: 'EnableNodeOptionsEnvironmentVariable', enableNodeCliInspectArguments: 'EnableNodeCliInspectArguments',
  enableEmbeddedAsarIntegrityValidation: 'EnableEmbeddedAsarIntegrityValidation', onlyLoadAppFromAsar: 'OnlyLoadAppFromAsar',
  loadBrowserProcessSpecificV8Snapshot: 'LoadBrowserProcessSpecificV8Snapshot', grantFileProtocolExtraPrivileges: 'GrantFileProtocolExtraPrivileges',
};

/* Самый большой образ из .ico (256 px, в нём PNG) */
function biggestIconBytes(file) {
  const b = fs.readFileSync(file);
  let best = null;
  for (let i = 0; i < b.readUInt16LE(4); i += 1) {
    const e = 6 + i * 16;
    const size = b[e] || 256;
    if (!best || size > best.size) best = { size, bytes: b.subarray(b.readUInt32LE(e + 12), b.readUInt32LE(e + 12) + b.readUInt32LE(e + 8)) };
  }
  return best.bytes;
}

async function main() {
  let ok = true;
  const sums = [];
  const fail = (msg) => { ok = false; console.log(`ПРОВАЛ  ${msg}`); };
  for (const p of programs) {
    if (!fs.existsSync(p.exe)) { fail(`${p.name}: нет ${path.relative(APP, p.exe)}`); continue; }
    const wire = await getCurrentFuseWire(p.exe);
    const bad = Object.entries(p.fuses).filter(([k, want]) => (wire[FuseV1Options[FUSE_NAMES[k]]] === 49) !== want).map(([k]) => k);
    if (bad.length) fail(`${p.name}: fuses не совпадают: ${bad.join(', ')}`);
    else console.log(`OK  ${p.name}: fuses как в настройках (${Object.keys(p.fuses).length})`);

    if (DIR_ONLY) console.log(`--  ${p.name}: значок в exe не проверяется (сборка папкой без правки exe)`);
    else if (fs.readFileSync(p.exe).includes(biggestIconBytes(p.ico))) console.log(`OK  ${p.name}: значок ${path.relative(APP, p.ico)} встроен в exe`);
    else fail(`${p.name}: в exe нет значка ${path.relative(APP, p.ico)}`);

    if (!DIR_ONLY) {
      if (!fs.existsSync(p.setup)) { fail(`${p.name}: нет установщика ${path.relative(APP, p.setup)}`); continue; }
      const out = path.join(APP, 'dist', 'installers');
      fs.mkdirSync(out, { recursive: true });
      fs.copyFileSync(p.setup, path.join(out, path.basename(p.setup)));
      const hash = crypto.createHash('sha256').update(fs.readFileSync(p.setup)).digest('hex');
      sums.push(`${hash}  ${path.basename(p.setup)}`);
      console.log(`OK  ${p.name}: ${path.basename(p.setup)}, ${(fs.statSync(p.setup).size / 1048576).toFixed(1)} МБ, SHA-256 ${hash}`);
    }
  }
  if (sums.length) fs.writeFileSync(path.join(APP, 'dist', 'installers', 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
  console.log(ok ? 'OK  И1, И2, И13: программы для Windows проверены' : 'ПРОВАЛ');
  process.exit(ok ? 0 : 1);
}
main().catch((err) => { console.error(err); process.exit(1); });
