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
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const POST_BYTES = 256; // голос (М4)
const POST_REPLY_BYTES = 1024;
/* Дата дня по часам тьютора (М4). Заголовок не подписан: берём только строго ГГГГ-ММ-ДД, иначе null. */
const dayOf = (res) => {
  const v = res.headers['x-k1-day'];
  return typeof v === 'string' && DAY.test(v) ? v : null;
};

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
     maxBytes: предел ответа. Больше — обрыв. etag: для If-None-Match. onProgress(bytes): ход загрузки.
     Докачка (М3): file, resume: { from, total, tag } — в файле уже from байт файла размером total с ETag tag.
     Ответ 206 принимается, только если он продолжает ровно с from и общий размер равен total; 200 переписывает файл с нуля.
     Тогда sha256 в ответе нет (часть файла пришла раньше): хеш считает вызывающий по всему файлу.
     С resume файл при ошибке не удаляется: это и есть недокачанное. signal: AbortSignal, отмена — код cancelled.
     503 — ошибка с кодом busy и retryAfter в секундах. */
  function get(ip, path, { maxBytes, etag = null, file = null, resume = null, signal = null, onProgress = () => {} }) {
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
        if (out) { out.destroy(); if (!resume) fs.rm(`${file}`, { force: true }, () => {}); }
        reject(err instanceof NetError ? err : new NetError(`Сеть: ${err && err.code ? err.code : 'ошибка'}`, 'io'));
      };
      const req = http.request({
        host: ip, port, path, method: 'GET', family: 4, agent: false, lookup: refuseDns, maxHeaderSize: 16384,
        headers: {
          Host: `${ip}:${port}`, Accept: '*/*', ...(etag ? { 'If-None-Match': etag } : {}),
          ...(resume && resume.from > 0 ? { Range: `bytes=${resume.from}-`, 'If-Range': resume.tag } : {}),
        },
      }, (res) => {
        const status = res.statusCode;
        const tag = typeof res.headers.etag === 'string' ? res.headers.etag : null;
        const day = dayOf(res);
        if (status === 304) { res.resume(); settled = true; untrack(); resolve({ status, etag: tag, day }); return; }
        if (status >= 300 && status < 400) return fail(new NetError(`Сервер прислал перенаправление ${status}, оно не выполняется`, 'redirect'));
        if (status === 503) {
          const after = /^\d{1,9}$/.test(String(res.headers['retry-after'] || '')) ? Number(res.headers['retry-after']) : null;
          const err = new NetError('Сервер занят, ждём очереди', 'busy');
          err.retryAfter = after;
          return fail(err);
        }
        // 206 бывает только в ответ на нашу докачку и только с тем местом, где мы остановились
        let start = 0;
        if (status === 206) {
          const m = /^bytes (\d{1,15})-(\d{1,15})\/(\d{1,15})$/.exec(String(res.headers['content-range'] || ''));
          if (!resume || !resume.from || !m || Number(m[1]) !== resume.from || Number(m[3]) !== resume.total || Number(m[2]) !== resume.total - 1) {
            return fail(new NetError(`Сервер прислал не тот кусок файла: ${String(res.headers['content-range'] || 'без Content-Range').slice(0, 60)}`, 'range'));
          }
          start = resume.from;
        } else if (status !== 200) return fail(new NetError(`Сервер ответил ${status}`, 'status'));
        const limit = maxBytes - start;
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > limit) return fail(new NetError(`Ответ больше ${maxBytes} байт`, 'too-big'));
        const hash = start ? null : crypto.createHash('sha256');
        const chunks = [];
        let bytes = 0;
        if (file) {
          // Докачка дописывает в конец, всё остальное начинает файл заново
          out = fs.createWriteStream(file, { flags: start ? 'a' : (resume ? 'w' : 'wx') });
          out.on('error', fail);
        }
        res.on('data', (chunk) => {
          if (settled) return;
          bytes += chunk.length;
          if (bytes > limit) return fail(new NetError(`Ответ больше ${maxBytes} байт`, 'too-big'));
          if (hash) hash.update(chunk);
          if (out) { if (!out.write(chunk)) { res.pause(); out.once('drain', () => res.resume()); } } else chunks.push(chunk);
          onProgress(start + bytes);
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
            const sha256 = hash ? hash.digest('hex') : null;
            resolve(file ? { status, etag: tag, sha256, bytes: start + bytes, from: start } : { status, etag: tag, body: Buffer.concat(chunks), sha256, bytes, day });
          };
          if (out) out.end(done); else done();
        });
      });
      untrack = track({ abort: () => fail(new NetError('Сеть остановлена', 'stopped')) });
      if (signal) {
        const cancel = () => fail(new NetError('Загрузка отменена', 'cancelled'));
        if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });
      }
      req.setTimeout(idleMs, () => fail(new NetError(`Сервер молчит больше ${Math.round(idleMs / 1000)} с`, 'idle')));
      req.on('error', fail);
      req.end();
    });
  }

  /* POST http://ip:port/path с телом JSON до 256 байт (голос, М4). Те же правила, что у get: фильтр адреса, без DNS
     и перенаправлений, таймаут простоя, ответ до 1 КБ. Возвращает { status, day }; тело ответа не нужно и не читается в память. */
  function post(ip, path, data) {
    if (stopped) return Promise.reject(new NetError('Сеть остановлена', 'stopped'));
    try { checkHost(ip); } catch (err) { return Promise.reject(err); }
    if (typeof path !== 'string' || !/^\/v1\/[a-z0-9/]+$/.test(path)) return Promise.reject(new NetError('Неверный путь', 'path'));
    const body = Buffer.from(JSON.stringify(data));
    if (body.length > POST_BYTES) return Promise.reject(new NetError(`Тело больше ${POST_BYTES} байт`, 'too-big'));
    return new Promise((resolve, reject) => {
      let settled = false;
      let untrack = () => {};
      const fail = (err) => {
        if (settled) return;
        settled = true;
        untrack();
        req.destroy();
        reject(err instanceof NetError ? err : new NetError(`Сеть: ${err && err.code ? err.code : 'ошибка'}`, 'io'));
      };
      const req = http.request({
        host: ip, port, path, method: 'POST', family: 4, agent: false, lookup: refuseDns, maxHeaderSize: 16384,
        headers: { Host: `${ip}:${port}`, 'Content-Type': 'application/json', 'Content-Length': body.length },
      }, (res) => {
        const status = res.statusCode;
        if (status >= 300 && status < 400) return fail(new NetError(`Сервер прислал перенаправление ${status}, оно не выполняется`, 'redirect'));
        let bytes = 0;
        res.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > POST_REPLY_BYTES) fail(new NetError(`Ответ больше ${POST_REPLY_BYTES} байт`, 'too-big'));
        });
        res.on('aborted', () => fail(new NetError('Связь оборвалась', 'aborted')));
        res.on('error', fail);
        res.on('end', () => {
          if (settled) return;
          settled = true;
          untrack();
          resolve({ status, day: dayOf(res) });
        });
      });
      untrack = track({ abort: () => fail(new NetError('Сеть остановлена', 'stopped')) });
      req.setTimeout(idleMs, () => fail(new NetError(`Сервер молчит больше ${Math.round(idleMs / 1000)} с`, 'idle')));
      req.on('error', fail);
      req.end(body);
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

  return { get, post, discover, checkHost, schoolIfaces, stop, resume, active: () => active.size, port };
}

module.exports = { createSchoolNet, NetError, PORT, filter };
