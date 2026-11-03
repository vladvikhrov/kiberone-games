'use strict';
/* Ключ школы (ADR-0002, 3.2). На диске только school-key.enc: две зашифрованные копии закрытого ключа Ed25519,
   одна под паролем, вторая под кодом восстановления. AES-256-GCM, ключ шифрования из scrypt со своей солью у каждой копии.
   В памяти ключ живёт, пока панель открыта: через 10 минут без действий буфер затирается нулями. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { publicKeyFromRaw, rawFromPublicKey, keyId, safeText } = require('../../shared/package-format');
const { makeSchoolFile, parseSchoolFile } = require('../../shared/catalog');
const { writeAtomic, readText } = require('./fsutil');

const KEY_FILE = 'school-key.enc';
const SCHOOL_FILE = 'school.kibschool';
const LOGIN_FILE = 'login.json';
const KDF = Object.freeze({ N: 2 ** 17, r: 8, p: 1 }); // ADR-0002, 3.2. Около 128 МБ памяти и доли секунды на попытку
const IDLE_MS = 10 * 60 * 1000;
const MAX_DELAY_S = 60;
const MIN_PASSWORD = 10;
const MAX_PASSWORD = 200;

/* code: 'weak' | 'mismatch' | 'wrong' | 'wait' | 'damaged' | 'exists' | 'none' | 'locked' | 'name' | 'code'. wait: секунды. */
class KeyError extends Error {
  constructor(message, code, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

/* ---------- Код восстановления: 128 бит, 26 знаков base32 Крокфорда (без I, L, O, U) ---------- */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeCode(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out; // 16 байт -> 26 знаков, в последнем знаке 2 младших бита нулевые
}

/* Читает код, как его перепишет человек: регистр, пробелы и дефисы не важны, O и 0, I/L и 1 не различаются. */
function decodeCode(text) {
  if (typeof text !== 'string' || text.length > 80) return null;
  const clean = text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (clean.length !== 26) return null;
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
    value &= (1 << bits) - 1;
  }
  if (value !== 0 || out.length !== 16) return null;
  return Buffer.from(out);
}

/* Для бумаги: пять групп, 5-5-5-5-6 знаков. */
const formatCode = (code) => [code.slice(0, 5), code.slice(5, 10), code.slice(10, 15), code.slice(15, 20), code.slice(20)].join('-');

/* ---------- Шифрование одной копии ---------- */

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const aad = (publicKey, slot) => Buffer.from(`kibschool-key-v1|${publicKey}|${slot}`, 'utf8');

function deriveKey(secret, salt, kdf) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(secret, salt, 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 160 * kdf.N * kdf.r + 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function sealCopy(seed, secret, publicKey, slot, kdf) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = await deriveKey(secret, salt, kdf);
  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad(publicKey, slot));
    const data = Buffer.concat([cipher.update(seed), cipher.final()]);
    return { salt: salt.toString('base64'), iv: iv.toString('base64'), data: data.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
  } finally { key.fill(0); }
}

/* Возвращает 32 байта ключа или null, если секрет не подошёл. */
async function openCopy(copy, secret, publicKey, slot, kdf) {
  const key = await deriveKey(secret, Buffer.from(copy.salt, 'base64'), kdf);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(copy.iv, 'base64'));
    decipher.setAAD(aad(publicKey, slot));
    decipher.setAuthTag(Buffer.from(copy.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(copy.data, 'base64')), decipher.final()]);
  } catch { return null; } finally { key.fill(0); }
}

/* ---------- Файл school-key.enc ---------- */

const COPY_KEYS = ['salt', 'iv', 'data', 'tag'];
const COPY_LENGTHS = { salt: 16, iv: 12, data: 32, tag: 16 };
const FILE_KEYS = ['format', 'kdf', 'publicKey', 'password', 'recovery', 'check'];

/* Контрольная сумма полей отличает случайно испорченный файл от неверного пароля. Злоумышленника она не остановит:
   он пересчитает её, но и тогда получит только «пароль не подошёл», а не ключ. */
const checksum = (f) => crypto.createHash('sha256')
  .update(JSON.stringify([f.format, f.kdf, f.publicKey, f.password, f.recovery])).digest('hex');

