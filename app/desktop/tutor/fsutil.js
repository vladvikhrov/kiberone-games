'use strict';
/* Файлы программы тьютора: запись атомарная (временный файл и переименование), чтение без BOM. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function writeAtomic(file, data) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

const readText = (file) => {
  try { return fs.readFileSync(file, 'utf8').replace(/^﻿/, ''); } catch { return null; }
};

module.exports = { writeAtomic, readText };
