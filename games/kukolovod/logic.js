/* ========================================================================
   Кукловод — логика без интерфейса.
   Кукла собрана из тех же блоков, что в «Фильме»: круг (голова),
   прямоугольник (туловище), линии (руки и ноги). У каждой детали есть
   числа-поля вида «деталь.ключ», например armR.y2.
   Файл работает и в браузере (window.PuppetLogic), и в Node (require).
   ======================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PuppetLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Правая и левая рука — по картинке: «справа» это X около 80, «слева» около 20. */
  const PARTS = {
    head: { kind: 'circle', keys: ['x', 'y', 'r'], label: 'Голова', color: '#E5333B' },
    body: { kind: 'rect', keys: ['x', 'y', 'w', 'h'], label: 'Туловище', color: '#3A3AD6' },
    armR: { kind: 'line', keys: ['x1', 'y1', 'x2', 'y2'], label: 'Рука справа', names: ['плечо', 'кисть'], color: '#9AA3B2' },
    armL: { kind: 'line', keys: ['x1', 'y1', 'x2', 'y2'], label: 'Рука слева', names: ['плечо', 'кисть'], color: '#9AA3B2' },
    legR: { kind: 'line', keys: ['x1', 'y1', 'x2', 'y2'], label: 'Нога справа', names: ['бедро', 'стопа'], color: '#9AA3B2' },
    legL: { kind: 'line', keys: ['x1', 'y1', 'x2', 'y2'], label: 'Нога слева', names: ['бедро', 'стопа'], color: '#9AA3B2' }
  };

  /* Поза «руки опущены, стоит». Остальные позы отсчитываются от неё. */
  const NEUTRAL = {
    'head.x': 50, 'head.y': 70, 'head.r': 10,
    'body.x': 50, 'body.y': 40, 'body.w': 20, 'body.h': 40,
    'armR.x1': 60, 'armR.y1': 50, 'armR.x2': 70, 'armR.y2': 25,
    'armL.x1': 40, 'armL.y1': 50, 'armL.x2': 30, 'armL.y2': 25,
    'legR.x1': 60, 'legR.y1': 20, 'legR.x2': 65, 'legR.y2': 0,
    'legL.x1': 40, 'legL.y1': 20, 'legL.x2': 35, 'legL.y2': 0
  };

  const THICK = 5;                  // толщина линий в единицах карты
  const SAMPLES = [0, 20, 40, 60, 80, 100];
  const AXIS = { x: 'X', y: 'Y' };

  const keyBase = (k) => k.replace(/\d$/, '');
  const splitId = (fid) => { const p = fid.split('.'); return { part: p[0], key: p[1] }; };
  const tol = (k) => ({ x: 3, y: 3, r: 2, w: 4, h: 4 })[keyBase(k)] || 3;
  const maxOf = (k) => (keyBase(k) === 'r' ? 50 : 100);

  function validValue(fid, n) {
    return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= maxOf(splitId(fid).key);
  }

  /* Значение поля: число, или формула от времени. */
  function evalSpec(spec, t) {
    if (spec.mode === 'time') return t;
    if (spec.mode === 'inv') return 100 - t;
    return spec.value;
  }
  const targetValue = (v, t) => (v === 'time' ? t : v === 'inv' ? 100 - t : v);

  const baseValues = (level) => Object.assign({}, NEUTRAL, level.base || {});
  const targetPose = (level, round) => Object.assign(baseValues(level), level.rounds[round].target);
  function targetAt(level, t) {
    const v = baseValues(level);
    Object.keys(level.anim || {}).forEach((f) => { v[f] = targetValue(level.anim[f], t); });
    return v;
  }

  function editedParts(level) {
    const out = [];
    level.edit.forEach((f) => { const p = splitId(f).part; if (!out.includes(p)) out.push(p); });
    return out;
  }

  /* Точка (x, y) детали, к которой относится ключ. Для размеров (r, w, h) null. */
  function pointOf(vals, pid, key) {
    const b = keyBase(key), n = key.slice(b.length);
    if (b !== 'x' && b !== 'y') return null;
    return { x: vals[pid + '.x' + n], y: vals[pid + '.y' + n] };
  }

  function pointName(pid, key) {
    const def = PARTS[pid];
    if (def.kind === 'line') return def.names[key.endsWith('1') ? 0 : 1];
    return 'центр';
  }

  function fieldLabel(fid) {
    const s = splitId(fid), def = PARTS[s.part], b = keyBase(s.key);
    if (b === 'x' || b === 'y') return def.label + ', ' + pointName(s.part, s.key) + ', ' + AXIS[b];
    return def.label + ', ' + ({ r: 'радиус', w: 'длина', h: 'высота' })[b];
  }

  function dirText(key, d) {
    const more = d < 0; // у ученика меньше, чем нужно
    switch (keyBase(key)) {
      case 'x': return 'X должен быть ' + (more ? 'больше (правее)' : 'меньше (левее)');
      case 'y': return 'Y должен быть ' + (more ? 'больше (выше)' : 'меньше (ниже)');
      case 'r': return 'радиус должен быть ' + (more ? 'больше' : 'меньше');
      case 'w': return 'длина должна быть ' + (more ? 'больше' : 'меньше');
      default: return 'высота должна быть ' + (more ? 'больше' : 'меньше');
    }
  }

  /* Проверка позы: сравниваем только детали, которые ученик правит. */
  function checkPose(level, round, vals) {
    const tgt = targetPose(level, round), parts = [];
    editedParts(level).forEach((pid) => {
      const def = PARTS[pid];
      const keys = def.keys.filter((k) => level.edit.includes(pid + '.' + k));
      const res = { id: pid, ok: true, note: '', issues: [] };
      let bad = keys.filter((k) => Math.abs(vals[pid + '.' + k] - tgt[pid + '.' + k]) > tol(k));

      if (bad.length && def.kind === 'line' && keys.length === 4) {
        const sw = { x1: 'x2', y1: 'y2', x2: 'x1', y2: 'y1' };
        if (keys.every((k) => Math.abs(vals[pid + '.' + k] - tgt[pid + '.' + sw[k]]) <= tol(k))) {
          bad = []; res.note = 'Точки 1 и 2 стоят наоборот, но для линии это то же самое: рисунок совпал.';
        }
      }
      // числа X и Y перепутаны внутри одной точки
      ['', '1', '2'].forEach((n) => {
        const kx = 'x' + n, ky = 'y' + n;
        if (!bad.includes(kx) || !bad.includes(ky)) return;
        const px = vals[pid + '.' + kx], py = vals[pid + '.' + ky], tx = tgt[pid + '.' + kx], ty = tgt[pid + '.' + ky];
        if (Math.abs(px - ty) <= tol('x') && Math.abs(py - tx) <= tol('y') && Math.abs(tx - ty) > tol('x')) {
          res.issues.push(pointName(pid, kx) + ': числа X и Y стоят в обратном порядке. Первое число — вбок, второе — вверх.');
          bad = bad.filter((k) => k !== kx && k !== ky);
        }
      });
      bad.forEach((k) => {
        const b = keyBase(k), who = (b === 'x' || b === 'y') ? pointName(pid, k) + ': ' : '';
        res.issues.push(who + dirText(k, vals[pid + '.' + k] - tgt[pid + '.' + k]));
      });
      res.ok = res.issues.length === 0;
      parts.push(res);
    });
    return { ok: parts.every((p) => p.ok), parts };
  }

  /* Проверка анимации: в нескольких моментах time сравниваем поля ученика с целью. */
  function checkAnim(level, specs) {
    const issues = [];
    level.edit.forEach((f) => {
      const goal = (level.anim || {})[f] !== undefined ? level.anim[f] : baseValues(level)[f];
      const spec = specs[f], goalMoves = goal === 'time' || goal === 'inv', userMoves = spec.mode !== 'num';
      let wrong = null;
      for (const t of SAMPLES) {
        if (Math.abs(evalSpec(spec, t) - targetValue(goal, t)) > tol(splitId(f).key)) { wrong = t; break; }
      }
      if (wrong === null) return;
      let text;
      if (goalMoves && !userMoves) text = 'эта часть должна двигаться: поставь вместо числа time или 100 − time.';
      else if (!goalMoves && userMoves) text = 'эта часть должна стоять на месте: оставь число.';
      else if (goalMoves && userMoves) text = 'двигается в другую сторону: поменяй time на 100 − time (или наоборот).';
      else text = 'число стоит не там: при любом time здесь должно быть другое число.';
      issues.push({ field: f, text: fieldLabel(f) + ': ' + text });
    });
    return { ok: issues.length === 0, issues };
  }

  const movingCount = (specs) => Object.keys(specs).filter((f) => specs[f].mode !== 'num').length;

  function stars(fails, hints) {
    if (fails === 0 && hints === 0) return 3;
    if (fails <= 1 && hints <= 1) return 2;
    return 1;
  }

  return { PARTS, NEUTRAL, THICK, SAMPLES, keyBase, splitId, tol, maxOf, validValue, evalSpec, targetValue, baseValues,
    targetPose, targetAt, editedParts, pointOf, pointName, fieldLabel, checkPose, checkAnim, movingCount, stars };
});
