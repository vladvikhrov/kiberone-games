'use strict';
/* Игры школы на ноутбуке тьютора (ADR-0002, 2.2; ADR-0003, 5.2). Список игр — это последний подписанный catalog.json,
   отдельного файла нет. Файлы игр и обложки лежат в blobs/<sha256>, без расширения: так их будет раздавать сервер на М2.
   Черновиков нет (решение Влада): выбранный файл ждёт решения тьютора во временном blobs/.incoming-…, а «Опубликовать»
   сразу добавляет игру в каталог. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readPackage, gameModes, supportsVersion, checkCoverBytes, safeText, PackageError, coverPaths } = require('../../shared/package-format');
const { verifyCatalog, nextSeq, LIMITS: CATALOG_LIMITS } = require('../../shared/catalog');
const { localDay } = require('../../shared/ratings');
const { signCatalog } = require('./catalog-sign');
const { writeAtomic, readText } = require('./fsutil');

const CATALOG_FILE = 'catalog.json';
const TRUST_FILE = 'trusted-keys.json';
const INCOMING = '.incoming-';
const HEX64 = /^[0-9a-f]{64}$/;
const TOKEN = /^[0-9a-f]{32}$/;

class LibraryError extends Error {}
const fail = (message) => { throw new LibraryError(message); };
const hexOf = (data) => crypto.createHash('sha256').update(data).digest('hex');

/* Сравнение версий вида 1.2.0: -1, 0, 1. */
function compareVersions(a, b) {
  if (a === b) return 0;
  return supportsVersion(a, b) ? 1 : -1;
}

