'use strict';
/* Этап М3, ученик: докачка, подмена при докачке, повторы, приоритет «Играть», что качается само, место на диске, .part.
   Настоящие server.js, school-net.js и net-source.js на loopback. Loopback школьной сетью не считается, поэтому тест
   подменяет filter.host так, чтобы 127.0.0.1 считался адресом своей подсети. Остальной фильтр не меняется. */
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { keygen, pack } = require('../kibpack/pack');
const { createServer } = require('../desktop/tutor/server');
const schoolNet = require('../desktop/school-net');
const { createNetSource } = require('../desktop/vitrina/net-source');
const { makeSchool } = require('../redteam/school-fixture');

const { createSchoolNet, NetError, filter } = schoolNet;
const IFACE = { name: 'test', address: '127.0.0.1', netmask: '255.255.255.0', prefix: 24, network: '127.0.0.0', broadcast: '127.0.0.255' };
const MB = 1024 * 1024;
let tmp;
const files = {};
const originalHost = filter.host;
const sha = (d) => crypto.createHash('sha256').update(d).digest('hex');

async function bigGame(name, size, keyName = 'avtor') {
  const dir = path.join(tmp, `src-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'kibgame.json'), JSON.stringify({ id: name, version: '1.0.0', title: `Игра ${name}`, description: 'Проверка', authors: ['Автор'],
    grades: '4–5 класс', minutes: 30, topic: 'Тест', minAppVersion: '1.0.0', entry: 'index.html' }));
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><title>${name}</title>`);
  fs.writeFileSync(path.join(dir, 'video.webm'), crypto.randomBytes(size));
  const out = path.join(tmp, `${name}.kibgames`);
  await pack(dir, { key: path.join(tmp, 'keys', `${keyName}.key.pem`), out });
  return out;
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kibm3d-'));
  keygen('avtor', path.join(tmp, 'keys'));
  files.a = await bigGame('a', 3 * MB);
  files.b = await bigGame('b', 3 * MB);
  files.c = await bigGame('c', 1 * MB);
  files.small = await bigGame('small', 50 * 1024);
  filter.host = (ip, list) => (ip === '127.0.0.1' ? IFACE : originalHost(ip, list));
});
after(() => { filter.host = originalHost; fs.rmSync(tmp, { recursive: true, force: true }); });

function snapshotOf(lib) {
  return () => {
    const blobs = new Set();
    for (const g of lib.games()) { blobs.add(g.sha256); if (g.cover) blobs.add(g.cover.sha256); for (const m of g.modes) if (m.cover) blobs.add(m.cover.sha256); }
    return { catalog: fs.readFileSync(lib.catalogPath), seq: lib.seq(), blobs };
  };
}
async function tutorServer(t, options = {}, port = 40000 + crypto.randomInt(20000)) {
  const s = createServer({ iface: IFACE, fingerprint: t.school.fingerprint, snapshot: snapshotOf(t.lib), blobPath: (h) => path.join(t.lib.blobsDir, h), port, ...options });
  await s.start();
  return s;
}

/* Сеть ученика, которая записывает каждый запрос файла: откуда начали и сколько байт пришло. */
function countingNet(port) {
  const net = createSchoolNet({ port, interfaces: () => ({}) });
  const log = [];
  const get = net.get;
  net.get = async (ip, p, o = {}) => {
    const entry = { path: p, from: o.resume ? o.resume.from : 0, got: 0 };
    if (p.startsWith('/v1/blobs/')) log.push(entry);
    const progress = o.onProgress || (() => {});
    return get(ip, p, { ...o, onProgress: (b) => { entry.got = b - entry.from; progress(b); } });
  };
  net.log = log;
  return net;
}

let clock = null; // null — настоящее время (по нему же считается скорость); число — поддельные часы
function source(t, net, dir, options = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ school: t.school.fingerprint, seq: 0, server: '127.0.0.1' }));
  const s = createNetSource({
    school: t.school, net, dir, appVersion: '1.1.0', now: () => (clock === null ? Date.now() : clock), random: () => 0.5,
    options: { pollMs: 1e9, retryMs: [1e9], askAfterMs: 15000, discoverMs: 50, freeBytes: () => 100 * 1024 * MB, ...options },
  });
  s.load();
  return s;
}
const gameOf = (s, id) => s.games().find((g) => g.id === id);
const waitFor = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 20)); }
  return fn();
};
const hashOf = (t, id) => t.lib.games().find((g) => g.id === id).sha256;
const partBytes = (dir, h) => { try { return fs.statSync(path.join(dir, 'cache', `${h}.part`)).size; } catch { return 0; } };

