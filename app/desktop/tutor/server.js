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

class ServerError extends Error {}

/* iface: подходящий интерфейс из netif.schoolInterfaces. fingerprint: отпечаток школы.
   snapshot: () => { catalog: Buffer | null, seq, blobs: Set<hex> } — текущий подписанный каталог и хеши, на которые он ссылается.
   blobPath: (hex) => путь к файлу. port: только для тестов. */
function createServer({ iface, fingerprint, snapshot, blobPath, port = PORT, log = () => {} }) {
  const subnet = [iface];
  const fromSubnet = (address) => !!hostInterface(String(address || '').replace(/^::ffff:/, ''), subnet);
  let httpServer = null;
  let udp = null;
  let replySock = null; // ответ уходит с адреса раздачи: ученик подключается к адресу отправителя ответа

  function send(res, status, headers = {}, body = null) {
    res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers, ...(body ? { 'Content-Length': body.length } : { 'Content-Length': 0 }) });
    res.end(body || undefined);
  }

  function handle(req, res) {
    // Браузерная страница из интернета на любом ноутбуке сети не должна достучаться сюда (У14)
    if (req.headers.origin !== undefined) return send(res, 403);
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
      if (req.headers['if-none-match'] === etag) return send(res, 304, { ETag: etag });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': snap.catalog.length, ETag: etag, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      return res.end(head ? undefined : snap.catalog);
    }
    const m = BLOB_PATH.exec(url);
    if (!m || !snap.blobs.has(m[1])) return send(res, 404);
    let stat;
    const file = blobPath(m[1]);
    try { stat = fs.statSync(file); } catch { return send(res, 404); }
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    if (head) return res.end();
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    return stream.pipe(res);
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
      socket.setTimeout(30000, () => socket.destroy());
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

  return { start, stop, running: () => !!httpServer, address: iface.address, port, name: iface.name };
}

module.exports = { createServer, ServerError, PORT };
