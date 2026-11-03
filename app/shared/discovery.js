'use strict';
/* Пакеты UDP-обнаружения сервера (ADR-0002, 3.5). Общие для ученика (запрос) и тьютора (ответ).
   Запрос: «KIBD1» + отпечаток школы (16 знаков hex) + случайное число (16 байт), всего 37 байт.
   Ответ:  «KIBR1» + тот же отпечаток + то же число, тоже 37 байт: ответ не больше запроса, усиливать атаки нечем.
   Адреса и порта в ответе нет: адрес сервера — адрес отправителя ответа, порт известен заранее. */
const crypto = require('crypto');

const REQ = Buffer.from('KIBD1', 'ascii');
const REP = Buffer.from('KIBR1', 'ascii');
const SIZE = 5 + 16 + 16;
const FP = /^[0-9a-f]{16}$/;

function parse(msg, magic) {
  if (!Buffer.isBuffer(msg) || msg.length !== SIZE || !msg.subarray(0, 5).equals(magic)) return null;
  const fingerprint = msg.toString('ascii', 5, 21);
  if (!FP.test(fingerprint)) return null;
  return { fingerprint, nonce: Buffer.from(msg.subarray(21)) };
}

const DISCOVERY = {
  SIZE,
  request(fingerprint, nonce = crypto.randomBytes(16)) {
    return { packet: Buffer.concat([REQ, Buffer.from(fingerprint, 'ascii'), nonce]), nonce };
  },
  reply: (fingerprint, nonce) => Buffer.concat([REP, Buffer.from(fingerprint, 'ascii'), nonce]),
  parseRequest: (msg) => parse(msg, REQ),
  parseReply: (msg) => parse(msg, REP),
};

module.exports = { DISCOVERY };
