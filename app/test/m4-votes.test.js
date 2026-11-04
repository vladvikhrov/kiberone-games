'use strict';
/* Этап М4: оценки по сети. Модуль голосов, сервер тьютора (/v1/votes, /v1/ratings, X-K1-Day), сеть ученика (post),
   очередь голосов, дата дня и рейтинг с сервера в net-source. К20а, К20б, К20в, К27, К29, Р1, Р2, Р4.
   Сервер на loopback, ученики — разные адреса 127.0.0.x. Каждая проверка защиты — с контрольным прогоном без неё. */
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const R = require('../shared/ratings');
const V = require('../desktop/tutor/votes');
const { createServer } = require('../desktop/tutor/server');
const schoolNet = require('../desktop/school-net');
const { createNetSource } = require('../desktop/vitrina/net-source');
const { createStore } = require('../desktop/vitrina/store');
const { createApi } = require('../desktop/vitrina/api');
const { keygen, pack } = require('../kibpack/pack');
const { makeSchool } = require('../redteam/school-fixture');

const { createSchoolNet, filter } = schoolNet;
const APP = path.join(__dirname, '..');
const IFACE = { name: 'test', address: '127.0.0.1', netmask: '255.255.255.0', prefix: 24, network: '127.0.0.0', broadcast: '127.0.0.255' };
const MB = 1024 * 1024;
const CATALOG = new Map([['tri-rezhima', new Set(['training', 'timed', 'custom'])], ['kiberpochta', new Set(['default'])]]);
const originalHost = filter.host;
const originalGuard = { ...V.guard };
let tmp;
let school; // настоящая школа с «Тремя режимами» и большой игрой
const dirOf = (name) => { const d = path.join(tmp, name); fs.mkdirSync(d, { recursive: true }); return d; };
const body = (o) => Buffer.from(JSON.stringify(o));
const ratingsFile = (dir) => path.join(dir, 'ratings.json');
const countOf = (dir, game, mode) => {
  if (!fs.existsSync(ratingsFile(dir))) return 0;
  const r = R.parseRatings(fs.readFileSync(ratingsFile(dir), 'utf8'));
  return Object.values(R.countsOf(r, game, mode)).reduce((a, b) => a + b, 0);
};

/* Поиск метки по всем файлам папки: текстом в UTF-8 и UTF-16 и байтами (как findOnDisk теста-«взломщика»). */
function findOnDisk(dir, needles) {
  const found = [];
  const walk = (d) => {
    for (const item of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.isFile()) {
        const data = fs.readFileSync(full);
        for (const n of needles) if (data.includes(n)) found.push(`${path.relative(dir, full)}: ${JSON.stringify(n.toString('latin1'))}`);
      }
    }
  };
  walk(dir);
  return found;
}
const needlesFor = (ip, t) => {
  const text = [ip, String(Math.floor(t / 1000)), String(t), new Date(t).toISOString().slice(0, 16)];
  return [...text.flatMap((x) => [Buffer.from(x, 'utf8'), Buffer.from(x, 'utf16le')]), Buffer.from(ip.split('.').map(Number))];
};

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kibm4-'));
  keygen('avtor', path.join(tmp, 'keys'));
  const tri = path.join(tmp, 'tri.kibgames');
  await pack(path.join(APP, 'testgames', 'tri-rezhima'), { key: path.join(tmp, 'keys', 'avtor.key.pem'), out: tri });
  const bigDir = path.join(tmp, 'src-big');
  fs.mkdirSync(bigDir, { recursive: true });
  fs.writeFileSync(path.join(bigDir, 'kibgame.json'), JSON.stringify({ id: 'big', version: '1.0.0', title: 'Большая', description: 'Проверка', authors: ['Автор'],
    grades: '4–5 класс', minutes: 30, topic: 'Тест', minAppVersion: '1.0.0', entry: 'index.html' }));
  fs.writeFileSync(path.join(bigDir, 'index.html'), '<!doctype html><title>big</title>');
  fs.writeFileSync(path.join(bigDir, 'video.webm'), crypto.randomBytes(4 * MB));
  const big = path.join(tmp, 'big.kibgames');
  await pack(bigDir, { key: path.join(tmp, 'keys', 'avtor.key.pem'), out: big });
  school = await makeSchool(path.join(tmp, 'tutor'), { games: [tri, big] });
  filter.host = (ip, list) => (ip === '127.0.0.1' ? IFACE : originalHost(ip, list));
});
after(() => { filter.host = originalHost; Object.assign(V.guard, originalGuard); fs.rmSync(tmp, { recursive: true, force: true }); });

