#!/usr/bin/env node
'use strict';
/* Папка игр для витрины этапа В0: Киберпочта, Взломай сейф и тестовая игра с тремя режимами.
   Игры подписываются ключом разработки k1-dev (создаётся один раз в папке ключей kibpack, вне репозитория).
   Ключ добавляется в список доверия профиля, иначе витрина покажет игры как «автор не проверен».

   node scripts/make-dev-catalog.js                      папка games и trusted-keys.json в профиле приложения
   node scripts/make-dev-catalog.js --out <папка> --profile <папка профиля>
   node scripts/make-dev-catalog.js --no-trust           не трогать список доверия */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { keygen, pack, defaultKeyDir } = require('../kibpack/pack');
const { readPackage } = require('../shared/package-format');

const APP = path.resolve(__dirname, '..');
const option = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };

/* Папка профиля Electron для productName «Игры KIBERone» */
function defaultProfile() {
  const name = require('../package.json').productName;
  if (process.platform === 'win32') return path.join(process.env.APPDATA, name);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', name);
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), name);
}

async function main() {
  const profile = path.resolve(option('--profile') || defaultProfile());
  const out = path.resolve(option('--out') || path.join(profile, 'games'));
  const keyPath = path.join(defaultKeyDir(), 'k1-dev.key.pem');
  if (!fs.existsSync(keyPath)) keygen('k1-dev');
  fs.mkdirSync(out, { recursive: true });

  const folders = [path.join(APP, '..', 'games', 'kiberpochta'), path.join(APP, '..', 'games', 'vzlomai-seif'), path.join(APP, 'testgames', 'tri-rezhima')];
  let keyId = null;
  for (const folder of folders) {
    const { target, manifest, warnings } = await pack(folder, { key: keyPath, out: path.join(out, `${path.basename(folder)}.kibgames`) });
    keyId = (await readPackage(target)).trust.keyId;
    console.log(`${manifest.title}: ${target}`);
    for (const w of warnings) console.log(`  внимание: ${w}`);
  }

  if (!process.argv.includes('--no-trust')) {
    const file = path.join(profile, 'trusted-keys.json');
    let list = {};
    try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* файла ещё нет */ }
    list[keyId] = 'Влад, тьютор (ключ разработки)';
    fs.mkdirSync(profile, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`);
    console.log(`Ключ ${keyId} в списке доверия: ${file}`);
  }
}

main().catch((err) => { console.error(`Ошибка: ${err.message}`); process.exit(1); });
