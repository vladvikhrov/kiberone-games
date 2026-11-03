'use strict';
/* Этап М1, Т1–Т7: ключ школы. Почти все тесты на облегчённом scrypt (N = 2^10), один — на настоящих параметрах ADR. */
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const SK = require('../desktop/tutor/school-key');
const { verifyCatalog, parseSchoolFile } = require('../shared/catalog');
const { signCatalog } = require('../desktop/tutor/catalog-sign');

const FAST = { N: 2 ** 10, r: 8, p: 1 };
const PASSWORD = 'длинный-пароль-1';
let tmp;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kibkey-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const fresh = () => fs.mkdtempSync(path.join(tmp, 'data-'));
function clock(start = 1_793_700_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}
const store = (dir, now = clock(), extra = {}) => SK.createSchoolKey(dir, { kdf: FAST, now, testHooks: true, ...extra });
const create = (s, password = PASSWORD) => s.create({ name: 'KIBERone Тест', password, again: password });
const code = (e) => e && e.code;

/* Все кодировки, в которых закрытый ключ мог бы лечь на диск. */
function encodings(seed) {
  const priv = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
  const der = priv.export({ format: 'der', type: 'pkcs8' });
  const pem = priv.export({ format: 'pem', type: 'pkcs8' });
  const pemBody = pem.split('\n').filter((l) => l && !l.startsWith('-----')).join('');
  return [
    ['сырые байты', seed], ['hex', Buffer.from(seed.toString('hex'))], ['HEX', Buffer.from(seed.toString('hex').toUpperCase())],
    ['base64', Buffer.from(seed.toString('base64').replace(/=+$/, ''))], ['base64url', Buffer.from(seed.toString('base64url'))],
    ['PKCS8 DER', der], ['PEM', Buffer.from(pemBody)],
  ];
}
function findIn(dir, seed) {
  const hits = [];
  const walk = (d) => {
    for (const item of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, item.name);
      if (item.isDirectory()) walk(full);
      else {
        const data = fs.readFileSync(full);
        for (const [name, needle] of encodings(seed)) if (data.includes(needle)) hits.push(`${path.relative(dir, full)}: ${name}`);
      }
    }
  };
  walk(dir);
  return hits;
}

test('Т1: после создания, входа, подписи и закрытия закрытого ключа нет на диске ни в одной кодировке; контроль находит его в нешифрованной копии', async () => {
  const dir = fresh();
  const now = clock();
  const s = store(dir, now);
  await create(s);
  const seed = Buffer.from(s.peekSeed()); // копия только для поиска
  s.lock();
  await s.unlock(PASSWORD);
  s.sign(Buffer.from('проба'));
  const backup = fresh();
  s.backup(backup, { day: '2026-11-03' });
  s.lock();
  assert.deepEqual(findIn(dir, seed), []);
  assert.deepEqual(findIn(backup, seed), []);

  // Контроль: тот же поиск находит ключ, если его записать без шифрования
  const control = fresh();
  const priv = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
  fs.writeFileSync(path.join(control, 'key.pem'), priv.export({ format: 'pem', type: 'pkcs8' }));
  fs.writeFileSync(path.join(control, 'key.raw'), seed);
  fs.writeFileSync(path.join(control, 'key.json'), JSON.stringify({ hex: seed.toString('hex'), b64: seed.toString('base64') }));
  const hits = findIn(control, seed);
  for (const name of ['key.pem: PEM', 'key.raw: сырые байты', 'key.json: hex', 'key.json: base64']) assert.ok(hits.includes(name), `контроль не нашёл ${name}: ${hits}`);
});

test('Т2: неверный пароль не открывает ключ, задержка 1, 2, 4 … 60 с и переживает перезапуск', async () => {
  const dir = fresh();
  const now = clock();
  const s = store(dir, now);
  await create(s);
  s.lock();
  const waits = [];
  for (let i = 0; i < 8; i += 1) {
    const err = await s.unlock('неверный-пароль').catch((e) => e);
    assert.equal(code(err), 'wrong');
    assert.equal(s.unlocked(), false);
    waits.push(err.wait);
    // Пока задержка не прошла, даже верный пароль не проверяется
    const early = await s.unlock(PASSWORD).catch((e) => e);
    assert.equal(code(early), 'wait');
    assert.equal(s.unlocked(), false);
    // Новый экземпляр (перезапуск программы) видит ту же задержку
    assert.equal(store(dir, now).waitSeconds(), err.wait);
    now.advance(err.wait * 1000);
  }
  assert.deepEqual(waits, [1, 2, 4, 8, 16, 32, 60, 60]);
  await s.unlock(PASSWORD);
  assert.equal(s.unlocked(), true);
  assert.equal(s.waitSeconds(), 0);
});

