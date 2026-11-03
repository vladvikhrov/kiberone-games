'use strict';
/* Каталог витрины на настроенном ноутбуке (постановка М2): подписанный каталог школы по сети и кеш по sha256.
   Сеть здесь только через school-net.js (переданный объект net), сам модуль сокетов не открывает.

   Что принимается: каталог, подписанный ключом из метки школы, с seq не меньше сохранённого (verifyCatalog);
   файл, чей sha256 и размер совпали с каталогом; игра, которую readPackage признал подписанной ключом автора из каталога.
   Данные: dir/catalog.json (последний принятый), dir/state.json (seq, адрес сервера), dir/cache/<sha256>. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const C = require('../../shared/catalog');

const { LIMITS } = C;
const { readPackage, supportsVersion } = require('../../shared/package-format');
const { groupsOf } = require('../../shared/groups');

const HEX64 = /^[0-9a-f]{64}$/;
const PART = '.part-';
const MAX_FAILURES = 3;
const LOG_LINES = 50;
const DEFAULTS = { pollMs: 60000, jitterMs: 15000, offlineMs: 10000, askAfterMs: 15000, discoverMs: 2000, resumeMinMs: 1000, resumeMaxMs: 5000 };

const hexOf = (data) => crypto.createHash('sha256').update(data).digest('hex');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function imageMime(data) {
  if (data.length >= 8 && data.subarray(0, 8).equals(PNG)) return 'image/png';
  if (data.length >= 12 && data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function writeAtomic(file, data) {
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, data); fs.renameSync(tmp, file); } finally { fs.rmSync(tmp, { force: true }); }
}
const readFile = (file) => { try { return fs.readFileSync(file); } catch { return null; } };

/* Проверки того, что пришло по сети или лежит в кеше. Объект модуля, а не параметр: настоящая программа их не меняет,
   а контрольный прогон теста-«взломщика» подменяет их из redteam/, чтобы доказать, что без них подделка проходит. */
const checks = {
  /* Подпись школы, префикс, строгая схема, размер (shared/catalog.js). Номер сравнивается отдельно. */
  catalog: (bytes, school) => C.verifyCatalog(bytes, { schoolKey: school.publicKey, minSeq: 0 }),
  hash: (data, hex) => hexOf(data) === hex,
  /* Файл совпал с каталогом по sha256 и размеру. */
  blob(data, item) {
    if (data.length !== item.bytes || !checks.hash(data, item.sha256)) throw new Error(`хеш или размер не совпали с каталогом (${data.length} байт)`);
  },
  /* Игра подписана ключом автора из каталога, и это та самая игра и версия. */
  async game(data, g) {
    const pkg = await readPackage(data, { trustedKeys: { [g.authorKey]: g.author || 'тьютор' } });
    const m = pkg.manifest;
    if (m.id !== g.id || m.version !== g.version || pkg.trust.keyId !== g.authorKey) {
      throw new Error(`в файле игра ${m.id} ${m.version} ключа ${pkg.trust.keyId}, в каталоге ${g.id} ${g.version} ключа ${g.authorKey}`);
    }
    return pkg;
  },
};