/* ---------------- Модуль голосов ---------------- */

test('К20а: повтор за день — 409 и счётчик не растёт; другой режим, другой адрес, следующий день — 204; контроль: без защиты +20', () => {
  for (const mode of ['защита', 'контроль']) {
    const dir = dirOf(`k20a-${mode}`);
    let clock = Date.parse('2026-11-04T10:00:00');
    if (mode === 'контроль') V.guard.repeated = () => false;
    try {
      const v = V.createVotes({ dir, now: () => clock });
      const statuses = [];
      for (let i = 0; i < 20; i += 1) statuses.push(v.submit('127.0.0.7', body({ game: 'tri-rezhima', mode: 'timed', value: 5 }), CATALOG).status);
      if (mode === 'контроль') {
        assert.equal(countOf(dir, 'tri-rezhima', 'timed'), 20, 'контроль: без множества HMAC все 20 голосов посчитаны, иначе тест пустой');
        continue;
      }
      assert.deepEqual([statuses[0], new Set(statuses.slice(1))], [204, new Set([409])]);
      assert.equal(countOf(dir, 'tri-rezhima', 'timed'), 1);
      assert.equal(v.submit('127.0.0.7', body({ game: 'tri-rezhima', mode: 'custom', value: 3 }), CATALOG).status, 204, 'другой режим');
      assert.equal(v.submit('127.0.0.8', body({ game: 'tri-rezhima', mode: 'timed', value: 4 }), CATALOG).status, 204, 'другой ноутбук');
      clock += 24 * 3600 * 1000;
      assert.equal(v.submit('127.0.0.7', body({ game: 'tri-rezhima', mode: 'timed', value: 2 }), CATALOG).status, 204, 'назавтра снова можно');
      assert.equal(v.submit('127.0.0.7', body({ game: 'tri-rezhima', mode: 'timed', value: 2 }), CATALOG).status, 409);
      assert.equal(countOf(dir, 'tri-rezhima', 'timed'), 3);
      assert.equal(v.marks(), 1, 'отметки прошлого дня забыты вместе с солью');
    } finally { Object.assign(V.guard, originalGuard); }
  }
});

test('К20а: соль живёт весь запуск программы тьютора, выключение раздачи (новый сервер) её не сбрасывает', async () => {
  const dir = dirOf('k20a-serve');
  const v = V.createVotes({ dir });
  for (let round = 0; round < 2; round += 1) {
    const s = createServer({ iface: IFACE, fingerprint: 'x', port: 40000 + crypto.randomInt(20000), blobPath: () => '/nope', votes: v,
      snapshot: () => ({ catalog: Buffer.from('{}'), seq: 1, blobs: new Set(), modes: CATALOG }) });
    await s.start();
    const r = await postVote(s.port, { game: 'kiberpochta', mode: 'default', value: 4 }, { from: '127.0.0.9' });
    await s.stop();
    assert.equal(r.status, round === 0 ? 204 : 409, `включение раздачи № ${round + 1}`);
  }
  assert.equal(countOf(dir, 'kiberpochta', 'default'), 1);
});