test('Н4: обрыв на середине — докачка с места обрыва, после обрыва пришла только вторая половина; контроль: без .part вдвое больше', async () => {
  const t = await makeSchool(path.join(tmp, 't-n4'), { games: [files.a] });
  const h = hashOf(t, 'a');
  const size = t.lib.games()[0].bytes;
  const results = {};
  for (const mode of ['докачка', 'контроль']) {
    const srv = await tutorServer(t, { rate: 2 * MB });
    const net = countingNet(srv.port);
    const dir = path.join(tmp, `s-n4-${mode}`);
    const s = source(t, net, dir);
    const run = s.cycle();
    assert.ok(await waitFor(() => partBytes(dir, h) >= size / 2), 'половина скачалась');
    await srv.stop(); // обрыв: сервер пропал
    await run;
    assert.notEqual(gameOf(s, 'a').state, 'failed', 'обрыв — не подделка');
    const kept = partBytes(dir, h);
    assert.ok(kept >= size / 2 && kept < size, `в .part ${kept}`);
    if (mode === 'контроль') fs.rmSync(path.join(dir, 'cache', `${h}.part`)); // как было на М2: недокачанное выброшено
    const srv2 = await tutorServer(t, { rate: 0 }, srv.port);
    s.load();
    await s.cycle();
    assert.equal(gameOf(s, 'a').state, 'ready', mode);
    assert.equal(sha(fs.readFileSync(path.join(dir, 'cache', h))), h);
    const last = net.log[net.log.length - 1];
    results[mode] = last.got;
    if (mode === 'докачка') assert.equal(last.from, kept, 'запрос продолжил ровно с размера .part');
    s.close();
    await srv2.stop();
  }
  assert.ok(results['докачка'] <= size * 0.55, `после обрыва с докачкой ${results['докачка']} из ${size}`);
  assert.ok(results['контроль'] >= results['докачка'] * 1.8, `контроль: ${results['контроль']} против ${results['докачка']}`);
});

/* Поддельный сервер для К25: каталог настоящий, файл отдаётся как скажет mode. */
async function tamperServer(t, mode) {
  const real = (h) => fs.readFileSync(path.join(t.lib.blobsDir, h));
  const other = fs.readFileSync(files.b);
  const s = http.createServer((req, res) => {
    if (req.url === '/v1/catalog') { const c = fs.readFileSync(t.lib.catalogPath); res.writeHead(200, { 'Content-Length': c.length }); return res.end(c); }
    const m = /([0-9a-f]{64})$/.exec(req.url);
    if (!m) { res.writeHead(404, { 'Content-Length': 0 }); return res.end(); } // рейтинг (М4) и прочее: как у настоящего сервера
    const data = real(m[1]);
    const range = /^bytes=(\d+)-$/.exec(req.headers.range || '');
    if (!range) {
      // Первая загрузка: половина настоящего файла и обрыв — так у ученика появляется .part
      res.writeHead(200, { 'Content-Length': data.length });
      res.write(data.subarray(0, Math.floor(data.length / 2)));
      return setTimeout(() => res.destroy(), 50);
    }
    const from = Number(range[1]);
    let body;
    let cr = `bytes ${from}-${data.length - 1}/${data.length}`;
    if (mode === 'хвост чужого файла') body = other.subarray(from, data.length);
    if (mode === 'чужой Content-Range') { body = data.subarray(from - 100); cr = `bytes ${from - 100}-${data.length - 1}/${data.length}`; }
    if (mode === 'другой общий размер') { body = data.subarray(from); cr = `bytes ${from}-${data.length - 1}/${data.length + 10}`; }
    if (mode === 'длиннее объявленного') { body = Buffer.concat([data.subarray(from), Buffer.alloc(1000)]); cr = `bytes ${from}-${data.length - 1}/${data.length}`; }
    res.writeHead(206, { 'Content-Range': cr, 'Content-Length': body.length });
    return res.end(body);
  });
  const port = 40000 + crypto.randomInt(20000);
  await new Promise((r) => s.listen(port, '127.0.0.1', r));
  return { port, stop: () => new Promise((r) => { s.closeAllConnections(); s.close(r); }) };
}

