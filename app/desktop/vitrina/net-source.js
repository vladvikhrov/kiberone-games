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
const PART_NAME = /^([0-9a-f]{64})\.part$/;
const MAX_FAILURES = 3;
const LOG_LINES = 50;
const MB = 1024 * 1024;
const GB = 1024 * MB;
/* Правила раздела 6 ADR-0002 (постановка М3): повторы со сдвигом ±30 %, само качается до 20 МБ или отмеченное тьютором,
   кеш до 5 ГБ и 2 ГБ запаса на диске, недокачанное хранится 7 дней. */
const DEFAULTS = {
  pollMs: 60000, jitterMs: 15000, askAfterMs: 15000, discoverMs: 2000, resumeMinMs: 1000, resumeMaxMs: 5000,
  retryMs: [5000, 10000, 20000, 40000, 60000], retrySpread: 0.3, maxRetryAfterMs: 60000, minRetryAfterMs: 2000,
  autoBytes: 20 * MB, cacheBytes: 5 * GB, reserveBytes: 2 * GB, partMaxAgeMs: 7 * 24 * 3600 * 1000,
  speedWindowMs: 10000, freeBytes: null,
};
// Эти ошибки — связь, а не подделка: «не скачалась» из-за них не ставится, недокачанное остаётся
const NETWORK = new Set(['idle', 'aborted', 'io', 'busy', 'stopped', 'cancelled', 'dns']);

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
  const sizes = new Map(); // sha256 -> размер файла в кеше
  const parts = new Map(); // sha256 -> сколько байт уже в cache/<sha256>.part
  const failures = new Map(); // sha256 -> число неудачных проверок за этот запуск
  const progress = new Map(); // sha256 игры -> скачано байт (идёт загрузка)
  const samples = new Map(); // sha256 -> [{ t, b }] за последние 10 с, для оставшегося времени
  const covers = new Map(); // проверенные обложки в памяти: sha256 -> { data, mime }
  const noSpace = new Set(); // не хватило места
  const waitingSlot = new Set(); // сервер ответил 503
  let played = {}; // sha256 игры -> когда запускалась (для освобождения места)
  let priority = null; // sha256 игры, на которой нажали «Играть»
  let current = null; // { sha256, ctrl } — идущая загрузка
  let retryStep = 0; // номер паузы после обрыва
  let retryDelay = null; // пауза, которую назначили загрузки этого цикла
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
    writeAtomic(statePath, `${JSON.stringify({ school: school.fingerprint, seq, server, played }, null, 1)}\n`);
  }
  function loadFromDisk() {
    let state = {};
    try { state = JSON.parse(String(readFile(statePath) || '{}')); } catch { state = {}; }
    if (state && state.school === school.fingerprint) {
      if (Number.isSafeInteger(state.seq) && state.seq > 0) seq = state.seq;
      if (typeof state.server === 'string') { try { net.checkHost(state.server); server = state.server; } catch { /* другая сеть */ } }
      if (state.played && typeof state.played === 'object') {
        for (const [hex, t] of Object.entries(state.played)) if (HEX64.test(hex) && Number.isFinite(t)) played[hex] = t;
      }
    }
    const bytes = readFile(catalogPath);
    if (bytes) {
      try {
        const p = checks.catalog(bytes, school);
        if (p.seq >= seq) { payload = p; seq = p.seq; } else log('Каталог в кеше старее сохранённого номера, не показываю');
      } catch (err) { log(`Каталог в кеше не прошёл проверку: ${err.message}`); }
    }
    cached.clear(); sizes.clear(); parts.clear();
    for (const name of fs.readdirSync(cacheDir)) {
      const file = path.join(cacheDir, name);
      const part = PART_NAME.exec(name);
      let stat = null;
      try { stat = fs.lstatSync(file); } catch { continue; }
      if (HEX64.test(name) && stat.isFile()) { cached.add(name); sizes.set(name, stat.size); } else if (part && stat.isFile()) {
        if (now() - stat.mtimeMs > opt.partMaxAgeMs) fs.rmSync(file, { force: true });
        else parts.set(part[1], stat.size);
      } else fs.rmSync(file, { force: true, recursive: true }); // остальное, в том числе временные файлы М2
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
      if (!keep.has(hex)) { fs.rmSync(path.join(cacheDir, hex), { force: true }); cached.delete(hex); sizes.delete(hex); covers.delete(hex); }
    }
    for (const hex of [...parts.keys()]) {
      if (!keep.has(hex) || cached.has(hex)) dropPart(hex);
    }
    for (const hex of Object.keys(played)) if (!keep.has(hex)) delete played[hex];
    if (priority && !keep.has(priority)) priority = null;
  }
  const partPath = (hex) => path.join(cacheDir, `${hex}.part`);
  function dropPart(hex) {
    fs.rmSync(partPath(hex), { force: true });
    parts.delete(hex);
  }
  /* Недокачанное старше 7 дней удаляется (проверка и при запуске, и в каждом цикле). */
  function expireParts() {
    for (const hex of [...parts.keys()]) {
      if (current && current.sha256 === hex) continue;
      let stat = null;
      try { stat = fs.statSync(partPath(hex)); } catch { parts.delete(hex); continue; }
      if (now() - stat.mtimeMs > opt.partMaxAgeMs) { log(`Недокачанный файл ${hex.slice(0, 8)} старше 7 дней, удалён`); dropPart(hex); }
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
  /* Что качается само (ADR-0002, раздел 6): игры до 20 МБ и отмеченные тьютором «На этом занятии». Остальное — по «Играть». */
  const auto = (g) => g.bytes <= opt.autoBytes || g.prefetch === true;
  const usable = (hex) => !cached.has(hex) && (failures.get(hex) || 0) < MAX_FAILURES;
  const gameItem = (g) => ({ kind: 'game', sha256: g.sha256, bytes: g.bytes, game: g });

  /* Очередь: обложки игр, обложки режимов, игры (ADR-0003, 5.2). Нажатая «Играть» игра — одна, остальное на паузе. */
  function queue() {
    if (!payload) return [];
    if (priority) {
      const g = payload.games.find((x) => x.sha256 === priority);
      if (g && usable(g.sha256) && supported(g)) return [gameItem(g)];
      priority = null;
    }
    const list = [];
    const add = (item) => { if (usable(item.sha256) && !noSpace.has(item.sha256) && !list.some((x) => x.sha256 === item.sha256)) list.push(item); };
    for (const g of payload.games) if (g.cover) add({ kind: 'cover', ...g.cover });
    for (const g of payload.games) for (const m of g.modes) if (m.cover) add({ kind: 'cover', ...m.cover });
    for (const g of payload.games) if (auto(g) && supported(g)) add(gameItem(g));
    return list;
  }

  /* ---- Место на диске ---- */
  function freeBytes() {
    if (opt.freeBytes) return opt.freeBytes();
    try { const st = fs.statfsSync(cacheDir); return Number(st.bavail) * Number(st.bsize); } catch { return Infinity; }
  }
  const usage = () => [...sizes.values(), ...parts.values()].reduce((a, b) => a + b, 0);
  const fits = (need) => usage() + need <= opt.cacheBytes && freeBytes() >= need + opt.reserveBytes;
  /* Место для игры, на которой нажали «Играть»: убираем игры не с этого занятия, дольше всего не запускавшиеся. */
  function makeRoom(need, keepHex) {
    const lessonOf = new Map(payload.games.map((g) => [g.sha256, g.lesson]));
    const candidates = [...cached].filter((hex) => lessonOf.has(hex) && !lessonOf.get(hex) && hex !== keepHex)
      .sort((a, b) => (played[a] || 0) - (played[b] || 0));
    for (const hex of candidates) {
      if (fits(need)) break;
      fs.rmSync(path.join(cacheDir, hex), { force: true });
      cached.delete(hex);
      sizes.delete(hex);
      log(`Мало места: удалена игра ${hex.slice(0, 8)}, её можно скачать снова`);
    }
    return fits(need);
  }

  const verifyGame = (data, g) => checks.game(data, g);
  const spread = (ms) => Math.round(ms * (1 + (random() * 2 - 1) * opt.retrySpread));
  /* Пауза после обрыва: 5, 10, 20, 40, 60, 60… с, каждая ±30 %. */
  function backoff() {
    const ms = opt.retryMs[Math.min(retryStep, opt.retryMs.length - 1)];
    retryStep += 1;
    return spread(ms);
  }

  function noteProgress(hex, bytes) {
    progress.set(hex, bytes);
    const t = now();
    const list = samples.get(hex) || [];
    list.push({ t, b: bytes });
    while (list.length > 1 && t - list[0].t > opt.speedWindowMs) list.shift();
    samples.set(hex, list);
  }
  /* Сколько секунд осталось по скорости за последние 10 с. До 2 с замера — неизвестно. */
  function etaOf(hex, total) {
    const list = samples.get(hex);
    if (!list || list.length < 2) return null;
    const first = list[0];
    const last = list[list.length - 1];
    const dt = (last.t - first.t) / 1000;
    if (dt < 2 || last.b <= first.b) return null;
    return Math.ceil((total - last.b) / ((last.b - first.b) / dt));
  }

  async function download(item) {
    const hex = item.sha256;
    const tmp = partPath(hex);
    const what = item.kind === 'game' ? `игра ${item.game.id}` : `обложка ${hex.slice(0, 8)}`;
    let from = 0;
    try { from = fs.statSync(tmp).size; } catch { from = 0; }
    if (from >= item.bytes) { dropPart(hex); from = 0; } // равный размер проверять нечем: заголовков не было, качаем заново
    const need = item.bytes - from;
    if (!fits(need) && !(hex === priority && makeRoom(need, hex))) {
      if (!noSpace.has(hex)) log(`${what}: мало места на диске (нужно ${Math.ceil(need / MB)} МБ и 2 ГБ запаса, кеш до 5 ГБ)`);
      noSpace.add(hex);
      if (hex === priority) priority = null; // карточка покажет «мало места», цикл не крутится впустую
      return true;
    }
    noSpace.delete(hex);
    const ctrl = new AbortController();
    current = { sha256: hex, ctrl };
    if (from) { noteProgress(hex, from); log(`${what}: докачка с ${Math.floor((from / item.bytes) * 100)} %`); }
    try {
      const r = await net.get(server, `/v1/blobs/sha256/${hex}`, {
        maxBytes: item.bytes, file: tmp, resume: { from, total: item.bytes, tag: `"${hex}"` }, signal: ctrl.signal,
        onProgress: (bytes) => {
          waitingSlot.delete(hex);
          parts.set(hex, bytes);
          if (item.kind === 'game') { noteProgress(hex, bytes); changed(false); }
        },
      });
      if (r.status !== 200 && r.status !== 206) throw new Error(`сервер ответил ${r.status}`);
      parts.set(hex, r.bytes);
      // Проверка всего файла, а не только последнего куска: начало могло прийти от другого сервера
      const data = fs.readFileSync(tmp);
      checks.blob(data, item);
      if (item.kind === 'game') await verifyGame(data, item.game);
      else if (!imageMime(data)) throw new Error('это не PNG и не WebP');
      fs.renameSync(tmp, path.join(cacheDir, hex));
      parts.delete(hex);
      cached.add(hex);
      sizes.set(hex, data.length);
      failures.delete(hex);
      retryStep = 0;
      if (hex === priority) priority = null;
      if (item.kind === 'game') log(`Скачана ${what}${r.from ? ' (докачка)' : ''}`);
    } catch (err) {
      try { parts.set(hex, fs.statSync(tmp).size); } catch { parts.delete(hex); }
      if (err.code === 'cancelled') return true; // нажали «Играть» на другой игре: недокачанное остаётся
      if (err.code === 'stopped' || paused || closed) return false;
      if (err.code === 'busy') {
        waitingSlot.add(hex);
        const after = Number.isFinite(err.retryAfter) ? err.retryAfter * 1000 : opt.retryMs[0];
        retryDelay = spread(Math.min(opt.maxRetryAfterMs, Math.max(opt.minRetryAfterMs, after)));
        log(`${what}: сервер занят, повтор через ${Math.round(retryDelay / 1000)} с`);
        return false;
      }
      if (NETWORK.has(err.code)) {
        online = false; // «нужна связь», пока следующий цикл не достучится до сервера
        retryDelay = backoff();
        log(`${what}: ${err.message}, повтор через ${Math.round(retryDelay / 1000)} с`);
        return false;
      }
      // Не совпал хеш, размер, подпись, кусок не тот или сервер отказал: файл не тот, недокачанное выбрасываем
      dropPart(hex);
      const n = (failures.get(hex) || 0) + 1;
      failures.set(hex, n);
      log(`${what} не скачалась (${n} из ${MAX_FAILURES}): ${err.message}`);
      if (n >= MAX_FAILURES && hex === priority) priority = null;
      return true;
    } finally {
      if (current && current.sha256 === hex) current = null;
      progress.delete(hex);
      changed();
    }
    return true;
  }

  async function downloadAll() {
    const tried = new Set(); // неудачный файл повторяется в следующем цикле, а не сразу
    for (;;) {
      if (paused || closed || !server) return;
      const next = queue().find((item) => !tried.has(item.sha256));
      if (!next) return;
      tried.add(next.sha256);
      const goOn = await download(next);
      if (!goOn) return; // связь пропала или сервер занят: ждём паузы
    }
  }

  /* «Играть» на нескачанной игре: она первая, остальное на паузе, идущая загрузка другого файла прерывается. */
  function want(game) {
    const g = payload && payload.games.find((x) => x.id === game.id && x.sha256 === game.sha256);
    if (!g) return 'failed';
    const st = stateOf(g);
    if (st === 'ready' || st === 'update' || st === 'failed') return st;
    noSpace.delete(g.sha256);
    if (priority !== g.sha256) {
      priority = g.sha256;
      log(`Нажали «Играть»: ${g.id} качается первой`);
    }
    if (current && current.sha256 !== g.sha256) current.ctrl.abort();
    if (!working && !paused && !closed) schedule(0);
    changed();
    return online ? 'queued' : 'offline';
  }

  /* ---- Цикл ---- */
  let nextDelay = null; // тесты: какую паузу назначил цикл
  function schedule(ms) {
    nextDelay = ms;
    clearTimeout(timer);
    if (closed || paused) return;
    timer = setTimeout(cycle, ms);
  }

  function cycle() {
    if (working || closed || paused) return working;
    working = (async () => {
      const wasOnline = online;
      retryDelay = null;
      try {
        expireParts();
        const ok = await refresh();
        changed();
        if (ok) await downloadAll();
        else if (!paused && !closed) retryDelay = backoff();
      } catch (err) {
        log(`Ошибка: ${err && err.message}`);
      } finally {
        working = null;
      }
      if (wasOnline !== online) changed();
      // Пауза после обрыва или 503, иначе обычный опрос. Если очередь осталась (нажали «Играть» во время цикла) — сразу
      if (retryDelay !== null) schedule(retryDelay);
      else if (priority && online) schedule(0);
      else { retryStep = 0; schedule(opt.pollMs + Math.floor(random() * opt.jitterMs)); }
      // Экран «Попроси тьютора» появляется через 15 с без каталога, даже если цикл ещё ждёт
      if (!payload && !online) setTimeout(() => changed(), Math.max(0, startedAt + opt.askAfterMs - now()) + 10);
    })();
    return working;
  }

  /* ---- Что видит витрина ---- */
  function stateOf(g) {
    const hex = g.sha256;
    if (!supported(g)) return 'update';
    if (cached.has(hex)) return 'ready';
    if ((failures.get(hex) || 0) >= MAX_FAILURES) return 'failed';
    if (noSpace.has(hex)) return 'nospace';
    if (progress.has(hex)) return 'downloading';
    if (!online) return 'offline';
    if (waitingSlot.has(hex)) return 'waiting';
    if (hex === priority || auto(g)) return 'queued';
    return 'ondemand'; // большая игра без отметки тьютора: качается по «Играть»
  }
  const doneBytes = (hex) => (progress.has(hex) ? progress.get(hex) : parts.get(hex) || 0);

  function games() {
    if (!payload) return [];
    return payload.games.map((g) => ({
      id: g.id, version: g.version, title: g.title, description: g.description, grades: g.grades, minutes: g.minutes, topic: g.topic,
      author: g.author, byTutor: g.author === null, keyId: g.authorKey, sha256: g.sha256, bytes: g.bytes, lesson: g.lesson, publishedAt: g.publishedAt,
      state: stateOf(g), progress: Math.min(99, Math.floor((doneBytes(g.sha256) / g.bytes) * 100)),
      eta: progress.has(g.sha256) ? etaOf(g.sha256, g.bytes) : null, first: g.sha256 === priority,
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
    const pkg = await verifyGame(data, g);
    played[g.sha256] = now();
    try { saveState(); } catch { /* время запуска нужно только для освобождения места */ }
    return pkg;
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
    games, view, coverData, gamePackage, setAddress, cycle, log, want,
    usage, nextDelay: () => nextDelay, // тесты
  };
}

module.exports = { createNetSource, MAX_FAILURES, DEFAULTS, checks };
