'use strict';
/* Сборка и подпись .kibgames из папки игры. В папке должен лежать kibgame.json с описанием. */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yazl = require('yazl');
const {
  MIME, PackageError, checkCovers, checkManifest, checkPath, extensionOf, rawFromPublicKey, sha256, supportsVersion,
} = require('../shared/package-format');

const FEATURES_VERSION = '1.1.0';
const SEMVER_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;

const fail = (message) => { throw new PackageError(message); };
const SOURCE_FILE = 'kibgame.json';
const FIXED_TIME = new Date('2000-01-01T00:00:00Z'); // одинаковый вход даёт одинаковый файл

function insideGitRepo(dir) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return true;
    if (d === path.dirname(d)) return false;
  }
}

const defaultKeyDir = () => path.join(os.homedir(), '.config', 'kibgames', 'keys');

/* Приватный ключ никогда не должен попасть в git: автор не сможет отозвать его из истории. */
function keygen(name, dir = defaultKeyDir()) {
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(name)) fail('Имя ключа: латиница, цифры, дефис');
  if (insideGitRepo(dir)) fail(`Папка ${dir} внутри git-репозитория. Выберите папку вне проекта`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const keyPath = path.join(dir, `${name}.key.pem`);
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8' });
  // флаг wx: существующий ключ не перезаписываем, иначе автор потеряет право обновлять свои игры
  try { fs.writeFileSync(keyPath, pem, { flag: 'wx', mode: 0o600 }); } catch (err) {
    if (err.code === 'EEXIST') fail(`Ключ уже существует: ${keyPath}`);
    throw err;
  }
  return { keyPath, publicKey: rawFromPublicKey(publicKey).toString('base64') };
}

function listFiles(root, dir = root, out = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue;
    const full = path.join(dir, item.name);
    if (item.isSymbolicLink()) fail(`В папке игры символическая ссылка: ${full}`);
    if (item.isDirectory()) listFiles(root, full, out);
    else if (item.isFile()) out.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return out;
}

/* Внешние ссылки в играх заблокирует песочница, и игра молча сломается. Лучше сказать автору сразу. */
function findExternalLinks(name, data) {
  if (!['html', 'htm', 'css'].includes(extensionOf(name))) return [];
  // Обычные <a href> сюда не входят: это ссылка, а не загружаемый ресурс
  const pattern = /<link\b[^>]*\bhref\s*=\s*["']?(?:https?:)?\/\/[^"'\s>]+|\bsrc\s*=\s*["']?(?:https?:)?\/\/[^"'\s>]+|url\(\s*["']?(?:https?:)?\/\/[^)"']+|@import\s+(?:url\(\s*)?["']?(?:https?:)?\/\/[^"')]+/gi;
  const found = data.toString('utf8').match(pattern) || [];
  return found.map((link) => `внешняя ссылка не сработает в песочнице: ${name}: ${link.slice(0, 100)}`);
}

async function pack(folder, { key: keyPath, out }) {
  const root = path.resolve(folder);
  const sourcePath = path.join(root, SOURCE_FILE);
  if (!fs.existsSync(sourcePath)) fail(`В папке нет ${SOURCE_FILE}`);
  let source;
  try { source = JSON.parse(fs.readFileSync(sourcePath, 'utf8')); } catch { fail(`${SOURCE_FILE} повреждён`); }
  if (typeof source.entry !== 'string') fail(`В ${SOURCE_FILE} нет поля entry`);

  const privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath));
  if (privateKey.asymmetricKeyType !== 'ed25519') fail('Нужен ключ Ed25519, созданный через kibpack keygen');

  const fileData = new Map();
  const warnings = [];
  for (const rel of listFiles(root).sort()) {
    if (rel === SOURCE_FILE) continue;
    const archived = rel === 'icon.png' ? rel : `game/${rel}`;
    checkPath(archived);
    if (archived !== 'icon.png' && !MIME[extensionOf(archived)]) fail(`Файлы такого типа в игре запрещены: ${rel}`);
    const data = fs.readFileSync(path.join(root, rel));
    fileData.set(archived, data);
    warnings.push(...findExternalLinks(rel, data));
  }

  // Пути в kibgame.json пишутся от папки игры, в манифесте они лежат в game/
  const inGame = (value) => (typeof value === 'string' ? `game/${value}` : value);
  const withPaths = (obj) => {
    const out = { ...obj };
    for (const key of ['entry', 'cover']) if (out[key] !== undefined) out[key] = inGame(out[key]);
    return out;
  };
  const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const manifest = {
    ...withPaths(source),
    ...(Array.isArray(source.modes) ? { modes: source.modes.map((mode) => (isObject(mode) ? withPaths(mode) : mode)) } : {}),
    format: 1,
    publicKey: rawFromPublicKey(crypto.createPublicKey(privateKey)).toString('base64'),
    files: Object.fromEntries([...fileData].map(([name, data]) => [name, sha256(data)])),
  };
  // Обложки и режимы понимает приложение начиная с 1.1.0. Старое ответило бы «Неизвестное поле», а не «обновите приложение»
  if ((manifest.cover !== undefined || manifest.modes !== undefined) && typeof manifest.minAppVersion === 'string'
    && SEMVER_RE.test(manifest.minAppVersion) && !supportsVersion(manifest.minAppVersion, FEATURES_VERSION)) {
    warnings.push(`minAppVersion поднят с ${manifest.minAppVersion} до ${FEATURES_VERSION}: обложки и режимы понимает только приложение ${FEATURES_VERSION} и новее`);
    manifest.minAppVersion = FEATURES_VERSION;
  }
  checkManifest(manifest);
  checkCovers(manifest, fileData);
  if (!manifest.cover) warnings.push('у игры нет обложки (поле cover), витрина покажет заглушку');

  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
  const zip = new yazl.ZipFile();
  const options = { mtime: FIXED_TIME, mode: 0o100644 };
  zip.addBuffer(manifestBytes, 'manifest.json', options);
  zip.addBuffer(crypto.sign(null, manifestBytes, privateKey), 'manifest.sig', options);
  for (const [name, data] of fileData) zip.addBuffer(data, name, options);
  zip.end();

  const target = out || path.join(process.cwd(), `${manifest.id}-${manifest.version}.kibgames`);
  await new Promise((resolve, reject) => {
    zip.outputStream.pipe(fs.createWriteStream(target)).on('close', resolve).on('error', reject);
  });
  return { target, manifest, warnings };
}

module.exports = { keygen, pack, defaultKeyDir };