test('Т2: испорченный счётчик ошибок не обнуляет задержку', async () => {
  const dir = fresh();
  const now = clock();
  const s = store(dir, now);
  await create(s);
  fs.writeFileSync(path.join(dir, SK.LOGIN_FILE), 'мусор');
  assert.equal(store(dir, now).waitSeconds(), 32);
});

test('Т3: пароль короче 10 знаков и несовпадающий повтор не принимаются, 10 знаков кириллицей принимаются', async () => {
  const s = store(fresh());
  assert.equal(code(await s.create({ name: 'Школа', password: '123456789', again: '123456789' }).catch((e) => e)), 'weak');
  assert.equal(code(await s.create({ name: 'Школа', password: 'парольпарол', again: 'парольпароль' }).catch((e) => e)), 'mismatch');
  assert.equal(s.exists(), false);
  await s.create({ name: 'Школа', password: 'пароль1234', again: 'пароль1234' });
  assert.equal(s.exists(), true);
});

test('Т4: код восстановления открывает ключ и задаёт новый пароль; старый пароль после этого не подходит; неверный и испорченный код нет', async () => {
  const dir = fresh();
  const now = clock();
  const s = store(dir, now);
  const { recoveryCode } = await create(s);
  assert.match(recoveryCode, /^[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{6}$/);
  s.lock();
  const other = SK.formatCode(SK.encodeCode(crypto.randomBytes(16)));
  const wrong = await s.recover({ code: other, password: 'новый-пароль-22', again: 'новый-пароль-22' }).catch((e) => e);
  assert.equal(code(wrong), 'wrong');
  assert.match(wrong.message, /Код не подошёл/);
  now.advance(60_000);
  const broken = await s.recover({ code: recoveryCode.slice(0, -1), password: 'новый-пароль-22', again: 'новый-пароль-22' }).catch((e) => e);
  assert.match(broken.message, /В коде ошибка/);
  assert.equal(s.unlocked(), false);
  now.advance(60_000);
  // Как перепишет человек: строчными и с пробелами вместо дефисов
  await s.recover({ code: recoveryCode.toLowerCase().replace(/-/g, ' '), password: 'новый-пароль-22', again: 'новый-пароль-22' });
  assert.equal(s.unlocked(), true);
  s.lock();
  assert.equal(code(await s.unlock(PASSWORD).catch((e) => e)), 'wrong');
  now.advance(60_000);
  await s.unlock('новый-пароль-22');
  assert.equal(s.unlocked(), true);
});

test('Т5: изменённое поле school-key.enc даёт понятную ошибку, а не ключ', async () => {
  const dir = fresh();
  const now = clock();
  const s = store(dir, now);
  await create(s);
  s.lock();
  const original = fs.readFileSync(path.join(dir, SK.KEY_FILE), 'utf8');
  const flip = (b64) => { const b = Buffer.from(b64, 'base64'); b[0] ^= 1; return b.toString('base64'); };
  const cases = [];
  for (const slot of ['password', 'recovery']) for (const field of ['salt', 'iv', 'data', 'tag']) cases.push([`${slot}.${field}`, (f) => { f[slot][field] = flip(f[slot][field]); }]);
  cases.push(['publicKey', (f) => { f.publicKey = flip(f.publicKey); }]);
  cases.push(['kdf.N', (f) => { f.kdf.N = 2 ** 11; }]);
  cases.push(['format', (f) => { f.format = 2; }]);
  cases.push(['check', (f) => { f.check = '0'.repeat(64); }]);
  cases.push(['лишнее поле', (f) => { f.extra = 1; }]);
  for (const [name, change] of cases) {
    const f = JSON.parse(original);
    change(f);
    fs.writeFileSync(path.join(dir, SK.KEY_FILE), JSON.stringify(f));
    const err = await store(dir, now).unlock(PASSWORD).catch((e) => e);
    assert.equal(code(err), 'damaged', `${name}: ${err && err.message}`);
    assert.match(err.message, /повреждён/);
  }
  fs.writeFileSync(path.join(dir, SK.KEY_FILE), '{не json');
  assert.equal(code(await store(dir, now).unlock(PASSWORD).catch((e) => e)), 'damaged');

  // Злоумышленник пересчитал контрольную сумму: ключа он всё равно не получит
  const crafted = JSON.parse(original);
  crafted.password.data = flip(crafted.password.data);
  delete crafted.check;
  crafted.check = crypto.createHash('sha256').update(JSON.stringify([crafted.format, crafted.kdf, crafted.publicKey, crafted.password, crafted.recovery])).digest('hex');
  fs.writeFileSync(path.join(dir, SK.KEY_FILE), JSON.stringify(crafted));
  const s2 = store(dir, now);
  assert.equal(code(await s2.unlock(PASSWORD).catch((e) => e)), 'wrong');
  assert.equal(s2.unlocked(), false);

  // Контроль: исходный файл открывается
  fs.writeFileSync(path.join(dir, SK.KEY_FILE), original);
  now.advance(60_000);
  const s3 = store(dir, now);
  await s3.unlock(PASSWORD);
  assert.equal(s3.unlocked(), true);
});

test('Т6: через 10 минут без действий ключ затёрт нулями и подпись отклонена; действие сбрасывает отсчёт', async () => {
  const now = clock();
  const s = store(fresh(), now);
  await create(s);
  now.advance(9 * 60_000);
  s.touch();
  now.advance(9 * 60_000);
  assert.equal(s.checkIdle(), false);
  assert.equal(s.unlocked(), true);
  s.sign(Buffer.from('действие'));
  const seedRef = s.peekSeed();
  assert.ok(seedRef.some((b) => b !== 0));
  now.advance(10 * 60_000);
  assert.equal(s.checkIdle(), true);
  assert.ok(seedRef.every((b) => b === 0), 'буфер ключа затёрт нулями');
  assert.equal(s.peekSeed(), null);
  assert.equal(s.unlocked(), false);
  assert.throws(() => s.sign(Buffer.from('после закрытия')), (e) => e.code === 'locked');
});

test('Т7: резервная копия восстанавливает ту же школу на другом ноутбуке, подпись проверяется старым school.kibschool', async () => {
  const s = store(fresh());
  await create(s);
  const before = s.info();
  const oldSchoolFile = parseSchoolFile(s.schoolFileText());
  const copy = s.backup(fresh(), { day: '2026-11-03' });
  assert.deepEqual(fs.readdirSync(copy).sort(), ['school-key.enc', 'school.kibschool']);

  const other = store(fresh()); // новая папка данных: другой ноутбук
  const restored = other.restore(copy);
  assert.equal(restored.fingerprint, before.fingerprint);
  assert.equal(other.unlocked(), false);
  await other.unlock(PASSWORD);
  const text = signCatalog({ format: 1, school: before.fingerprint, seq: 5, games: [] }, other.sign);
  assert.equal(verifyCatalog(text, { schoolKey: oldSchoolFile.publicKey }).seq, 5);
  // Поверх существующей школы копия не ложится
  assert.equal(code((() => { try { other.restore(copy); return null; } catch (e) { return e; } })()), 'exists');
});

test('настоящие параметры scrypt из ADR (N = 2^17): создание и вход работают', async () => {
  assert.deepEqual(SK.KDF, { N: 2 ** 17, r: 8, p: 1 });
  const dir = fresh();
  const s = SK.createSchoolKey(dir, {});
  await s.create({ name: 'Школа', password: PASSWORD, again: PASSWORD });
  s.lock();
  await SK.createSchoolKey(dir, {}).unlock(PASSWORD);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, SK.KEY_FILE), 'utf8')).kdf.N, 2 ** 17);
});

test('код восстановления: 26 знаков, путаница O/0 и I/L/1 прощается', () => {
  const bytes = crypto.randomBytes(16);
  const c = SK.encodeCode(bytes);
  assert.equal(c.length, 26);
  assert.ok(SK.decodeCode(c.replace(/0/g, 'O').replace(/1/g, 'l')).equals(bytes));
  assert.equal(SK.decodeCode(`${c.slice(0, 25)}Z`), null); // лишние биты в последнем знаке
  assert.equal(SK.decodeCode('U'.repeat(26)), null);
});
