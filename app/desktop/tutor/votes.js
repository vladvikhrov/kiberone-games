'use strict';
/* Голоса учеников на сервере тьютора (ADR-0003, раздел 10; постановка М4). Модуль без Electron, в сборку ученика не входит.

   На диске только ratings.json: сколько раз поставили каждую звезду каждому режиму. Адреса, времени, порядка голосов нет.
   Один голос в день на пару «адрес + игра + режим»: в памяти хранится только HMAC(соль дня, адрес, игра, режим).
   Соль — случайные байты в памяти, новая при смене даты по часам тьютора и при запуске программы тьютора.
   Выключение раздачи соль не сбрасывает: модуль создаётся один раз на запуск программы, а сервер — при каждом включении. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const R = require('../../shared/ratings');
const { writeAtomic, readText } = require('./fsutil');

const MAX_MARKS = 50000; // отметок за день; на классе из 15 ноутбуков столько не бывает, это предел памяти
const BODY_BYTES = 256;
const ID = /^[a-z0-9-]{1,40}$/;

/* Правила защиты. Объект модуля, а не параметр: настоящая программа их не меняет, а контрольный прогон теста-«взломщика»
   подменяет их из redteam/, чтобы доказать, что без них повтор, мусор или журнал проходят. */
const guard = {
  /* Повтор за день: true — голос уже был. */
  repeated: (marks, mark) => marks.has(mark),
  /* Игра и режим есть в текущем каталоге. */
  known: (catalog, game, mode) => catalog.has(game) && catalog.get(game).has(mode),
  /* Что ещё записать о голосе. В рабочей программе ничего. */
  record: (_dir, _vote) => {},
};

class VoteError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* Тело голоса: строго { game, mode, value }. Возвращает объект или бросает VoteError(400). */
function parseVote(body) {
  let data;
  try { data = JSON.parse(body.toString('utf8')); } catch { throw new VoteError(400, 'не JSON'); }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new VoteError(400, 'не объект');
  const keys = Object.keys(data);
  if (keys.length !== 3 || !['game', 'mode', 'value'].every((k) => Object.prototype.hasOwnProperty.call(data, k))) throw new VoteError(400, 'лишние или нет полей');
  const { game, mode, value } = data;
  if (typeof game !== 'string' || !ID.test(game) || typeof mode !== 'string' || !ID.test(mode)) throw new VoteError(400, 'неверный id');
  if (!Number.isInteger(value) || value < 1 || value > 5) throw new VoteError(400, 'оценка не 1–5');
  return { game, mode, value };
}

/* dir: папка данных тьютора. now: часы (тесты). log: журнал программы, туда адреса не пишутся. */
function createVotes({ dir, now = () => Date.now(), maxMarks = MAX_MARKS, log = () => {} }) {
  const file = path.join(dir, 'ratings.json');
  let ratings = R.emptyRatings();
  const text = readText(file);
  if (text !== null) {
    const parsed = R.parseRatings(text);
    if (parsed) ratings = parsed;
    else {
      // Испорченный файл не затираем: тьютор может его посмотреть
      const bad = `${file}.bad-${R.localDay(new Date(now()))}-${crypto.randomBytes(3).toString('hex')}`;
      try { fs.renameSync(file, bad); } catch { /* файл уже убрали */ }
      log('ratings-bad', path.basename(bad));
    }
  }
  let version = 1; // растёт с каждым принятым голосом: ETag ответа /v1/ratings
  let day = null;
  let salt = null;
  let marks = new Set();

  const today = () => R.localDay(new Date(now()));
  function freshDay() {
    const d = today();
    if (d !== day) { day = d; salt = crypto.randomBytes(32); marks = new Set(); }
    return d;
  }
  freshDay();
  const markOf = (ip, game, mode) => crypto.createHmac('sha256', salt).update(`${ip}\n${game}\n${mode}`).digest('hex');

  /* ip: адрес ученика (только для отметки в памяти). body: Buffer. catalog: Map игра -> Set режимов.
     Возвращает { status }: 204 принят, 400, 409 уже голосовал сегодня, 429 память переполнена. */
  function submit(ip, body, catalog) {
    let vote;
    try { vote = parseVote(body); } catch (err) { return { status: err.status }; }
    if (!guard.known(catalog, vote.game, vote.mode)) return { status: 400 };
    freshDay();
    const mark = markOf(ip, vote.game, vote.mode);
    if (guard.repeated(marks, mark)) return { status: 409 };
    if (marks.size >= maxMarks) return { status: 429 };
    let next;
    try { next = R.addVote(ratings, new Map([[vote.game, new Set([vote.mode])]]), vote.game, vote.mode, vote.value); } catch { return { status: 400 }; }
    writeAtomic(file, `${JSON.stringify(next, null, 1)}\n`);
    ratings = next;
    marks.add(mark);
    version += 1;
    guard.record(dir, { ip, at: now(), ...vote });
    return { status: 204 };
  }

  return {
    submit,
    day: freshDay,
    version: () => version,
    ratings: () => ratings,
    /* Ответ /v1/ratings: только каталог, при n < 5 без распределения. */
    view: (catalog) => R.ratingsView(ratings, catalog),
    marks: () => marks.size, // тесты
  };
}

module.exports = { createVotes, parseVote, guard, VoteError, MAX_MARKS, BODY_BYTES };
