'use strict';
/* ratings.json и state.json на диске. Запись атомарная: временный файл и переименование.
   В0: ratings.json лежит у ученика вместо сервера тьютора, форма та же, что будет на сервере (ADR-0003, раздел 10). */
const fs = require('fs');
const path = require('path');
const R = require('../../shared/ratings');

function createStore(dir, { now = () => new Date() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const ratingsPath = path.join(dir, 'ratings.json');
  const statePath = path.join(dir, 'state.json');
  // Блокнот и PowerShell 5 пишут UTF-8 с BOM, JSON.parse на нём падает
  const read = (p) => { try { return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); } catch { return null; } };
  const write = (p, data) => {
    const tmp = `${p}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 1)}\n`);
    fs.renameSync(tmp, p);
  };

  let ratings = R.emptyRatings();
  const raw = read(ratingsPath);
  if (raw !== null) {
    const parsed = R.parseRatings(raw);
    if (parsed) ratings = parsed;
    else fs.renameSync(ratingsPath, `${ratingsPath}.bad-${Date.now()}`); // испорченный файл не затираем, а откладываем
  }

  const today = () => R.localDay(now());
  /* serverDay: дата по часам тьютора (М4), если сервер её сообщил; иначе по часам этого ноутбука. */
  const day = (serverDay = null) => {
    let saved = null;
    try { saved = JSON.parse(read(statePath)); } catch { /* пустой или испорченный файл: оценок сегодня не было */ }
    return R.dayState(saved, serverDay || today());
  };

  return {
    ratings: () => ratings,
    day,
    /* Настроенный ноутбук (М4): только отметка «сегодня оценивал», без звёзд. Счётчик на сервере тьютора. */
    markDay(game, mode, serverDay = null) {
      const state = day(serverDay);
      if (R.hasVoted(state, game, mode)) return { ok: false, reason: 'already' };
      write(statePath, R.markVoted(state, game, mode));
      return { ok: true };
    },
    /* catalog: Map id игры -> Set id режимов. Возвращает { ok } или { ok: false, reason: 'already' }. */
    vote(catalog, game, mode, value) {
      const state = day();
      if (R.hasVoted(state, game, mode)) return { ok: false, reason: 'already' };
      const next = R.addVote(ratings, catalog, game, mode, value);
      write(ratingsPath, next);
      ratings = next;
      write(statePath, R.markVoted(state, game, mode));
      return { ok: true };
    },
  };
}

module.exports = { createStore };
