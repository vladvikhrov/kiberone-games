/* ========================================================================
   Остров координат — логика без интерфейса.
   Здесь всё, что можно проверить тестами: маршрут Бита, камни, подбор
   кристаллов, разбор типичных ошибок ученика.
   Файл работает и в браузере (window.CoordLogic), и в Node (require).
   ======================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CoordLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const AX = { x: 'X', y: 'Y' };

  /* ---------- Маршрут: сначала вбок (X), потом вверх (Y) ---------- */

  function cmdTarget(level, from, cmd) {
    if (level.axes === 'x') return { x: cmd.x, y: from.y };
    if (level.axes === 'y') return { x: from.x, y: cmd.y };
    return { x: cmd.x, y: cmd.y };
  }

  function segmentsFor(from, to) {
    const segs = [];
    if (to.x !== from.x) segs.push({ x0: from.x, y0: from.y, x1: to.x, y1: from.y, axis: 'x' });
    if (to.y !== from.y) segs.push({ x0: to.x, y0: from.y, x1: to.x, y1: to.y, axis: 'y' });
    return segs;
  }

  function segLen(s) {
    return Math.abs(s.x1 - s.x0) + Math.abs(s.y1 - s.y0);
  }

  /* Камень занимает прямоугольник целых точек x0..x1, y0..y1 (включительно).
     Бит останавливается за одну точку до камня. */
  function trimSegment(seg, rocks) {
    let stop, hit = null;
    if (seg.axis === 'x') {
      const dir = Math.sign(seg.x1 - seg.x0);
      stop = seg.x1;
      for (const r of rocks) {
        if (seg.y0 < r.y0 || seg.y0 > r.y1) continue;
        if (dir > 0) {
          if (r.x1 < seg.x0 || r.x0 > seg.x1) continue;
          const s = Math.max(seg.x0, r.x0 - 1);
          if (s < stop) { stop = s; hit = r; }
        } else {
          if (r.x0 > seg.x0 || r.x1 < seg.x1) continue;
          const s = Math.min(seg.x0, r.x1 + 1);
          if (s > stop) { stop = s; hit = r; }
        }
      }
      return { seg: Object.assign({}, seg, { x1: stop }), blocked: hit };
    }
    const dir = Math.sign(seg.y1 - seg.y0);
    stop = seg.y1;
    for (const r of rocks) {
      if (seg.x0 < r.x0 || seg.x0 > r.x1) continue;
      if (dir > 0) {
        if (r.y1 < seg.y0 || r.y0 > seg.y1) continue;
        const s = Math.max(seg.y0, r.y0 - 1);
        if (s < stop) { stop = s; hit = r; }
      } else {
        if (r.y0 > seg.y0 || r.y1 < seg.y1) continue;
        const s = Math.min(seg.y0, r.y1 + 1);
        if (s > stop) { stop = s; hit = r; }
      }
    }
    return { seg: Object.assign({}, seg, { y1: stop }), blocked: hit };
  }

  /* Расстояние от кристалла до отрезка и длина пути до ближайшей точки. */
  function pickupAlong(seg, c, radius) {
    let d, along;
    if (seg.axis === 'x') {
      const lo = Math.min(seg.x0, seg.x1), hi = Math.max(seg.x0, seg.x1);
      const px = Math.min(hi, Math.max(lo, c.x));
      d = Math.hypot(c.x - px, c.y - seg.y0);
      along = Math.abs(px - seg.x0);
    } else {
      const lo = Math.min(seg.y0, seg.y1), hi = Math.max(seg.y0, seg.y1);
      const py = Math.min(hi, Math.max(lo, c.y));
      d = Math.hypot(c.x - seg.x0, c.y - py);
      along = Math.abs(py - seg.y0);
    }
    return d <= radius + 1e-9 ? along : null;
  }

  /* Прогон программы: список команд -> шаги, подбор кристаллов, камни. */
  function evaluate(level, cmds) {
    const rocks = level.rocks || [];
    const radius = level.radius || 0.25;
    let pos = { x: level.start.x, y: level.start.y };
    const steps = [];
    const got = new Set();
    const pickups = [];
    let blocked = null;
    let length = 0;

    for (let i = 0; i < cmds.length; i++) {
      const target = cmdTarget(level, pos, cmds[i]);
      const segs = [];
      let cur = { x: pos.x, y: pos.y };
      let stepBlocked = null;
      for (const raw of segmentsFor(pos, target)) {
        const t = trimSegment(raw, rocks);
        if (t.seg.x0 === t.seg.x1 && t.seg.y0 === t.seg.y1) { stepBlocked = t.blocked; break; }
        segs.push(t.seg);
        level.crystals.forEach((c, j) => {
          if (got.has(j)) return;
          const a = pickupAlong(t.seg, c, radius);
          if (a !== null) { got.add(j); pickups.push({ index: j, at: length + a }); }
        });
        length += segLen(t.seg);
        cur = { x: t.seg.x1, y: t.seg.y1 };
        if (t.blocked) { stepBlocked = t.blocked; break; }
      }
      steps.push({ cmdIndex: i, from: { x: pos.x, y: pos.y }, to: cur, segs, target, blocked: stepBlocked });
      pos = cur;
      if (stepBlocked) { blocked = { rock: stepBlocked, at: { x: cur.x, y: cur.y }, cmdIndex: i }; break; }
    }
    return {
      steps, pickups, collected: got, end: pos, blocked, length,
      solved: !blocked && got.size === level.crystals.length
    };
  }

  /* ---------- Проверка ввода ---------- */

  function axesNeeded(level) {
    return level.axes === 'x' ? ['x'] : level.axes === 'y' ? ['y'] : ['x', 'y'];
  }

  function validateCommand(level, raw) {
    const out = {};
    for (const k of axesNeeded(level)) {
      const v = raw[k];
      if (v === '' || v === null || v === undefined) return { ok: false, text: 'Введи число ' + AX[k] + '.' };
      const n = Number(v);
      if (!Number.isFinite(n)) return { ok: false, text: 'Нужно число.' };
      if (!Number.isInteger(n)) return { ok: false, text: 'Нужно целое число.' };
      const max = k === 'x' ? level.size.w : level.size.h;
      if (n < 0 || n > max) return { ok: false, text: AX[k] + ' может быть от 0 до ' + max + '. Дальше остров заканчивается.' };
      out[k] = n;
    }
    return { ok: true, cmd: out };
  }

  /* ---------- Разбор ошибок: что именно перепутал ученик ---------- */

  function diagnose(level, cmds, res) {
    if (res.blocked) {
      const b = res.blocked.at;
      return {
        kind: 'rock',
        text: 'Бит врезался в камень и остановился в точке (' + b.x + ', ' + b.y + '). ' +
          'Он идёт сначала вбок, потом вверх. Добавь промежуточную точку, чтобы обойти камни.'
      };
    }
    const missing = [];
    level.crystals.forEach((c, j) => { if (!res.collected.has(j)) missing.push(c); });
    if (!missing.length) return { kind: 'ok', text: '' };

    const radius = level.radius || 0.25;
    const entered = cmds.map(c => ({ x: c.x, y: c.y }));
    const tail = missing.length > 1 ? ' Не собрано кристаллов: ' + missing.length + '.' : '';

    for (const c of missing) {
      if (level.axes === 'xy') {
        const swapped = entered.some(e => e.x === c.y && e.y === c.x) && c.x !== c.y;
        if (swapped) {
          return { kind: 'swapped', text: 'Кажется, числа стоят в обратном порядке. Для кристалла (' + c.x + ', ' + c.y + ') ты ввёл ' + c.y + ' в поле X. Первое число — X: вбок по синей шкале, второе — Y: вверх по оранжевой.' };
        }
      }
    }
    for (const c of missing) {
      if (level.axes === 'x' || level.axes === 'y') {
        const k = level.axes;
        const dist = Math.abs(c[k] - level.start[k]);
        if (dist !== c[k] && entered.some(e => e[k] === dist)) {
          return { kind: 'steps', text: 'Ты ввёл число шагов: ' + dist + '. Но Бит ждёт адрес точки, а не длину пути. Посмотри на шкалу: на каком числе лежит кристалл?' };
        }
      }
    }
    for (const c of missing) {
      if (level.axes !== 'xy') continue;
      const xOnly = entered.find(e => e.x === c.x && e.y !== c.y);
      const yOnly = entered.find(e => e.y === c.y && e.x !== c.x);
      if (xOnly) return { kind: 'xok', text: 'X верный, а Y нет. Найди высоту кристалла на оранжевой шкале слева.' + tail };
      if (yOnly) return { kind: 'yok', text: 'Y верный, а X нет. Найди кристалл на синей шкале внизу.' + tail };
    }
    for (const c of missing) {
      const near = entered.find(e => {
        if (level.axes === 'xy') return Math.abs(e.x - c.x) <= 2 * Math.max(radius, 1) && Math.abs(e.y - c.y) <= 2 * Math.max(radius, 1);
        const k = level.axes; return Math.abs(e[k] - c[k]) <= 1;
      });
      if (near) return { kind: 'near', text: 'Почти! Бит прошёл рядом с кристаллом, но не попал. Проверь числа ещё раз по шкалам.' + tail };
    }
    return {
      kind: 'miss',
      text: 'Бит дошёл не до всех кристаллов. ' +
        (level.axes === 'xy' ? 'Найди кристалл на синей шкале (X) и на оранжевой (Y).' : 'Найди число на шкале рядом с кристаллом.') + tail
    };
  }

  /* ---------- Маяки: нажми в точку по числам ---------- */

  function checkBeacon(target, click) {
    if (click.x === target.x && click.y === target.y) return { ok: true, kind: 'ok', text: '' };
    if (click.x === target.y && click.y === target.x && target.x !== target.y) {
      return { ok: false, kind: 'swapped', text: 'Ты нажал (' + click.x + ', ' + click.y + ') — числа в обратном порядке. Первое число — X: сначала считай вбок по синей шкале, потом вверх.' };
    }
    if (click.x === target.x) {
      return { ok: false, kind: 'ywrong', text: 'X верный, а Y нет. Нужно ' + target.y + ' на оранжевой шкале, ты нажал ' + click.y + '.' };
    }
    if (click.y === target.y) {
      return { ok: false, kind: 'xwrong', text: 'Y верный, а X нет. Нужно ' + target.x + ' на синей шкале, ты нажал ' + click.x + '.' };
    }
    return { ok: false, kind: 'both', text: 'Ты нажал (' + click.x + ', ' + click.y + '), а нужна точка (' + target.x + ', ' + target.y + '). Сначала найди ' + target.x + ' на синей шкале, потом поднимись до ' + target.y + '.' };
  }

  /* ---------- Время: формулы дронов ---------- */

  function droneAt(drone, t) {
    return { x: drone.fx(t), y: drone.fy(t) };
  }

  /* Одна строка таблицы кадров: ученик подставил time в формулу и записал точку. */
  function checkFrame(level, t, cmd) {
    const d = level.drones[0], want = droneAt(d, t);
    const okX = cmd.x === want.x, okY = cmd.y === want.y;
    if (okX && okY) return { ok: true, okX, okY, text: '' };
    if (cmd.x === want.y && cmd.y === want.x && want.x !== want.y) {
      return { ok: false, okX, okY, text: 'Числа в обратном порядке: сначала X (вбок), потом Y (вверх).' };
    }
    const parts = [];
    [['X', d.xText, okX], ['Y', d.yText, okY]].forEach(function (a) {
      if (a[2]) return;
      if (/^\d+$/.test(a[1])) parts.push(a[0] + ': в формуле стоит число ' + a[1] + ', оно не меняется.');
      else parts.push(a[0] + ': в формуле «' + a[1] + '». Замени слово time на ' + t + ' и посчитай.');
    });
    return { ok: false, okX, okY, text: parts.join(' ') };
  }

  function checkMeet(level, t) {
    const a = droneAt(level.drones[0], t), b = droneAt(level.drones[1], t);
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d <= (level.radius || 4)) return { ok: true, text: '' };
    return { ok: false, text: 'Пока не встретились: у первого X = ' + a.x + ', у второго X = ' + b.x + '. Разница ' + Math.abs(a.x - b.x) + '. Подвигай ползунок и найди момент, когда она станет почти нулём.' };
  }

  /* ---------- Блиц «Радар» ---------- */

  function makeQuestion(rng, size, prev) {
    let q;
    for (let i = 0; i < 20; i++) {
      q = {
        kind: rng() < 0.55 ? 'click' : 'name',
        target: { x: Math.floor(rng() * (size + 1)), y: Math.floor(rng() * (size + 1)) }
      };
      if (!prev || prev.target.x !== q.target.x || prev.target.y !== q.target.y) break;
    }
    return q;
  }

  function blitzRank(score) {
    if (score >= 220) return 'Навигатор острова';
    if (score >= 140) return 'Картограф';
    if (score >= 70) return 'Штурман';
    return 'Стажёр';
  }

  function stars(fails, hints) {
    if (fails === 0 && hints === 0) return 3;
    if (fails <= 1 && hints <= 1) return 2;
    return 1;
  }

  return { cmdTarget, segmentsFor, segLen, trimSegment, evaluate, validateCommand, axesNeeded,
    diagnose, checkBeacon, droneAt, checkFrame, checkMeet, makeQuestion, blitzRank, stars };
});
