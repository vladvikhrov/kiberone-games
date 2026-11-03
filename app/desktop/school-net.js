'use strict';
/* Вся сеть программы ученика (ADR-0002, 4.1; постановка М2). Других мест, откуда программа ученика ходит в сеть, нет:
   окна Chromium закрыты host-resolver-rules, прокси в никуда и webRequest (sandbox.js, vitrina/window.js).
   Здесь только Node http и dgram. Модуль net из Electron не используется.

   Фильтр перед каждым подключением и каждой отправкой: IPv4-литерал из подсети школьного интерфейса (shared/netif.js)
   или широковещательный адрес такой подсети. Имена не разрешаются: lookup всегда отвечает ошибкой.
   Перенаправления не выполняются. Каждый ответ ограничен по размеру и времени простоя. */
const crypto = require('crypto');
const dgram = require('dgram');
const fs = require('fs');
const http = require('http');
const os = require('os');
const netif = require('../shared/netif');
const { DISCOVERY } = require('../shared/discovery');

const PORT = 47800;
const IDLE_MS = 30000;

class NetError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

/* Правила фильтра. Объект модуля, а не параметр: настоящая программа их не меняет, а контрольный прогон теста-«взломщика»
   подменяет их из redteam/, чтобы доказать, что без фильтра атака проходит. */
const filter = {
  /* Интерфейс, в подсети которого лежит адрес, или null. */
  host: (ip, list) => netif.hostInterface(ip, list),
  /* Можно ли слать запрос обнаружения на этот адрес. */
  broadcast: (target, list) => target === '255.255.255.255' || list.some((i) => i.broadcast === target),
};

const refuseDns = (hostname, _options, callback) => callback(new NetError(`Имена в сети не используются: ${String(hostname).slice(0, 60)}`, 'dns'));

