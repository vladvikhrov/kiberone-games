'use strict';
/* Формат .kibgames: чтение и проверка. Этот модуль используют и kibpack, и приложение,
   поэтому файл, прошедший kibpack verify, приложение примет по тем же правилам.
   Файл считается недоверенным: он мог прийти откуда угодно. */
const crypto = require('crypto');
const fs = require('fs');
const yauzl = require('yauzl');

const LIMITS = {
  fileBytes: 250 * 1024 * 1024,
  totalBytes: 200 * 1024 * 1024,
  entries: 5000,
  manifestBytes: 2 * 1024 * 1024,
  coverBytes: 512 * 1024,
  modes: 12,
};

const MIME = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  json: 'application/json', txt: 'text/plain; charset=utf-8',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', ico: 'image/x-icon',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
};

class PackageError extends Error {}
const fail = (message) => { throw new PackageError(message); };

const extensionOf = (path) => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
};

/* Безопасный путь внутри архива, на любой ОС. Запрещены выход из папки, абсолютные пути,
   имена, которые Windows трактует особо (NTFS-потоки через «:», CON, NUL, точка в конце). */
function checkPath(path) {
  const bad = () => fail(`Недопустимый путь в архиве: ${JSON.stringify(path)}`);
  if (typeof path !== 'string' || !path || path.length > 400) bad();
  if (path.normalize('NFC') !== path) bad();
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\\:*?"<>|]/.test(path)) bad();
  for (const part of path.split('/')) {
    if (!part || part === '.' || part === '..' || /[. ]$/.test(part)) bad();
    if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part)) bad();
  }
  return path;
}

function checkArchivedName(path) {
  checkPath(path);
  if (path === 'manifest.json' || path === 'manifest.sig' || path === 'icon.png') return;
  if (!path.startsWith('game/')) fail(`Лишний файл вне папки game/: ${path}`);
  if (!MIME[extensionOf(path)]) fail(`Файлы такого типа в игре запрещены: ${path}`);
}

const SEMVER = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
const FIELDS = ['format', 'id', 'version', 'title', 'description', 'authors', 'grades', 'minutes', 'topic',
  'entry', 'minAppVersion', 'publicKey', 'files', 'cover', 'modes'];
const MODE_FIELDS = ['id', 'title', 'about', 'entry', 'cover'];
const MODE_ID = /^[a-z0-9-]{1,40}$/;
// Управляющие символы и смена направления текста позволяют подделать имя на экране
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/;
const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !UNSAFE_TEXT.test(v);

function checkManifest(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) fail('Манифест не является объектом');
  if (m.format !== 1) fail('Файл создан для другой версии формата. Обновите приложение');
  for (const key of Object.keys(m)) if (!FIELDS.includes(key)) fail(`Неизвестное поле манифеста: ${key}`);
  if (typeof m.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(m.id)) fail('Поле id: только латиница, цифры и дефис, до 40 знаков');
  if (typeof m.version !== 'string' || !SEMVER.test(m.version)) fail('Поле version: нужен вид 1.2.0');
  if (typeof m.minAppVersion !== 'string' || !SEMVER.test(m.minAppVersion)) fail('Поле minAppVersion: нужен вид 1.0.0');
  if (!text(m.title, 80)) fail('Поле title: нужно название до 80 знаков');
  if (!text(m.description, 300)) fail('Поле description: нужно описание до 300 знаков');
  if (!text(m.grades, 40)) fail('Поле grades: укажите класс, до 40 знаков');
  if (!text(m.topic, 80)) fail('Поле topic: укажите тему, до 80 знаков');
  if (!Number.isInteger(m.minutes) || m.minutes < 1 || m.minutes > 180) fail('Поле minutes: целое число от 1 до 180');
  if (!Array.isArray(m.authors) || m.authors.length < 1 || m.authors.length > 10 || !m.authors.every((a) => text(a, 80))) {
    fail('Поле authors: от 1 до 10 имён');
  }
  if (typeof m.publicKey !== 'string' || Buffer.from(m.publicKey, 'base64').length !== 32) fail('Поле publicKey: неверный ключ');
  if (!m.files || typeof m.files !== 'object' || Array.isArray(m.files)) fail('Поле files: нужен список файлов');
  for (const [path, hash] of Object.entries(m.files)) {
    checkArchivedName(path);
    if (path === 'manifest.json' || path === 'manifest.sig') fail('Манифест не может перечислять сам себя');
    if (typeof hash !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(hash)) fail(`Неверный хеш файла: ${path}`);
  }
  if (!isEntry(m.entry, m.files)) fail('Поле entry: нужна HTML-страница из папки game/');
  if (m.cover !== undefined) checkCoverPath(m.cover, m.files, 'Поле cover');
  if (m.modes !== undefined) checkModes(m.modes, m.files);
}