test('К27: мусор не попадает в ratings.json, файл побайтно прежний; контроль: без проверки каталога ключ vzlom в файле', () => {
  const bad = [
    { game: 'vzlom', mode: 'default', value: 5 }, { game: 'tri-rezhima', mode: 'vzlom', value: 5 }, { game: 'kiberpochta', mode: 'training', value: 5 },
    { game: 'tri-rezhima', mode: 'timed', value: 0 }, { game: 'tri-rezhima', mode: 'timed', value: 6 }, { game: 'tri-rezhima', mode: 'timed', value: 2.5 },
    { game: 'tri-rezhima', mode: 'timed', value: '5' }, { game: 'tri-rezhima', mode: 'timed', value: 5, extra: 1 }, { game: 'tri-rezhima', mode: 'timed' },
    { game: '../x', mode: 'timed', value: 5 }, { game: 'TRI', mode: 'timed', value: 5 }, [1, 2, 3], null, 'строка',
  ];
  const raw = [Buffer.from('{"game":"tri-rezhima","mode":"timed","value":5,"__proto__":{"x":1}}'), Buffer.from('не json'), Buffer.from(''), Buffer.from('{"game":"tri-rezhima","mode":"timed","value":5'),
    Buffer.from('{"__proto__":{"game":"tri-rezhima"},"mode":"timed","value":5}')];
  const dir = dirOf('k27');
  const v = V.createVotes({ dir });
  assert.equal(v.submit('127.0.0.2', body({ game: 'tri-rezhima', mode: 'timed', value: 5 }), CATALOG).status, 204);
  const before = fs.readFileSync(ratingsFile(dir));
  for (const b of [...bad.map(body), ...raw]) assert.equal(v.submit('127.0.0.3', b, CATALOG).status, 400, b.toString());
  assert.ok(fs.readFileSync(ratingsFile(dir)).equals(before), 'файл не изменился');
  assert.deepEqual(fs.readdirSync(dir), ['ratings.json']);

  const ctl = dirOf('k27-control');
  V.guard.known = () => true;
  try {
    const c = V.createVotes({ dir: ctl });
    assert.equal(c.submit('127.0.0.3', body({ game: 'vzlom', mode: 'default', value: 5 }), CATALOG).status, 204);
    assert.ok(fs.readFileSync(ratingsFile(ctl), 'utf8').includes('vzlom'), 'контроль: мусор дошёл до файла, иначе тест пустой');
  } finally { Object.assign(V.guard, originalGuard); }
});

test('К20б: в папке тьютора нет адреса ученика и времени голоса; контроль: вариант с журналом находит метку', () => {
  const ip = '127.0.77.201';
  const t = Date.parse('2026-11-04T10:17:00');
  for (const mode of ['защита', 'контроль']) {
    const dir = dirOf(`k20b-${mode}`);
    if (mode === 'контроль') {
      V.guard.record = (d, vote) => fs.appendFileSync(path.join(d, 'journal.log'), `${vote.ip} ${vote.at} ${new Date(vote.at).toISOString()} ${vote.game} ${vote.value}\n`);
    }
    try {
      const v = V.createVotes({ dir, now: () => t });
      for (const m of ['training', 'timed', 'custom']) assert.equal(v.submit(ip, body({ game: 'tri-rezhima', mode: m, value: 4 }), CATALOG).status, 204);
      const found = findOnDisk(dir, needlesFor(ip, t));
      if (mode === 'контроль') { assert.ok(found.length > 0, 'контроль: журнал с адресом найден, иначе поиск пустой'); continue; }
      assert.deepEqual(found, []);
      const saved = JSON.parse(fs.readFileSync(ratingsFile(dir), 'utf8'));
      assert.deepEqual(R.parseRatings(JSON.stringify(saved)), saved, 'ratings.json строго по схеме: только счётчики');
    } finally { Object.assign(V.guard, originalGuard); }
  }
});

test('К20в: при n < 5 распределение не раскрывается; контроль: раскрытие без порога тест замечает', () => {
  const reveals = (view) => Object.values(view.games).some((g) => (g.counts && g.n < 5) || Object.values(g.modes).some((m) => m.counts && m.n < 5));
  const dir = dirOf('k20v');
  const v = V.createVotes({ dir });
  for (let i = 0; i < 4; i += 1) v.submit(`127.0.0.${10 + i}`, body({ game: 'tri-rezhima', mode: 'timed', value: 5 }), CATALOG);
  let view = v.view(CATALOG);
  assert.deepEqual(view.games['tri-rezhima'], { n: 4, modes: { timed: { n: 4 } } });
  assert.equal(reveals(view), false);
  assert.deepEqual(R.summarizeNode(view.games['tri-rezhima'].modes.timed), { n: 4, few: true, avg: null });
  v.submit('127.0.0.20', body({ game: 'tri-rezhima', mode: 'timed', value: 3 }), CATALOG);
  v.submit('127.0.0.20', body({ game: 'tri-rezhima', mode: 'custom', value: 1 }), CATALOG);
  view = v.view(CATALOG);
  assert.deepEqual(view.games['tri-rezhima'].modes.timed, { n: 5, counts: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 4 } });
  assert.deepEqual(view.games['tri-rezhima'].modes.custom, { n: 1 });
  assert.equal(view.games['tri-rezhima'].n, 6);
  assert.equal(R.summarizeNode(view.games['tri-rezhima'].modes.timed).avg, 4.6);
  assert.equal(view.games.kiberpochta, undefined, 'без оценок игры нет в ответе');
  assert.equal(reveals(view), false);
  // Контроль: ответ без порога (как ratings.json целиком) детектор ловит
  const raw = { format: 1, games: { 'tri-rezhima': { n: 1, counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 }, modes: { custom: { n: 1, counts: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 } } } } } };
  assert.equal(reveals(raw), true, 'контроль');
  // Снятая игра пропадает из ответа
  assert.deepEqual(v.view(new Map([['kiberpochta', new Set(['default'])]])).games, {});
});

