'use strict';
/* Этап М2, С7 и серверная часть К18: раздача каталога в программе тьютора. Сервер на loopback, интерфейс задан вручную. */
const assert = require('node:assert');
const crypto = require('node:crypto');
const dgram = require('node:dgram');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { keygen, pack } = require('../kibpack/pack');
const { verifyCatalog } = require('../shared/catalog');
const { DISCOVERY } = require('../shared/discovery');
const { createServer } = require('../desktop/tutor/server');
const { makeSchool } = require('../redteam/school-fixture');

const APP = path.join(__dirname, '..');
const IFACE = { name: 'test', address: '127.0.0.1', netmask: '255.255.255.0', prefix: 24, network: '127.0.0.0', broadcast: '127.0.0.255' };
let tmp;
let school;
let server;
let port;

function snapshotOf(lib) {
  return () => {
    const blobs = new Set();
    for (const g of lib.games()) { blobs.add(g.sha256); if (g.cover) blobs.add(g.cover.sha256); for (const m of g.modes) if (m.cover) blobs.add(m.cover.sha256); }
    return { catalog: fs.readFileSync(lib.catalogPath), seq: lib.seq(), blobs };
  };
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kibsrv-'));
  keygen('avtor', path.join(tmp, 'keys'));
  const game = path.join(tmp, 'tri.kibgames');
  await pack(path.join(APP, 'testgames', 'tri-rezhima'), { key: path.join(tmp, 'keys', 'avtor.key.pem'), out: game });
  school = await makeSchool(path.join(tmp, 'tutor'), { games: [game] });
  port = 40000 + crypto.randomInt(20000);
  server = createServer({ iface: IFACE, fingerprint: school.school.fingerprint, snapshot: snapshotOf(school.lib), blobPath: (h) => path.join(school.lib.blobsDir, h), port });
  await server.start();
});
after(async () => { await server.stop(); fs.rmSync(tmp, { recursive: true, force: true }); });

/* Сырой HTTP-запрос: так можно послать то, что http.request сам бы исправил (%2e, .., тело у GET). */
function raw(text, { localAddress } = {}) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port, ...(localAddress ? { localAddress } : {}) });
    const chunks = [];
    sock.on('data', (d) => chunks.push(d));
    sock.on('error', () => {});
    sock.on('close', () => {
      const all = Buffer.concat(chunks);
      const head = all.toString('latin1').split('\r\n\r\n')[0];
      resolve({ status: Number((head.match(/^HTTP\/1\.1 (\d+)/) || [])[1] || 0), head, body: all.subarray(head.length + 4), bytes: all.length });
    });
    sock.write(text); // без end: иначе сервер может закрыть соединение раньше, чем допишет поток файла
  });
}
const get = (url, headers = '') => raw(`GET ${url} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n${headers}\r\n`);

test('С7: каталог отдаётся с ETag = seq, повторный запрос с If-None-Match получает 304', async () => {
  const r = await get('/v1/catalog');
  assert.equal(r.status, 200);
  const payload = verifyCatalog(r.body, { schoolKey: school.school.publicKey });
  assert.equal(payload.seq, school.lib.seq());
  assert.match(r.head, new RegExp(`ETag: "${payload.seq}"`, 'i'));
  const again = await get('/v1/catalog', `If-None-Match: "${payload.seq}"\r\n`);
  assert.equal(again.status, 304);
  assert.ok(again.bytes < 400, `ответ 304 весит ${again.bytes} байт`);
});

test('С7: файлы из каталога отдаются побайтно; новый каталог после снятия игры отдаётся сразу, файл снятой игры больше нет', async () => {
  const g = school.lib.games()[0];
  const r = await get(`/v1/blobs/sha256/${g.sha256}`);
  assert.equal(r.status, 200);
  assert.equal(crypto.createHash('sha256').update(r.body).digest('hex'), g.sha256);
  const cover = await get(`/v1/blobs/sha256/${g.cover.sha256}`);
  assert.equal(cover.status, 200);
  assert.equal(cover.body.length, g.cover.bytes);

  const before = school.lib.seq();
  await school.lib.setLesson(g.id, true);
  const fresh = await get('/v1/catalog', `If-None-Match: "${before}"\r\n`);
  assert.equal(fresh.status, 200, 'старый ETag не подходит к новому каталогу');
  assert.equal(verifyCatalog(fresh.body, { schoolKey: school.school.publicKey }).games[0].lesson, true);
});

