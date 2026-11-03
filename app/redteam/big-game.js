'use strict';
/* Замер большой игры (постановка М3, раздел «Большая игра в памяти», Н11). Только Linux-машина разработки или Windows с Node.
   Собирает игру на ~200 МБ: три файла .webm по 50 МБ случайных байт и WAV на 50 МБ (звук, который можно перематывать),
   и запускает её тем же путём, что витрина: чтение файла, sha256, readPackage, openGame в песочнице.
   Пишет время каждого шага, пик памяти основного процесса и всех процессов, и проверку перемотки звука к концу файла.
   Запуск: node redteam/big-game.js [МБ на файл, по умолчанию 49: вместе 196 МБ, предел распаковки 200 МБ] */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { keygen, pack } = require('../kibpack/pack');

const APP = path.join(__dirname, '..');
const ELECTRON = path.join(APP, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const MB = 1024 * 1024;

/* WAV 8 бит, моно, 22 050 Гц: 50 МБ — это около 40 минут звука. */
function wav(bytes) {
  const rate = 22050;
  const data = Buffer.alloc(bytes);
  // Тихий шум: сжать нельзя, иначе файл игры вышел бы меньше 200 МБ
  crypto.randomFillSync(data);
  for (let i = 0; i < bytes; i += 1) data[i] = 120 + (data[i] & 15);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + bytes, 4); head.write('WAVE', 8); head.write('fmt ', 12);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate, 28); head.writeUInt16LE(1, 32); head.writeUInt16LE(8, 34); head.write('data', 36); head.writeUInt32LE(bytes, 40);
  return Buffer.concat([head, data]);
}

async function main() {
  const each = Number(process.argv[2] || 49) * MB;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kibbig-'));
  try {
    const src = path.join(tmp, 'src');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'kibgame.json'), JSON.stringify({ id: 'bolshaya', version: '1.0.0', title: 'Большая игра', description: 'Замер',
      authors: ['Тест'], grades: '4–5 класс', minutes: 30, topic: 'Тест', minAppVersion: '1.0.0', entry: 'index.html' }));
    fs.writeFileSync(path.join(src, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Большая игра</title><h1>Большая игра</h1><audio id="a" src="zvuk.wav" preload="auto"></audio>');
    for (let i = 1; i <= 3; i += 1) fs.writeFileSync(path.join(src, `video${i}.webm`), crypto.randomBytes(each));
    fs.writeFileSync(path.join(src, 'zvuk.wav'), wav(each));
    keygen('zamer', path.join(tmp, 'keys'));
    const game = path.join(tmp, 'bolshaya.kibgames');
    await pack(src, { key: path.join(tmp, 'keys', 'zamer.key.pem'), out: game });
    fs.rmSync(src, { recursive: true });
    const out = path.join(tmp, 'result.json');
    const r = spawnSync(ELECTRON, [path.join(__dirname, 'big-game-main.js'), '--no-sandbox-check'], {
      env: { ...process.env, BIG_GAME: game, BIG_OUT: out }, stdio: 'inherit', timeout: 180000,
    });
    if (!fs.existsSync(out)) throw new Error(`Electron не записал результат (код ${r.status})`);
    const res = JSON.parse(fs.readFileSync(out, 'utf8'));
    console.log(JSON.stringify(res, null, 1));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