/* port и interfaces меняют только тесты: настоящая программа берёт 47800 и os.networkInterfaces(). */
function createSchoolNet({ port = PORT, interfaces = () => os.networkInterfaces(), idleMs = IDLE_MS } = {}) {
  const active = new Set(); // запросы и сокеты, которые надо оборвать при остановке сети
  let stopped = false;

  const schoolIfaces = () => netif.schoolInterfaces(interfaces());

  /* Адрес узла для подключения: только IPv4 своей подсети. */
  function checkHost(ip) {
    if (!netif.isIPv4(ip)) throw new NetError('Это не адрес IPv4', 'not-ip');
    const iface = filter.host(ip, schoolIfaces());
    if (!iface) throw new NetError(`Адрес ${ip} не из школьной сети`, 'not-subnet');
    return iface;
  }

  function track(item) {
    active.add(item);
    return () => active.delete(item);
  }

  /* GET http://ip:port/path. Возвращает { status, etag, body } или, если задан file, { status, etag, sha256, bytes }.
     maxBytes: предел ответа. Больше — обрыв. etag: для If-None-Match. onProgress(bytes): ход загрузки. */
  function get(ip, path, { maxBytes, etag = null, file = null, onProgress = () => {} }) {
    if (stopped) return Promise.reject(new NetError('Сеть остановлена', 'stopped'));
    try { checkHost(ip); } catch (err) { return Promise.reject(err); }
    if (typeof path !== 'string' || !/^\/v1\/[a-z0-9/]+$/.test(path)) return Promise.reject(new NetError('Неверный путь', 'path'));
    return new Promise((resolve, reject) => {
      let settled = false;
      let untrack = () => {};
      let out = null;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        untrack();
        req.destroy();
        if (out) { out.destroy(); fs.rm(`${file}`, { force: true }, () => {}); }
        reject(err instanceof NetError ? err : new NetError(`Сеть: ${err && err.code ? err.code : 'ошибка'}`, 'io'));
      };
      const req = http.request({
        host: ip, port, path, method: 'GET', family: 4, agent: false, lookup: refuseDns, maxHeaderSize: 16384,
        headers: { Host: `${ip}:${port}`, Accept: '*/*', ...(etag ? { 'If-None-Match': etag } : {}) },
      }, (res) => {
        const status = res.statusCode;
        const tag = typeof res.headers.etag === 'string' ? res.headers.etag : null;
        if (status === 304) { res.resume(); settled = true; untrack(); resolve({ status, etag: tag }); return; }
        if (status >= 300 && status < 400) return fail(new NetError(`Сервер прислал перенаправление ${status}, оно не выполняется`, 'redirect'));
        if (status !== 200) return fail(new NetError(`Сервер ответил ${status}`, 'status'));
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > maxBytes) return fail(new NetError(`Ответ больше ${maxBytes} байт`, 'too-big'));
        const hash = crypto.createHash('sha256');
        const chunks = [];
        let bytes = 0;
        if (file) {
          out = fs.createWriteStream(file, { flags: 'wx' });
          out.on('error', fail);
        }
        res.on('data', (chunk) => {
          if (settled) return;
          bytes += chunk.length;
          if (bytes > maxBytes) return fail(new NetError(`Ответ больше ${maxBytes} байт`, 'too-big'));
          hash.update(chunk);
          if (out) { if (!out.write(chunk)) { res.pause(); out.once('drain', () => res.resume()); } } else chunks.push(chunk);
          onProgress(bytes);
        });
        res.on('aborted', () => fail(new NetError('Связь оборвалась', 'aborted')));
        res.on('error', fail);
        res.on('end', () => {
          if (settled) return;
          if (Number.isFinite(declared) && declared !== bytes) return fail(new NetError('Связь оборвалась', 'aborted'));
          const done = () => {
            if (settled) return;
            settled = true;
            untrack();
            const sha256 = hash.digest('hex');
            resolve(file ? { status, etag: tag, sha256, bytes } : { status, etag: tag, body: Buffer.concat(chunks), sha256, bytes });
          };
          if (out) out.end(done); else done();
        });
      });
      untrack = track({ abort: () => fail(new NetError('Сеть остановлена', 'stopped')) });
      req.setTimeout(idleMs, () => fail(new NetError(`Сервер молчит больше ${Math.round(idleMs / 1000)} с`, 'idle')));
      req.on('error', fail);
      req.end();
    });
  }

  /* Широковещательный запрос KIBD1. Возвращает адреса, ответившие правильным отпечатком и числом, из своей подсети. */
  function discover(fingerprint, waitMs = 2000) {
    if (stopped) return Promise.resolve([]);
    const list = schoolIfaces();
    const targets = netif.broadcastTargets(list);
    if (!targets.length) return Promise.resolve([]);
    const { packet, nonce } = DISCOVERY.request(fingerprint);
    return new Promise((resolve) => {
      const found = new Set();
      const sock = dgram.createSocket('udp4');
      let finished = false;
      let timer = null;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        untrack();
        try { sock.close(); } catch { /* уже закрыт */ }
        resolve([...found]);
      };
      const untrack = track({ abort: finish });
      sock.on('error', finish);
      sock.on('message', (msg, rinfo) => {
        const reply = DISCOVERY.parseReply(msg);
        if (!reply || reply.fingerprint !== fingerprint || !reply.nonce.equals(nonce)) return;
        if (!filter.host(rinfo.address, list)) return; // ответ не из школьной сети не считается
        found.add(rinfo.address);
      });
      sock.bind(0, '0.0.0.0', () => {
        if (finished) return;
        try { sock.setBroadcast(true); } catch { return finish(); }
        for (const target of targets) {
          // Отправка только на широковещательные адреса школьных подсетей и 255.255.255.255
          if (!filter.broadcast(target, list)) continue;
          sock.send(packet, port, target, () => {});
        }
        timer = setTimeout(finish, waitMs);
      });
    });
  }

  /* Оборвать всё и больше ничего не начинать, пока не вызван resume (К21). */
  function stop() {
    stopped = true;
    for (const item of [...active]) item.abort();
  }
  const resume = () => { stopped = false; };

  return { get, discover, checkHost, schoolIfaces, stop, resume, active: () => active.size, port };
}

module.exports = { createSchoolNet, NetError, PORT, filter };
