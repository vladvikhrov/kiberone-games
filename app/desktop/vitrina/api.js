'use strict';
/* IPC окна витрины. Каналов три плюс событие game.closed из основного процесса (постановка В0).
   Каждый аргумент из окна считается недоверенным: окно показывает тексты чужих авторов. */
const R = require('../../shared/ratings');

const CHANNELS = Object.freeze(['catalog.list', 'game.launch', 'vote.send']);
const EVENT_CLOSED = 'game.closed';
const ID = /^[a-z0-9-]{1,40}$/;

class ApiError extends Error {}
const bad = (message) => { throw new ApiError(message); };

/* getCatalog: () => результат loadCatalog. store: createStore. launch: (game, mode) => Promise<{ ok, reason? }>.
   played: Set "игра/режим", которые запускались в этом окне приложения. */
function createApi({ getCatalog, store, launch, played }) {
  const findGame = (id) => {
    if (typeof id !== 'string' || !ID.test(id)) bad('Неверный id игры');
    return getCatalog().games.find((g) => g.id === id) || bad('Такой игры нет на витрине');
  };
  const findMode = (game, id) => {
    if (typeof id !== 'string' || !ID.test(id)) bad('Неверный id режима');
    return game.modes.find((m) => m.id === id) || bad('Такого режима нет в игре');
  };
  const arity = (args, n, name) => { if (args.length !== n) bad(`${name}: нужно аргументов: ${n}`); };

  const day = () => store.day();
  /* То, что видит окно: без путей к файлам и ключей. */
  function gameView(g, today = day()) {
    const ratings = store.ratings();
    const counts = g.modes.map((m) => R.countsOf(ratings, g.id, m.id));
    return {
      id: g.id, title: g.title, description: g.description, grades: g.grades, minutes: g.minutes, topic: g.topic,
      author: g.author, state: g.state, groups: g.groups, cover: g.cover, multiMode: g.multiMode,
      rating: R.summarize(R.sumCounts(counts)),
      modes: g.modes.map((m, i) => ({
        id: m.id, title: m.title, about: m.about, cover: m.cover, rating: R.summarize(counts[i]),
        played: played.has(`${g.id}/${m.id}`), votedToday: R.hasVoted(today, g.id, m.id),
      })),
    };
  }

  return {
    'catalog.list': (...args) => {
      arity(args, 0, 'catalog.list');
      const catalog = getCatalog();
      const today = day();
      return { games: catalog.games.map((g) => gameView(g, today)), skipped: catalog.skipped.length, missing: catalog.missing };
    },
    'game.launch': async (...args) => {
      arity(args, 2, 'game.launch');
      const game = findGame(args[0]);
      const mode = findMode(game, args[1]);
      if (game.state !== 'ready') return { ok: false, reason: game.state };
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
      const map = new Map(getCatalog().games.map((g) => [g.id, new Set(g.modes.map((m) => m.id))]));
      const result = store.vote(map, game.id, mode.id, value);
      return result.ok ? { ok: true, game: gameView(game) } : result;
    },
  };
}

module.exports = { CHANNELS, EVENT_CLOSED, createApi, ApiError };
