'use strict';
/* Процесс стенда этапа М2 в сетевом пространстве «сервера» (или «ученика» — только приёмник на loopback).
   Конфигурация в NET_CONFIG (JSON). Пишет READY, по SIGTERM сохраняет счётчики в cfg.out и выходит.

   mode real:  настоящий сервер тьютора (desktop/tutor/server.js) над папкой тьютора cfg.tutorDir.
               Журнал запросов ведёт только этот стенд: в самом сервере журнала нет намеренно.
   mode fake:  поддельный сервер: свой каталог cfg.fake.catalog, подмена файлов cfg.fake.blobs { hex: путь },
               ответ на обнаружение с правильным отпечатком, перенаправление на адрес «интернета» с cfg.fake.redirectFrom.
   canaries:   [{ host, http, tcp, udp, files? }] — приёмники: считают всё, что до них дошло. files: { '/control-x/': папка }. */
const dgram = require('dgram');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const cfg = JSON.parse(process.env.NET_CONFIG);
const stats = { requests: [], canary: {}, discovery: 0 };
const closers = [];

/* Журнал запросов стенда: метод, путь, If-None-Match, ответ, адрес клиента. */
const origCreate = http.createServer;
http.createServer = function createServer(...args) {
  const handler = args.find((a) => typeof a === 'function');
  const opts = args.find((a) => a && typeof a === 'object') || {};
  return origCreate.call(http, opts, (req, res) => {
    const entry = { method: req.method, url: req.url, inm: req.headers['if-none-match'] || null, from: req.socket.remoteAddress, status: null };
    stats.requests.push(entry);
    res.on('finish', () => { entry.status = res.statusCode; });
    handler(req, res);
  });
};

function startCanary({ host, http: httpPort, tcp: tcpPort, udp: udpPort, files = {} }) {
  const hits = { http: [], tcp: 0, udp: 0 };
  stats.canary[host] = hits;
  const server = origCreate.call(http, (req, res) => {
    const url = req.url.split('?')[0];
    const dir = Object.keys(files).find((prefix) => url.startsWith(prefix));
    if (dir) {
      const file = path.join(files[dir], path.basename(url));
      const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.txt': 'text/plain' }[path.extname(file)] || 'application/octet-stream';
      if (fs.existsSync(file)) { res.writeHead(200, { 'Content-Type': type }); res.end(fs.readFileSync(file)); return; }
      res.writeHead(404); res.end(); return;
    }
    hits.http.push(url);
    if (url.includes('eventsource')) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(); return; }
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' });
    res.end('hit');
  });
  server.on('upgrade', (req, socket) => { hits.http.push(req.url.split('?')[0]); socket.destroy(); });
  const tcp = net.createServer((socket) => { hits.tcp += 1; socket.destroy(); });
  const udp = dgram.createSocket('udp4');
  udp.on('message', () => { hits.udp += 1; });
  closers.push(() => { server.closeAllConnections(); server.close(); tcp.close(); udp.close(); });
  return new Promise((resolve) => server.listen(httpPort, host, () => tcp.listen(tcpPort, host, () => udp.bind(udpPort, host, resolve))));
}

/* Приёмник на порту сервера по адресу «интернета»: сюда стучится ученик без фильтра (контроль К18). */
function startPortTrap(host, port) {
  const hits = { http: [], tcp: 0, udp: 0 };
  stats.canary[`${host}:${port}`] = hits;
  const tcp = net.createServer((socket) => { hits.tcp += 1; socket.destroy(); });
  closers.push(() => tcp.close());
  return new Promise((resolve) => tcp.listen(port, host, resolve));
}

async function startReal() {
  const { createSchoolKey } = require('../desktop/tutor/school-key');
  const { createLibrary } = require('../desktop/tutor/library');
  const { createServer } = require('../desktop/tutor/server');
  const key = createSchoolKey(cfg.tutorDir);
  const lib = createLibrary(cfg.tutorDir, { key, appVersion: '1.1.0' });
  lib.load();
  for (const address of cfg.addresses) {
    const iface = { name: 'k1lan1', address, netmask: '255.255.255.0', prefix: 24, network: '10.99.1.0', broadcast: '10.99.1.255' };
    const snapshot = () => {
      const blobs = new Set();
      for (const g of lib.games()) { blobs.add(g.sha256); if (g.icon) blobs.add(g.icon.sha256); if (g.cover) blobs.add(g.cover.sha256); for (const m of g.modes) if (m.cover) blobs.add(m.cover.sha256); }
      return { catalog: fs.readFileSync(lib.catalogPath), seq: lib.seq(), blobs };
    };
    const server = createServer({ iface, fingerprint: key.info().fingerprint, snapshot, blobPath: (h) => path.join(lib.blobsDir, h) });
    await server.start();
    closers.push(() => server.stop());
  }
}

async function startFake() {
  const { DISCOVERY } = require('../shared/discovery');
  const f = cfg.fake;
  const catalog = fs.readFileSync(f.catalog);
  const handler = (req, res) => {
    if (f.redirectFrom && req.socket.localAddress === f.redirectFrom) {
      res.writeHead(302, { Location: `http://${f.redirectTo}:47800/v1/catalog` });
      res.end();
      return;
    }
    if (req.url === '/v1/catalog') { res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': catalog.length }); res.end(catalog); return; }
    const m = /^\/v1\/blobs\/sha256\/([0-9a-f]{64})$/.exec(req.url);
    const file = m && ((f.blobs && f.blobs[m[1]]) || path.join(f.blobDir, m[1]));
    if (file && fs.existsSync(file)) {
      const data = fs.readFileSync(file);
      // Зависшая отдача: часть файла и тишина (для снимка «скачивается»)
      f.seen = f.seen || {};
      f.seen[m[1]] = (f.seen[m[1]] || 0) + 1;
      if (f.stall && f.stall[m[1]]) {
        // stallAfter: пока другой файл не запрошен нужное число раз, этот отвечает 404 (чтобы на снимке успели все состояния)
        const wait = f.stallAfter && f.stallAfter[m[1]];
        if (wait && (f.seen[wait.hex] || 0) < wait.count) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Length': data.length });
        res.write(data.subarray(0, Math.floor(data.length * f.stall[m[1]])));
        return;
      }
      res.writeHead(200, { 'Content-Length': data.length });
      res.end(data);
      return;
    }
    res.writeHead(404); res.end();
  };
  for (const address of cfg.addresses) {
    const server = http.createServer(handler);
    await new Promise((resolve) => server.listen(47800, address, resolve));
    closers.push(() => { server.closeAllConnections(); server.close(); });
  }
  const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  udp.on('message', (msg, rinfo) => {
    const r = DISCOVERY.parseRequest(msg);
    if (!r) return;
    stats.discovery += 1;
    udp.send(DISCOVERY.reply(f.fingerprint || r.fingerprint, r.nonce), rinfo.port, rinfo.address);
  });
  await new Promise((resolve) => udp.bind(47800, '0.0.0.0', resolve));
  closers.push(() => udp.close());
}

async function main() {
  for (const c of cfg.canaries || []) await startCanary(c);
  for (const t of cfg.traps || []) await startPortTrap(t.host, t.port);
  if (cfg.mode === 'real') await startReal();
  if (cfg.mode === 'fake') await startFake();
  process.stdout.write('READY\n');
}

process.on('SIGTERM', async () => {
  for (const close of closers) { try { await close(); } catch { /* уже закрыт */ } }
  if (cfg.out) fs.writeFileSync(cfg.out, JSON.stringify(stats));
  process.exit(0);
});

main().catch((err) => { process.stderr.write(`${err.stack}\n`); process.exit(1); });
