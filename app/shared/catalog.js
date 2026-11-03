'use strict';
/* Подписанный каталог школы (ADR-0002, 3.4; ADR-0003, 5.2) и файл школы school.kibschool (ADR-0002, 3.3).
   Здесь только проверка и схема: этот модуль войдёт в программу ученика. Подписывает каталог программа тьютора
   (desktop/tutor/catalog-sign.js), в сборку ученика тот файл не попадает. */
const crypto = require('crypto');
const { safeText, SEMVER, MODE_ID, keyId, publicKeyFromRaw } = require('./package-format');

const PREFIX = Buffer.from('kibcatalog-v1\n', 'utf8'); // подпись каталога не подойдёт ни к чему другому
const LIMITS = { catalogBytes: 2 * 1024 * 1024, games: 500, gameBytes: 250 * 1024 * 1024, coverBytes: 512 * 1024, iconBytes: 64 * 1024, schoolBytes: 4096 };

class CatalogError extends Error {}
const fail = (message) => { throw new CatalogError(message); };

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const ID = /^[a-z0-9-]{1,40}$/;
const HEX16 = /^[0-9a-f]{16}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/* Ровно эти поля, не больше и не меньше. Лишнее поле значит другую версию формата или подделку. */
function exactKeys(obj, keys, where) {
  if (!isObject(obj)) fail(`${where}: нужен объект`);
  for (const key of Object.keys(obj)) if (!keys.includes(key)) fail(`${where}: лишнее поле ${key}`);
  for (const key of keys) if (!own(obj, key)) fail(`${where}: нет поля ${key}`);
}

/* Строгий base64: Buffer.from прощает мусор, поэтому сверяем обратное кодирование. */
function strictBase64(value, where) {
  if (typeof value !== 'string' || !value) fail(`${where}: нужна строка base64`);
  const data = Buffer.from(value, 'base64');
  if (data.toString('base64') !== value) fail(`${where}: неверный base64`);
  return data;
}

const GAME_KEYS = ['id', 'version', 'title', 'description', 'grades', 'minutes', 'topic', 'author', 'authorKey', 'sha256', 'bytes',
  'icon', 'cover', 'publishedAt', 'lesson', 'prefetch', 'minAppVersion', 'modes'];
const MODE_KEYS = ['id', 'title', 'about', 'cover'];
const BLOB_KEYS = ['sha256', 'bytes'];
const PAYLOAD_KEYS = ['format', 'school', 'seq', 'games'];

function checkBlobRef(ref, max, where) {
  if (ref === null) return;
  exactKeys(ref, BLOB_KEYS, where);
  if (typeof ref.sha256 !== 'string' || !HEX64.test(ref.sha256)) fail(`${where}: неверный sha256`);
  if (!Number.isSafeInteger(ref.bytes) || ref.bytes < 1 || ref.bytes > max) fail(`${where}: неверный размер`);
}

function checkGame(g, index) {
  const where = `Игра ${index + 1}`;
  exactKeys(g, GAME_KEYS, where);
  if (typeof g.id !== 'string' || !ID.test(g.id)) fail(`${where}: неверный id`);
  if (typeof g.version !== 'string' || !SEMVER.test(g.version)) fail(`${where}: неверная версия`);
  if (typeof g.minAppVersion !== 'string' || !SEMVER.test(g.minAppVersion)) fail(`${where}: неверная minAppVersion`);
  if (!safeText(g.title, 80)) fail(`${where}: неверное название`);
  if (!safeText(g.description, 300)) fail(`${where}: неверное описание`);
  if (!safeText(g.grades, 40)) fail(`${where}: неверный класс`);
  if (!safeText(g.topic, 80)) fail(`${where}: неверная тема`);
  if (!Number.isInteger(g.minutes) || g.minutes < 1 || g.minutes > 180) fail(`${where}: неверное время`);
  if (g.author !== null && !safeText(g.author, 80)) fail(`${where}: неверное имя автора`);
  if (typeof g.authorKey !== 'string' || !HEX16.test(g.authorKey)) fail(`${where}: неверный отпечаток автора`);
  if (typeof g.sha256 !== 'string' || !HEX64.test(g.sha256)) fail(`${where}: неверный sha256`);
  if (!Number.isSafeInteger(g.bytes) || g.bytes < 1 || g.bytes > LIMITS.gameBytes) fail(`${where}: неверный размер`);
  checkBlobRef(g.icon, LIMITS.iconBytes, `${where}, значок`);
  checkBlobRef(g.cover, LIMITS.coverBytes, `${where}, обложка`);
  if (typeof g.publishedAt !== 'string' || !DAY.test(g.publishedAt)) fail(`${where}: неверная дата публикации`);
  if (typeof g.lesson !== 'boolean') fail(`${where}: lesson должно быть true или false`);
  if (typeof g.prefetch !== 'boolean') fail(`${where}: prefetch должно быть true или false`);
  if (!Array.isArray(g.modes) || g.modes.length < 1 || g.modes.length > 12) fail(`${where}: от 1 до 12 режимов`);
  const ids = new Set();
  g.modes.forEach((m, i) => {
    const at = `${where}, режим ${i + 1}`;
    exactKeys(m, MODE_KEYS, at);
    if (typeof m.id !== 'string' || !MODE_ID.test(m.id) || ids.has(m.id)) fail(`${at}: неверный или повторный id`);
    ids.add(m.id);
    if (!safeText(m.title, 80)) fail(`${at}: неверное название`);
    if (!safeText(m.about, 300)) fail(`${at}: неверное описание`);
    checkBlobRef(m.cover, LIMITS.coverBytes, `${at}, обложка`);
  });
}

