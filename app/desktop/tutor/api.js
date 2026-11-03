'use strict';
/* IPC окна тьютора (Т12). Только эти каналы, каждый аргумент проверяется: окно показывает тексты чужих авторов.
   Путей к файлам окно не передаёт и не получает: файлы и папки выбирает системное окно основного процесса. */
const R = require('../../shared/ratings');
const { groupsOf } = require('../../shared/groups');
const { fingerprintText, CatalogError } = require('../../shared/catalog');
const { PackageError } = require('../../shared/package-format');
const { KeyError, IDLE_MS } = require('./school-key');
const { LibraryError } = require('./library');

const CHANNELS = Object.freeze([
  'state.get', 'school.create', 'school.restore', 'school.unlock', 'school.recover', 'school.lock', 'school.backup', 'school.saveFile',
  'game.pick', 'game.publish', 'game.cancel', 'game.try', 'game.unpublish', 'game.lesson',
]);
const EVENT_LOCKED = 'school.locked';
const ID = /^[a-z0-9-]{1,40}$/;
const TOKEN = /^[0-9a-f]{32}$/;

class ApiError extends Error {}
const bad = (message) => { throw new ApiError(message); };
const arity = (args, n, name) => { if (args.length !== n) bad(`${name}: нужно аргументов: ${n}`); };
const str = (v, max, name) => (typeof v === 'string' && v.length <= max ? v : bad(`${name}: нужна строка до ${max} знаков`));
const bool = (v, name) => (typeof v === 'boolean' ? v : bad(`${name}: нужно true или false`));
const id = (v) => (typeof v === 'string' && ID.test(v) ? v : bad('Неверный id'));
const token = (v) => (typeof v === 'string' && TOKEN.test(v) ? v : bad('Неверный номер файла'));

/* Ошибки, понятные тьютору, уходят в окно текстом. Остальное — в журнал, в окно только общий текст. */
function asResult(err, log) {
  if (err instanceof KeyError) return { ok: false, error: err.message, code: err.code, ...(err.wait ? { wait: err.wait } : {}) };
  if (err instanceof LibraryError || err instanceof CatalogError) return { ok: false, error: err.message };
  if (err instanceof PackageError) {
    if (err.detail) log('package-error', err.detail);
    return { ok: false, error: err.message, kind: err.kind };
  }
  if (err instanceof ApiError) throw err;
  log('error', String(err && err.stack));
  return { ok: false, error: 'Непредвиденная ошибка. Подробности в журнале программы' };
}

/* key: createSchoolKey. getLibrary: () => createLibrary (пересоздаётся после создания школы).
   ratings: () => содержимое ratings.json. dialogs: системные окна выбора файлов. tryGame: (pkg, modeId) => Promise. */