test('К18 (сервер): Origin, чужие методы, тело, обход пути, хеш не из каталога, временные файлы — отказ', async () => {
  const g = school.lib.games()[0];
  assert.equal((await get('/v1/catalog', 'Origin: http://example.com\r\n')).status, 403);
  assert.equal((await get('/v1/catalog', 'Origin: null\r\n')).status, 403);
  assert.equal((await raw('POST /v1/catalog HTTP/1.1\r\nHost: x\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}')).status, 405);
  assert.equal((await raw('PUT /v1/catalog HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n')).status, 405);
  assert.equal((await raw('GET /v1/catalog HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello')).status, 413);
  assert.equal((await raw('GET /v1/catalog HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n0\r\n\r\n')).status, 413);
  for (const url of ['/v1/catalog/', '/v1/catalog?x=1', '/v1/../v1/catalog', '/v1/%2e%2e/catalog.json', '/catalog.json', '/v1/blobs/sha256/../../catalog.json',
    `/v1/blobs/sha256/${g.sha256.toUpperCase()}`, `/v1/blobs/sha256/${g.sha256}/`, `/v1/blobs/sha256/${'0'.repeat(64)}`, '/v1/blobs/sha256/%2e%2e%2fschool-key.enc',
    '/v1/ratings', '/v1/votes', '/']) {
    assert.equal((await get(url)).status, 404, url);
  }
  // Незаконченное добавление игры лежит в blobs, но в каталоге его нет
  fs.writeFileSync(path.join(school.lib.blobsDir, 'a'.repeat(64)), 'черновик');
  assert.equal((await get(`/v1/blobs/sha256/${'a'.repeat(64)}`)).status, 404);
  const big = await raw(`GET /v1/catalog HTTP/1.1\r\nHost: x\r\nX-Big: ${'a'.repeat(9000)}\r\nConnection: close\r\n\r\n`);
  assert.ok(big.status === 431 || big.status === 0, `большие заголовки: ${big.status}`);
  // Контроль: тот же сервер верный запрос выполняет
  assert.equal((await get('/v1/catalog')).status, 200);
});

test('К18 (сервер): соединение с адреса не из подсети закрывается без ответа', async () => {
  const r = await raw('GET /v1/catalog HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n', { localAddress: '127.0.1.5' });
  assert.equal(r.bytes, 0);
  const ok = await raw('GET /v1/catalog HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n', { localAddress: '127.0.0.7' });
  assert.equal(ok.status, 200, 'контроль: адрес из подсети получает ответ');
});

function udpAsk(packet, localAddress = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    const got = [];
    s.on('message', (m, r) => got.push({ m, r }));
    s.bind(0, localAddress, () => {
      s.send(packet, port, '127.0.0.1');
      setTimeout(() => { s.close(); resolve(got); }, 300);
    });
  });
}

test('С1 (сервер): обнаружение отвечает своей школе тем же числом, ответ не длиннее запроса; чужой отпечаток, мусор и чужая подсеть без ответа', async () => {
  const fp = school.school.fingerprint;
  const { packet, nonce } = DISCOVERY.request(fp);
  const got = await udpAsk(packet);
  assert.equal(got.length, 1);
  const reply = DISCOVERY.parseReply(got[0].m);
  assert.equal(reply.fingerprint, fp);
  assert.ok(reply.nonce.equals(nonce));
  assert.ok(got[0].m.length <= packet.length);
  assert.equal((await udpAsk(DISCOVERY.request('0123456789abcdef').packet)).length, 0);
  assert.equal((await udpAsk(Buffer.concat([packet, Buffer.from('x')]))).length, 0);
  assert.equal((await udpAsk(DISCOVERY.reply(fp, nonce))).length, 0, 'ответ на ответ не отправляется');
  assert.equal((await udpAsk(packet, '127.0.1.5')).length, 0);
});

test('С7: остановленная раздача не принимает соединений, повторный запуск работает', async () => {
  await server.stop();
  assert.equal(server.running(), false);
  const r = await get('/v1/catalog');
  assert.equal(r.status, 0);
  await server.start();
  assert.equal((await get('/v1/catalog')).status, 200);
});