const damagedFile = () => new KeyError('Файл ключа школы повреждён. Восстановите школу из резервной копии', 'damaged');

function parseKeyFile(text) {
  let f;
  try { f = JSON.parse(text); } catch { throw damagedFile(); }
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const exact = (obj, keys) => isObj(obj) && Object.keys(obj).length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(obj, k));
  if (!exact(f, FILE_KEYS) || f.format !== 1 || typeof f.check !== 'string') throw damagedFile();
  if (!exact(f.kdf, ['N', 'r', 'p']) || f.kdf.r !== 8 || f.kdf.p !== 1 || !Number.isInteger(f.kdf.N)
    || f.kdf.N < 2 ** 10 || f.kdf.N > 2 ** 20 || (f.kdf.N & (f.kdf.N - 1)) !== 0) throw damagedFile();
  if (typeof f.publicKey !== 'string' || Buffer.from(f.publicKey, 'base64').length !== 32
    || Buffer.from(f.publicKey, 'base64').toString('base64') !== f.publicKey) throw damagedFile();
  for (const slot of ['password', 'recovery']) {
    const copy = f[slot];
    if (!exact(copy, COPY_KEYS)) throw damagedFile();
    for (const k of COPY_KEYS) {
      if (typeof copy[k] !== 'string') throw damagedFile();
      const b = Buffer.from(copy[k], 'base64');
      if (b.length !== COPY_LENGTHS[k] || b.toString('base64') !== copy[k]) throw damagedFile();
    }
  }
  if (checksum(f) !== f.check) throw damagedFile();
  return f;
}

const serializeKeyFile = (f) => {
  const full = { ...f, check: checksum(f) };
  return `${JSON.stringify(full, null, 1)}\n`;
};

/* ---------- Пароль ---------- */

function checkNewPassword(password, again) {
  if (typeof password !== 'string' || typeof again !== 'string') throw new KeyError('Введите пароль', 'weak');
  const length = [...password].length;
  if (length < MIN_PASSWORD) throw new KeyError(`Пароль слишком короткий: нужно не меньше ${MIN_PASSWORD} знаков`, 'weak');
  if (length > MAX_PASSWORD) throw new KeyError(`Пароль слишком длинный: не больше ${MAX_PASSWORD} знаков`, 'weak');
  if (password !== again) throw new KeyError('Пароли не совпадают', 'mismatch');
}

const delayFor = (failures) => (failures <= 0 ? 0 : Math.min(MAX_DELAY_S, 2 ** (failures - 1)));

/* ---------- Хранилище ---------- */

