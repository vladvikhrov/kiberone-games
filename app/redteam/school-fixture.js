'use strict';
/* Школа для тестов этапа М2: настоящий ключ школы, настоящая публикация и подписанный каталог программы тьютора.
   Используют модульные тесты и тест-«взломщик». Только Node, без Electron. */
const fs = require('fs');
const path = require('path');
const { createSchoolKey } = require('../desktop/tutor/school-key');
const { createLibrary } = require('../desktop/tutor/library');
const { parseSchoolFile } = require('../shared/catalog');

const FAST = { N: 2 ** 10, r: 8, p: 1 };
const PASSWORD = 'длинный-пароль-1';

/* dir: папка данных тьютора. games: пути к .kibgames. trust: { отпечаток: имя } — список доверия школы.
   Игры неизвестных авторов публикуются с подтверждением и author: null. */
async function makeSchool(dir, { games = [], trust = {}, name = 'Тестовая школа', now = () => Date.now(), appVersion = '1.1.0' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const key = createSchoolKey(dir, { kdf: FAST, now });
  if (!key.exists()) await key.create({ name, password: PASSWORD, again: PASSWORD });
  else await key.unlock(PASSWORD);
  if (Object.keys(trust).length) fs.writeFileSync(path.join(dir, 'trusted-keys.json'), JSON.stringify(trust));
  const lib = createLibrary(dir, { key, now, appVersion });
  lib.load();
  for (const file of games) {
    const a = await lib.inspect(file);
    await lib.publish(a.token, { confirmUnknown: true, confirmReplace: true, trustName: '' });
  }
  const schoolText = key.schoolFileText();
  return { key, lib, schoolText, school: parseSchoolFile(schoolText), dir };
}

module.exports = { makeSchool, FAST, PASSWORD };
