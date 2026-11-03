'use strict';
/* Оценки режимов (ADR-0003, раздел 10). Без имён, адресов и времени: только сколько раз поставили каждую звезду.
   Этот же счётчик будет на сервере тьютора, на этапе В0 он лежит в локальном ratings.json. */

const STARS = ['1', '2', '3', '4', '5'];
const FEW = 5; // при n < 5 среднее не показываем: одна оценка не должна давать 5.0
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const ID = /^[a-z0-9-]{1,40}$/;

const emptyRatings = () => ({ format: 1, games: {} });

/* Разбирает ratings.json. Неверный файл не чинится молча: вызывающий решает, что с ним делать. */
function parseRatings(text) {
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (!isObject(data) || data.format !== 1 || !isObject(data.games)) return null;
  const out = emptyRatings();
  for (const [game, modes] of Object.entries(data.games)) {
    if (!ID.test(game) || !isObject(modes)) return null;
    out.games[game] = {};
    for (const [mode, counts] of Object.entries(modes)) {
      if (!ID.test(mode) || !isObject(counts)) return null;
      const clean = {};
      for (const star of STARS) {
        const n = own(counts, star) ? counts[star] : 0;
        if (!Number.isSafeInteger(n) || n < 0) return null;
        clean[star] = n;
      }
      if (Object.keys(counts).some((k) => !STARS.includes(k))) return null;
      out.games[game][mode] = clean;
    }
  }
  return out;
}

/* Счётчики режима, если оценок ещё нет: нули. */
function countsOf(ratings, game, mode) {
  const modes = own(ratings.games, game) ? ratings.games[game] : null;
  const counts = modes && own(modes, mode) ? modes[mode] : null;
  return Object.fromEntries(STARS.map((s) => [s, counts ? counts[s] : 0]));
}

/* Среднее с одним знаком после запятой. При n < 5 только «мало оценок», среднее не раскрываем. */
function summarize(counts) {
  let n = 0;
  let sum = 0;
  for (const star of STARS) { n += counts[star]; sum += Number(star) * counts[star]; }
  const few = n < FEW;
  return { n, few, avg: few ? null : Math.round((sum * 10) / n) / 10 };
}

/* Сумма по нескольким режимам: для карточки игры на витрине. */
function sumCounts(list) {
  const total = Object.fromEntries(STARS.map((s) => [s, 0]));
  for (const counts of list) for (const s of STARS) total[s] += counts[s];
  return total;
}

/* Добавляет голос. catalog: Map id игры -> множество id режимов. Ключи не из каталога не принимаются,
   иначе любой ноутбук мог бы добавить в файл мусор. Возвращает новый объект, старый не меняется. */
function addVote(ratings, catalog, game, mode, value) {
  if (typeof game !== 'string' || !catalog.has(game)) throw new Error('Такой игры нет в каталоге');
  if (typeof mode !== 'string' || !catalog.get(game).has(mode)) throw new Error('Такого режима нет в игре');
  if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error('Оценка: целое число от 1 до 5');
  const next = JSON.parse(JSON.stringify(ratings));
  if (!own(next.games, game)) next.games[game] = {};
  const counts = countsOf(next, game, mode);
  counts[String(value)] += 1;
  next.games[game][mode] = counts;
  return next;
}

/* Одна оценка режима в день с этого ноутбука. state.json хранит только факт, без звёзд.
   День считается по местной дате; при смене даты список очищается. */
const localDay = (date) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

function dayState(saved, today) {
  const ok = isObject(saved) && saved.votedOn === today && Array.isArray(saved.voted)
    && saved.voted.every((k) => typeof k === 'string' && /^[a-z0-9-]{1,40}\/[a-z0-9-]{1,40}$/.test(k));
  return { votedOn: today, voted: ok ? [...new Set(saved.voted)] : [] };
}
const voteKey = (game, mode) => `${game}/${mode}`;
const hasVoted = (state, game, mode) => state.voted.includes(voteKey(game, mode));
const markVoted = (state, game, mode) => (hasVoted(state, game, mode) ? state : { ...state, voted: [...state.voted, voteKey(game, mode)] });

module.exports = { FEW, emptyRatings, parseRatings, countsOf, summarize, sumCounts, addVote, localDay, dayState, hasVoted, markVoted };
