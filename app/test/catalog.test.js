'use strict';
/* Этап М1, Т8 и Т9: подписанный каталог школы и файл school.kibschool. */
const assert = require('node:assert');
const crypto = require('node:crypto');
const { test } = require('node:test');
const C = require('../shared/catalog');
const { signCatalog } = require('../desktop/tutor/catalog-sign');
const { keyId, rawFromPublicKey } = require('../shared/package-format');

function school() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const pub = rawFromPublicKey(publicKey).toString('base64');
  return { pub, fp: keyId(pub), sign: (bytes) => crypto.sign(null, bytes, privateKey) };
}
const S = school();
const OTHER = school();
const blob = (n = 100) => ({ sha256: 'a'.repeat(64), bytes: n });
const GAME = {
  id: 'kiberpochta', version: '1.2.0', title: 'Киберпочта', description: 'Письма и фишинг', grades: '4–5 класс', minutes: 30,
  topic: 'Кибербезопасность', author: 'Влад, тьютор', authorKey: '0123456789abcdef', sha256: 'b'.repeat(64), bytes: 95000,
  icon: null, cover: blob(182000), publishedAt: '2026-11-03', lesson: true, prefetch: true, minAppVersion: '1.1.0',
  modes: [{ id: 'default', title: 'Киберпочта', about: 'Письма и фишинг', cover: null }],
};
const payload = (extra = {}) => ({ format: 1, school: S.fp, seq: 1793700000, games: [GAME], ...extra });
const valid = () => signCatalog(payload(), S.sign);
const reject = (text, re, opts = {}) => assert.throws(() => C.verifyCatalog(text, { schoolKey: S.pub, ...opts }), (e) => e instanceof C.CatalogError && re.test(e.message));

/* Подписывает произвольные байты, минуя проверку схемы при подписи: так собираются плохие каталоги. */
const rawSigned = (bytes, prefix = C.PREFIX, signer = S) => JSON.stringify({
  payload: bytes.toString('base64'), sig: signer.sign(Buffer.concat([prefix, bytes])).toString('base64'),
});
const rawPayload = (obj, prefix, signer) => rawSigned(Buffer.from(JSON.stringify(obj)), prefix, signer);

test('Т8 контроль: верный каталог принимается, содержимое то же', () => {
  const p = C.verifyCatalog(valid(), { schoolKey: S.pub, minSeq: 0 });
  assert.deepEqual(p, payload());
});

test('Т8: подпись чужим ключом', () => reject(signCatalog(payload(), OTHER.sign), /не ключом этой школы/));
test('Т8: каталог другой школы, подписанный своим ключом, не проходит по ключу этой школы', () => {
  reject(signCatalog(payload({ school: OTHER.fp }), OTHER.sign), /не ключом этой школы/);
});
test('Т8: поле school не совпадает с ключом', () => reject(rawPayload(payload({ school: OTHER.fp })), /другой школы/));

test('Т8: изменён один байт содержимого или подписи', () => {
  const outer = JSON.parse(valid());
  const bytes = Buffer.from(outer.payload, 'base64');
  bytes[bytes.indexOf('"lesson":true') + 10] ^= 1;
  reject(JSON.stringify({ ...outer, payload: bytes.toString('base64') }), /не ключом этой школы|повреждён/);
  const sig = Buffer.from(outer.sig, 'base64');
  sig[5] ^= 1;
  reject(JSON.stringify({ ...outer, sig: sig.toString('base64') }), /не ключом этой школы/);
});

test('Т8: другой префикс и без префикса', () => {
  reject(rawPayload(payload(), Buffer.from('kibcatalog-v2\n')), /не ключом этой школы/);
  reject(rawPayload(payload(), Buffer.alloc(0)), /не ключом этой школы/);
  // Подпись манифеста игры (без префикса) не подходит как подпись каталога
  const bytes = Buffer.from(JSON.stringify(payload()));
  reject(JSON.stringify({ payload: bytes.toString('base64'), sig: S.sign(bytes).toString('base64') }), /не ключом этой школы/);
});

test('Т8: старый и равный seq', () => {
  reject(valid(), /старее/, { minSeq: 1793700000 });
  reject(valid(), /старее/, { minSeq: 1793700001 });
  assert.equal(C.verifyCatalog(valid(), { schoolKey: S.pub, minSeq: 1793699999 }).seq, 1793700000);
});

