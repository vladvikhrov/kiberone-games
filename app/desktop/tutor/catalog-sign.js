'use strict';
/* Подпись каталога ключом школы. Только в программе тьютора: в сборку ученика этот файл не входит (Т14). */
const { checkPayload, signedBytes } = require('../../shared/catalog');

/* payload: содержимое каталога. sign: (байты) => подпись Ed25519, 64 байта (школьный ключ, см. school-key.js).
   Возвращает текст файла catalog.json. Подписываются точные байты, проверка у ученика читает их же. */
function signCatalog(payload, sign) {
  checkPayload(payload); // каталог, который не пройдёт проверку у ученика, не подписываем
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const sig = sign(signedBytes(bytes));
  return `${JSON.stringify({ payload: bytes.toString('base64'), sig: Buffer.from(sig).toString('base64') })}\n`;
}

module.exports = { signCatalog };
