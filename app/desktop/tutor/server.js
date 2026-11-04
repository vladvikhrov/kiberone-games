'use strict';
/* Раздача каталога в сети школы (ADR-0002, 3.4, 3.5; постановка М2). Только чтение: каталог и файлы из blobs/.
   Сервер ненадёжен по замыслу: ученик проверяет подпись каталога и хеш каждого файла сам, поэтому здесь нет секретов.
   Чего здесь нет намеренно: журнала запросов, записи на диск, ответов адресам не из подсети, ответов страницам браузера.
   Модуль без Electron, чтобы его можно было проверять в Node. В сборку ученика не входит. */
const dgram = require('dgram');
const fs = require('fs');
const http = require('http');
const { hostInterface } = require('../../shared/netif');
const { DISCOVERY } = require('../../shared/discovery');

const PORT = 47800;
const BLOB_PATH = /^\/v1\/blobs\/sha256\/([0-9a-f]{64})$/;
/* Нагрузка на сеть (ADR-0002, раздел 6; постановка М3). */
const SLOTS = 3; // больших файлов одновременно
const BIG_BYTES = 1024 * 1024; // файл больше этого занимает слот, меньше идёт вне очереди
const RATE_BPS = 30e6 / 8; // 30 Мбит/с на все ответы с файлами вместе
const CHUNK = 64 * 1024;
const WAITING_MS = 90000; // ноутбук «ждёт очереди», если получил 503 за это время
const RANGE = /^bytes=(\d{1,15})-(\d{0,15})$/;
/* Голоса (М4): мелкие запросы вне слотов и ведра. Тело до 256 байт, читается не дольше 5 с. */
const VOTE_BYTES = 256;
const VOTE_BODY_MS = 5000;
const JSON_TYPE = /^application\/json(\s*;\s*charset=utf-8)?$/i;

/* Общее ведро для всех ответов: каждый кусок берёт свои байты, долг ждёт. Так суммарная скорость не выше rate,
   сколько бы ответов ни шло одновременно. rate = 0 — без предела. */
function createBucket(rate, clock = () => Date.now()) {
  let tokens = 0;
  let at = clock();
  const burst = CHUNK * 4;
  return {
    rate: () => rate,
    setRate(value) { rate = value; tokens = 0; at = clock(); },
    /* Через сколько мс можно отправить n байт. */
    take(n) {
      if (!rate) return 0;
      const t = clock();
      tokens = Math.min(burst, tokens + ((t - at) / 1000) * rate);
      at = t;
      tokens -= n;
      return tokens >= 0 ? 0 : Math.ceil((-tokens / rate) * 1000);
    },
  };
}

class ServerError extends Error {}

/* iface: подходящий интерфейс из netif.schoolInterfaces. fingerprint: отпечаток школы.
   snapshot: () => { catalog: Buffer | null, seq, blobs: Set<hex>, modes?: Map<игра, Set<режим>> } — текущий подписанный каталог,
   хеши, на которые он ссылается, и режимы игр (для голосов).
   votes: createVotes (votes.js) или null — тогда /v1/votes и /v1/ratings отвечают 404.
   blobPath: (hex) => путь к файлу. port: только для тестов. */
