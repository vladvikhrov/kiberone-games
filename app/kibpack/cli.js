#!/usr/bin/env node
'use strict';
const path = require('path');
const { PackageError, readPackage } = require('../shared/package-format');
const { keygen, pack, defaultKeyDir } = require('./pack');

const USAGE = `kibpack: сборка игр KIBERone

  kibpack keygen <имя> [--dir <папка>]     создать ключ автора (по умолчанию в ${defaultKeyDir()})
  kibpack pack <папка> --key <ключ> [--out <файл>]   собрать и подписать .kibgames
  kibpack verify <файл>                    проверить .kibgames по правилам приложения
`;

function option(args, name) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

async function main([command, target, ...rest]) {
  if (command === 'keygen' && target) {
    const { keyPath, publicKey } = keygen(target, option(rest, '--dir'));
    console.log(`Приватный ключ: ${keyPath}\nНикому его не передавайте и сделайте резервную копию.\nПубличный ключ: ${publicKey}`);
  } else if (command === 'pack' && target && option(rest, '--key')) {
    const { target: file, manifest, warnings } = await pack(target, { key: option(rest, '--key'), out: option(rest, '--out') });
    console.log(`Собрано: ${path.relative(process.cwd(), file)} (${manifest.title} ${manifest.version}, файлов: ${Object.keys(manifest.files).length})`);
    for (const warning of warnings) console.log(`ВНИМАНИЕ: ${warning}`);
  } else if (command === 'verify' && target) {
    const { manifest, trust, files } = await readPackage(target);
    console.log(`Файл в порядке: ${manifest.title} ${manifest.version}\nАвтор называет себя: ${manifest.authors.join(', ')}\nКлюч: ${trust.keyId}\nФайлов: ${files.size}`);
  } else {
    process.stdout.write(USAGE);
    process.exitCode = 2;
  }
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof PackageError ? `Ошибка: ${err.message}` : err);
  process.exitCode = 1;
});