test('К25: подмена при докачке не попадает в кеш и не запускается; после 3 неудач «не скачалась»', async () => {
  const t = await makeSchool(path.join(tmp, 't-k25'), { games: [files.a] });
  const h = hashOf(t, 'a');
  for (const mode of ['хвост чужого файла', 'чужой Content-Range', 'другой общий размер', 'длиннее объявленного']) {
    const srv = await tamperServer(t, mode);
    const dir = path.join(tmp, `s-k25-${crypto.randomBytes(3).toString('hex')}`);
    const s = source(t, createSchoolNet({ port: srv.port, interfaces: () => ({}) }), dir);
    for (let i = 0; i < 8 && (!gameOf(s, 'a') || gameOf(s, 'a').state !== 'failed'); i += 1) await s.cycle();
    assert.equal(gameOf(s, 'a').state, 'failed', mode);
    assert.ok(!fs.existsSync(path.join(dir, 'cache', h)), `${mode}: в кеше`);
    await assert.rejects(s.gamePackage(gameOf(s, 'a')), mode);
    assert.match(s.view().log.join('\n'), /не скачалась \(3 из 3\)/, mode);
    s.close();
    await srv.stop();
  }
});

test('Н5: сервер перезапущен посреди загрузки — загрузка завершается, «не скачалась» нет, загруженное не теряется', async () => {
  const t = await makeSchool(path.join(tmp, 't-n5'), { games: [files.a, files.b] });
  const srv = await tutorServer(t, { rate: 3 * MB });
  const net = countingNet(srv.port);
  const dir = path.join(tmp, 's-n5');
  const s = source(t, net, dir, { retryMs: [200, 400, 800] });
  s.start();
  assert.ok(await waitFor(() => partBytes(dir, hashOf(t, 'a')) > MB));
  await srv.stop();
  await new Promise((r) => setTimeout(r, 700));
  const srv2 = await tutorServer(t, { rate: 0 }, srv.port);
  assert.ok(await waitFor(() => ['a', 'b'].every((id) => gameOf(s, id).state === 'ready'), 15000), JSON.stringify(s.games().map((g) => g.state)));
  const total = net.log.reduce((sum, e) => sum + e.got, 0);
  const size = t.lib.games().reduce((sum, g) => sum + g.bytes, 0);
  assert.ok(total <= size * 1.1, `отдано ${total} на ${size}`);
  s.close();
  await srv2.stop();
});

