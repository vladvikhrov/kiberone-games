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

/* ---- Рейтинг по сети (этап М4): GET /v1/ratings ----
   { format: 1, games: { игра: { n, counts?, modes: { режим: { n, counts? } } } } }. Распределение counts есть только при n >= 5,
   иначе только n: так ни сервер, ни витрина не раскрывают, что поставили первые четыре человека (ADR-0002 3.8, ADR-0003 10).
   Только игры и режимы текущего каталога, без нулевых. catalog: Map id игры -> Set id режимов. */
function hideFew(counts) {
  const { n } = summarize(counts);
  return n >= FEW ? { n, counts: { ...counts } } : { n };
}
function ratingsView(ratings, catalog) {
  const games = {};
  for (const [game, modes] of catalog) {
    const list = {};
    const all = [];
    for (const mode of modes) {
      const counts = countsOf(ratings, game, mode);
      all.push(counts);
      if (summarize(counts).n) list[mode] = hideFew(counts);
    }
    const total = sumCounts(all);
    if (summarize(total).n) games[game] = { ...hideFew(total), modes: list };
  }
  return { format: 1, games };
}

/* Разбор ответа сервера на ноутбуке ученика. Сервер не доверенный: строгая схема, только игры и режимы принятого каталога,
   counts только при n >= 5 и с суммой, равной n. Иначе null: витрина покажет прежний рейтинг. */
function parseRatingsView(text, catalog) {
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  const exact = (obj, required, optional = []) => isObject(obj) && required.every((k) => own(obj, k))
    && Object.keys(obj).every((k) => required.includes(k) || optional.includes(k));
  const node = (obj, extra = []) => {
    if (!exact(obj, ['n', ...extra], ['counts'])) return null;
    if (!Number.isSafeInteger(obj.n) || obj.n < 1) return null;
    if (!own(obj, 'counts')) return obj.n < FEW ? { n: obj.n } : null;
    if (obj.n < FEW || !exact(obj.counts, STARS)) return null;
    let sum = 0;
    for (const s of STARS) { const v = obj.counts[s]; if (!Number.isSafeInteger(v) || v < 0) return null; sum += v; }
    return sum === obj.n ? { n: obj.n, counts: Object.fromEntries(STARS.map((s) => [s, obj.counts[s]])) } : null;
  };
  if (!exact(data, ['format', 'games']) || data.format !== 1 || !isObject(data.games)) return null;
  const out = {};
  for (const [game, g] of Object.entries(data.games)) {
    if (!catalog.has(game) || !isObject(g)) return null;
    const top = node(g, ['modes']);
    if (!top || !isObject(g.modes)) return null;
    const modes = {};
    for (const [mode, m] of Object.entries(g.modes)) {
      if (!catalog.get(game).has(mode)) return null;
      const one = node(m);
      if (!one) return null;
      modes[mode] = one;
    }
    out[game] = { ...top, modes };
  }
  return out;
}

/* Сводка для витрины из узла рейтинга по сети: то же, что summarize, но среднее только если сервер дал распределение. */
function summarizeNode(item) {
  if (!item) return { n: 0, few: true, avg: null };
  if (!item.counts) return { n: item.n, few: true, avg: null };
  return summarize(item.counts);
}

module.exports = {
  FEW, emptyRatings, parseRatings, countsOf, summarize, sumCounts, addVote, localDay, dayState, hasVoted, markVoted,
  ratingsView, parseRatingsView, summarizeNode,
};
