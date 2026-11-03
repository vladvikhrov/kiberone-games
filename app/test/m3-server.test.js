'use strict';
/* Этап М3, сервер тьютора: слоты, 503 с Retry-After, предел скорости, Range и If-Range, таймаут простоя (К26, Н1, Н2).
   Сервер на loopback, ученики — разные адреса 127.0.0.x (localAddress), файлы — случайные байты. */
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { createServer, createBucket } = require('../desktop/tutor/server');

const IFACE = { name: 'test', address: '127.0.0.1', netmask: '255.255.255.0', prefix: 24, network: '127.0.0.0', broadcast: '127.0.0.255' };
const MB = 1024 * 1024;
let tmp;
const blobs = {};
const hex = (d) => crypto.createHash('sha256').update(d).digest('hex');

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kibm3s-'));
  for (const [name, size] of [['big', 4 * MB], ['huge', 40 * MB], ['small', 200 * 1024], ['outside', 2 * MB]]) {
    const data = crypto.randomBytes(size);
    blobs[name] = { data, hex: hex(data) };
    fs.writeFileSync(path.join(tmp, blobs[name].hex), data);
  }
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function serve(options = {}) {
  const port = 40000 + crypto.randomInt(20000);
  const known = new Set(['big', 'huge', 'small'].map((n) => blobs[n].hex)); // outside лежит рядом, но не в каталоге
  const s = createServer({
    iface: IFACE, fingerprint: 'x', port, blobPath: (h) => path.join(tmp, h),
    snapshot: () => ({ catalog: Buffer.from('{}'), seq: 1, blobs: known }), ...options,
  });
  await s.start();
  return s;
}

/* Запрос с адреса ученика. hold: не читать тело (держать соединение). Возвращает { status, headers, body, req, res }. */
function request(s, h, { from = '127.0.0.2', headers = {}, hold = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: s.port, path: `/v1/blobs/sha256/${h}`, localAddress: from, agent: false, headers }, (res) => {
      if (hold) { res.pause(); resolve({ status: res.statusCode, headers: res.headers, req, res }); return; }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}
const waitFor = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return fn();
};

test('Range: 206 с Content-Range, If-Range с другим значением — файл целиком, кривые диапазоны — 416, хеш не из каталога — 404', async () => {
  const s = await serve({ rate: 0 });
  try {
    const { data, hex: h } = blobs.big;
    const full = await request(s, h);
    assert.equal(full.status, 200);
    assert.equal(full.headers.etag, `"${h}"`);
    assert.equal(full.headers['accept-ranges'], 'bytes');
    assert.ok(full.body.equals(data));

    const tail = await request(s, h, { headers: { Range: `bytes=${MB}-`, 'If-Range': `"${h}"` } });
    assert.equal(tail.status, 206);
    assert.equal(tail.headers['content-range'], `bytes ${MB}-${data.length - 1}/${data.length}`);
    assert.ok(tail.body.equals(data.subarray(MB)));

    const mid = await request(s, h, { headers: { Range: 'bytes=10-19' } });
    assert.equal(mid.status, 206);
    assert.ok(mid.body.equals(data.subarray(10, 20)));

    const other = await request(s, h, { headers: { Range: `bytes=${MB}-`, 'If-Range': `"${blobs.small.hex}"` } });
    assert.equal(other.status, 200, 'другой ETag в If-Range — файл целиком');
    assert.ok(other.body.equals(data));

    for (const bad of [`bytes=${data.length}-`, 'bytes=5-1', 'bytes=0-1,5-6', 'bytes=-100', 'items=0-1', 'bytes=x-']) {
      const r = await request(s, h, { headers: { Range: bad } });
      assert.equal(r.status, 416, bad);
      assert.equal(r.headers['content-range'], `bytes */${data.length}`, bad);
    }
    assert.equal((await request(s, blobs.outside.hex, { headers: { Range: 'bytes=0-' } })).status, 404, 'Range не открывает файлы вне каталога');
    assert.equal((await request(s, h, { headers: { Range: 'bytes=0-', Origin: 'http://203.0.113.50' } })).status, 403);
  } finally { await s.stop(); }
});