test('Н6: паузы 5, 10, 20, 40, 60, 60 с со сдвигом ±30 %; Retry-After соблюдается и ограничен 2–60 с; удача сбрасывает счёт', async () => {
  const t = await makeSchool(path.join(tmp, 't-n6'), { games: [files.small] });
  const dir = path.join(tmp, 's-n6');
  let reply = () => new NetError('нет ответа', 'io');
  const real = createSchoolNet({ interfaces: () => ({}) });
  const net = {
    ...real, checkHost: (ip) => filter.host(ip, []),
    async get(_ip, p) {
      if (p === '/v1/catalog') return { status: 200, body: fs.readFileSync(t.lib.catalogPath) };
      const r = reply();
      if (r instanceof Error) throw r;
      return r;
    },
    discover: async () => [],
  };
  for (const [rnd, factor] of [[0, 0.7], [0.5, 1], [0.999999, 1.3]]) {
    fs.rmSync(dir, { recursive: true, force: true });
    const s = createNetSource({ school: t.school, net, dir: (fs.mkdirSync(dir, { recursive: true }), dir), appVersion: '1.1.0', random: () => rnd, options: { freeBytes: () => 1e12 } });
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ school: t.school.fingerprint, seq: 0, server: '127.0.0.1' }));
    s.load();
    const delays = [];
    for (let i = 0; i < 6; i += 1) { await s.cycle(); delays.push(s.nextDelay()); }
    assert.deepEqual(delays.map((d) => Math.round(d / factor / 1000)), [5, 10, 20, 40, 60, 60], `сдвиг ${rnd}`);
    s.close();
  }
  const s = createNetSource({ school: t.school, net, dir, appVersion: '1.1.0', random: () => 0.5, options: { freeBytes: () => 1e12 } });
  s.load();
  for (const [after, expect] of [[0, 2000], [30, 30000], [100000, 60000], [null, 5000]]) {
    reply = () => Object.assign(new NetError('занят', 'busy'), { retryAfter: after });
    await s.cycle();
    assert.equal(s.nextDelay(), expect, `Retry-After ${after}`);
    assert.equal(gameOf(s, 'small').state, 'waiting');
  }
  reply = () => new NetError('нет ответа', 'io');
  await s.cycle();
  await s.cycle();
  assert.equal(s.nextDelay(), 10000, 'вторая пауза');
  const data = fs.readFileSync(path.join(t.lib.blobsDir, hashOf(t, 'small')));
  reply = () => ({ status: 200, bytes: data.length });
  const realGet = net.get;
  net.get = async (ip, p, o) => {
    if (p !== '/v1/catalog' && o.file) { fs.writeFileSync(o.file, data); return { status: 200, bytes: data.length, from: 0 }; }
    return realGet(ip, p, o);
  };
  await s.cycle();
  assert.equal(gameOf(s, 'small').state, 'ready');
  net.get = realGet;
  reply = () => new NetError('нет ответа', 'io');
  fs.rmSync(path.join(dir, 'cache', hashOf(t, 'small')));
  s.load();
  await s.cycle();
  assert.equal(s.nextDelay(), 5000, 'после удачи счёт пауз сначала');
  s.close();
});

test('Н7, Н8: само качается мелкое и отмеченное тьютором; большое — по «Играть», первым, остальное на паузе', async () => {
  const t = await makeSchool(path.join(tmp, 't-n7'), { games: [files.a, files.b, files.c] });
  await t.lib.setLesson('b', true);
  assert.equal(t.lib.games().find((g) => g.id === 'b').prefetch, true, 'отметка тьютора ставит prefetch');
  assert.equal(t.lib.games().find((g) => g.id === 'a').prefetch, false);
  const srv = await tutorServer(t, { rate: MB });
  const net = countingNet(srv.port);
  const dir = path.join(tmp, 's-n7');
  const s = source(t, net, dir, { autoBytes: 2 * MB });
  await s.cycle();
  const ids = Object.fromEntries(t.lib.games().map((g) => [g.sha256, g.id]));
  const order = net.log.map((e) => ids[e.path.slice(-64)]).filter(Boolean);
  assert.deepEqual([...new Set(order)].sort(), ['b', 'c'], `само скачалось: ${order}`);
  assert.equal(gameOf(s, 'a').state, 'ondemand');
  assert.equal(gameOf(s, 'b').state, 'ready');
  assert.equal(gameOf(s, 'c').state, 'ready');
  s.close();

  // Новый ноутбук: идёт b (отмечена), нажали «Играть» на a — a первой, b на паузе с .part, потом b докачивается
  const dir2 = path.join(tmp, 's-n7b');
  const net2 = countingNet(srv.port);
  const s2 = source(t, net2, dir2, { autoBytes: 2 * MB });
  const run = s2.cycle();
  assert.ok(await waitFor(() => partBytes(dir2, hashOf(t, 'b')) > 0.5 * MB));
  assert.equal(s2.want(gameOf(s2, 'a')), 'queued');
  assert.equal(gameOf(s2, 'a').first, true);
  assert.ok(await waitFor(() => gameOf(s2, 'a').state === 'downloading'));
  const keptB = partBytes(dir2, hashOf(t, 'b'));
  assert.ok(keptB > 0, 'b осталась недокачанной');
  assert.ok(await waitFor(() => gameOf(s2, 'a').eta !== null, 5000), 'есть примерное время');
  assert.ok(await waitFor(() => gameOf(s2, 'a').state === 'ready', 15000));
  assert.equal(gameOf(s2, 'b').state !== 'ready', true, 'b ещё не готова: была на паузе');
  await run;
  await waitFor(() => !s2.games().some((g) => g.state === 'downloading'), 5000);
  await s2.cycle();
  assert.equal(gameOf(s2, 'b').state, 'ready');
  const seq2 = net2.log.map((e) => ids[e.path.slice(-64)]).filter(Boolean);
  const bAfter = net2.log.filter((e) => ids[e.path.slice(-64)] === 'b');
  assert.equal(seq2[seq2.indexOf('a') - 1], 'b');
  assert.ok(bAfter.some((e) => e.from >= keptB), 'b докачана с места паузы');
  s2.close();
  await srv.stop();
});

