'use strict';
/* IPC окна витрины. Четыре канала (ADR-0002, 4.1) и события game.closed и catalog.changed из основного процесса.
   Каждый аргумент из окна считается недоверенным: окно показывает тексты чужих авторов. */
const R = require('../../shared/ratings');

const CHANNELS = Object.freeze(['catalog.list', 'game.launch', 'vote.send', 'server.setAddress']);
const EVENT_CLOSED = 'game.closed';
const EVENT_CHANGED = 'catalog.changed';
const IP_TEXT = /^[0-9.]{7,15}$/;
const ID = /^[a-z0-9-]{1,40}$/;

class ApiError extends Error {}
const bad = (message) => { throw new ApiError(message); };

/* getCatalog: () => { games, skipped, missing, net? }. store: createStore. launch: (game, mode) => Promise<{ ok, reason? }>.
   played: Set "игра/режим", которые запускались в этом окне приложения.
   setAddress: (ip) => Promise<{ ok, reason? }>, только на настроенном ноутбуке. */
/* want: (game) => 'queued' | 'offline' | … — «Играть» на нескачанной игре ставит её первой (М3), только на настроенном ноутбуке. */
const WANTABLE = new Set(['queued', 'ondemand', 'downloading', 'waiting', 'offline', 'nospace']);
/* netVotes: оценки по сети на настроенном ноутбуке (net-source: vote, rating, votePending, day), иначе оценки локальные, как на В0. */
function createApi({ getCatalog, store, launch, played, setAddress = null, want = null, netVotes = null }) {
  const findGame = (id) => {
    if (typeof id !== 'string' || !ID.test(id)) bad('Неверный id игры');
    return getCatalog().games.find((g) => g.id === id) || bad('Такой игры нет на витрине');
  };
  const findMode = (game, id) => {
    if (typeof id !== 'string' || !ID.test(id)) bad('Неверный id режима');
    return game.modes.find((m) => m.id === id) || bad('Такого режима нет в игре');
  };
  const arity = (args, n, name) => { if (args.length !== n) bad(`${name}: нужно аргументов: ${n}`); };

  const day = () => store.day(netVotes ? netVotes.day() : null);
  /* Рейтинг режима (mode) или всей игры (mode = null): с сервера на настроенном ноутбуке, из своего файла на В0. */
  function ratingOf(g, mode) {
    if (netVotes) return netVotes.rating(g.id, mode);
    const ratings = store.ratings();
    if (mode !== null) return R.summarize(R.countsOf(ratings, g.id, mode));
    return R.summarize(R.sumCounts(g.modes.map((m) => R.countsOf(ratings, g.id, m.id))));
  }
  /* То, что видит окно: без путей к файлам и ключей. */
  function gameView(g, today = day()) {
    return {
      id: g.id, title: g.title, description: g.description, grades: g.grades, minutes: g.minutes, topic: g.topic,
      author: g.author, byTutor: !!g.byTutor, state: g.state, progress: g.progress || 0, groups: g.groups, cover: g.cover, multiMode: g.multiMode,
      eta: Number.isInteger(g.eta) ? g.eta : null, first: g.first === true, mb: Math.max(1, Math.round((g.bytes || 0) / (1024 * 1024))),
      rating: ratingOf(g, null),
      modes: g.modes.map((m) => ({
        id: m.id, title: m.title, about: m.about, cover: m.cover, rating: ratingOf(g, m.id),
        played: played.has(`${g.id}/${m.id}`), votedToday: R.hasVoted(today, g.id, m.id),
        votePending: netVotes ? netVotes.votePending(g.id, m.id) : false,
      })),
    };
  }

  return {
    'catalog.list': (...args) => {
      arity(args, 0, 'catalog.list');
      const catalog = getCatalog();
      const today = day();
      return {
        games: catalog.games.map((g) => gameView(g, today)), skipped: catalog.skipped.length, missing: catalog.missing,
        net: catalog.net || { configured: false },
      };
    },
    'game.launch': async (...args) => {
      arity(args, 2, 'game.launch');
      const game = findGame(args[0]);
      const mode = findMode(game, args[1]);
      if (game.state !== 'ready') {
        if (want && WANTABLE.has(game.state)) return { ok: false, reason: String(want(game)) };
        return { ok: false, reason: game.state };
      }
      const result = await launch(game, mode);
      if (result.ok) played.add(`${game.id}/${mode.id}`);
      return { ok: !!result.ok, ...(result.ok ? {} : { reason: String(result.reason || 'failed') }) };
    },
    'vote.send': (...args) => {
      arity(args, 3, 'vote.send');
      const game = findGame(args[0]);
      const mode = findMode(game, args[1]);
      const value = args[2];
      if (!Number.isInteger(value) || value < 1 || value > 5) bad('Оценка: целое число от 1 до 5');
      // Оценить можно только то, что запускали в этом окне: окно витрины само по себе этого не докажет
      if (!played.has(`${game.id}/${mode.id}`)) return { ok: false, reason: 'not-played' };
      if (netVotes) {
        // Отметка дня до отправки: повторное нажатие не дойдёт до сервера, даже если голос ещё в очереди
        const marked = store.markDay(game.id, mode.id, netVotes.day());
        if (!marked.ok) return marked;
        netVotes.vote(game.id, mode.id, value);
        return { ok: true, net: true, game: gameView(game) };
      }
      const map = new Map(getCatalog().games.map((g) => [g.id, new Set(g.modes.map((m) => m.id))]));
      const result = store.vote(map, game.id, mode.id, value);
      return result.ok ? { ok: true, game: gameView(game) } : result;
    },
    'server.setAddress': async (...args) => {
      arity(args, 1, 'server.setAddress');
      const ip = args[0];
      if (typeof ip !== 'string' || !IP_TEXT.test(ip)) return { ok: false, reason: 'not-ip' };
      if (!setAddress) return { ok: false, reason: 'not-configured' };
      const result = await setAddress(ip);
      return { ok: !!result.ok, ...(result.ok ? {} : { reason: String(result.reason) }) };
    },
  };
}

module.exports = { CHANNELS, EVENT_CLOSED, EVENT_CHANGED, createApi, ApiError };