/* dir: папка данных. key: результат createSchoolKey. appVersion: версия программы ученика, под которую публикуем. */
function createLibrary(dir, { key, now = () => Date.now(), appVersion, log = () => {} }) {
  const blobsDir = path.join(dir, 'blobs');
  fs.mkdirSync(blobsDir, { recursive: true });
  const catalogPath = path.join(dir, CATALOG_FILE);
  const trustPath = path.join(dir, TRUST_FILE);
  const pending = new Map(); // token -> { tmp, pkg, sha, bytes, analysis }

  let games = [];
  let seq = 0;
  let catalogError = null;
  let keepBlobs = false; // каталог на диске не прочитался: файлы прежних игр не удаляем, их ещё можно опубликовать снова
  let queue = Promise.resolve();
  const serial = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };

  /* ---- Каталог с диска: проверяется ключом школы, как его проверит ученик ---- */
  function load() {
    games = [];
    seq = 0;
    catalogError = null;
    const text = readText(catalogPath);
    if (text !== null && key.exists()) {
      try {
        const payload = verifyCatalog(text, { schoolKey: key.publicKey(), minSeq: 0 });
        games = payload.games;
        seq = payload.seq;
      } catch (err) {
        catalogError = `Каталог на диске не прошёл проверку: ${err.message}. Следующая публикация создаст его заново, файлы прежних игр остаются в папке blobs`;
        keepBlobs = true;
        log('catalog-error', err.message);
      }
    }
    // Остатки незаконченных добавлений после прошлого запуска
    for (const name of fs.readdirSync(blobsDir)) if (name.startsWith(INCOMING)) fs.rmSync(path.join(blobsDir, name), { force: true });
    return { games, catalogError };
  }

  /* ---- Список доверия школы: { отпечаток ключа автора: имя } ---- */
  function trustedKeys() {
    const text = readText(trustPath);
    if (text === null) return {};
    try {
      const list = JSON.parse(text);
      if (list && typeof list === 'object' && !Array.isArray(list)) {
        return Object.fromEntries(Object.entries(list).filter(([id, name]) => /^[0-9a-f]{16}$/.test(id) && safeText(name, 80)));
      }
    } catch { /* ниже */ }
    log('trust-error', 'trusted-keys.json не читается');
    return {};
  }
  function addTrusted(id, name) {
    const list = trustedKeys();
    list[id] = name;
    writeAtomic(trustPath, `${JSON.stringify(list, null, 1)}\n`);
  }

  /* ---- Блобы ---- */
  const blobPath = (hex) => {
    if (typeof hex !== 'string' || !HEX64.test(hex)) fail('Неверный хеш');
    return path.join(blobsDir, hex);
  };
  function putBlob(data) {
    const hex = hexOf(data);
    const target = blobPath(hex);
    if (!fs.existsSync(target)) writeAtomic(target, data);
    return { sha256: hex, bytes: data.length };
  }
  /* Читает блоб и сверяет хеш: файл на диске мог испортиться или его могли подменить. */
  function readBlob(hex) {
    let data;
    try { data = fs.readFileSync(blobPath(hex)); } catch { return null; }
    return hexOf(data) === hex ? data : null;
  }
  function referenced() {
    const set = new Set();
    for (const g of games) {
      set.add(g.sha256);
      if (g.icon) set.add(g.icon.sha256);
      if (g.cover) set.add(g.cover.sha256);
      for (const m of g.modes) if (m.cover) set.add(m.cover.sha256);
    }
    return set;
  }
  /* Блоб, на который не ссылается ни одна игра, удаляется. Ожидающие решения файлы не трогаем. */
  function collectGarbage() {
    const removed = [];
    if (keepBlobs) return removed;
    const keep = referenced();
    for (const name of fs.readdirSync(blobsDir)) {
      if (name.startsWith(INCOMING) || name.startsWith('.')) continue;
      if (!keep.has(name)) { fs.rmSync(path.join(blobsDir, name), { force: true }); removed.push(name); }
    }
    return removed;
  }

  /* ---- Новый каталог: следующий seq, подпись, запись ---- */
  function commit(nextGames) {
    const payload = { format: 1, school: key.info().fingerprint, seq: nextSeq(seq, now()), games: nextGames };
    const text = signCatalog(payload, key.sign); // при закрытом ключе бросит ошибку до записи
    if (Buffer.byteLength(text) > CATALOG_LIMITS.catalogBytes) fail('Каталог получился больше 2 МБ');
    writeAtomic(catalogPath, text);
    games = nextGames;
    seq = payload.seq;
    catalogError = null;
    collectGarbage();
    return payload;
  }

  const requireUnlocked = () => { if (!key.unlocked()) fail('Ключ школы закрыт. Войдите по паролю'); };

  /* ---- Добавление файла: копия, проверка, решение тьютора ---- */

  /* Копирует выбранный файл к себе и проверяет уже копию: так проверенные и опубликованные байты совпадают,
     даже если исходный файл на флешке поменяют. Возвращает описание для окна проверки. */
  function inspect(srcPath) {
    return serial(async () => {
      requireUnlocked();
      const token = crypto.randomBytes(16).toString('hex');
      const tmp = path.join(blobsDir, `${INCOMING}${token}`);
      let data;
      try {
        const stat = await fs.promises.stat(srcPath);
        if (!stat.isFile() || stat.size > CATALOG_LIMITS.gameBytes) fail('Файл игры слишком большой или это не файл');
        data = await fs.promises.readFile(srcPath);
      } catch (err) {
        if (err instanceof LibraryError) throw err;
        log('read-error', err.message);
        fail('Файл не удалось прочитать');
      }
      await fs.promises.writeFile(tmp, data);
      let pkg;
      try {
        pkg = await readPackage(tmp, { trustedKeys: trustedKeys() });
      } catch (err) {
        fs.rmSync(tmp, { force: true });
        if (err instanceof PackageError && err.detail) log('package-error', err.detail);
        throw err;
      }
      const sha = hexOf(data);
      const m = pkg.manifest;
      const existing = games.find((g) => g.id === m.id) || null;
      const replace = !!existing && existing.authorKey !== pkg.trust.keyId;
      if (existing && !replace && compareVersions(m.version, existing.version) <= 0) {
        fs.rmSync(tmp, { force: true });
        fail(`В каталоге уже версия ${existing.version}. Опубликовать можно только более новую версию этой игры`);
      }
      const icon = iconOf(pkg);
      const covers = new Map(coverPaths(m).map((p) => [hexOf(pkg.files.get(p)), pkg.files.get(p)]));
      const coverHex = (p) => (p ? hexOf(pkg.files.get(p)) : null);
      const warnings = [];
      if (!pkg.trust.trusted) warnings.push('unknown');
      if (replace) warnings.push('replace');
      if (appVersion && !supportsVersion(appVersion, m.minAppVersion)) warnings.push('app-version');
      if (pkg.files.has('icon.png') && !icon) warnings.push('icon');
      const analysis = {
        token, id: m.id, version: m.version, title: m.title, description: m.description, grades: m.grades, minutes: m.minutes,
        topic: m.topic, claimedAuthors: m.authors, authorKey: pkg.trust.keyId, trustedName: pkg.trust.name,
        unknownAuthor: !pkg.trust.trusted, replace, replaced: existing ? { version: existing.version, author: existing.author, authorKey: existing.authorKey } : null,
        update: !!existing && !replace, minAppVersion: m.minAppVersion, warnings, bytes: data.length, sha256: sha,
        cover: coverHex(m.cover), modes: gameModes(m).map((x) => ({ id: x.id, title: x.title, cover: coverHex(x.cover) })),
      };
      pending.set(token, { tmp, pkg, sha, bytes: data.length, analysis, icon, covers });
      return analysis;
    });
  }

  /* Значок icon.png из корня архива: PNG до 64 КБ, иначе без значка. */
  function iconOf(pkg) {
    const data = pkg.files.get('icon.png');
    if (!data || !pkg.manifest.files['icon.png'] || data.length > CATALOG_LIMITS.iconBytes) return null;
    try { checkCoverBytes('icon.png', data); } catch { return null; }
    return data;
  }

  function takePending(token) {
    if (typeof token !== 'string' || !TOKEN.test(token) || !pending.has(token)) fail('Этот файл уже не ждёт решения. Выберите его снова');
    return pending.get(token);
  }

  /* Решение тьютора. confirmUnknown: публикую игру неизвестного автора. confirmReplace: заменяю игру с тем же id другого автора.
     trustName: внести автора в список доверия школы под этим именем (только для неизвестного автора). */
  function publish(token, { confirmUnknown = false, confirmReplace = false, trustName = '' } = {}) {
    return serial(async () => {
      requireUnlocked();
      const item = takePending(token);
      const { pkg, analysis } = item;
      const m = pkg.manifest;
      if (analysis.unknownAuthor && confirmUnknown !== true) fail('Автор неизвестен школе: подтвердите публикацию отдельно');
      if (analysis.replace && confirmReplace !== true) fail('Игра с таким id уже есть у другого автора: подтвердите замену отдельно');
      if (trustName && !analysis.unknownAuthor) fail('Автор уже есть в списке доверия школы');
      if (trustName && !safeText(trustName, 80)) fail('Имя автора для списка доверия: от 1 до 80 знаков');
      // Каталог мог измениться, пока окно проверки было открыто
      const existing = games.find((g) => g.id === m.id) || null;
      if (existing && existing.authorKey === pkg.trust.keyId && compareVersions(m.version, existing.version) <= 0) {
        fail(`В каталоге уже версия ${existing.version}. Опубликовать можно только более новую версию этой игры`);
      }
      if (existing && existing.authorKey !== pkg.trust.keyId && confirmReplace !== true) fail('Игра с таким id уже есть у другого автора: подтвердите замену отдельно');

      // Обложки берутся из уже проверенных байтов и не перекодируются (ADR-0003, 5.2)
      const coverRef = (p) => (p ? putBlob(pkg.files.get(p)) : null);
      const iconRef = item.icon ? putBlob(item.icon) : null;
      const name = trustName ? trustName.trim() : pkg.trust.name;
      const sameAuthor = existing && existing.authorKey === pkg.trust.keyId;
      const record = {
        id: m.id, version: m.version, title: m.title, description: m.description, grades: m.grades, minutes: m.minutes, topic: m.topic,
        author: name || null, authorKey: pkg.trust.keyId, sha256: item.sha, bytes: item.bytes,
        icon: iconRef, cover: coverRef(m.cover),
        publishedAt: sameAuthor ? existing.publishedAt : localDay(new Date(now())),
        lesson: sameAuthor ? existing.lesson : false,
        prefetch: true, minAppVersion: m.minAppVersion,
        modes: gameModes(m).map((x) => ({ id: x.id, title: x.title, about: x.about, cover: coverRef(x.cover) })),
      };
      const target = blobPath(item.sha);
      if (!fs.existsSync(target)) fs.renameSync(item.tmp, target);
      else fs.rmSync(item.tmp, { force: true });
      pending.delete(token);
      const nextGames = [...games.filter((g) => g.id !== m.id), record].sort((a, b) => a.title.localeCompare(b.title, 'ru'));
      commit(nextGames);
      if (trustName) addTrusted(pkg.trust.keyId, trustName.trim());
      return record;
    });
  }

  function cancel(token) {
    if (typeof token !== 'string' || !TOKEN.test(token)) return false;
    const item = pending.get(token);
    if (!item) return false;
    fs.rmSync(item.tmp, { force: true });
    pending.delete(token);
    return true;
  }

  const findGame = (id) => games.find((g) => g.id === id) || fail('Такой игры нет в каталоге');

  function unpublish(id) {
    return serial(async () => {
      requireUnlocked();
      findGame(id);
      commit(games.filter((g) => g.id !== id));
      return true;
    });
  }

  function setLesson(id, value) {
    return serial(async () => {
      requireUnlocked();
      if (typeof value !== 'boolean') fail('Отметка занятия: true или false');
      const game = findGame(id);
      if (game.lesson === value) return game;
      commit(games.map((g) => (g.id === id ? { ...g, lesson: value } : g)));
      return findGame(id);
    });
  }

  /* Пакет для пробного запуска: из ожидающих решения или из каталога, всегда заново через readPackage. */
  async function packageFor(kind, value) {
    if (kind === 'pending') return readPackage(takePending(value).tmp, { trustedKeys: trustedKeys() });
    const game = findGame(value);
    const pkg = await readPackage(blobPath(game.sha256), { trustedKeys: trustedKeys() });
    if (pkg.manifest.id !== game.id || pkg.trust.keyId !== game.authorKey || hexOf(fs.readFileSync(blobPath(game.sha256))) !== game.sha256) {
      fail('Файл игры на диске не совпадает с каталогом');
    }
    return pkg;
  }

  /* Обложка для окна тьютора: из файла, ждущего решения, или из каталога. Других блобов окно не получает. */
  function coverData(hex) {
    for (const item of pending.values()) if (item.covers.has(hex)) return item.covers.get(hex);
    const refs = new Set();
    for (const g of games) {
      if (g.cover) refs.add(g.cover.sha256);
      for (const m of g.modes) if (m.cover) refs.add(m.cover.sha256);
    }
    return refs.has(hex) ? readBlob(hex) : null;
  }

  function cancelAll() { for (const token of [...pending.keys()]) cancel(token); }

  load();
  return {
    load, games: () => games, seq: () => seq, catalogError: () => catalogError, catalogPath, blobsDir,
    trustedKeys, inspect, publish, cancel, cancelAll, coverData, unpublish, setLesson, readBlob, blobPath, packageFor, collectGarbage,
    pendingInfo: (token) => takePending(token).analysis,
  };
}

module.exports = { createLibrary, LibraryError, compareVersions, CATALOG_FILE, TRUST_FILE };