test('Р4: при 50 000 отметок за день — 429, отметки не растут', () => {
  const v = V.createVotes({ dir: dirOf('r4-limit'), maxMarks: 3 });
  const st = [1, 2, 3, 4, 5].map((i) => v.submit(`127.0.1.${i}`, body({ game: 'kiberpochta', mode: 'default', value: 5 }), CATALOG).status);
  assert.deepEqual(st, [204, 204, 204, 429, 429]);
  assert.equal(v.marks(), 3);
  assert.equal(V.MAX_MARKS, 50000);
});

test('Испорченный ratings.json откладывается, а не затирается', () => {
  const dir = dirOf('bad-file');
  fs.writeFileSync(ratingsFile(dir), '{"format":1,"games":{"x":{"y":{"1":-1}}}}');
  const v = V.createVotes({ dir });
  assert.deepEqual(v.ratings(), R.emptyRatings());
  assert.ok(fs.readdirSync(dir).some((n) => n.startsWith('ratings.json.bad-')));
});

/* ---------------- Сервер ---------------- */

function postVote(port, data, { from = '127.0.0.2', headers = {}, raw = null } = {}) {
  const payload = raw !== null ? raw : Buffer.from(JSON.stringify(data));
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/v1/votes', method: 'POST', localAddress: from, agent: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length, ...headers } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    req.on('error', (err) => resolve({ status: 0, error: err.code }));
    req.end(payload);
  });
}
function get(port, p, { from = '127.0.0.2', headers = {}, hold = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, localAddress: from, agent: false, headers }, (res) => {
      if (hold) { res.pause(); resolve({ status: res.statusCode, headers: res.headers, res }); return; }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}
function snapshotOf(lib) {
  return () => {
    const blobs = new Set();
    const modes = new Map();
    for (const g of lib.games()) { blobs.add(g.sha256); modes.set(g.id, new Set(g.modes.map((m) => m.id))); }
    return { catalog: fs.readFileSync(lib.catalogPath), seq: lib.seq(), blobs, modes };
  };
}
async function tutorServer(dir, options = {}) {
  const votes = options.votes || V.createVotes({ dir });
  const s = createServer({ iface: IFACE, fingerprint: school.school.fingerprint, snapshot: snapshotOf(school.lib), blobPath: (h) => path.join(school.lib.blobsDir, h),
    port: 40000 + crypto.randomInt(20000), votes, ...options });
  await s.start();
  return { s, votes };
}

test('Сервер: POST /v1/votes — 204, 409, 413, 411, 415, 403 при Origin, 405 на GET; X-K1-Day в ответах каталога и рейтинга, 304 по ETag', async () => {
  const dir = dirOf('srv');
  const { s, votes } = await tutorServer(dir);
  try {
    const ok = { game: 'tri-rezhima', mode: 'training', value: 4 };
    const r1 = await postVote(s.port, ok);
    assert.equal(r1.status, 204);
    assert.match(r1.headers['x-k1-day'], /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(r1.headers['x-k1-day'], R.localDay(new Date()));
    assert.equal((await postVote(s.port, ok)).status, 409);
    assert.equal((await postVote(s.port, ok, { from: '127.0.0.3' })).status, 204);
    assert.equal((await postVote(s.port, null, { raw: Buffer.alloc(257, 0x20) })).status, 413);
    assert.equal((await postVote(s.port, { game: 'big', mode: 'default', value: 2 }, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await postVote(s.port, { game: 'big', mode: 'default', value: 2 }, { headers: { Origin: 'http://evil.example' } })).status, 403);
    assert.equal((await postVote(s.port, { game: 'vzlom', mode: 'default', value: 2 })).status, 400);
    assert.equal((await get(s.port, '/v1/votes')).status, 405);
    // Без Content-Length (chunked) и без тела
    const chunked = await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: s.port, path: '/v1/votes', method: 'POST', localAddress: '127.0.0.4', agent: false, headers: { 'Content-Type': 'application/json' } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', () => resolve(0));
      req.write('{"game":"big",'); req.end('"mode":"default","value":2}');
    });
    assert.equal(chunked, 413);
    assert.equal(countOf(dir, 'big', 'default'), 0, 'ни один кривой запрос не посчитан');

    const cat = await get(s.port, '/v1/catalog');
    assert.equal(cat.headers['x-k1-day'], R.localDay(new Date()));
    const cat304 = await get(s.port, '/v1/catalog', { headers: { 'If-None-Match': cat.headers.etag } });
    assert.equal(cat304.status, 304);
    assert.equal(cat304.headers['x-k1-day'], R.localDay(new Date()));
    const rat = await get(s.port, '/v1/ratings');
    assert.equal(rat.status, 200);
    assert.deepEqual(JSON.parse(rat.body), { format: 1, games: { 'tri-rezhima': { n: 2, modes: { training: { n: 2 } } } } });
    assert.equal((await get(s.port, '/v1/ratings', { headers: { 'If-None-Match': rat.headers.etag } })).status, 304);
    await postVote(s.port, ok, { from: '127.0.0.5' });
    const rat2 = await get(s.port, '/v1/ratings', { headers: { 'If-None-Match': rat.headers.etag } });
    assert.equal(rat2.status, 200, 'после голоса ETag другой');
    assert.equal(JSON.parse(rat2.body).games['tri-rezhima'].n, 3);
    assert.equal(votes.marks(), 3);
  } finally { await s.stop(); }
  // Сервер без модуля голосов (М2, М3) голоса не принимает
  const plain = createServer({ iface: IFACE, fingerprint: 'x', port: 40000 + crypto.randomInt(20000), blobPath: () => '/nope', snapshot: () => ({ catalog: Buffer.from('{}'), seq: 1, blobs: new Set() }) });
  await plain.start();
  try {
    assert.equal((await postVote(plain.port, { game: 'big', mode: 'default', value: 2 })).status, 404);
    assert.equal((await get(plain.port, '/v1/ratings')).status, 404);
  } finally { await plain.stop(); }
});

test('К29: голоса не ждут слота и не тормозятся пределом скорости; контроль: большой файл в это время — 503', async () => {
  const dir = dirOf('k29');
  const { s } = await tutorServer(dir, { rate: 64 * 1024 }); // ведро почти пустое: 64 КБ/с
  const bigHex = school.lib.games().find((g) => g.id === 'big').sha256;
  const held = [];
  try {
    for (const from of ['127.0.0.31', '127.0.0.32', '127.0.0.33']) held.push(await get(s.port, `/v1/blobs/sha256/${bigHex}`, { from, hold: true }));
    assert.deepEqual(held.map((r) => r.status), [200, 200, 200]);
    const loadBefore = s.load();
    assert.equal(loadBefore.downloading, 3);
    const control = await get(s.port, `/v1/blobs/sha256/${bigHex}`, { from: '127.0.0.34' });
    assert.equal(control.status, 503, 'контроль: слоты действительно заняты, иначе тест пустой');
    const t0 = Date.now();
    const times = await Promise.all(Array.from({ length: 15 }, async (_, i) => {
      const start = Date.now();
      const r = await postVote(s.port, { game: 'tri-rezhima', mode: 'timed', value: 1 + (i % 5) }, { from: `127.0.0.${101 + i}` });
      return { status: r.status, ms: Date.now() - start };
    }));
    assert.deepEqual(new Set(times.map((x) => x.status)), new Set([204]));
    assert.ok(times.every((x) => x.ms < 1000), `каждый голос быстрее 1 с: ${times.map((x) => x.ms).join(', ')}`);
    assert.ok(Date.now() - t0 < 2000);
    const rat = await get(s.port, '/v1/ratings', { from: '127.0.0.39' });
    assert.equal(rat.status, 200);
    assert.equal(s.load().downloading, 3, 'голоса не заняли и не освободили слоты');
    assert.equal(countOf(dir, 'tri-rezhima', 'timed'), 15);
  } finally { for (const r of held) r.res.destroy(); await s.stop(); }
});

test('Р4: медленное тело голоса обрывается по таймауту, 1000 голосов подряд с одного адреса не роняют раздачу', async () => {
  const dir = dirOf('r4');
  const { s } = await tutorServer(dir, { voteBodyMs: 300 });
  try {
    const closedIn = await new Promise((resolve) => {
      const start = Date.now();
      const sock = net.connect({ host: '127.0.0.1', port: s.port, localAddress: '127.0.0.6' }, () => {
        sock.write('POST /v1/votes HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"game":');
      });
      sock.on('close', () => resolve(Date.now() - start));
      sock.on('error', () => {});
      sock.resume();
    });
    assert.ok(closedIn < 2000, `соединение закрыто через ${closedIn} мс`);
    const statuses = new Map();
    for (let i = 0; i < 1000; i += 1) {
      const r = await postVote(s.port, { game: 'big', mode: 'default', value: 3 }, { from: '127.0.0.7' });
      statuses.set(r.status, (statuses.get(r.status) || 0) + 1);
    }
    assert.deepEqual([...statuses], [[204, 1], [409, 999]]);
    assert.equal((await get(s.port, '/v1/catalog')).status, 200, 'каталог отдаётся');
    assert.equal(countOf(dir, 'big', 'default'), 1);
  } finally { await s.stop(); }
});

/* ---------------- Ученик ---------------- */

function source(dir, port, options = {}, clock = () => Date.now()) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ school: school.school.fingerprint, seq: 0, server: '127.0.0.1' }));
  const n = createSchoolNet({ port, interfaces: () => ({}) });
  const posts = [];
  const post = n.post;
  n.post = async (...args) => { posts.push(args[2]); return post(...args); };
  n.posts = posts;
  const s = createNetSource({
    school: school.school, net: n, dir, appVersion: '1.1.0', now: clock, random: () => 0.5,
    options: { pollMs: 1e9, retryMs: [1e9], askAfterMs: 15000, discoverMs: 50, freeBytes: () => 100 * 1024 * MB, autoBytes: 0, ...options },
  });
  s.load();
  return { s, net: n };
}
const waitFor = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 20)); }
  return fn();
};