test('Н1: не больше 3 больших файлов сразу и одного на адрес; четвёртый — 503 с Retry-After; мелкий файл идёт вне очереди', async () => {
  const s = await serve({ rate: 0 });
  const held = [];
  try {
    for (const from of ['127.0.0.2', '127.0.0.3', '127.0.0.4']) {
      const r = await request(s, blobs.huge.hex, { from, hold: true });
      assert.equal(r.status, 200, from);
      held.push(r);
    }
    assert.equal(s.load().downloading, 3);
    const fourth = await request(s, blobs.huge.hex, { from: '127.0.0.5' });
    assert.equal(fourth.status, 503);
    const after = Number(fourth.headers['retry-after']);
    assert.ok(after >= 2 && after <= 60, `Retry-After ${after}`);
    assert.equal(s.load().waiting, 1);
    const small = await request(s, blobs.small.hex, { from: '127.0.0.5' });
    assert.equal(small.status, 200, 'мелкий файл вне слотов');
    assert.ok(small.body.equals(blobs.small.data));

    // Тот же ноутбук попросил другой большой файл (нажали «Играть»): прежний ответ ему обрывается, слот переходит
    const again = await request(s, blobs.big.hex, { from: '127.0.0.2' });
    assert.equal(again.status, 200);
    assert.ok(again.body.equals(blobs.big.data));
    assert.ok(await waitFor(() => held[0].res.destroyed || held[0].res.complete === false), 'прежний ответ оборван');

    for (const r of held) r.req.destroy();
    assert.ok(await waitFor(() => s.load().downloading === 0), 'слоты освободились после обрыва');
    const fifth = await request(s, blobs.big.hex, { from: '127.0.0.5' });
    assert.equal(fifth.status, 200, 'после освобождения слот достаётся ждавшему');
    assert.equal(s.load().waiting, 0);
  } finally { for (const r of held) r.req.destroy(); await s.stop(); }
});

test('Н1, контроль: без слотов (slots = 15) 15 больших ответов идут одновременно', async () => {
  const s = await serve({ rate: 0, slots: 15 });
  const held = [];
  try {
    for (let i = 0; i < 15; i += 1) held.push(await request(s, blobs.huge.hex, { from: `127.0.0.${10 + i}`, hold: true }));
    assert.ok(held.every((r) => r.status === 200));
    assert.equal(s.load().downloading, 15);
  } finally { for (const r of held) r.req.destroy(); await s.stop(); }
});

test('К26: ученик, который держит слот и не читает, освобождает его по таймауту простоя; контроль: без таймаута держит', async () => {
  for (const [idleMs, expectFree] of [[800, true], [600000, false]]) {
    const s = await serve({ rate: 0, idleMs });
    let r;
    try {
      r = await request(s, blobs.huge.hex, { from: '127.0.0.7', hold: true });
      assert.equal(r.status, 200);
      const freed = await waitFor(() => s.load().downloading === 0, 4000);
      assert.equal(freed, expectFree, `таймаут ${idleMs} мс`);
    } finally { if (r) r.req.destroy(); await s.stop(); }
  }
});

test('Н2: предел скорости общий на все ответы; «Скачать быстрее» его снимает', async () => {
  const rate = 4 * MB; // 4 МБ/с, чтобы тест шёл секунды
  const s = await serve({ rate });
  try {
    assert.equal(s.load().limited, true);
    let t = Date.now();
    await Promise.all(['127.0.0.2', '127.0.0.3', '127.0.0.4'].map((from) => request(s, blobs.big.hex, { from })));
    const limited = (3 * blobs.big.data.length) / ((Date.now() - t) / 1000);
    assert.ok(limited <= rate * 1.1, `с пределом ${Math.round(limited / MB * 10) / 10} МБ/с`);
    assert.ok(limited >= rate * 0.6, `предел не душит лишнего: ${Math.round(limited / MB * 10) / 10} МБ/с`);

    s.setFast(true);
    assert.equal(s.load().limited, false);
    t = Date.now();
    await Promise.all(['127.0.0.2', '127.0.0.3', '127.0.0.4'].map((from) => request(s, blobs.big.hex, { from })));
    const fast = (3 * blobs.big.data.length) / ((Date.now() - t) / 1000);
    assert.ok(fast > rate * 2, `без предела ${Math.round(fast / MB)} МБ/с`);
    s.setFast(false);
    assert.equal(s.load().limited, true);
  } finally { await s.stop(); }
});

test('Н2: ведро токенов — долг ждёт, без предела ожидания нет', () => {
  let now = 0;
  const b = createBucket(1000, () => now);
  assert.equal(b.take(500), 500);
  assert.equal(b.take(500), 1000, 'долг копится');
  now = 2000;
  assert.equal(b.take(500), 0);
  b.setRate(0);
  assert.equal(b.take(1e9), 0);
});