const listed = (files, path) => Object.prototype.hasOwnProperty.call(files, path);
const isEntry = (entry, files) => typeof entry === 'string' && entry.startsWith('game/') && /\.html?$/.test(entry) && listed(files, entry);

/* Обложка: картинка из подписанных файлов игры. Тип по байтам проверяет checkCovers, когда файлы прочитаны. */
function checkCoverPath(path, files, where) {
  if (typeof path !== 'string' || !path.startsWith('game/')) fail(`${where}: картинка должна лежать в папке game/`);
  checkPath(path);
  if (!['png', 'webp'].includes(extensionOf(path))) fail(`${where}: обложка только PNG или WebP`);
  if (!listed(files, path)) fail(`${where}: файла ${path} нет в игре`);
}

/* Режимы (ADR-0002, 3.6): только описание вариантов запуска, прав они не дают. */
function checkModes(modes, files) {
  if (!Array.isArray(modes) || modes.length < 1 || modes.length > LIMITS.modes) fail(`Поле modes: от 1 до ${LIMITS.modes} режимов`);
  const ids = new Set();
  modes.forEach((mode, index) => {
    const where = `Режим ${index + 1}`;
    if (!mode || typeof mode !== 'object' || Array.isArray(mode)) fail(`${where}: нужен объект`);
    for (const key of Object.keys(mode)) if (!MODE_FIELDS.includes(key)) fail(`${where}: неизвестное поле ${key}`);
    if (typeof mode.id !== 'string' || !MODE_ID.test(mode.id)) fail(`${where}: id только латиница, цифры и дефис, до 40 знаков`);
    if (ids.has(mode.id)) fail(`${where}: id «${mode.id}» уже есть`);
    ids.add(mode.id);
    if (!text(mode.title, 40)) fail(`${where}: нужно название до 40 знаков`);
    if (mode.about !== undefined && !text(mode.about, 120)) fail(`${where}: описание до 120 знаков`);
    if (mode.entry !== undefined && !isEntry(mode.entry, files)) fail(`${where}: entry должна быть HTML-страницей из папки game/`);
    if (mode.cover !== undefined) checkCoverPath(mode.cover, files, where);
  });
}

const coverPaths = (m) => [...new Set([m.cover, ...(m.modes || []).map((mode) => mode.cover)].filter(Boolean))];

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/* JPEG не берём: в нём часто координаты съёмки в EXIF. Расширение должно совпадать с содержимым. */
function checkCoverBytes(path, data) {
  if (!data) fail(`Не хватает обложки: ${path}`);
  if (data.length > LIMITS.coverBytes) fail(`Обложка больше 512 КБ: ${path}`);
  const png = data.length >= 8 && data.subarray(0, 8).equals(PNG_MAGIC);
  const webp = data.length >= 12 && data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP';
  if (extensionOf(path) === 'png' ? !png : !webp) fail(`Обложка не PNG или WebP либо расширение не совпадает с содержимым: ${path}`);
}

function checkCovers(manifest, files) {
  for (const path of coverPaths(manifest)) checkCoverBytes(path, files.get(path));
}

/* Режимы игры для запуска и витрины. Игра без modes имеет один режим default. */
function gameModes(m) {
  if (!m.modes) return [{ id: 'default', title: m.title, about: m.description, entry: m.entry, cover: m.cover || null }];
  return m.modes.map((mode) => ({
    id: mode.id, title: mode.title, about: mode.about || m.description, entry: mode.entry || m.entry, cover: mode.cover || m.cover || null,
  }));
}

/* Ключи: в файле лежат 32 байта Ed25519, Node принимает их в обёртке SPKI. */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const publicKeyFromRaw = (raw) => crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
const rawFromPublicKey = (key) => key.export({ format: 'der', type: 'spki' }).subarray(-32);
const keyId = (publicKeyBase64) => crypto.createHash('sha256')
  .update(Buffer.from(publicKeyBase64, 'base64')).digest('hex').slice(0, 16);
const sha256 = (data) => `sha256:${crypto.createHash('sha256').update(data).digest('hex')}`;

const openZip = (path) => new Promise((resolve, reject) => {
  yauzl.open(path, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true, decodeStrings: true },
    (err, zip) => (err ? reject(new PackageError(`Файл повреждён или это не игра: ${err.message}`)) : resolve(zip)));
});