test('school-net: post по фильтру адреса, без DNS, тело до 256 байт; get отдаёт X-K1-Day только строгого вида', async () => {
  const { s } = await tutorServer(dirOf('sn'));
  const n = createSchoolNet({ port: s.port, interfaces: () => ({}) });
  try {
    const r = await n.post('127.0.0.1', '/v1/votes', { game: 'big', mode: 'default', value: 5 });
    assert.deepEqual(r, { status: 204, day: R.localDay(new Date()) });
    await assert.rejects(n.post('8.8.8.8', '/v1/votes', {}), { code: 'not-subnet' });
    await assert.rejects(n.post('localhost', '/v1/votes', {}), { code: 'not-ip' });
    await assert.rejects(n.post('127.0.0.1', '/v1/votes', { game: 'x'.repeat(300) }), { code: 'too-big' });
    const c = await n.get('127.0.0.1', '/v1/catalog', { maxBytes: 2 * MB });
    assert.equal(c.day, R.localDay(new Date()));
  } finally { await s.stop(); }
  // Кривой заголовок не принимается
  const fake = http.createServer((req, res) => { res.writeHead(200, { 'X-K1-Day': '2026-11-04; rm -rf', 'Content-Length': 2 }); res.end('{}'); });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  try {
    const n2 = createSchoolNet({ port: fake.address().port, interfaces: () => ({}) });
    assert.equal((await n2.get('127.0.0.1', '/v1/catalog', { maxBytes: 100 })).day, null);
    assert.equal((await n2.post('127.0.0.1', '/v1/votes', {})).day, null);
  } finally { fake.close(); }
});

