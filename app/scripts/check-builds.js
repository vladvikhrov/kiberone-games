#!/usr/bin/env node
'use strict';
/* Т14: в сборке ученика нет кода тьютора, в сборке тьютора он есть (контроль: те же поиски его находят).
   Запуск: npm run check:builds [-- --no-build]. Без --no-build сначала собирает обе программы папкой (--linux dir или --win dir).
   Проверяется список файлов app.asar и поиск строк в его содержимом. */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const APP = path.resolve(__dirname, '..');
const WIN = process.platform === 'win32';
const STUDENT = path.join(APP, 'dist', WIN ? 'win-unpacked' : 'linux-unpacked', 'resources', 'app.asar');
const TUTOR = path.join(APP, 'dist', 'tutor', WIN ? 'win-unpacked' : 'linux-unpacked', 'resources', 'app.asar');

/* Что выдаёт код тьютора: файлы и строки, которых в программе ученика быть не должно. */
const TUTOR_FILES = [/^desktop\/tutor\//, /school-key/, /catalog-sign/];
const TUTOR_STRINGS = ['kibtutor', 'school-key.enc', 'signCatalog', 'createSchoolKey'];

function build(args) {
  const bin = path.join(APP, 'node_modules', '.bin', WIN ? 'electron-builder.cmd' : 'electron-builder');
  const r = spawnSync(bin, args, { cwd: APP, stdio: 'inherit', shell: WIN });
  if (r.status !== 0) { console.error(`Сборка не удалась: electron-builder ${args.join(' ')}`); process.exit(1); }
}

function inspect(file) {
  if (!fs.existsSync(file)) { console.error(`Нет сборки: ${file}`); process.exit(1); }
  const list = asar.listPackage(file).map((p) => p.replace(/\\/g, '/').replace(/^\//, ''));
  const files = list.filter((p) => TUTOR_FILES.some((re) => re.test(p)));
  const strings = [];
  for (const p of list.filter((x) => /\.(js|json|html)$/.test(x))) {
    let text;
    try { text = asar.extractFile(file, p).toString('utf8'); } catch { continue; }
    for (const s of TUTOR_STRINGS) if (text.includes(s)) strings.push(`${p}: ${s}`);
  }
  return { total: list.length, files, strings, list };
}

if (!process.argv.includes('--no-build')) {
  const target = WIN ? ['--win', 'dir', '--x64', '-c.win.signAndEditExecutable=false'] : ['--linux', 'dir'];
  build(target);
  build(['-c', 'builder-tutor.json', ...target]);
}

const student = inspect(STUDENT);
const tutor = inspect(TUTOR);
const studentOk = student.files.length === 0 && student.strings.length === 0;
const tutorOk = tutor.files.length > 0 && tutor.strings.length > 0 && tutor.list.includes('desktop/tutor/main.js');
const main = JSON.parse(asar.extractFile(TUTOR, 'package.json').toString('utf8')).main;

console.log(`Сборка ученика: ${student.total} файлов в app.asar, кода тьютора: ${student.files.length ? student.files.join(', ') : 'нет'}, строк тьютора: ${student.strings.length ? student.strings.join('; ') : 'нет'}`);
console.log(`Сборка тьютора (контроль): ${tutor.total} файлов, файлов тьютора: ${tutor.files.length}, строк тьютора: ${tutor.strings.length}, вход: ${main}`);
console.log(`${studentOk && tutorOk && main === 'desktop/tutor/main.js' ? 'OK' : 'ПРОВАЛ'}  Т14  В сборке ученика нет кода тьютора, в сборке тьютора он есть`);
process.exit(studentOk && tutorOk ? 0 : 1);