test('Н9: кеш до предела и запас на диске — само не качается, «Играть» освобождает место за счёт давно не запускавшихся, иначе «мало места»', async () => {
  const t = await makeSchool(path.join(tmp, 't-n9'), { games: [files.a, files.b, files.c] });
  await t.lib.setLesson('c', true);
  const srv = await tutorServer(t, { rate: 0 });
  const dir = path.join(tmp, 's-n9');
  const size = (id) => t.lib.games().find((g) => g.id === id).bytes;
  // Сначала всё скачано на большом диске
  let s = source(t, countingNet(srv.port), dir, { autoBytes: 10 * MB });
  await s.cycle();
  assert.ok(['a', 'b', 'c'].every((id) => gameOf(s, id).state === 'ready'));
  await s.gamePackage(gameOf(s, 'a')); // a запускали недавно, b давно не запускали
  s.close();
  fs.rmSync(path.join(dir, 'cache', hashOf(t, 'a')));

  // Кеш: место только под две игры. a само не качается
  const limit = size('b') + size('c') + size('a') / 2;
  s = source(t, countingNet(srv.port), dir, { autoBytes: 10 * MB, cacheBytes: limit });
  await s.cycle();
  assert.equal(gameOf(s, 'a').state, 'nospace');
  assert.ok(s.usage() <= limit);
  // «Играть» на a: удаляется b (не на занятии, давно не запускали), c на занятии остаётся
  assert.equal(s.want(gameOf(s, 'a')), 'queued');
  await s.cycle();
  assert.equal(gameOf(s, 'a').state, 'ready');
  assert.equal(gameOf(s, 'c').state, 'ready', 'игра на занятии не удаляется');
  assert.notEqual(gameOf(s, 'b').state, 'ready', 'удалена давно не запускавшаяся');
  assert.ok(s.usage() <= limit);
  s.close();

  // Свободного места меньше запаса: даже «Играть» не помогает, если удалять нечего
  fs.rmSync(dir, { recursive: true, force: true });
  s = source(t, countingNet(srv.port), dir, { autoBytes: 10 * MB, freeBytes: () => MB, reserveBytes: 2 * MB });
  await s.cycle();
  assert.ok(['a', 'b', 'c'].every((id) => gameOf(s, id).state === 'nospace'));
  assert.equal(s.want(gameOf(s, 'a')), 'queued');
  await s.cycle();
  assert.equal(gameOf(s, 'a').state, 'nospace');
  assert.match(s.view().log.join('\n'), /мало места/);
  s.close();
  await srv.stop();
});

test('Н10: .part переживает перезапуск программы, удаляется через 7 дней и при снятии игры из каталога', async () => {
  const t = await makeSchool(path.join(tmp, 't-n10'), { games: [files.a, files.b] });
  const dir = path.join(tmp, 's-n10');
  const s0 = source(t, countingNet(1), dir); // каталог без сети: положим вручную
  s0.close();
  fs.copyFileSync(t.lib.catalogPath, path.join(dir, 'catalog.json'));
  const [ha, hb] = [hashOf(t, 'a'), hashOf(t, 'b')];
  fs.writeFileSync(path.join(dir, 'cache', `${ha}.part`), Buffer.alloc(1000));
  fs.writeFileSync(path.join(dir, 'cache', `${hb}.part`), Buffer.alloc(1000));
  fs.writeFileSync(path.join(dir, 'cache', '.part-0123456789abcdef'), 'М2');
  const real = Date.now();
  clock = real;
  let s = source(t, countingNet(1), dir);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'cache')).sort(), [`${ha}.part`, `${hb}.part`].sort(), 'перезапуск: .part на месте, временный файл М2 удалён');
  assert.equal(gameOf(s, 'a').progress, Math.floor((1000 / t.lib.games().find((g) => g.id === 'a').bytes) * 100));
  s.close();
  // Игру b сняли: её .part удаляется
  await t.lib.unpublish('b');
  fs.copyFileSync(t.lib.catalogPath, path.join(dir, 'catalog.json'));
  s = source(t, countingNet(1), dir);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'cache')), [`${ha}.part`]);
  s.close();
  // Через 7 дней и минуту — удалён
  clock = real + 7 * 24 * 3600 * 1000 + 60000;
  s = source(t, countingNet(1), dir);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'cache')), []);
  s.close();
  clock = null;
});