test('К28 (логика): голос в очереди ждёт, пока идёт игра и пока нет сервера; уходит после закрытия игры и при возвращении сервера', async () => {
  const dir = dirOf('k28-tutor');
  const votes = V.createVotes({ dir });
  let { s } = await tutorServer(dir, { votes });
  const port = s.port;
  const st = source(dirOf('k28-student'), port);
  await st.s.cycle();
  assert.ok(st.s.view().online);
  // Игра запущена: сеть остановлена, голос в очереди
  st.s.pause();
  assert.deepEqual(st.s.vote('tri-rezhima', 'training', 5), { ok: true, queued: true });
  assert.equal(st.s.votePending('tri-rezhima', 'training'), true);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(st.net.posts.length, 0, 'пока идёт игра, ни одного голоса в сеть');
  assert.equal(countOf(dir, 'tri-rezhima', 'training'), 0);
  // Сервер пропал, игра закрыта: голос по-прежнему ждёт
  await s.stop();
  st.s.resume();
  await st.s.cycle();
  assert.equal(st.s.votePending('tri-rezhima', 'training'), true);
  // Сервер вернулся: голос ушёл
  s = createServer({ iface: IFACE, fingerprint: school.school.fingerprint, snapshot: snapshotOf(school.lib), blobPath: () => '/nope', port, votes });
  await s.start();
  try {
    await st.s.cycle();
    assert.equal(st.s.votePending('tri-rezhima', 'training'), false);
    assert.equal(countOf(dir, 'tri-rezhima', 'training'), 1);
    // Повтор того же режима (например, после очистки state.json): сервер отвечает 409, голос из очереди убран, счётчик тот же
    st.s.vote('tri-rezhima', 'training', 1);
    assert.ok(await waitFor(() => !st.s.votePending('tri-rezhima', 'training')));
    assert.equal(countOf(dir, 'tri-rezhima', 'training'), 1);
    assert.ok(st.s.view().log.some((l) => l.includes('уже была')));
  } finally { st.s.close(); await s.stop(); }
});