/* dir: папка данных программы тьютора. now: часы (в тестах поддельные). kdf: только для быстрых тестов. */
function createSchoolKey(dir, { now = () => Date.now(), kdf = KDF, idleMs = IDLE_MS, testHooks = false } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const keyPath = path.join(dir, KEY_FILE);
  const schoolPath = path.join(dir, SCHOOL_FILE);
  const loginPath = path.join(dir, LOGIN_FILE);

  let seed = null; // Buffer 32 байта, пока панель открыта
  let lastActivity = 0;
  let busy = false;

  /* ---- Счётчик ошибок входа: на диске, чтобы перезапуск программы его не сбрасывал ---- */
  function loginState() {
    const text = readText(loginPath);
    if (text === null) return { failures: 0, lastFailureAt: 0 };
    try {
      const s = JSON.parse(text);
      if (Number.isSafeInteger(s.failures) && s.failures >= 0 && Number.isSafeInteger(s.lastFailureAt)) return s;
    } catch { /* ниже */ }
    return { failures: 6, lastFailureAt: now() }; // испорченный счётчик не обнуляет задержку
  }
  const saveLogin = (s) => writeAtomic(loginPath, `${JSON.stringify(s)}\n`);
  function waitSeconds() {
    const s = loginState();
    const until = s.lastFailureAt + delayFor(s.failures) * 1000;
    return Math.max(0, Math.ceil((until - now()) / 1000));
  }
  function guard() {
    const wait = waitSeconds();
    if (wait > 0) throw new KeyError(`Подождите ${wait} с и попробуйте снова`, 'wait', { wait });
    if (busy) throw new KeyError('Проверка уже идёт, подождите', 'wait', { wait: 1 });
  }
  function failed(message) {
    const s = loginState();
    const next = { failures: s.failures + 1, lastFailureAt: now() };
    saveLogin(next);
    return new KeyError(message, 'wrong', { wait: delayFor(next.failures) });
  }

  /* ---- Файлы ---- */
  const exists = () => fs.existsSync(keyPath);
  function readFiles() {
    const text = readText(keyPath);
    if (text === null) throw new KeyError('Школа ещё не создана', 'none');
    const file = parseKeyFile(text);
    const schoolText = readText(schoolPath);
    if (schoolText === null) throw new KeyError('Нет файла school.kibschool. Восстановите школу из резервной копии', 'damaged');
    let school;
    try { school = parseSchoolFile(schoolText); } catch { throw new KeyError('Файл school.kibschool повреждён. Восстановите школу из резервной копии', 'damaged'); }
    if (school.publicKey !== file.publicKey) throw new KeyError('Файл школы и файл ключа от разных школ', 'damaged');
    return { file, school };
  }

  function info() {
    if (!exists()) return null;
    const { school } = readFiles();
    return { name: school.name, publicKey: school.publicKey, fingerprint: school.fingerprint };
  }

  /* ---- Открытый ключ в памяти ---- */
  function lock() {
    if (seed) seed.fill(0);
    seed = null;
  }
  function open(newSeed, publicKey) {
    // Расшифрованное должно давать тот же публичный ключ: иначе файл собран из частей разных школ
    const priv = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, newSeed]), format: 'der', type: 'pkcs8' });
    const pub = rawFromPublicKey(crypto.createPublicKey(priv)).toString('base64');
    if (pub !== publicKey) { newSeed.fill(0); throw damagedFile(); }
    lock();
    seed = newSeed;
    lastActivity = now();
  }
  /* Закрывает панель, если прошло 10 минут без действий. Возвращает true, если закрыла сейчас. */
  function checkIdle() {
    if (seed && now() - lastActivity >= idleMs) { lock(); return true; }
    return false;
  }
  const unlocked = () => { checkIdle(); return seed !== null; };
  const touch = () => { if (unlocked()) lastActivity = now(); };

  /* Подпись: единственное, что можно сделать ключом. Ключ не покидает модуль. */
  function sign(bytes) {
    if (!unlocked()) throw new KeyError('Ключ школы закрыт. Войдите по паролю', 'locked');
    lastActivity = now();
    const der = Buffer.concat([PKCS8_PREFIX, seed]);
    try {
      return crypto.sign(null, bytes, crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }));
    } finally { der.fill(0); }
  }

  async function withBusy(fn) {
    busy = true;
    try { return await fn(); } finally { busy = false; }
  }

  /* ---- Создание школы ---- */
  async function create({ name, password, again }) {
    if (exists()) throw new KeyError('Школа уже создана на этом ноутбуке', 'exists');
    if (!safeText(name, 80)) throw new KeyError('Название школы: от 1 до 80 знаков', 'name');
    checkNewPassword(password, again);
    return withBusy(async () => {
      const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
      const der = privateKey.export({ format: 'der', type: 'pkcs8' });
      const newSeed = Buffer.from(der.subarray(-32));
      der.fill(0);
      const pub = rawFromPublicKey(publicKey).toString('base64');
      const codeBytes = crypto.randomBytes(16);
      const code = encodeCode(codeBytes);
      try {
        const file = {
          format: 1, kdf: { ...kdf }, publicKey: pub,
          password: await sealCopy(newSeed, Buffer.from(password.normalize('NFC'), 'utf8'), pub, 'password', kdf),
          recovery: await sealCopy(newSeed, codeBytes, pub, 'recovery', kdf),
        };
        writeAtomic(schoolPath, makeSchoolFile({ name: name.trim(), publicKey: pub }));
        writeAtomic(keyPath, serializeKeyFile(file));
        saveLogin({ failures: 0, lastFailureAt: 0 });
      } finally { codeBytes.fill(0); }
      open(newSeed, pub);
      return { recoveryCode: formatCode(code), fingerprint: keyId(pub) };
    });
  }

  /* ---- Вход ---- */
  async function unlock(password) {
    if (typeof password !== 'string' || !password || password.length > 4 * MAX_PASSWORD) throw new KeyError('Введите пароль', 'weak');
    guard();
    const { file } = readFiles();
    return withBusy(async () => {
      const opened = await openCopy(file.password, Buffer.from(password.normalize('NFC'), 'utf8'), file.publicKey, 'password', file.kdf);
      if (!opened) throw failed('Пароль не подошёл');
      open(opened, file.publicKey);
      saveLogin({ failures: 0, lastFailureAt: 0 });
      return { ok: true };
    });
  }

  /* ---- Восстановление кодом: код открывает вторую копию, после чего задаётся новый пароль ---- */
  async function recover({ code, password, again }) {
    guard();
    checkNewPassword(password, again);
    const { file } = readFiles();
    const codeBytes = decodeCode(code);
    if (!codeBytes) throw failed('В коде ошибка: нужно 26 знаков, как на бумаге');
    return withBusy(async () => {
      try {
        const opened = await openCopy(file.recovery, codeBytes, file.publicKey, 'recovery', file.kdf);
        if (!opened) throw failed('Код не подошёл');
        try {
          const next = { ...file, password: await sealCopy(opened, Buffer.from(password.normalize('NFC'), 'utf8'), file.publicKey, 'password', file.kdf) };
          delete next.check;
          writeAtomic(keyPath, serializeKeyFile(next));
        } catch (err) { opened.fill(0); throw err; }
        open(opened, file.publicKey);
        saveLogin({ failures: 0, lastFailureAt: 0 });
        return { ok: true };
      } finally { codeBytes.fill(0); }
    });
  }

  /* ---- Резервная копия: папка с school-key.enc и school.kibschool. Ключ в ней тоже только зашифрован ---- */
  function backup(destDir, { day }) {
    if (!unlocked()) throw new KeyError('Ключ школы закрыт. Войдите по паролю', 'locked');
    readFiles(); // копируем только целые файлы
    let target = path.join(destDir, `kiberone-shkola-${day}`);
    for (let i = 2; fs.existsSync(target); i += 1) target = path.join(destDir, `kiberone-shkola-${day}-${i}`);
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(keyPath, path.join(target, KEY_FILE));
    fs.copyFileSync(schoolPath, path.join(target, SCHOOL_FILE));
    return target;
  }

  /* Восстановление школы на другом ноутбуке (второй тьютор). Вход после него — по паролю той копии. */
  function restore(srcDir) {
    if (exists()) throw new KeyError('Школа уже создана на этом ноутбуке', 'exists');
    const keyText = readText(path.join(srcDir, KEY_FILE));
    const schoolText = readText(path.join(srcDir, SCHOOL_FILE));
    if (keyText === null || schoolText === null) throw new KeyError(`В папке нет ${KEY_FILE} и ${SCHOOL_FILE}`, 'none');
    const file = parseKeyFile(keyText);
    let school;
    try { school = parseSchoolFile(schoolText); } catch { throw new KeyError('Файл school.kibschool в копии повреждён', 'damaged'); }
    if (school.publicKey !== file.publicKey) throw new KeyError('Файлы в копии от разных школ', 'damaged');
    writeAtomic(schoolPath, schoolText);
    writeAtomic(keyPath, keyText);
    saveLogin({ failures: 0, lastFailureAt: 0 });
    return { name: school.name, fingerprint: school.fingerprint };
  }

  const schoolFileText = () => { readFiles(); return readText(schoolPath); };
  const publicKey = () => readFiles().file.publicKey;

  const api = { exists, info, unlocked, lock, touch, checkIdle, sign, create, unlock, recover, backup, restore, waitSeconds, schoolFileText, publicKey };
  // Только модульные тесты (Т1, Т6): программа тьютора создаёт хранилище без testHooks
  if (testHooks) api.peekSeed = () => seed;
  return api;
}

module.exports = { createSchoolKey, KeyError, KDF, IDLE_MS, encodeCode, decodeCode, formatCode, delayFor, KEY_FILE, SCHOOL_FILE, LOGIN_FILE };