test('сеть ученика: 206 только с того места, где остановились, и с тем же общим размером; 503 с Retry-After', async () => {
  const data = crypto.randomBytes(5000);
  const replies = [];
  const s = http.createServer((req, res) => { const r = replies.shift(); r(req, res); });
  const port = 40000 + crypto.randomInt(20000);
  await new Promise((r) => s.listen(port, '127.0.0.1', r));
  const net = createSchoolNet({ port, interfaces: () => ({}) });
  const file = path.join(tmp, 'sn.part');
  const p = `/v1/blobs/sha256/${sha(data)}`;
  const opts = (from) => ({ maxBytes: data.length, file, resume: { from, total: data.length, tag: `"${sha(data)}"` } });
  try {
    fs.writeFileSync(file, data.subarray(0, 2000));
    let seen = null;
    replies.push((req, res) => { seen = req.headers; res.writeHead(206, { 'Content-Range': `bytes 2000-4999/5000`, 'Content-Length': 3000 }); res.end(data.subarray(2000)); });
    const r = await net.get('127.0.0.1', p, opts(2000));
    assert.equal(seen.range, 'bytes=2000-');
    assert.equal(seen['if-range'], `"${sha(data)}"`);
    assert.equal(r.bytes, 5000);
    assert.ok(fs.readFileSync(file).equals(data));

    for (const [name, cr] of [['не с того места', 'bytes 1999-4999/5000'], ['другой размер', 'bytes 2000-4999/6000'], ['без заголовка', null], ['не до конца', 'bytes 2000-3999/5000']]) {
      fs.writeFileSync(file, data.subarray(0, 2000));
      replies.push((_req, res) => { res.writeHead(206, { ...(cr ? { 'Content-Range': cr } : {}), 'Content-Length': 3000 }); res.end(data.subarray(2000)); });
      await assert.rejects(net.get('127.0.0.1', p, opts(2000)), (e) => e.code === 'range', name);
    }
    // 200 в ответ на докачку — файл пишется заново, а не дописывается
    fs.writeFileSync(file, Buffer.alloc(2000));
    replies.push((_req, res) => { res.writeHead(200, { 'Content-Length': 5000 }); res.end(data); });
    await net.get('127.0.0.1', p, opts(2000));
    assert.ok(fs.readFileSync(file).equals(data));
    // 206 без нашей докачки не принимается
    replies.push((_req, res) => { res.writeHead(206, { 'Content-Range': 'bytes 0-4999/5000', 'Content-Length': 5000 }); res.end(data); });
    await assert.rejects(net.get('127.0.0.1', p, { maxBytes: 5000 }), (e) => e.code === 'range');
    replies.push((_req, res) => { res.writeHead(503, { 'Retry-After': '17', 'Content-Length': 0 }); res.end(); });
    await assert.rejects(net.get('127.0.0.1', p, opts(0)), (e) => e.code === 'busy' && e.retryAfter === 17);
    // Обрыв при докачке не удаляет недокачанное
    fs.writeFileSync(file, data.subarray(0, 2000));
    replies.push((_req, res) => { res.writeHead(206, { 'Content-Range': 'bytes 2000-4999/5000', 'Content-Length': 3000 }); res.write(data.subarray(2000, 3000)); setTimeout(() => res.destroy(), 50); });
    await assert.rejects(net.get('127.0.0.1', p, opts(2000)), (e) => e.code === 'aborted' || e.code === 'io');
    assert.ok(fs.statSync(file).size >= 2000);
  } finally {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});