test('Р1: день для правила «одна оценка в день» — по часам тьютора; без сервера — по своим часам', async () => {
  const { s } = await tutorServer(dirOf('r1'));
  try {
    // Часы ученика на день вперёд
    const st = source(dirOf('r1-student'), s.port, {}, () => Date.now() + 24 * 3600 * 1000);
    assert.equal(st.s.day(), null);
    await st.s.cycle();
    assert.equal(st.s.day(), R.localDay(new Date()));
    const store = createStore(dirOf('r1-store'), { now: () => new Date(Date.now() + 24 * 3600 * 1000) });
    assert.equal(store.day(st.s.day()).votedOn, R.localDay(new Date()), 'по дате тьютора');
    assert.equal(store.day(null).votedOn, R.localDay(new Date(Date.now() + 24 * 3600 * 1000)), 'без сервера — свои часы');
    assert.deepEqual(store.markDay('big', 'default', st.s.day()), { ok: true });
    assert.deepEqual(store.markDay('big', 'default', st.s.day()), { ok: false, reason: 'already' });
    assert.equal(fs.existsSync(path.join(dirOf('r1-store'), 'ratings.json')), false, 'на настроенном ноутбуке звёзды на диск ученика не пишутся');
    st.s.close();
  } finally { await s.stop(); }
});

test('Р2: витрина показывает рейтинг с сервера, кривой ответ не показывается, без сервера — прежний', async () => {
  const dir = dirOf('r2');
  const votes = V.createVotes({ dir });
  for (let i = 0; i < 5; i += 1) votes.submit(`127.0.5.${i}`, body({ game: 'tri-rezhima', mode: 'timed', value: 4 + (i % 2) }), new Map([['tri-rezhima', new Set(['timed'])]]));
  const { s } = await tutorServer(dir, { votes });
  const st = source(dirOf('r2-student'), s.port);
  try {
    await st.s.cycle();
    assert.deepEqual(st.s.rating('tri-rezhima', 'timed'), { n: 5, few: false, avg: 4.4 });
    assert.deepEqual(st.s.rating('tri-rezhima', null), { n: 5, few: false, avg: 4.4 });
    assert.deepEqual(st.s.rating('tri-rezhima', 'custom'), { n: 0, few: true, avg: null });
    // Окно витрины видит то же через api
    const played = new Set(['tri-rezhima/custom']);
    const store = createStore(dirOf('r2-store'));
    const api = createApi({ getCatalog: () => ({ games: st.s.games(), skipped: [], missing: false, net: st.s.view() }), store, launch: async () => ({ ok: true }), played, netVotes: st.s });
    const view = api['catalog.list']().games.find((g) => g.id === 'tri-rezhima');
    assert.equal(view.rating.avg, 4.4);
    const r = api['vote.send']('tri-rezhima', 'custom', 2);
    assert.equal(r.ok, true);
    assert.equal(r.net, true);
    assert.ok(await waitFor(() => countOf(dir, 'tri-rezhima', 'custom') === 1), 'голос из окна дошёл до тьютора');
    assert.ok(await waitFor(() => st.s.rating('tri-rezhima', 'custom').n === 1), 'рейтинг обновился сразу после голоса');
    assert.deepEqual(api['vote.send']('tri-rezhima', 'custom', 2), { ok: false, reason: 'already' });
    assert.equal(api['catalog.list']().games.find((g) => g.id === 'tri-rezhima').modes.find((m) => m.id === 'custom').votePending, false);
  } finally { await s.stop(); }
  // Без сервера — прежний рейтинг
  await st.s.cycle();
  assert.equal(st.s.rating('tri-rezhima', 'timed').avg, 4.4);
  st.s.close();
});

