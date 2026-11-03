'use strict';
/* Процесс нагрузочного стенда М3 (redteam/load-run.js) внутри своего сетевого пространства. Конфигурация в LOAD_CONFIG.
   role server: настоящий desktop/tutor/server.js. Команды построчно в stdin: stop, start, fast, stats.
                Стенд считает байты ответов с файлами (по адресам и по 100 мс) и наибольшее число занятых слотов.
                В самом сервере журнала нет намеренно, счёт ведёт только этот стенд.
   role client: настоящие school-net.js и net-source.js без Electron. Пишет «DONE <мс>», когда игра проверена и в кеше. */
const fs = require('fs');
const http = require('http');
const path = require('path');

const cfg = JSON.parse(process.env.LOAD_CONFIG);
const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

async function server() {
  const stats = { byIp: {}, timeline: {}, requests: [], maxBusy: 0, status: {} };
  // Счёт байт: каждый кусок ответа с файлом, по адресу ученика и по 100 мс
  const write = http.ServerResponse.prototype.write;
  http.ServerResponse.prototype.write = function countedWrite(chunk, ...rest) {
    if (this.req && this.req.url.startsWith('/v1/blobs/') && chunk && chunk.length) {
      const ip = String(this.req.socket.remoteAddress || '').replace(/^::ffff:/, '');
      stats.byIp[ip] = (stats.byIp[ip] || 0) + chunk.length;
      const slot = Math.floor(Date.now() / 100);
      stats.timeline[slot] = (stats.timeline[slot] || 0) + chunk.length;
    }
    return write.call(this, chunk, ...rest);
  };
  const origCreate = http.createServer;
  http.createServer = function createServer(opts, handler) {
    return origCreate.call(http, opts, (req, res) => {
      if (req.url.startsWith('/v1/')) {
        const e = { ip: String(req.socket.remoteAddress || '').replace(/^::ffff:/, ''), t: Date.now(), url: req.url, range: req.headers.range || null, status: 0 };
        stats.requests.push(e);
        res.on('finish', () => { e.status = res.statusCode; if (req.url.startsWith('/v1/blobs/')) stats.status[res.statusCode] = (stats.status[res.statusCode] || 0) + 1; });
      }
      handler(req, res);
    });
  };
  const { createSchoolKey } = require('../desktop/tutor/school-key');
  const { createLibrary } = require('../desktop/tutor/library');
  const { createServer } = require('../desktop/tutor/server');
  const key = createSchoolKey(cfg.tutorDir);
  const lib = createLibrary(cfg.tutorDir, { key, appVersion: '1.1.0' });
  lib.load();
  const iface = { name: 'kb0', address: cfg.address, netmask: '255.255.255.0', prefix: 24, network: cfg.network, broadcast: cfg.broadcast };
  const snapshot = () => {
    const blobs = new Set(lib.games().map((g) => g.sha256));
    return { catalog: fs.readFileSync(lib.catalogPath), seq: lib.seq(), blobs };
  };
  let fast = false;
  let s = null;
  const start = async () => {
    s = createServer({ iface, fingerprint: key.info().fingerprint, snapshot, blobPath: (h) => path.join(lib.blobsDir, h), rate: cfg.rate, slots: cfg.slots });
    await s.start();
    if (fast) s.setFast(true);
  };
  await start();
  setInterval(() => { if (s) stats.maxBusy = Math.max(stats.maxBusy, s.load().downloading); }, 50);
  let buf = '';
  process.stdin.on('data', async (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const cmd = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (cmd === 'stop' && s) { await s.stop(); s = null; out({ ok: 'stop' }); }
      if (cmd === 'start' && !s) { await start(); out({ ok: 'start' }); }
      if (cmd === 'fast') { fast = true; if (s) s.setFast(true); out({ ok: 'fast', t: Date.now() }); }
      if (cmd === 'stats') out({ stats });
    }
  });
  out({ ready: true });
}

async function client() {
  const { parseSchoolFile } = require('../shared/catalog');
  const { createSchoolNet } = require('../desktop/school-net');
  const { createNetSource } = require('../desktop/vitrina/net-source');
  const school = parseSchoolFile(fs.readFileSync(cfg.schoolFile));
  fs.mkdirSync(cfg.dir, { recursive: true });
  fs.writeFileSync(path.join(cfg.dir, 'state.json'), JSON.stringify({ school: school.fingerprint, seq: 0, server: cfg.server }));
  const t0 = Number(cfg.t0) || Date.now();
  const src = createNetSource({ school, net: createSchoolNet(), dir: cfg.dir, appVersion: '1.1.0', options: cfg.options || {} });
  src.start();
  let failed = false;
  const timer = setInterval(() => {
    const g = src.games().find((x) => x.id === cfg.game);
    if (!g) return;
    if (g.state === 'failed') failed = true;
    if (g.state === 'ready') {
      clearInterval(timer);
      out({ done: Date.now() - t0, failed, log: src.view().log.slice(-5) });
      src.close();
      setTimeout(() => process.exit(0), 50);
    }
  }, 50);
}

(cfg.role === 'server' ? server() : client()).catch((err) => { process.stderr.write(`${err.stack}\n`); process.exit(1); });
