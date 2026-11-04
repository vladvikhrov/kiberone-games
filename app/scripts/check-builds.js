#!/usr/bin/env node
'use strict';
/* Т14, К19: в сборке ученика нет кода тьютора и сервера, в сборке тьютора он есть (контроль: те же поиски его находят).
   Плюс в обеих сборках нет стенда теста-«взломщика» и его режимов без защиты (постановка М2).
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
const TUTOR_FILES = [/^desktop\/tutor\//, /school-key/, /catalog-sign/, /tutor\/server/, /tutor\/votes/];
// М3: слоты, ведро токенов и «Скачать быстрее» — тоже только у тьютора
const TUTOR_STRINGS = ['kibtutor', 'school-key.enc', 'signCatalog', 'createSchoolKey', 'createServer', 'powerSaveBlocker', 'server.start',
  'createBucket', 'Retry-After', 'server.fast', 'setFast',
  'createVotes', 'createHmac', 'ratings.saveSnapshot']; // М4: голоса принимает только сервер тьютора
/* Стенд и его отключение защиты живут только в redteam/: в сборках этих файлов и строк быть не должно. */
const HARNESS_FILES = [/^redteam\//, /harness/];
const HARNESS_STRINGS = ['disableProtection', 'net-control', 'REDTEAM_CONFIG', 'vitrina-control', 'tutor-control',
  'LOAD_CONFIG', 'net-priority', 'BIG_GAME', // стенд М3: нагрузка, приоритет, замер большой игры
  'votesControl', 'VOTE_CONFIG', 'net-vote', 'votes-journal']; // стенд М4: голоса без защиты, скрипт ученика

function build(args) {
  const bin = path.join(APP, 'node_modules', '.bin', WIN ? 'electron-builder.cmd' : 'electron-builder');
  const r = spawnSync(bin, args, { cwd: APP, stdio: 'inherit', shell: WIN });
  if (r.status !== 0) { console.error(`Сборка не удалась: electron-builder ${args.join(' ')}`); process.exit(1); }
}

function inspect(file) {
  if (!fs.existsSync(file)) { console.error(`Нет сборки: ${file}`); process.exit(1); }
  const list = asar.listPackage(file).map((p) => p.replace(/\\/g, '/').replace(/^\//, ''));
  const files = list.filter((p) => TUTOR_FILES.some((re) => re.test(p)));
  const harness = list.filter((p) => HARNESS_FILES.some((re) => re.test(p)));
  const strings = [];
  const harnessStrings = [];
  for (const p of list.filter((x) => /\.(js|json|html)$/.test(x))) {
    let text;
    try { text = asar.extractFile(file, p).toString('utf8'); } catch { continue; }
    for (const s of TUTOR_STRINGS) if (text.includes(s)) strings.push(`${p}: ${s}`);
    for (const s of HARNESS_STRINGS) if (text.includes(s)) harnessStrings.push(`${p}: ${s}`);
  }
  return { total: list.length, files, strings, harness, harnessStrings, list };
}

if (!process.argv.includes('--no-build')) {
  const target = WIN ? ['--win', 'dir', '--x64', '-c.win.signAndEditExecutable=false'] : ['--linux', 'dir'];
  build(target);
  build(['-c', 'builder-tutor.json', ...target]);
}

const student = inspect(STUDENT);
const tutor = inspect(TUTOR);
const studentOk = student.files.length === 0 && student.strings.length === 0;
const harnessOk = [student, tutor].every((b) => b.harness.length === 0 && b.harnessStrings.length === 0);
const netOk = student.list.includes('desktop/school-net.js') && tutor.list.includes('desktop/tutor/server.js');
const tutorOk = tutor.files.length > 0 && tutor.strings.length > 0 && tutor.list.includes('desktop/tutor/main.js');
const main = JSON.parse(asar.extractFile(TUTOR, 'package.json').toString('utf8')).main;

console.log(`Сборка ученика: ${student.total} файлов в app.asar, кода тьютора: ${student.files.length ? student.files.join(', ') : 'нет'}, строк тьютора: ${student.strings.length ? student.strings.join('; ') : 'нет'}`);
console.log(`Сборка тьютора (контроль): ${tutor.total} файлов, файлов тьютора: ${tutor.files.length}, строк тьютора: ${tutor.strings.length}, вход: ${main}`);
console.log(`Стенд теста-«взломщика» в сборках: ${harnessOk ? 'нет' : [...student.harness, ...student.harnessStrings, ...tutor.harness, ...tutor.harnessStrings].join('; ')}`);
console.log(`${studentOk && tutorOk && main === 'desktop/tutor/main.js' ? 'OK' : 'ПРОВАЛ'}  Т14  В сборке ученика нет кода тьютора, в сборке тьютора он есть`);
console.log(`${studentOk && tutorOk && harnessOk && netOk ? 'OK' : 'ПРОВАЛ'}  К19  В сборке ученика нет сервера и подписи, сетевой модуль ученика на месте; переключателей защиты стенда нет ни в одной сборке`);
process.exit(studentOk && tutorOk && harnessOk && netOk ? 0 : 1);