test('Р2: разбор рейтинга с сервера строгий', () => {
  const cat = new Map([['g', new Set(['a', 'b'])]]);
  const c5 = { 1: 0, 2: 0, 3: 0, 4: 1, 5: 4 };
  const good = { format: 1, games: { g: { n: 7, counts: { 1: 0, 2: 0, 3: 0, 4: 3, 5: 4 }, modes: { a: { n: 5, counts: c5 }, b: { n: 2 } } } } };
  assert.ok(R.parseRatingsView(JSON.stringify(good), cat));
  const bad = [
    { ...good, extra: 1 }, { format: 2, games: {} },
    { format: 1, games: { чужая: { n: 1, modes: {} } } },
    { format: 1, games: { g: { n: 1, modes: { c: { n: 1 } } } } },
    { format: 1, games: { g: { n: 2, counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 2 }, modes: {} } } }, // распределение при n < 5
    { format: 1, games: { g: { n: 5, counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 4 }, modes: {} } } }, // сумма не равна n
    { format: 1, games: { g: { n: 6, modes: {} } } }, // n >= 5 без распределения
    { format: 1, games: { g: { n: 0, modes: {} } } },
    { format: 1, games: { g: { n: 5, counts: { ...c5, 6: 0 }, modes: {} } } },
    { format: 1, games: { g: { n: 1.5, modes: {} } } },
  ];
  for (const b of bad) assert.equal(R.parseRatingsView(JSON.stringify(b), cat), null, JSON.stringify(b));
  assert.equal(R.parseRatingsView('{"format":1,"games":{"__proto__":{"n":1,"modes":{}}}}', cat), null);
  assert.equal(R.parseRatingsView('не json', cat), null);
});

test('Р3: программа тьютора видит голоса без перезапуска, «Сохранить срез» пишет копию ratings.json с датой в имени', async () => {
  const { createTutorApi, CHANNELS } = require('../desktop/tutor/api');
  const dir = dirOf('r3');
  const votes = V.createVotes({ dir });
  const saved = [];
  const api = createTutorApi({
    key: school.key, getLibrary: () => school.lib, ratings: () => votes.ratings(), tryGame: async () => {}, today: () => '2026-11-04',
    dialogs: { saveRatings: async (text, name) => { saved.push({ text, name }); return true; } },
  });
  assert.ok(CHANNELS.includes('ratings.saveSnapshot'));
  const modes = new Map([['tri-rezhima', new Set(['training', 'timed', 'custom'])]]);
  for (let i = 0; i < 6; i += 1) votes.submit(`127.0.0.${50 + i}`, body({ game: 'tri-rezhima', mode: 'timed', value: 5 - (i % 2) }), modes);
  const g = api['state.get']().games.find((x) => x.id === 'tri-rezhima');
  const timed = g.modes.find((m) => m.id === 'timed');
  assert.deepEqual(timed.counts, { 1: 0, 2: 0, 3: 0, 4: 3, 5: 3 });
  assert.equal(timed.rating.avg, 4.5);
  const r = await api['ratings.saveSnapshot']();
  assert.equal(r.ok, true);
  assert.equal(saved[0].name, 'ocenki-2026-11-04.json');
  assert.deepEqual(JSON.parse(saved[0].text), JSON.parse(fs.readFileSync(ratingsFile(dir), 'utf8')));
  await assert.rejects(async () => api['ratings.saveSnapshot']('лишнее'));
});