test('Т8: лишнее поле на каждом уровне', () => {
  reject(rawPayload(payload({ extra: 1 })), /лишнее поле extra/);
  reject(rawPayload(payload({ games: [{ ...GAME, permissions: ['net'] }] })), /лишнее поле permissions/);
  reject(rawPayload(payload({ games: [{ ...GAME, modes: [{ ...GAME.modes[0], entry: 'x.html' }] }] })), /лишнее поле entry/);
  reject(rawPayload(payload({ games: [{ ...GAME, cover: { ...blob(), url: 'http://x' } }] })), /лишнее поле url/);
  reject(JSON.stringify({ ...JSON.parse(valid()), note: 'x' }), /лишнее поле note/);
  reject(rawPayload(JSON.parse(`{"format":1,"school":"${S.fp}","seq":5,"games":[],"__proto__":{"x":1}}`)), /лишнее поле __proto__/);
});

test('Т8: неверные типы и пропущенные поля', () => {
  const bad = (change, re) => { const g = { ...GAME }; change(g); reject(rawPayload(payload({ games: [g] })), re); };
  bad((g) => { g.lesson = 'true'; }, /lesson/);
  bad((g) => { g.minutes = '30'; }, /время/);
  bad((g) => { g.bytes = -1; }, /размер/);
  bad((g) => { g.sha256 = 'B'.repeat(64); }, /sha256/);
  bad((g) => { g.title = '<img src=x onerror=alert(1)>‮'; }, /название/);
  bad((g) => { g.author = 5; }, /автора/);
  bad((g) => { g.modes = []; }, /режимов/);
  bad((g) => { delete g.prefetch; }, /нет поля prefetch/);
  bad((g) => { g.cover = { sha256: 'a'.repeat(64), bytes: 600 * 1024 }; }, /размер/);
  reject(rawPayload(payload({ seq: '5' })), /номер/);
  reject(rawPayload(payload({ seq: 0 })), /номер/);
  reject(rawPayload(payload({ format: 2 })), /другой версией/);
  reject(rawPayload(payload({ games: [GAME, GAME] })), /дважды/);
  reject(rawPayload([1, 2]), /нужен объект/);
  reject('не json', /повреждён/);
  reject(JSON.stringify({ payload: 'не base64!', sig: 'x' }), /base64/);
});

test('Т8: каталог больше 2 МБ', () => {
  const big = `${valid().slice(0, -2)}${' '.repeat(2 * 1024 * 1024)}}`;
  reject(big, /больше 2 МБ/);
});

test('Т8: подпись не ставится на каталог, который ученик не примет', () => {
  assert.throws(() => signCatalog(payload({ extra: 1 }), S.sign), C.CatalogError);
});

test('Т9: seq растёт при откате часов назад и при публикациях в одну секунду', () => {
  const t = 1_793_700_000_500;
  let seq = 0;
  const seen = [];
  for (const now of [t, t, t + 100, t - 86_400_000, t - 86_400_000, t + 5000]) {
    seq = C.nextSeq(seq, now);
    seen.push(seq);
  }
  assert.deepEqual(seen, [1793700000, 1793700001, 1793700002, 1793700003, 1793700004, 1793700005]);
  assert.equal(C.nextSeq(10, t + 1_000_000), 1793701000);
  assert.equal(C.nextSeq(undefined, 0), 1);
});

test('school.kibschool: только публичный ключ, отпечаток сверяется, лишние поля и чужой отпечаток отвергаются', () => {
  const text = C.makeSchoolFile({ name: 'KIBERone Петроградская', publicKey: S.pub });
  const s = C.parseSchoolFile(text);
  assert.deepEqual(Object.keys(s).sort(), ['fingerprint', 'format', 'name', 'publicKey']);
  assert.equal(s.fingerprint, S.fp);
  assert.equal(C.parseSchoolFile(`﻿${text}`).name, 'KIBERone Петроградская'); // Блокнот пишет BOM
  const obj = JSON.parse(text);
  assert.throws(() => C.parseSchoolFile(JSON.stringify({ ...obj, fingerprint: OTHER.fp })), /отпечаток/);
  assert.throws(() => C.parseSchoolFile(JSON.stringify({ ...obj, privateKey: 'x' })), /лишнее поле/);
  assert.throws(() => C.parseSchoolFile('{'), /повреждён/);
  assert.equal(C.fingerprintText('0123456789abcdef'), '0123 4567 89ab cdef');
});