/* Читает весь архив в память с жёсткими лимитами: фактически прочитанные байты считаем сами,
   заголовкам ZIP не верим. Так проверенное и запущенное содержимое не могут разойтись. */
function readEntries(zip) {
  return new Promise((resolve, reject) => {
    const files = new Map();
    const seen = new Set();
    let total = 0;
    const stop = (err) => { zip.close(); reject(err); };

    zip.on('error', (err) => reject(err instanceof PackageError ? err : new PackageError(`Файл повреждён: ${err.message}`)));
    zip.on('end', () => resolve(files));
    zip.on('entry', (entry) => {
      try {
        if (files.size >= LIMITS.entries) fail('В архиве слишком много файлов');
        const name = entry.fileName;
        if (name.endsWith('/')) fail(`Папки как отдельные записи запрещены: ${name}`);
        checkArchivedName(name);
        // Windows не различает регистр, поэтому Game.js и game.js считаем одним файлом
        const folded = name.toLowerCase();
        if (seen.has(folded)) fail(`Файл встречается дважды: ${name}`);
        seen.add(folded);
        if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) fail(`Символические ссылки запрещены: ${name}`);
        if (total + entry.uncompressedSize > LIMITS.totalBytes) fail('Игра слишком большая после распаковки');
      } catch (err) { stop(err); return; }

      zip.openReadStream(entry, (err, stream) => {
        if (err) { stop(new PackageError(`Не удалось прочитать ${entry.fileName}: ${err.message}`)); return; }
        const chunks = [];
        stream.on('data', (chunk) => {
          total += chunk.length;
          if (total > LIMITS.totalBytes) { stream.destroy(); stop(new PackageError('Игра слишком большая после распаковки')); return; }
          chunks.push(chunk);
        });
        stream.on('error', (e) => stop(new PackageError(`Файл повреждён: ${e.message}`)));
        stream.on('end', () => { files.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); });
      });
    });
    zip.readEntry();
  });
}

/* Открывает .kibgames. trustedKeys: { keyId: 'Имя, заданное школой' }.
   Возвращает проверенные манифест и файлы. Любое нарушение: PackageError с текстом для человека. */
async function readPackage(path, { trustedKeys = {} } = {}) {
  const stat = await fs.promises.stat(path).catch(() => fail('Файл не найден'));
  if (!stat.isFile()) fail('Это не файл');
  if (stat.size > LIMITS.fileBytes) fail('Файл игры слишком большой');

  const files = await readEntries(await openZip(path));
  const manifestBytes = files.get('manifest.json');
  const signature = files.get('manifest.sig');
  if (!manifestBytes) fail('В файле нет манифеста');
  if (!signature) fail('Игра не подписана автором');
  if (manifestBytes.length > LIMITS.manifestBytes) fail('Манифест слишком большой');

  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch { fail('Манифест повреждён'); }
  checkManifest(manifest);

  // Подпись проверяем до хешей: без неё содержимое манифеста ничего не значит
  const key = publicKeyFromRaw(Buffer.from(manifest.publicKey, 'base64'));
  if (!crypto.verify(null, manifestBytes, key, signature)) fail('Подпись не сходится: файл изменён после выпуска');

  const expected = Object.keys(manifest.files);
  for (const name of expected) {
    const data = files.get(name);
    if (!data) fail(`Не хватает файла: ${name}`);
    if (sha256(data) !== manifest.files[name]) fail(`Файл изменён после подписи: ${name}`);
  }
  for (const name of files.keys()) {
    if (name !== 'manifest.json' && name !== 'manifest.sig' && !manifest.files[name]) fail(`Лишний файл: ${name}`);
  }
  checkCovers(manifest, files);

  const id = keyId(manifest.publicKey);
  const trustedName = Object.prototype.hasOwnProperty.call(trustedKeys, id) ? trustedKeys[id] : null;
  return { manifest, files, trust: { keyId: id, trusted: trustedName !== null, name: trustedName } };
}

/* Подходит ли игра этой версии приложения. Версии уже проверены: вид 1.2.0. */
function supportsVersion(appVersion, minVersion) {
  const a = appVersion.split('.').map(Number);
  const b = minVersion.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

module.exports = {
  supportsVersion, LIMITS, MIME, PackageError, readPackage, checkManifest, checkPath, extensionOf,
  publicKeyFromRaw, rawFromPublicKey, keyId, sha256, checkCovers, coverPaths, gameModes,
};