function createServer({ iface, fingerprint, snapshot, blobPath, votes = null, port = PORT, log = () => {}, slots = SLOTS, bigBytes = BIG_BYTES, rate = RATE_BPS, idleMs = 30000, voteBodyMs = VOTE_BODY_MS }) {
  const subnet = [iface];
  const fromSubnet = (address) => !!hostInterface(String(address || '').replace(/^::ffff:/, ''), subnet);
  let httpServer = null;
  let udp = null;
  let replySock = null; // ответ уходит с адреса раздачи: ученик подключается к адресу отправителя ответа
  const bucket = createBucket(rate);
  const busy = new Map(); // адрес ученика -> ответ, занявший слот (один на ноутбук)
  const progress = new WeakMap(); // ответ -> { total, sent, at } — чтобы оценить, когда освободится слот
  const waiting = new Map(); // адрес -> когда последний раз получил 503
  const peerOf = (req) => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');

  function pruneWaiting() {
    const t = Date.now();
    for (const [ip, at] of waiting) if (t - at > WAITING_MS) waiting.delete(ip);
  }
  /* Через сколько секунд спросить снова: когда по нынешней скорости освободится ближайший слот, от 2 до 60 с.
     Постоянная пауза в 5 с на быстрой сети оставляла слот пустым дольше, чем шла сама загрузка (стенд нагрузки, 150 Мбит/с). */
  function retryAfter() {
    pruneWaiting();
    const t = Date.now();
    let soonest = Infinity;
    for (const res of busy.values()) {
      const p = progress.get(res);
      if (!p || !p.sent) { soonest = Math.min(soonest, 5); continue; }
      const speed = p.sent / Math.max(0.001, (t - p.at) / 1000);
      soonest = Math.min(soonest, (p.total - p.sent) / speed);
    }
    if (!Number.isFinite(soonest)) soonest = 5;
    return Math.min(60, Math.max(2, Math.ceil(soonest)));
  }

  /* Отдать часть файла через общее ведро. Обрыв и молчание клиента освобождают слот (таймаут сокета). */
  function pump(res, file, start, end, done) {
    const stream = fs.createReadStream(file, { start, end, highWaterMark: CHUNK });
    let closed = false;
    let timer = null;
    let pending = false; // кусок ждёт ведра: конец ответа только после него
    let ended = false;
    const finish = () => { if (closed) return; closed = true; clearTimeout(timer); stream.destroy(); done(); };
    res.on('close', finish);
    stream.on('error', () => { res.destroy(); finish(); });
    stream.on('end', () => { ended = true; if (!pending) res.end(); });
    stream.on('data', (chunk) => {
      stream.pause();
      pending = true;
      const write = () => {
        if (closed) return;
        pending = false;
        const p = progress.get(res);
        if (p) p.sent += chunk.length;
        const ok = res.write(chunk);
        if (ended) { res.end(); return; }
        if (ok) stream.resume(); else res.once('drain', () => stream.resume());
      };
      const wait = bucket.take(chunk.length);
      if (wait) timer = setTimeout(write, wait); else write();
    });
  }

  function send(res, status, headers = {}, body = null) {
    res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers, ...(body ? { 'Content-Length': body.length } : { 'Content-Length': 0 }) });
    res.end(body || undefined);
  }

  const dayHeader = () => (votes ? { 'X-K1-Day': votes.day() } : {});
  const modesOf = (snap) => (snap.catalog && snap.modes) || new Map();

  /* POST /v1/votes (М4). Не занимает слот и не берёт токены ведра: голос — несколько сотен байт. */
  function handleVote(req, res) {
    const fail = (status) => { res.setHeader('Connection', 'close'); send(res, status); };
    if (!votes) return fail(404);
    if (req.headers['transfer-encoding'] !== undefined) return fail(413);
    const length = req.headers['content-length'];
    if (length === undefined || !/^\d{1,4}$/.test(length)) return fail(length === undefined ? 411 : 413);
    if (Number(length) > VOTE_BYTES) return fail(413);
    if (!JSON_TYPE.test(String(req.headers['content-type'] || ''))) return fail(415);
    const chunks = [];
    let got = 0;
    let done = false;
    const timer = setTimeout(() => { done = true; req.destroy(); res.destroy(); }, voteBodyMs);
    req.on('data', (chunk) => {
      if (done) return;
      got += chunk.length;
      if (got > Number(length)) { done = true; clearTimeout(timer); fail(413); return; }
      chunks.push(chunk);
    });
    req.on('error', () => { done = true; clearTimeout(timer); res.destroy(); });
    req.on('end', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (got !== Number(length)) return fail(400);
      let result;
      try { result = votes.submit(peerOf(req), Buffer.concat(chunks), modesOf(snapshot())); } catch (err) {
        log('vote-error', String(err && err.message)); // без адреса
        return fail(500);
      }
      return send(res, result.status, dayHeader());
    });
  }

  function handle(req, res) {
    // Браузерная страница из интернета на любом ноутбуке сети не должна достучаться сюда (У14)
    if (req.headers.origin !== undefined) return send(res, 403);
    // Без модуля голосов (как на М2 и М3) путь не существует: 404 на любой метод
    if (req.url === '/v1/votes') {
      if (!votes) return send(res, 404);
      return req.method === 'POST' ? handleVote(req, res) : send(res, 405, { Allow: 'POST' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { Allow: 'GET, HEAD' });
    const length = req.headers['content-length'];
    if ((length !== undefined && length !== '0') || req.headers['transfer-encoding'] !== undefined) {
      res.setHeader('Connection', 'close');
      return send(res, 413);
    }
    const head = req.method === 'HEAD';
    // Путь сверяется как есть, без раскодирования: %2e, .. и лишние знаки сюда просто не подходят
    const url = req.url;
    const snap = snapshot();
    if (url === '/v1/catalog') {
      if (!snap.catalog) return send(res, 404);
      const etag = `"${snap.seq}"`;
      if (req.headers['if-none-match'] === etag) return send(res, 304, { ETag: etag, ...dayHeader() });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': snap.catalog.length, ETag: etag, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', ...dayHeader() });
      return res.end(head ? undefined : snap.catalog);
    }
    if (url === '/v1/ratings') {
      if (!votes || !snap.catalog) return send(res, 404);
      // Ответ зависит и от голосов, и от каталога: снятая игра пропадает из рейтинга
      const etag = `"${votes.version()}-${snap.seq}"`;
      if (req.headers['if-none-match'] === etag) return send(res, 304, { ETag: etag, ...dayHeader() });
      const body = Buffer.from(JSON.stringify(votes.view(modesOf(snap))));
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': body.length, ETag: etag, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', ...dayHeader() });
      return res.end(head ? undefined : body);
    }
    const m = BLOB_PATH.exec(url);
    if (!m || !snap.blobs.has(m[1])) return send(res, 404);
    let stat;
    const file = blobPath(m[1]);
    try { stat = fs.statSync(file); } catch { return send(res, 404); }
    const size = stat.size;
    const etag = `"${m[1]}"`;

    // Докачка: один диапазон. If-Range с другим значением — файл целиком (у файла имя по хешу, он не меняется)
    let start = 0;
    let end = size - 1;
    let partial = false;
    const range = req.headers.range;
    const ifRange = req.headers['if-range'];
    if (range !== undefined && (ifRange === undefined || ifRange === etag)) {
      const r = RANGE.exec(range);
      const unsatisfiable = () => send(res, 416, { 'Content-Range': `bytes */${size}` });
      if (!r) return unsatisfiable();
      start = Number(r[1]);
      end = r[2] === '' ? size - 1 : Math.min(Number(r[2]), size - 1);
      if (start >= size || end < start) return unsatisfiable();
      partial = true;
    }

    const ip = peerOf(req);
    const big = size > bigBytes;
    if (big && !head) {
      // Ноутбук сменил файл (нажали «Играть» на другой игре): прежний ответ ему больше не нужен
      const prev = busy.get(ip);
      if (prev && prev !== res) prev.destroy();
      if (!busy.has(ip) && busy.size >= slots) {
        waiting.set(ip, Date.now());
        return send(res, 503, { 'Retry-After': String(retryAfter()) });
      }
      waiting.delete(ip);
      busy.set(ip, res);
      progress.set(res, { total: end - start + 1, sent: 0, at: Date.now() });
    }
    const headers = {
      'Content-Type': 'application/octet-stream', 'Content-Length': end - start + 1, 'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes', ETag: etag,
      ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    };
    res.writeHead(partial ? 206 : 200, headers);
    if (head) return res.end();
    return pump(res, file, start, end, () => { if (busy.get(ip) === res) busy.delete(ip); });
  }

  /* Ответ на обнаружение: только своей школе и только соседям по подсети. Ответ той же длины, что запрос. */
  function onDiscovery(msg, rinfo) {
    if (!fromSubnet(rinfo.address)) return;
    const req = DISCOVERY.parseRequest(msg);
    if (!req || req.fingerprint !== fingerprint) return;
    const reply = DISCOVERY.reply(fingerprint, req.nonce);
    (replySock || udp).send(reply, rinfo.port, rinfo.address, () => {});
  }

  async function start() {
    httpServer = http.createServer({ maxHeaderSize: 8192, requestTimeout: 30000, headersTimeout: 10000, keepAliveTimeout: 5000 }, (req, res) => {
      try { handle(req, res); } catch (err) { log('server-error', String(err && err.message)); res.destroy(); }
    });
    httpServer.maxConnections = 64;
    httpServer.on('connection', (socket) => {
      // Адрес не из подсети: соединение закрывается без ответа (У15)
      if (!fromSubnet(socket.remoteAddress)) socket.destroy();
      socket.setTimeout(idleMs, () => socket.destroy());
    });
    httpServer.on('clientError', (_err, socket) => socket.destroy());
    await new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(port, iface.address, () => { httpServer.off('error', reject); resolve(); });
    }).catch((err) => { httpServer = null; throw new ServerError(err.code === 'EADDRINUSE' ? `Порт ${port} занят другой программой` : 'Раздачу не удалось включить'); });

    // На Linux сокет на конкретном адресе не получает широковещание, поэтому 0.0.0.0 и проверка отправителя
    udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    udp.on('message', onDiscovery);
    udp.on('error', (err) => log('udp-error', String(err && err.message)));
    await new Promise((resolve, reject) => {
      udp.once('error', reject);
      udp.bind(port, '0.0.0.0', () => { udp.off('error', reject); resolve(); });
    }).catch(async (err) => {
      udp = null;
      await stop();
      throw new ServerError(err.code === 'EADDRINUSE' ? `Порт ${port} занят другой программой` : 'Раздачу не удалось включить');
    });
    // Сокет 0.0.0.0 ответил бы с адреса, который выберет система (у интерфейса их может быть несколько)
    replySock = dgram.createSocket('udp4');
    replySock.on('error', (err) => log('udp-error', String(err && err.message)));
    await new Promise((resolve) => {
      replySock.once('error', () => { replySock = null; resolve(); });
      replySock.bind(0, iface.address, resolve);
    });
  }

  async function stop() {
    if (udp) { try { udp.close(); } catch { /* уже закрыт */ } udp = null; }
    if (replySock) { try { replySock.close(); } catch { /* уже закрыт */ } replySock = null; }
    if (httpServer) {
      const s = httpServer;
      httpServer = null;
      s.closeAllConnections();
      await new Promise((resolve) => s.close(() => resolve()));
    }
  }

  /* Для плашки тьютора: сколько ноутбуков качают большие файлы и сколько ждут очереди. Без адресов. */
  function load() {
    pruneWaiting();
    return { downloading: busy.size, waiting: waiting.size, limited: bucket.rate() > 0 };
  }

  return {
    start, stop, running: () => !!httpServer, address: iface.address, port, name: iface.name, load,
    /* «Скачать быстрее»: без предела до выключения раздачи. */
    setFast(fast) { bucket.setRate(fast ? 0 : rate); },
  };
}

module.exports = { createServer, createBucket, ServerError, PORT, SLOTS, BIG_BYTES, RATE_BPS, VOTE_BYTES };
