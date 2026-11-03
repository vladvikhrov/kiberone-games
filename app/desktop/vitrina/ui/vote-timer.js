'use strict';
/* Голос с отменой: уходит через 5 с, «Отменить» в это время его снимает.
   Работает в окне витрины и в модульных тестах Node. Часы передаются снаружи, чтобы их можно было подменить. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.K1VoteTimer = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  function createPendingVotes({ delayMs = 5000, now, setTimer, clearTimer, send }) {
    const pending = new Map(); // "игра/режим" -> { value, at, timer }
    const key = (game, mode) => `${game}/${mode}`;

    function fire(k) {
      const item = pending.get(k);
      if (!item) return;
      pending.delete(k);
      send(item.game, item.mode, item.value);
    }

    return {
      /* Повторное нажатие до отправки меняет звёзды и запускает 5 с заново. */
      start(game, mode, value) {
        const k = key(game, mode);
        const old = pending.get(k);
        if (old) clearTimer(old.timer);
        const item = { game, mode, value, at: now(), timer: null };
        item.timer = setTimer(() => fire(k), delayMs);
        pending.set(k, item);
      },
      cancel(game, mode) {
        const k = key(game, mode);
        const item = pending.get(k);
        if (!item) return false;
        clearTimer(item.timer);
        pending.delete(k);
        return true;
      },
      /* Сколько миллисекунд осталось, или null, если голоса нет. */
      remaining(game, mode) {
        const item = pending.get(key(game, mode));
        return item ? Math.max(0, delayMs - (now() - item.at)) : null;
      },
      value(game, mode) {
        const item = pending.get(key(game, mode));
        return item ? item.value : null;
      },
    };
  }
  return { createPendingVotes };
}));