function createTutorApi({ key, getLibrary, ratings, dialogs, tryGame, today, log = () => {}, onSchool = () => {} }) {
  const safe = (fn) => async (...args) => {
    try { return await fn(...args); } catch (err) { return asResult(err, log); }
  };

  function gameView(g, r) {
    const counts = g.modes.map((m) => R.countsOf(r, g.id, m.id));
    return {
      id: g.id, title: g.title, version: g.version, grades: g.grades, groups: groupsOf(g.grades), author: g.author, authorKey: g.authorKey,
      lesson: g.lesson, publishedAt: g.publishedAt, cover: g.cover ? g.cover.sha256 : null, minAppVersion: g.minAppVersion,
      rating: R.summarize(R.sumCounts(counts)),
      modes: g.modes.map((m, i) => ({ id: m.id, title: m.title, cover: m.cover ? m.cover.sha256 : null, counts: counts[i], rating: R.summarize(counts[i]) })),
    };
  }

  function state() {
    let school = null;
    let schoolError = null;
    if (key.exists()) {
      try {
        const info = key.info();
        school = { name: info.name, fingerprint: fingerprintText(info.fingerprint) };
      } catch (err) { schoolError = err.message; }
    }
    const lib = school ? getLibrary() : null;
    const r = ratings();
    return {
      school, schoolError, unlocked: key.unlocked(), wait: school ? key.waitSeconds() : 0, idleMinutes: IDLE_MS / 60000,
      catalogError: lib ? lib.catalogError() : null, seq: lib ? lib.seq() : 0,
      games: lib ? lib.games().map((g) => gameView(g, r)) : [],
    };
  }

  const ok = (extra = {}) => ({ ok: true, ...extra, state: state() });

  return {
    'state.get': (...args) => { arity(args, 0, 'state.get'); return state(); },

    'school.create': safe(async (...args) => {
      arity(args, 3, 'school.create');
      const result = await key.create({ name: str(args[0], 200, 'Название'), password: str(args[1], 1000, 'Пароль'), again: str(args[2], 1000, 'Пароль') });
      onSchool();
      return ok({ recoveryCode: result.recoveryCode });
    }),
    'school.restore': safe(async (...args) => {
      arity(args, 0, 'school.restore');
      const dir = await dialogs.pickRestoreDir();
      if (!dir) return { ok: false, cancelled: true };
      key.restore(dir);
      onSchool();
      return ok();
    }),
    'school.unlock': safe(async (...args) => {
      arity(args, 1, 'school.unlock');
      await key.unlock(str(args[0], 1000, 'Пароль'));
      return ok();
    }),
    'school.recover': safe(async (...args) => {
      arity(args, 3, 'school.recover');
      await key.recover({ code: str(args[0], 80, 'Код'), password: str(args[1], 1000, 'Пароль'), again: str(args[2], 1000, 'Пароль') });
      return ok();
    }),
    'school.lock': safe(async (...args) => {
      arity(args, 0, 'school.lock');
      getLibrary().cancelAll();
      key.lock();
      return ok();
    }),
    'school.backup': safe(async (...args) => {
      arity(args, 0, 'school.backup');
      if (!key.unlocked()) throw new KeyError('Ключ школы закрыт. Войдите по паролю', 'locked');
      const dir = await dialogs.pickBackupDir();
      if (!dir) return { ok: false, cancelled: true };
      const target = key.backup(dir, { day: today() });
      return ok({ folder: target.split(/[\\/]/).pop() });
    }),
    'school.saveFile': safe(async (...args) => {
      arity(args, 0, 'school.saveFile');
      const saved = await dialogs.saveSchoolFile(key.schoolFileText());
      return saved ? ok() : { ok: false, cancelled: true };
    }),

    'game.pick': safe(async (...args) => {
      arity(args, 0, 'game.pick');
      if (!key.unlocked()) throw new KeyError('Ключ школы закрыт. Войдите по паролю', 'locked');
      const file = await dialogs.pickGame();
      if (!file) return { ok: false, cancelled: true };
      const analysis = await getLibrary().inspect(file);
      const { sha256, ...view } = analysis; // хеш файла окну не нужен
      return { ok: true, game: { ...view, groups: groupsOf(analysis.grades) } };
    }),
    'game.publish': safe(async (...args) => {
      arity(args, 4, 'game.publish');
      const record = await getLibrary().publish(token(args[0]), {
        confirmUnknown: bool(args[1], 'Подтверждение автора'), confirmReplace: bool(args[2], 'Подтверждение замены'),
        trustName: str(args[3], 200, 'Имя автора').trim(),
      });
      return ok({ id: record.id });
    }),
    'game.cancel': safe(async (...args) => {
      arity(args, 1, 'game.cancel');
      return { ok: getLibrary().cancel(token(args[0])) };
    }),
    'game.try': safe(async (...args) => {
      arity(args, 3, 'game.try');
      const kind = args[0] === 'pending' || args[0] === 'catalog' ? args[0] : bad('Неверный источник игры');
      const value = kind === 'pending' ? token(args[1]) : id(args[1]);
      const mode = id(args[2]);
      const pkg = await getLibrary().packageFor(kind, value);
      await tryGame(pkg, mode);
      return { ok: true };
    }),
    'game.unpublish': safe(async (...args) => {
      arity(args, 1, 'game.unpublish');
      await getLibrary().unpublish(id(args[0]));
      return ok();
    }),
    'game.lesson': safe(async (...args) => {
      arity(args, 2, 'game.lesson');
      await getLibrary().setLesson(id(args[0]), bool(args[1], 'Отметка занятия'));
      return ok();
    }),
  };
}

module.exports = { CHANNELS, EVENT_LOCKED, createTutorApi, ApiError };