/* school: результат parseSchoolFile. net: createSchoolNet. appVersion: версия программы. now, random, options: тесты. */
function createNetSource({ school, net, dir, appVersion, now = () => Date.now(), random = Math.random, options = {}, onChange = () => {} }) {
  const opt = { ...DEFAULTS, ...options };
  const cacheDir = path.join(dir, 'cache');
  const catalogPath = path.join(dir, 'catalog.json');
  const statePath = path.join(dir, 'state.json');
  fs.mkdirSync(cacheDir, { recursive: true });

  let payload = null; // принятый каталог
  let seq = 0;
  let server = null; // последний рабочий адрес
  let online = false;
  let paused = false;
  let closed = false;
  let timer = null;
  let working = null;
  const startedAt = now();
  const cached = new Set(); // хеши файлов в кеше
  const failures = new Map(); // sha256 -> число неудач за этот запуск
  const progress = new Map(); // sha256 игры -> скачано байт
  const covers = new Map(); // проверенные обложки в памяти: sha256 -> { data, mime }
  const lines = [];

  function log(text) {
    const d = new Date(now());
    const t = [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':');
    lines.push(`${t} ${text}`);
    if (lines.length > LOG_LINES) lines.shift();
  }

  let changeTimer = null;
  const changed = (urgent = true) => {
    if (urgent) { clearTimeout(changeTimer); changeTimer = null; onChange(); return; }
    if (!changeTimer) changeTimer = setTimeout(() => { changeTimer = null; onChange(); }, 300);
  };

  /* ---- Диск ---- */
  function saveState() {
    writeAtomic(statePath, `${JSON.stringify({ school: school.fingerprint, seq, server }, null, 1)}\n`);
  }
  function loadFromDisk() {
    let state = {};
    try { state = JSON.parse(String(readFile(statePath) || '{}')); } catch { state = {}; }
    if (state && state.school === school.fingerprint) {
      if (Number.isSafeInteger(state.seq) && state.seq > 0) seq = state.seq;
      if (typeof state.server === 'string') { try { net.checkHost(state.server); server = state.server; } catch { /* другая сеть */ } }
    }
    const bytes = readFile(catalogPath);
    if (bytes) {
      try {
        const p = checks.catalog(bytes, school);
        if (p.seq >= seq) { payload = p; seq = p.seq; } else log('Каталог в кеше старее сохранённого номера, не показываю');
      } catch (err) { log(`Каталог в кеше не прошёл проверку: ${err.message}`); }
    }
    for (const name of fs.readdirSync(cacheDir)) {
      if (HEX64.test(name)) cached.add(name);
      else fs.rmSync(path.join(cacheDir, name), { force: true, recursive: true }); // недокачанное: докачки на М2 нет
    }
    cleanup();
  }

  function referenced() {
    const set = new Set();
    for (const g of payload ? payload.games : []) {
      set.add(g.sha256);
      if (g.cover) set.add(g.cover.sha256);
      for (const m of g.modes) if (m.cover) set.add(m.cover.sha256);
    }
    return set;
  }
  /* Снятые игры и их обложки удаляются при новом каталоге (ADR-0002, 3.7). */
  function cleanup() {
    if (!payload) return;
    const keep = referenced();
    for (const hex of [...cached]) {
      if (!keep.has(hex)) { fs.rmSync(path.join(cacheDir, hex), { force: true }); cached.delete(hex); covers.delete(hex); }
    }
  }

  /* ---- Каталог ---- */
  /* Каталог с одного адреса. Возвращает { ip, payload, bytes } (новее), { ip, same: true } или null. */
  async function fetchCatalog(ip) {
    let r;
    try {
      r = await net.get(ip, '/v1/catalog', { maxBytes: LIMITS.catalogBytes, etag: payload && ip === server ? `"${seq}"` : null });
    } catch (err) {
      if (err.code !== 'stopped') log(`${ip}: ${err.message}`);
      return null;
    }
    if (r.status === 304) return { ip, same: true };
    let p;
    try { p = checks.catalog(r.body, school); } catch (err) {
      log(`${ip}: каталог отвергнут: ${err.message}`);
      return null;
    }
    if (p.seq < seq) { log(`${ip}: каталог старее уже полученного (№ ${p.seq} < № ${seq}), отвергнут`); return null; }
    if (p.seq === seq && payload) return { ip, same: true };
    return { ip, payload: p, bytes: r.body };
  }

  function accept(found) {
    writeAtomic(catalogPath, found.bytes);
    payload = found.payload;
    seq = found.payload.seq;
    log(`Новый каталог № ${seq}: игр ${payload.games.length}, сервер ${found.ip}`);
    cleanup();
  }

  function setServer(ip) {
    if (server !== ip) { server = ip; log(`Сервер: ${ip}`); }
    online = true;
    saveState();
  }

  /* Сначала последний адрес, потом обнаружение. Каждый ответивший проверяется, берётся наибольший seq (ADR-0002, 3.5). */
  async function refresh() {
    if (server) {
      const r = await fetchCatalog(server);
      if (paused || closed) return false;
      if (r) { if (r.payload) accept(r); setServer(r.ip); return true; }
    }
    const ips = await net.discover(school.fingerprint, opt.discoverMs);
    if (paused || closed) return false;
    if (!ips.length) { if (online) log('Сервер не отвечает'); online = false; return false; }
    log(`Ответили на обнаружение: ${ips.join(', ')}`);
    let best = null;
    for (const ip of ips) {
      const r = await fetchCatalog(ip);
      if (paused || closed) return false;
      if (r && (!best || (r.payload && (!best.payload || r.payload.seq > best.payload.seq)))) best = r;
    }
    if (!best) { online = false; return false; }
    if (best.payload) accept(best);
    setServer(best.ip);
    return true;
  }

  /* ---- Загрузки ---- */
  const supported = (g) => supportsVersion(appVersion, g.minAppVersion);

  /* Очередь: обложки игр, обложки режимов, игры (ADR-0003, 5.2). */
  function queue() {
    if (!payload) return [];
    const list = [];
    const add = (item) => { if (!cached.has(item.sha256) && (failures.get(item.sha256) || 0) < MAX_FAILURES && !list.some((x) => x.sha256 === item.sha256)) list.push(item); };
    for (const g of payload.games) if (g.cover) add({ kind: 'cover', ...g.cover });
    for (const g of payload.games) for (const m of g.modes) if (m.cover) add({ kind: 'cover', ...m.cover });
    for (const g of payload.games) if (g.prefetch && supported(g)) add({ kind: 'game', sha256: g.sha256, bytes: g.bytes, game: g });
    return list;
  }

  const verifyGame = (data, g) => checks.game(data, g);

  async function download(item) {
    const tmp = path.join(cacheDir, `${PART}${crypto.randomBytes(8).toString('hex')}`);
    const what = item.kind === 'game' ? `игра ${item.game.id}` : `обложка ${item.sha256.slice(0, 8)}`;
    try {
      const r = await net.get(server, `/v1/blobs/sha256/${item.sha256}`, {
        maxBytes: item.bytes, file: tmp,
        onProgress: (bytes) => { if (item.kind === 'game') { progress.set(item.sha256, bytes); changed(false); } },
      });
      if (r.status !== 200) throw new Error(`сервер ответил ${r.status}`);
      const data = fs.readFileSync(tmp);
      checks.blob(data, item);
      if (item.kind === 'game') await verifyGame(data, item.game);
      else if (!imageMime(data)) throw new Error('это не PNG и не WebP');
      fs.renameSync(tmp, path.join(cacheDir, item.sha256));
      cached.add(item.sha256);
      failures.delete(item.sha256);
      if (item.kind === 'game') log(`Скачана ${what}`);
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      if (err.code === 'stopped' || paused || closed) return false;
      const n = (failures.get(item.sha256) || 0) + 1;
      failures.set(item.sha256, n);
      log(`${what} не скачалась (${n} из ${MAX_FAILURES}): ${err.message}`);
      // Обрыв и молчание тоже считаются неудачей, но цикл на этом заканчивается: связь проверит следующий опрос
      const network = ['idle', 'aborted', 'io'].includes(err.code);
      if (network) online = false;
      return !network;
    } finally {
      progress.delete(item.sha256);
      changed();
    }
    return true;
  }

  async function downloadAll() {
    const tried = new Set(); // неудачный файл повторяется при следующем опросе, а не сразу
    for (;;) {
      if (paused || closed || !server) return;
      const next = queue().find((item) => !tried.has(item.sha256));
      if (!next) return;
      tried.add(next.sha256);
      const goOn = await download(next);
      if (!goOn) return; // связь пропала: ждём следующего цикла
    }
  }

  /* ---- Цикл ---- */
  function schedule(ms) {
    clearTimeout(timer);
    if (closed || paused) return;
    timer = setTimeout(cycle, ms);
  }

  function cycle() {
    if (working || closed || paused) return working;
    working = (async () => {
      const wasOnline = online;
      try {
        const ok = await refresh();
        changed();
        if (ok) await downloadAll();
      } catch (err) {
        log(`Ошибка: ${err && err.message}`);
      } finally {
        working = null;
      }
      if (wasOnline !== online) changed();
      schedule(online ? opt.pollMs + Math.floor(random() * opt.jitterMs) : opt.offlineMs + Math.floor(random() * opt.jitterMs / 3));
      // Экран «Попроси тьютора» появляется через 15 с без каталога, даже если цикл ещё ждёт
      if (!payload && !online) setTimeout(() => changed(), Math.max(0, startedAt + opt.askAfterMs - now()) + 10);
    })();
    return working;
  }

  /* ---- Что видит витрина ---- */
  function stateOf(g) {
    if (!supported(g)) return 'update';
    if (cached.has(g.sha256)) return 'ready';
    if ((failures.get(g.sha256) || 0) >= MAX_FAILURES) return 'failed';
    if (progress.has(g.sha256)) return 'downloading';
    return online ? 'queued' : 'offline';
  }

  function games() {
    if (!payload) return [];
    return payload.games.map((g) => ({
      id: g.id, version: g.version, title: g.title, description: g.description, grades: g.grades, minutes: g.minutes, topic: g.topic,
      author: g.author, byTutor: g.author === null, keyId: g.authorKey, sha256: g.sha256, bytes: g.bytes, lesson: g.lesson, publishedAt: g.publishedAt,
      state: stateOf(g), progress: progress.has(g.sha256) ? Math.min(99, Math.floor((progress.get(g.sha256) / g.bytes) * 100)) : 0,
      groups: groupsOf(g.grades), cover: g.cover && cached.has(g.cover.sha256) ? g.cover.sha256 : null,
      multiMode: g.modes.length > 1 || g.modes[0].id !== 'default',
      modes: g.modes.map((m) => ({ id: m.id, title: m.title, about: m.about, cover: m.cover && cached.has(m.cover.sha256) ? m.cover.sha256 : null })),
    })).sort((a, b) => (b.lesson - a.lesson) || a.title.localeCompare(b.title, 'ru'));
  }

  function coverData(hex) {
    if (typeof hex !== 'string' || !HEX64.test(hex) || !cached.has(hex)) return null;
    if (covers.has(hex)) return covers.get(hex);
    const data = readFile(path.join(cacheDir, hex));
    if (!data || data.length > LIMITS.coverBytes || !checks.hash(data, hex)) return null; // кеш могли подменить на диске
    const mime = imageMime(data);
    if (!mime) return null;
    const item = { data, mime };
    covers.set(hex, item);
    return item;
  }

  /* Байты игры из кеша, проверенные по хешу каталога, и проверенный пакет. Перед каждым запуском (ADR-0002, 2.2). */
  async function gamePackage(game) {
    const g = payload && payload.games.find((x) => x.id === game.id && x.sha256 === game.sha256);
    if (!g || !cached.has(g.sha256)) throw new Error('игры нет в кеше');
    const data = readFile(path.join(cacheDir, g.sha256));
    if (!data || !checks.hash(data, g.sha256)) {
      fs.rmSync(path.join(cacheDir, g.sha256), { force: true });
      cached.delete(g.sha256);
      log(`Игра ${g.id} в кеше изменена, удалена`);
      changed();
      throw new Error('файл в кеше изменён');
    }
    return verifyGame(data, g);
  }

  const view = () => ({
    configured: true, online, server, ask: !payload && !online && now() - startedAt >= opt.askAfterMs,
    school: { name: school.name, fingerprint: school.fingerprint }, log: lines.slice(),
  });

  /* Ручной адрес (экран «Попроси тьютора»). */
  async function setAddress(ip) {
    if (paused) return { ok: false, reason: 'busy' };
    try { net.checkHost(ip); } catch (err) { return { ok: false, reason: err.code === 'not-ip' ? 'not-ip' : 'not-subnet' }; }
    if (working) await working;
    const r = await fetchCatalog(ip);
    if (!r) return { ok: false, reason: 'no-answer' };
    if (r.payload) accept(r);
    setServer(ip);
    changed();
    schedule(0);
    return { ok: true };
  }

  return {
    kind: 'net',
    start() { loadFromDisk(); changed(); schedule(0); },
    load: loadFromDisk, // тесты: прочитать диск без запуска цикла
    close() { closed = true; clearTimeout(timer); clearTimeout(changeTimer); net.stop(); },
    /* Игра запущена: сеть останавливается полностью (К21). */
    pause() { paused = true; clearTimeout(timer); net.stop(); },
    resume() {
      if (!paused || closed) return;
      paused = false;
      net.resume();
      schedule(opt.resumeMinMs + Math.floor(random() * (opt.resumeMaxMs - opt.resumeMinMs)));
    },
    paused: () => paused,
    games, view, coverData, gamePackage, setAddress, cycle, log,
  };
}

module.exports = { createNetSource, MAX_FAILURES, DEFAULTS, checks };