/* Проверка содержимого каталога. Используют и подпись (до записи), и проверка (после чтения). */
function checkPayload(p) {
  exactKeys(p, PAYLOAD_KEYS, 'Каталог');
  if (p.format !== 1) fail('Каталог создан другой версией программы. Обновите программу');
  if (typeof p.school !== 'string' || !HEX16.test(p.school)) fail('Каталог: неверный отпечаток школы');
  if (!Number.isSafeInteger(p.seq) || p.seq < 1) fail('Каталог: неверный номер');
  if (!Array.isArray(p.games) || p.games.length > LIMITS.games) fail(`Каталог: не больше ${LIMITS.games} игр`);
  const ids = new Set();
  p.games.forEach((g, i) => {
    checkGame(g, i);
    if (ids.has(g.id)) fail(`Каталог: игра ${g.id} встречается дважды`);
    ids.add(g.id);
  });
  return p;
}

const signedBytes = (payloadBytes) => Buffer.concat([PREFIX, payloadBytes]);

/* seq растёт всегда: и при часах, отведённых назад, и при двух публикациях в одну секунду.
   Время в секундах нужно, чтобы школа, восстановленная из старой копии, не оказалась позади ноутбуков. */
function nextSeq(prev, nowMs) {
  const base = Number.isSafeInteger(prev) && prev > 0 ? prev : 0;
  return Math.max(base + 1, Math.floor(nowMs / 1000));
}

/* Проверяет файл catalog.json: { payload: base64, sig: base64 }.
   schoolKey: публичный ключ школы, 32 байта в base64. minSeq: сохранённый номер; принимается только больший.
   Возвращает содержимое каталога. Любое нарушение: CatalogError с текстом для человека. */
function verifyCatalog(data, { schoolKey, minSeq = 0 }) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  if (bytes.length > LIMITS.catalogBytes) fail('Каталог больше 2 МБ');
  let outer;
  try { outer = JSON.parse(bytes.toString('utf8')); } catch { fail('Каталог повреждён'); }
  exactKeys(outer, ['payload', 'sig'], 'Файл каталога');
  const payloadBytes = strictBase64(outer.payload, 'Каталог');
  const sig = strictBase64(outer.sig, 'Подпись каталога');
  if (sig.length !== 64) fail('Подпись каталога неверной длины');

  const key = publicKeyFromRaw(strictBase64(schoolKey, 'Ключ школы'));
  if (!crypto.verify(null, signedBytes(payloadBytes), key, sig)) fail('Каталог подписан не ключом этой школы или изменён после подписи');

  let payload;
  try { payload = JSON.parse(payloadBytes.toString('utf8')); } catch { fail('Каталог повреждён'); }
  checkPayload(payload);
  if (payload.school !== keyId(schoolKey)) fail('Каталог другой школы');
  if (payload.seq <= minSeq) fail('Каталог старее уже полученного');
  return payload;
}

/* ---------- Файл школы ---------- */

const SCHOOL_KEYS = ['format', 'name', 'publicKey', 'fingerprint'];

function makeSchoolFile({ name, publicKey }) {
  const school = { format: 1, name, publicKey, fingerprint: keyId(publicKey) };
  parseSchool(school);
  return `${JSON.stringify(school, null, 1)}\n`;
}

function parseSchool(s) {
  exactKeys(s, SCHOOL_KEYS, 'Файл школы');
  if (s.format !== 1) fail('Файл школы создан другой версией программы');
  if (!safeText(s.name, 80)) fail('Файл школы: неверное название');
  if (strictBase64(s.publicKey, 'Файл школы').length !== 32) fail('Файл школы: неверный ключ');
  if (s.fingerprint !== keyId(s.publicKey)) fail('Файл школы: отпечаток не совпадает с ключом');
  return s;
}

/* Читает school.kibschool. Секрета в файле нет, только публичный ключ. */
function parseSchoolFile(data) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  if (bytes.length > LIMITS.schoolBytes) fail('Файл школы слишком большой');
  let s;
  try { s = JSON.parse(bytes.toString('utf8').replace(/^﻿/, '')); } catch { fail('Файл школы повреждён'); }
  return parseSchool(s);
}

/* Отпечаток для глаз: 16 знаков группами по 4, чтобы тьютор сверял его вслух. */
const fingerprintText = (fp) => fp.match(/.{1,4}/g).join(' ');

module.exports = {
  PREFIX, LIMITS, CatalogError, checkPayload, signedBytes, nextSeq, verifyCatalog, makeSchoolFile, parseSchoolFile, fingerprintText,
};
