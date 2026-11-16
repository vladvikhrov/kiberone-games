/* ========================================================================
   Остров координат — интерфейс и отрисовка.
   Логика маршрутов и разбор ошибок лежат в logic.js, уровни в levels.js.
   Прогресс хранится во вкладке (sessionStorage) и пропадает при закрытии.
   Звук — WebAudio, без файлов.
   ======================================================================== */
(function () {
  'use strict';

  var L = window.CoordLogic, CH = window.CoordLevels;
  var COL = { x: '#4DB2FF', y: '#FF9F43', crystal: '#5CF2E0', good: '#5BE38A', bad: '#FF6B7A', gold: '#FFD24D',
    sea: '#0B2239', island: '#1B5A52', islandEdge: '#2F9484', rock: '#6B7787', rockEdge: '#3B4553' };
  var MODE = (function () { try { return new URLSearchParams(location.search).get('mode'); } catch (e) { return null; } })();
  var app = document.getElementById('app');
  var MAX_CMDS = 12;

  var RADAR_LEVEL = { type: 'radar', axes: 'xy', size: { w: 10, h: 10 }, scale: 1, start: { x: 0, y: 0 }, crystals: [], rocks: [] };

  /* ---------- мелкие помощники ---------- */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === false || v == null) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }
  function span(cls, text) { return h('span', { class: cls, text: String(text) }); }
  function coord(x, y) { return h('span', { class: 'num' }, '(', span('x', x), ', ', span('y', y), ')'); }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ---------- сохранение ---------- */
  var KEY = 'ostrov-koordinat:v1';
  var P = (function () {
    try { var v = JSON.parse(sessionStorage.getItem(KEY)); if (v && v.prog) return v; } catch (e) { /* без хранилища тоже работает */ }
    return { prog: {}, best: 0 };
  })();
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(P)); } catch (e) { /* ничего */ } }
  function keyOf(ci, li) { return CH[ci].id + '/' + CH[ci].levels[li].id; }
  function chapterDone(ci) { return CH[ci].levels.every(function (_, li) { return !!P.prog[keyOf(ci, li)]; }); }
  function totalStars() {
    var s = 0, max = 0;
    CH.forEach(function (c, ci) { c.levels.forEach(function (_, li) { max += 3; var p = P.prog[keyOf(ci, li)]; if (p) s += p.stars; }); });
    return { s: s, max: max };
  }

  /* ---------- звук ---------- */
  var sound = true, ac = null;
  function ctxAudio() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; } }
    if (ac && ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(f, d, type, vol, delay, slide) {
    if (!sound) return;
    var a = ctxAudio(); if (!a) return;
    var t0 = a.currentTime + (delay || 0), o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t0 + d);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol || 0.1, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + d + 0.02);
  }
  var sfx = {
    click: function () { tone(520, 0.05, 'triangle', 0.06); },
    add: function () { tone(440, 0.07, 'triangle', 0.08); tone(660, 0.08, 'triangle', 0.08, 0.06); },
    step: function () { tone(180 + Math.random() * 30, 0.04, 'square', 0.025); },
    pick: function (i) { var b = 523 * Math.pow(1.122, Math.min(i, 8)); tone(b, 0.1, 'sine', 0.12); tone(b * 1.5, 0.16, 'sine', 0.09, 0.07); },
    bad: function () { tone(190, 0.28, 'sawtooth', 0.09, 0, -90); },
    bump: function () { tone(110, 0.18, 'square', 0.12, 0, -50); },
    win: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.22, 'triangle', 0.12, i * 0.1); }); },
    tick: function () { tone(880, 0.04, 'square', 0.04); }
  };

  /* ---------- состояние ---------- */
  var S = {
    screen: 'home', ci: 0, li: 0, level: null, cmds: [], plan: null, draft: { x: '', y: '' },
    hero: { x: 0, y: 0, dir: { x: 1, y: 0 }, moving: false }, shown: new Set(), run: null,
    hints: 0, fails: 0, guides: 0, beacon: null, time: null, blitz: null,
    particles: [], floaters: [], mouse: null, done: false, fast: false
  };
  var UI = {};   // ссылки на элементы текущего экрана
  var ST = null; // сцена: canvas, ctx, размер, вид

  /* ---------- вид карты ---------- */
  function viewFor(level, cw, chh) {
    var W = level.size.w, H = level.size.h, sc = level.scale || 1, u = sc >= 10 ? 9 : 1;
    var xMin, xMax, yMin, yMax;
    if (level.axes === 'xy') { xMin = -1.5 * u; xMax = W + 1.4 * u; yMin = -1.8 * u; yMax = H + 1.4 * u; }
    else if (level.axes === 'x') {
      xMin = -1.5; xMax = W + 1.0;
      var yr = (xMax - xMin) * chh / cw; yMin = -yr / 2 - 0.3; yMax = yr / 2 - 0.3;
    } else {
      yMin = -1.5; yMax = H + 1.0;
      var xr = (yMax - yMin) * cw / chh; xMin = -xr / 2 - 0.9; xMax = xr / 2 - 0.9;
    }
    var s = Math.min(cw / (xMax - xMin), chh / (yMax - yMin));
    var ox = (cw - s * (xMax - xMin)) / 2, oy = (chh - s * (yMax - yMin)) / 2;
    return {
      xMin: xMin, xMax: xMax, yMin: yMin, yMax: yMax, s: s, ox: ox, oy: oy, cw: cw, ch: chh,
      px: function (x) { return ox + (x - xMin) * s; },
      py: function (y) { return chh - (oy + (y - yMin) * s); },
      wx: function (px) { return xMin + (px - ox) / s; },
      wy: function (py) { return yMin + ((chh - py) - oy) / s; }
    };
  }

  function stageSide(level) {
    var w = app.clientWidth || 1000, hh = (app.clientHeight || 700) - (level && level.type === 'time' ? 72 : 0);
    var side = w < 1100 ? Math.min(w - 32, 560) : Math.min(hh - 28, w - 32 - 372 - 16);
    return Math.max(340, Math.min(740, Math.floor(side)));
  }

  function makeStage(level) {
    var side = stageSide(level), dpr = window.devicePixelRatio || 1;
    var canvas = h('canvas', { width: Math.round(side * dpr), height: Math.round(side * dpr), 'aria-label': 'Карта острова' });
    canvas.style.width = side + 'px'; canvas.style.height = side + 'px';
    var ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ST = { canvas: canvas, ctx: ctx, side: side, V: viewFor(level, side, side), level: level };
    canvas.addEventListener('mousemove', function (e) {
      var r = canvas.getBoundingClientRect(); S.mouse = { px: e.clientX - r.left, py: e.clientY - r.top };
    });
    canvas.addEventListener('mouseleave', function () { S.mouse = null; });
    canvas.addEventListener('click', onCanvasClick);
    return canvas;
  }

  function relayout() {
    if (!ST || (S.screen !== 'level' && S.screen !== 'radar')) return;
    var side = stageSide(ST.level);
    if (side === ST.side) return;
    var dpr = window.devicePixelRatio || 1;
    ST.canvas.width = Math.round(side * dpr); ST.canvas.height = Math.round(side * dpr);
    ST.canvas.style.width = side + 'px'; ST.canvas.style.height = side + 'px';
    ST.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ST.side = side; ST.V = viewFor(ST.level, side, side);
  }
  window.addEventListener('resize', relayout);

  /* ---------- рисование ---------- */
  function rr(c, x, y, w, hgt, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + hgt, r); c.arcTo(x + w, y + hgt, x, y + hgt, r);
    c.arcTo(x, y + hgt, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); }

  function drawBit(c, px, py, sz, dir, t, moving, alpha) {
    c.save(); c.globalAlpha = alpha == null ? 1 : alpha; c.translate(px, py);
    c.translate(0, Math.sin(t * (moving ? 16 : 3)) * (moving ? 1.8 : 1));
    var k = sz / 36; c.scale(k, k);
    c.fillStyle = 'rgba(0,0,0,.30)'; c.beginPath(); c.ellipse(0, 17, 15, 5, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#8DA7C4'; rr(c, -12, 8, 8, 9, 3); c.fill(); rr(c, 4, 8, 8, 9, 3); c.fill();
    c.fillStyle = '#EAF3FF'; rr(c, -16, -13, 32, 25, 9); c.fill(); c.strokeStyle = '#9FB8D6'; c.lineWidth = 2; c.stroke();
    c.fillStyle = '#0B2239'; rr(c, -12, -9, 24, 14, 6); c.fill();
    var ex = dir.x * 2.6, ey = -dir.y * 2.6;
    c.fillStyle = COL.crystal; circle(c, -5 + ex, -2 + ey, 2.8); c.fill(); circle(c, 5 + ex, -2 + ey, 2.8); c.fill();
    c.strokeStyle = '#9FB8D6'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(0, -13); c.lineTo(0, -20); c.stroke();
    c.fillStyle = COL.bad; circle(c, 0, -22, 3.2 + Math.sin(t * 5) * 0.5); c.fill();
    c.restore();
  }

  function drawCrystal(c, px, py, size, t, color, alpha) {
    var pulse = 1 + Math.sin(t * 4 + px) * 0.07, s = size * pulse;
    c.save(); c.globalAlpha = alpha == null ? 1 : alpha; c.translate(px, py);
    c.shadowColor = color || COL.crystal; c.shadowBlur = 14;
    c.fillStyle = color || COL.crystal;
    c.beginPath(); c.moveTo(0, -s); c.lineTo(s * 0.75, 0); c.lineTo(0, s); c.lineTo(-s * 0.75, 0); c.closePath(); c.fill();
    c.shadowBlur = 0; c.fillStyle = 'rgba(255,255,255,.55)';
    c.beginPath(); c.moveTo(0, -s); c.lineTo(s * 0.3, -s * 0.1); c.lineTo(0, 0); c.lineTo(-s * 0.4, -s * 0.15); c.closePath(); c.fill();
    c.restore();
  }

  function arrow(c, x, y, dx, dy, color) {
    c.fillStyle = color; c.beginPath();
    c.moveTo(x + dx * 9, y + dy * 9);
    c.lineTo(x - dy * 6 - dx * 2, y + dx * 6 - dy * 2); c.lineTo(x + dy * 6 - dx * 2, y - dx * 6 - dy * 2);
    c.closePath(); c.fill();
  }

  function label(c, text, x, y, color, align, size, weight) {
    c.font = (weight || 700) + ' ' + (size || 13) + 'px "Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace';
    c.fillStyle = color; c.textAlign = align || 'center'; c.textBaseline = 'middle'; c.fillText(text, x, y);
  }

  function drawBase(c, V, lv, t) {
    var W = lv.size.w, H = lv.size.h, sc = lv.scale || 1, m = sc >= 10 ? 5 : 0.5, cw = V.cw, chh = V.ch;
    c.fillStyle = COL.sea; c.fillRect(0, 0, cw, chh);
    // лёгкие волны
    c.strokeStyle = 'rgba(120,180,255,.06)'; c.lineWidth = 2;
    for (var i = 0; i < 9; i++) {
      c.beginPath();
      for (var x = 0; x <= cw; x += 12) { var y = (i + 0.5) * chh / 9 + Math.sin(x / 38 + i + t * 0.6) * 4; if (x === 0) c.moveTo(x, y); else c.lineTo(x, y); }
      c.stroke();
    }
    // остров
    var x0, y0, x1, y1;
    if (lv.axes === 'xy') { x0 = -m; y0 = -m; x1 = W + m; y1 = H + m; }
    else if (lv.axes === 'x') { x0 = -0.5; x1 = W + 0.5; y0 = -0.8; y1 = 0.8; }
    else { x0 = -0.8; x1 = 0.8; y0 = -0.5; y1 = H + 0.5; }
    var ix0 = V.px(x0), ix1 = V.px(x1), iy0 = V.py(y1), iy1 = V.py(y0);
    c.fillStyle = COL.islandEdge; rr(c, ix0 - 5, iy0 - 5, ix1 - ix0 + 10, iy1 - iy0 + 10, 20); c.fill();
    c.fillStyle = COL.island; rr(c, ix0, iy0, ix1 - ix0, iy1 - iy0, 16); c.fill();

    // сетка
    c.lineWidth = 1;
    if (lv.axes === 'xy') {
      var step = sc >= 10 ? 10 : 1, k;
      for (k = 0; k <= W; k += step) { c.strokeStyle = 'rgba(255,255,255,' + (k % 5 === 0 || sc >= 10 ? '.20' : '.11') + ')'; c.beginPath(); c.moveTo(V.px(k), iy0 + 4); c.lineTo(V.px(k), iy1 - 4); c.stroke(); }
      for (k = 0; k <= H; k += step) { c.strokeStyle = 'rgba(255,255,255,' + (k % 5 === 0 || sc >= 10 ? '.20' : '.11') + ')'; c.beginPath(); c.moveTo(ix0 + 4, V.py(k)); c.lineTo(ix1 - 4, V.py(k)); c.stroke(); }
    }
    // оси и подписи
    var fsz = clamp(V.s * (sc >= 10 ? 2.4 : 0.34), 12, 15);
    if (lv.axes === 'xy' || lv.axes === 'x') {
      var ay = V.py(0), tickBottom = iy1 + 16;
      c.strokeStyle = COL.x; c.lineWidth = 3; c.beginPath(); c.moveTo(ix0 + 6, ay); c.lineTo(ix1 + 10, ay); c.stroke(); arrow(c, ix1 + 12, ay, 1, 0, COL.x);
      var stepX = sc >= 10 ? 10 : 1;
      for (var xx = 0; xx <= W; xx += stepX) {
        c.strokeStyle = COL.x; c.lineWidth = 2; c.beginPath(); c.moveTo(V.px(xx), ay - 5); c.lineTo(V.px(xx), ay + 5); c.stroke();
        label(c, xx, V.px(xx), tickBottom, COL.x, 'center', fsz);
      }
      label(c, 'X — вбок →', ix1 - 2, tickBottom + 20, COL.x, 'right', 14);
    }
    if (lv.axes === 'xy' || lv.axes === 'y') {
      var axx = V.px(0), tickLeft = ix0 - 14;
      c.strokeStyle = COL.y; c.lineWidth = 3; c.beginPath(); c.moveTo(axx, iy1 - 6); c.lineTo(axx, iy0 - 10); c.stroke(); arrow(c, axx, iy0 - 12, 0, -1, COL.y);
      var stepY = sc >= 10 ? 10 : 1;
      for (var yy = 0; yy <= H; yy += stepY) {
        c.strokeStyle = COL.y; c.lineWidth = 2; c.beginPath(); c.moveTo(axx - 5, V.py(yy)); c.lineTo(axx + 5, V.py(yy)); c.stroke();
        label(c, yy, tickLeft, V.py(yy), COL.y, 'right', fsz);
      }
      label(c, 'Y — вверх ↑', axx + 16, iy0 - 22, COL.y, 'left', 14);
    }

    // камни
    (lv.rocks || []).forEach(function (r) {
      var rx0 = V.px(r.x0 - 0.5), rx1 = V.px(r.x1 + 0.5), ry0 = V.py(r.y1 + 0.5), ry1 = V.py(r.y0 - 0.5);
      c.fillStyle = COL.rockEdge; rr(c, rx0 - 2, ry0 - 2, rx1 - rx0 + 4, ry1 - ry0 + 4, 8); c.fill();
      c.fillStyle = COL.rock; rr(c, rx0, ry0, rx1 - rx0, ry1 - ry0, 7); c.fill();
      c.fillStyle = 'rgba(255,255,255,.10)';
      var bw = Math.max(14, V.s * (sc >= 10 ? 8 : 0.9));
      for (var px = rx0 + bw * 0.5; px < rx1 - bw * 0.3; px += bw) for (var py = ry0 + bw * 0.5; py < ry1 - bw * 0.3; py += bw) { circle(c, px, py, bw * 0.28); c.fill(); }
    });
  }

  function dashLine(c, x0, y0, x1, y1, color, width, alpha) {
    c.save(); c.globalAlpha = alpha == null ? 1 : alpha; c.strokeStyle = color; c.lineWidth = width || 2; c.setLineDash([7, 6]);
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); c.restore();
  }

  function drawSegs(c, V, segs, dashed, alpha, width) {
    segs.forEach(function (s) {
      var color = s.axis === 'x' ? COL.x : COL.y;
      if (dashed) dashLine(c, V.px(s.x0), V.py(s.y0), V.px(s.x1), V.py(s.y1), color, width || 3, alpha);
      else { c.save(); c.globalAlpha = alpha == null ? 1 : alpha; c.strokeStyle = color; c.lineWidth = width || 4; c.lineCap = 'round'; c.beginPath(); c.moveTo(V.px(s.x0), V.py(s.y0)); c.lineTo(V.px(s.x1), V.py(s.y1)); c.stroke(); c.restore(); }
    });
  }

  /* линии от точки к осям: показывают, какие числа у точки */
  function drawProjection(c, V, lv, p, alpha, withNumbers, skipV) {
    var ax = V.px(0), ay = V.py(0), px = V.px(p.x), py = V.py(p.y);
    if (lv.axes === 'xy' || lv.axes === 'x') {
      if (!skipV) dashLine(c, px, py, px, ay, COL.x, 2, alpha);
      c.save(); c.globalAlpha = alpha == null ? 1 : alpha; c.fillStyle = COL.x; circle(c, px, ay, 5); c.fill(); c.restore();
      if (withNumbers) label(c, p.x, px, V.py(lv.axes === 'x' ? -0.9 : -(lv.scale >= 10 ? 7 : 0.7)), COL.x, 'center', 18);
    }
    if (lv.axes === 'xy' || lv.axes === 'y') {
      dashLine(c, px, py, ax, py, COL.y, 2, alpha);
      c.save(); c.globalAlpha = alpha == null ? 1 : alpha; c.fillStyle = COL.y; circle(c, ax, py, 5); c.fill(); c.restore();
      if (withNumbers) label(c, p.y, V.px(lv.axes === 'y' ? -1.1 : -(lv.scale >= 10 ? 7 : 0.7)), py, COL.y, 'center', 18);
    }
  }

  function burst(px, py, color, n) {
    for (var i = 0; i < (n || 16); i++) {
      var a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 120;
      S.particles.push({ x: px, y: py, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.7 + Math.random() * 0.4, max: 1.1, color: color || COL.crystal });
    }
  }
  function floater(px, py, text, color) { S.floaters.push({ x: px, y: py, text: text, color: color || COL.good, life: 1.1 }); }

  function drawFx(c, dt) {
    S.particles = S.particles.filter(function (p) { p.life -= dt; return p.life > 0; });
    S.particles.forEach(function (p) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96;
      c.globalAlpha = clamp(p.life / p.max, 0, 1); c.fillStyle = p.color; circle(c, p.x, p.y, 3); c.fill();
    });
    c.globalAlpha = 1;
    S.floaters = S.floaters.filter(function (f) { f.life -= dt; return f.life > 0; });
    S.floaters.forEach(function (f) { f.y -= 34 * dt; c.globalAlpha = clamp(f.life, 0, 1); label(c, f.text, f.x, f.y, f.color, 'center', 20, 800); });
    c.globalAlpha = 1;
  }

  /* ---------- главный цикл ---------- */
  var lastTs = 0, clockT = 0;
  function frame(ts) {
    var dt = Math.min(0.05, (ts - lastTs) / 1000 || 0); lastTs = ts; clockT += dt;
    if (S.screen === 'level' && ST) { updateRun(dt); if (S.time) updateTime(dt); drawLevel(dt, clockT); }
    else if (S.screen === 'radar' && ST) { updateRadar(dt); drawRadar(dt, clockT); }
    requestAnimationFrame(frame);
  }

  /* ---------- уровни: общее ---------- */
  function lvKey() { return keyOf(S.ci, S.li); }
  function running() { return !!(S.run && !S.run.done); }

  function axisVal(lv, k) {
    var raw = S.draft[k];
    if (raw === '' || raw == null) return null;
    var n = Number(raw);
    var max = k === 'x' ? lv.size.w : lv.size.h;
    return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
  }

  function drawLevel(dt, t) {
    var c = ST.ctx, V = ST.V, lv = S.level;
    drawBase(c, V, lv, t);
    if (lv.type === 'walk') drawWalk(c, V, lv, t);
    else if (lv.type === 'beacon') drawBeacon(c, V, lv, t);
    else if (lv.type === 'time') drawTime(c, V, lv, t);
    drawHover(c, V, lv);
    drawFx(c, dt);
  }

  /* Наведение: пунктир к осям. hover === true добавляет подпись (x, y), 'lines' только пунктир. */
  function drawHover(c, V, lv) {
    if (!S.mouse || !lv.hover) return;
    var wx = Math.round(V.wx(S.mouse.px)), wy = Math.round(V.wy(S.mouse.py));
    var W = lv.size.w, H = lv.size.h;
    if (wx < 0 || wy < 0 || wx > W || wy > H) return;
    if (lv.axes === 'x') wy = 0; if (lv.axes === 'y') wx = 0;
    var px = V.px(wx), py = V.py(wy);
    drawProjection(c, V, lv, { x: wx, y: wy }, 0.9, false);
    c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 2; circle(c, px, py, 9); c.stroke();
    if (lv.hover !== true) return;
    var txt = lv.axes === 'xy' ? '(' + wx + ', ' + wy + ')' : lv.axes === 'x' ? 'X = ' + wx : 'Y = ' + wy;
    c.font = '700 15px "Cascadia Mono", Consolas, monospace';
    var tw = c.measureText(txt).width + 16, bx = clamp(px + 14, 4, ST.side - tw - 4), by = clamp(py - 34, 4, ST.side - 30);
    c.fillStyle = 'rgba(5,18,32,.88)'; rr(c, bx, by, tw, 26, 8); c.fill();
    label(c, txt, bx + tw / 2, by + 13, '#fff', 'center', 15);
  }

  /* ---------- уровни «ходить» ---------- */
  function resetHero() {
    S.run = null; S.shown = new Set(); S.hero = { x: S.level.start.x, y: S.level.start.y, dir: { x: 1, y: 0 }, moving: false };
    S.particles = []; S.floaters = [];
    if (UI.queue) renderQueue();
    if (UI.count) updateCount();
  }

  function replan() { S.plan = L.evaluate(S.level, S.cmds); }

  function drawWalk(c, V, lv, t) {
    // планируемый маршрут
    if (!S.run) {
      S.plan.steps.forEach(function (st) { drawSegs(c, V, st.segs, true, 0.55, 3); });
      S.plan.steps.forEach(function (st, i) {
        var px = V.px(st.to.x), py = V.py(st.to.y);
        c.fillStyle = 'rgba(5,18,32,.9)'; circle(c, px + 13, py - 13, 10); c.fill();
        label(c, i + 1, px + 13, py - 13, '#fff', 'center', 13);
      });
    } else {
      S.run.drawn.forEach(function (s) { drawSegs(c, V, [s], false, 0.9, 4); });
    }
    // подсказки: линии от кристаллов к осям
    if (S.guides >= 1) lv.crystals.forEach(function (cr, j) { if (!S.shown.has(j)) drawProjection(c, V, lv, cr, 0.9, S.guides >= 2); });
    // призрак: что будет, если нажать «Добавить»
    if (!S.run) drawGhost(c, V, lv, t);
    // кристаллы
    lv.crystals.forEach(function (cr, j) { if (!S.shown.has(j)) drawCrystal(c, V.px(cr.x), V.py(cr.y), clamp(V.s * 0.34, 11, 17), t); });
    // Бит
    drawBit(c, V.px(S.hero.x), V.py(S.hero.y) - 6, clamp(V.s * 0.78, 30, 44), S.hero.dir, t, S.hero.moving, 1);
  }

  function drawGhost(c, V, lv, t) {
    if (S.plan.blocked) return;
    var start = S.plan.end, dx = axisVal(lv, 'x'), dy = axisVal(lv, 'y');
    var haveX = lv.axes === 'y' || dx !== null, haveY = lv.axes === 'x' || dy !== null;
    if (!haveX || !haveY) { // введено только одно число: показываем его линию
      if (dx !== null && lv.axes === 'xy') dashLine(c, V.px(dx), V.py(0), V.px(dx), V.py(lv.size.h), COL.x, 2, 0.55);
      if (dy !== null && lv.axes === 'xy') dashLine(c, V.px(0), V.py(dy), V.px(lv.size.w), V.py(dy), COL.y, 2, 0.55);
      return;
    }
    var target = L.cmdTarget(lv, start, { x: dx, y: dy });
    var tr = L.segmentsFor(start, target).map(function (sg) { return L.trimSegment(sg, lv.rocks || []).seg; });
    drawSegs(c, V, tr, true, 0.95, 3.5);
    drawProjection(c, V, lv, target, 0.6, false, lv.axes === 'xy');
    var end = tr.length ? { x: tr[tr.length - 1].x1, y: tr[tr.length - 1].y1 } : start;
    drawBit(c, V.px(end.x), V.py(end.y) - 6, clamp(V.s * 0.78, 30, 44), { x: 1, y: 0 }, t, false, 0.45);
  }

  function updateCount() {
    if (!UI.count) return;
    UI.count.textContent = S.shown.size + ' / ' + S.level.crystals.length;
  }

  function startRun() {
    var lv = S.level;
    if (running()) return;
    if (!S.cmds.length) { say('Сначала добавь хотя бы одну команду.', 'bad'); sfx.bad(); return; }
    ctxAudio();
    resetHero();
    var ev = S.plan, flat = [], acc = 0;
    ev.steps.forEach(function (st) { st.segs.forEach(function (s) { flat.push({ seg: s, start: acc, cmd: st.cmdIndex }); acc += L.segLen(s); }); });
    S.run = { ev: ev, flat: flat, total: acc, traveled: 0, drawn: [], done: false, pi: 0, lastStep: -1, finishAt: 0, lastU: 0 };
    UI.go.disabled = true;
    say('Поехали!', 'info');
    if (acc === 0) { S.run.done = true; finishRun(); }
  }

  function updateRun(dt) {
    var r = S.run; if (!r || r.done) { S.hero.moving = false; return; }
    var lv = S.level, speed = (lv.scale >= 10 ? 46 : 5.5) * (S.fast ? 2 : 1);
    r.traveled = Math.min(r.total, r.traveled + speed * dt);
    // позиция
    var cur = null;
    for (var i = 0; i < r.flat.length; i++) { if (r.traveled >= r.flat[i].start) cur = i; }
    r.drawn = [];
    for (var j = 0; j < r.flat.length; j++) {
      var f = r.flat[j], sg = f.seg, len = L.segLen(sg), part = clamp(r.traveled - f.start, 0, len);
      if (part <= 0 && j !== 0) break;
      var dx = Math.sign(sg.x1 - sg.x0), dy = Math.sign(sg.y1 - sg.y0);
      var ex = sg.x0 + dx * part, ey = sg.y0 + dy * part;
      r.drawn.push({ x0: sg.x0, y0: sg.y0, x1: ex, y1: ey, axis: sg.axis });
      if (j === cur) { S.hero.x = ex; S.hero.y = ey; S.hero.dir = { x: dx, y: dy }; }
    }
    S.hero.moving = true;
    if (cur !== null && cur !== r.lastStep) { r.lastStep = cur; markActive(r.flat[cur].cmd); }
    var un = Math.floor(r.traveled / (lv.scale >= 10 ? 10 : 1));
    if (un !== r.lastU) { r.lastU = un; sfx.step(); }
    // кристаллы
    while (r.pi < r.ev.pickups.length && r.traveled >= r.ev.pickups[r.pi].at - 1e-6) {
      var p = r.ev.pickups[r.pi++], cr = lv.crystals[p.index];
      S.shown.add(p.index); sfx.pick(S.shown.size - 1);
      burst(ST.V.px(cr.x), ST.V.py(cr.y), COL.crystal, 18); floater(ST.V.px(cr.x), ST.V.py(cr.y) - 14, '+1', COL.crystal);
      updateCount();
    }
    if (r.traveled >= r.total) { r.done = true; S.hero.moving = false; r.finishAt = clockT; finishRun(); }
  }

  function markActive(i) {
    if (!UI.queue) return;
    Array.prototype.forEach.call(UI.queue.children, function (el, k) { el.classList.toggle('active', k === i); });
  }

  function finishRun() {
    var lv = S.level, ev = S.run.ev;
    markActive(-1); UI.go.disabled = false;
    if (ev.blocked) {
      sfx.bump(); S.fails++;
      burst(ST.V.px(ev.blocked.at.x), ST.V.py(ev.blocked.at.y), COL.rock, 12);
      say(L.diagnose(lv, S.cmds, ev).text, 'bad'); return;
    }
    if (ev.solved) { setTimeout(function () { if (S.screen === 'level' && S.level === lv) winLevel(); }, 450); say('Все кристаллы собраны!', 'good'); return; }
    S.fails++; sfx.bad();
    say(L.diagnose(lv, S.cmds, ev).text, 'bad');
  }

  function say(text, tone) {
    if (!UI.say) return;
    UI.say.textContent = text; UI.bubble.className = 'bubble' + (tone === 'good' ? ' good' : tone === 'bad' ? ' bad' : '');
  }

  /* ---------- панель «ходить» ---------- */
  function stepper(k, onEnter) {
    var lv = S.level, max = k === 'x' ? lv.size.w : lv.size.h, step = 1;
    var input = h('input', { type: 'number', inputmode: 'numeric', min: 0, max: max, step: 1, id: 'in-' + k, 'aria-label': 'Число ' + k.toUpperCase() });
    function bump(d) {
      var n = input.value === '' ? (d > 0 ? -1 : max + 1) : Number(input.value);
      input.value = clamp(n + d * step, 0, max); S.draft[k] = input.value; input.focus();
    }
    input.addEventListener('input', function () { S.draft[k] = input.value; UI.err.textContent = ''; });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); onEnter(k); } });
    var box = h('div', { class: 'field f' + k },
      h('label', { for: 'in-' + k, text: k.toUpperCase() + (k === 'x' ? ' — вбок' : ' — вверх') }),
      h('div', { class: 'stepper' }, h('button', { type: 'button', 'aria-label': 'Меньше', text: '−', onclick: function () { bump(-1); } }), input,
        h('button', { type: 'button', 'aria-label': 'Больше', text: '+', onclick: function () { bump(1); } })));
    UI['in' + k] = input;
    return box;
  }

  function addCommand() {
    var lv = S.level;
    if (running()) return;
    var v = L.validateCommand(lv, S.draft);
    if (!v.ok) { UI.err.textContent = v.text; sfx.bad(); return; }
    if (S.cmds.length >= MAX_CMDS) { UI.err.textContent = 'Хватит команд: максимум ' + MAX_CMDS + '.'; return; }
    S.cmds.push(v.cmd); resetHero(); replan(); renderQueue(); sfx.add();
    S.draft = { x: '', y: '' }; if (UI.inx) UI.inx.value = ''; if (UI.iny) UI.iny.value = '';
    UI.err.textContent = '';
    (UI.inx || UI.iny).focus();
  }

  function cmdNode(cmd) {
    var lv = S.level;
    if (lv.axes === 'x') return h('span', { class: 'v' }, 'X = ', span('x', cmd.x));
    if (lv.axes === 'y') return h('span', { class: 'v' }, 'Y = ', span('y', cmd.y));
    var n = coord(cmd.x, cmd.y); n.className = 'v num'; return n;
  }

  function renderQueue() {
    clear(UI.queue);
    if (!S.cmds.length) { UI.queue.appendChild(h('div', { class: 'empty', text: 'Команд пока нет. Введи число и нажми «Добавить».' })); return; }
    S.cmds.forEach(function (cmd, i) {
      UI.queue.appendChild(h('div', { class: 'q-item' }, h('span', { class: 'i', text: (i + 1) + '.' }), cmdNode(cmd),
        h('button', { type: 'button', title: 'Убрать команду', 'aria-label': 'Убрать команду ' + (i + 1), text: '×', onclick: function () {
          if (running()) return; S.cmds.splice(i, 1); resetHero(); replan(); renderQueue();
        } })));
    });
  }

  function hint() {
    var lv = S.level;
    if (S.hints >= 3) { say('Больше подсказок нет. Спроси тьютора или внимательно посмотри на оси.', 'info'); return; }
    S.hints++; sfx.click();
    if (S.hints === 1) say(lv.hint, 'info');
    else if (S.hints === 2) { S.guides = 1; say('Смотри: пунктирные линии идут от кристаллов к осям. Они показывают, где искать числа.', 'info'); }
    else { S.guides = 2; say('Теперь на осях подписаны числа кристаллов. Попробуй понять, почему они такие.', 'info'); }
    UI.hintBtn.textContent = 'Подсказка (' + (3 - S.hints) + ')';
  }

  function journalBox() {
    var done = CH.filter(function (_, ci) { return chapterDone(ci); });
    var det = h('details', { class: 'journal' }, h('summary', { text: 'Журнал исследователя (' + done.length + '/' + CH.length + ')' }));
    var ul = h('ul');
    if (!done.length) ul.appendChild(h('li', { text: 'Здесь появятся правила, которые ты открыл. Пройди главу целиком.' }));
    done.forEach(function (c) { ul.appendChild(h('li', null, h('b', { text: c.title + '. ' }), c.rule)); });
    det.appendChild(ul); return det;
  }

  function avatar() {
    var cv = h('canvas', { width: 112, height: 112 }); cv.style.width = '56px'; cv.style.height = '56px';
    var c = cv.getContext('2d'); c.scale(2, 2); c.fillStyle = '#102E4C'; c.fillRect(0, 0, 56, 56); drawBit(c, 28, 33, 36, { x: 0, y: -0.3 }, 0, false, 1);
    return cv;
  }

  function bubbleBox(text) {
    UI.say = h('div', { class: 'say', 'aria-live': 'polite', text: text });
    UI.bubble = h('div', { class: 'bubble' }, avatar(), h('div', null, h('span', { class: 'tag', text: 'БИТ' }), UI.say));
    return UI.bubble;
  }

  function buildWalkPanel(panel) {
    var lv = S.level;
    panel.appendChild(bubbleBox(lv.story));
    UI.count = h('span', { class: 'count', text: '0 / ' + lv.crystals.length });
    panel.appendChild(h('div', { class: 'goal' }, h('span', { text: 'Кристаллы:' }), UI.count));
    UI.err = h('div', { class: 'err', 'aria-live': 'polite' });
    var build = h('div', { class: 'build' });
    if (lv.axes !== 'y') build.appendChild(stepper('x', function (k) { if (lv.axes === 'xy' && k === 'x' && S.draft.y === '') UI.iny.focus(); else addCommand(); }));
    if (lv.axes !== 'x') build.appendChild(stepper('y', function () { addCommand(); }));
    build.appendChild(h('button', { type: 'button', class: 'btn primary', text: 'Добавить', onclick: addCommand }));
    UI.queue = h('div', { class: 'queue', 'aria-label': 'Команды' });
    UI.go = h('button', { type: 'button', class: 'btn run grow', text: 'Запустить ▶', onclick: startRun });
    UI.hintBtn = h('button', { type: 'button', class: 'btn small ghost', text: 'Подсказка (3)', onclick: hint });
    panel.appendChild(h('div', { class: 'box' }, h('h3', { text: 'Куда идти Биту?' }), build, UI.err));
    panel.appendChild(h('div', { class: 'box' }, h('h3', { text: 'Программа' }), UI.queue,
      h('div', { class: 'actions' }, UI.go,
        h('button', { type: 'button', class: 'btn small', text: 'Очистить', onclick: function () { if (running()) return; S.cmds = []; resetHero(); replan(); renderQueue(); } }),
        h('button', { type: 'button', class: 'btn small', id: 'fast', text: 'Быстро', 'aria-pressed': 'false', onclick: function (e) { S.fast = !S.fast; e.target.setAttribute('aria-pressed', S.fast); e.target.textContent = S.fast ? 'Быстро ✓' : 'Быстро'; } }),
        UI.hintBtn)));
    panel.appendChild(journalBox());
    renderQueue();
  }

  /* ---------- уровни «маяки» ---------- */
  function beaconTarget() { return S.level.targets[S.beacon.idx]; }

  function drawBeacon(c, V, lv, t) {
    var B = S.beacon;
    B.placed.forEach(function (p) {
      drawProjection(c, V, lv, p, 0.5, false);
      c.save(); c.shadowColor = COL.gold; c.shadowBlur = 16; c.fillStyle = COL.gold; circle(c, V.px(p.x), V.py(p.y), 9); c.fill(); c.restore();
      label(c, '✓', V.px(p.x), V.py(p.y), '#3B2A00', 'center', 12);
    });
    if (B.flash && clockT - B.flash.t0 < 1.1) {
      var f = B.flash, a = 1 - (clockT - f.t0) / 1.1;
      c.save(); c.globalAlpha = a; c.strokeStyle = COL.bad; c.lineWidth = 4;
      var px = V.px(f.x), py = V.py(f.y); c.beginPath(); c.moveTo(px - 10, py - 10); c.lineTo(px + 10, py + 10); c.moveTo(px + 10, py - 10); c.lineTo(px - 10, py + 10); c.stroke(); c.restore();
    }
    if (!S.done && B.idx < lv.targets.length) drawBit(c, V.px(0), V.py(0) - 6, clamp(V.s * 0.78, 30, 44), { x: 1, y: 0 }, t, false, 0.9);
  }

  function renderBeaconPrompt() {
    clear(UI.prompt);
    var B = S.beacon, lv = S.level;
    if (B.idx >= lv.targets.length) { UI.prompt.appendChild(h('div', { class: 'ask' }, 'Все маяки стоят!')); return; }
    var t = beaconTarget();
    UI.prompt.appendChild(h('div', { class: 'ask' }, h('span', { class: 'lbl', text: 'Поставь маяк ' + (B.idx + 1) + ' из ' + lv.targets.length }), coord(t.x, t.y)));
  }

  function onCanvasClick(e) {
    if (S.screen === 'radar') return radarClick(e);
    if (S.screen !== 'level' || S.level.type !== 'beacon' || S.done) return;
    var r = ST.canvas.getBoundingClientRect(), V = ST.V, lv = S.level;
    var wx = Math.round(V.wx(e.clientX - r.left)), wy = Math.round(V.wy(e.clientY - r.top));
    if (wx < 0 || wy < 0 || wx > lv.size.w || wy > lv.size.h) return;
    var B = S.beacon, res = L.checkBeacon(beaconTarget(), { x: wx, y: wy });
    if (res.ok) {
      sfx.pick(B.idx); B.placed.push({ x: wx, y: wy }); burst(V.px(wx), V.py(wy), COL.gold, 18); floater(V.px(wx), V.py(wy) - 14, '+1', COL.gold);
      B.idx++; renderBeaconPrompt();
      say(B.idx >= lv.targets.length ? 'Все маяки на местах!' : 'Верно! Следующий маяк.', 'good');
      if (B.idx >= lv.targets.length) setTimeout(function () { if (S.screen === 'level' && S.level === lv) winLevel(); }, 500);
    } else {
      S.fails++; B.flash = { x: wx, y: wy, t0: clockT }; sfx.bad(); say(res.text, 'bad');
    }
  }

  function buildBeaconPanel(panel) {
    var lv = S.level;
    S.beacon = { idx: 0, placed: [], flash: null };
    panel.appendChild(bubbleBox(lv.story));
    UI.prompt = h('div', { class: 'box' }); panel.appendChild(UI.prompt); renderBeaconPrompt();
    UI.hintBtn = h('button', { type: 'button', class: 'btn small ghost', text: 'Подсказка (1)', onclick: function () {
      if (S.hints >= 1) { say(lv.hint, 'info'); return; } S.hints = 1; say(lv.hint, 'info'); UI.hintBtn.textContent = 'Подсказка (0)'; sfx.click();
    } });
    panel.appendChild(h('div', { class: 'actions' }, UI.hintBtn));
    panel.appendChild(journalBox());
  }

  /* ---------- уровни «время» ---------- */
  function formulaNode(d) {
    return h('span', { class: 'num' }, '(', span('x', d.xText), ', ', span('y', d.yText), ')');
  }

  function drawClock(c, t) {
    var txt = 'time = ' + Math.round(t);
    c.font = '800 24px "Cascadia Mono", Consolas, monospace';
    var w = c.measureText(txt).width + 26, x = ST.side - w - 12, y = 12;
    c.fillStyle = 'rgba(5,18,32,.9)'; rr(c, x, y, w, 42, 10); c.fill();
    c.strokeStyle = COL.crystal; c.lineWidth = 2; rr(c, x, y, w, 42, 10); c.stroke();
    label(c, txt, x + w / 2, y + 22, '#fff', 'center', 24, 800);
  }

  function drawTime(c, V, lv, t) {
    var T = S.time;
    lv.drones.forEach(function (d) {
      var now = L.droneAt(d, T.t);
      c.save(); c.strokeStyle = d.color; c.globalAlpha = 0.5; c.lineWidth = 3; c.setLineDash([2, 7]); c.beginPath();
      for (var k = 0; k <= Math.floor(T.t); k++) { var q = L.droneAt(d, k); if (k === 0) c.moveTo(V.px(q.x), V.py(q.y)); else c.lineTo(V.px(q.x), V.py(q.y)); }
      c.lineTo(V.px(now.x), V.py(now.y)); c.stroke(); c.restore();
      drawProjection(c, V, lv, now, 0.55, false);
      drawCrystal(c, V.px(now.x), V.py(now.y), 14, t, d.color);
    });
    T.frames.forEach(function (f) {
      var px = V.px(f.x), py = V.py(f.y);
      c.save(); c.strokeStyle = COL.gold; c.lineWidth = 3; circle(c, px, py, 13); c.stroke(); c.restore();
      label(c, 'time=' + f.time, px, py - 25, COL.gold, 'center', 14);
    });
    drawClock(c, T.t);
  }

  function refreshTime() {
    var lv = S.level, T = S.time; if (!UI.read) return; clear(UI.read);
    UI.read.hidden = lv.mode === 'frames' && !T.solved;
    if (UI.read.hidden) return;
    var tt = Math.round(T.t);
    lv.drones.forEach(function (d) {
      var p = L.droneAt(d, tt);
      UI.read.appendChild(h('div', null, h('span', { style: 'color:' + d.color, text: d.name + ': ' }), 'x = ', span('x', p.x), ', y = ', span('y', p.y)));
    });
    if (lv.mode === 'meet') {
      var a = L.droneAt(lv.drones[0], tt), b = L.droneAt(lv.drones[1], tt);
      UI.read.appendChild(h('div', { class: 'fog', text: 'Разница по X: ' + Math.abs(a.x - b.x) }));
    }
  }

  function togglePlay() {
    var T = S.time; ctxAudio();
    if (T.playing) { T.playing = false; UI.play.textContent = '▶ Полёт'; return; }
    if (T.t >= 100) T.t = 0;
    T.playing = true; UI.play.textContent = '❚❚ Пауза'; sfx.click();
  }

  function updateTime(dt) {
    var T = S.time; if (!T || !T.playing) return;
    var before = Math.round(T.t);
    T.t = Math.min(100, T.t + dt * 28);
    if (UI.slider) UI.slider.value = Math.round(T.t);
    if (Math.round(T.t) !== before && Math.round(T.t) % 10 === 0) sfx.tick();
    if (UI.read && Math.round(T.t) !== before) refreshTime();
    if (T.t >= 100) {
      T.playing = false; if (UI.play) UI.play.textContent = '▶ Полёт';
      if (T.onEnd) { var f = T.onEnd; T.onEnd = null; f(); }
    }
  }

  function buildFramesBox() {
    var lv = S.level, T = S.time;
    var box = h('div', { class: 'box' }, h('h3', { text: 'Заполни кадры: подставь time' }));
    box.appendChild(h('div', { class: 'frow head' }, h('span', { text: 'time' }), h('span', { class: 'x', text: 'X' }), h('span', { class: 'y', text: 'Y' })));
    lv.rows.forEach(function (tm, i) {
      var ix = h('input', { type: 'number', inputmode: 'numeric', class: 'fi-x', id: 'fr-' + i + '-x', 'aria-label': 'X при time ' + tm });
      var iy = h('input', { type: 'number', inputmode: 'numeric', class: 'fi-y', id: 'fr-' + i + '-y', 'aria-label': 'Y при time ' + tm });
      var row = h('div', { class: 'frow' }, h('span', { class: 'tm', text: String(tm) }), ix, iy);
      [ix, iy].forEach(function (inp) {
        inp.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter') return; e.preventDefault();
          if (inp === ix && iy.value === '') iy.focus(); else checkFrames();
        });
        inp.addEventListener('input', function () { inp.classList.remove('good', 'wrong'); UI.err.textContent = ''; });
      });
      T.rows.push({ time: tm, ix: ix, iy: iy, el: row, ok: false });
      box.appendChild(row);
    });
    box.appendChild(UI.err);
    UI.hintBtn = h('button', { type: 'button', class: 'btn small ghost', text: 'Подсказка (1)', onclick: function () {
      if (S.hints >= 1) { say(lv.hint, 'info'); return; } S.hints = 1; say(lv.hint, 'info'); UI.hintBtn.textContent = 'Подсказка (0)'; sfx.click();
    } });
    box.appendChild(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn primary grow', text: 'Проверить', onclick: checkFrames }), UI.hintBtn));
    return box;
  }

  function checkFrames() {
    var lv = S.level, T = S.time; if (T.solved) return;
    var firstBad = null, empty = false;
    T.rows.forEach(function (r) {
      if (r.ok) return;
      if (r.ix.value === '' || r.iy.value === '') { empty = true; return; }
      var res = L.checkFrame(lv, r.time, { x: Number(r.ix.value), y: Number(r.iy.value) });
      if (res.ok) {
        r.ok = true; r.el.className = 'frow ok'; r.ix.disabled = true; r.iy.disabled = true; r.ix.classList.remove('wrong'); r.iy.classList.remove('wrong');
        var p = L.droneAt(lv.drones[0], r.time); T.frames.push({ time: r.time, x: p.x, y: p.y });
        sfx.pick(T.frames.length); burst(ST.V.px(p.x), ST.V.py(p.y), COL.gold, 14);
      } else {
        r.ix.classList.toggle('wrong', !res.okX); r.ix.classList.toggle('good', res.okX);
        r.iy.classList.toggle('wrong', !res.okY); r.iy.classList.toggle('good', res.okY);
        if (!firstBad) firstBad = 'Строка time = ' + r.time + '. ' + res.text;
      }
    });
    if (T.rows.every(function (r) { return r.ok; })) { solveFrames(); return; }
    if (firstBad) { S.fails++; sfx.bad(); say(firstBad, 'bad'); }
    else if (empty) { UI.err.textContent = 'Заполни оба числа в каждой строке.'; sfx.bad(); }
    else say('Верно! Остальные строки ещё ждут.', 'good');
  }

  function solveFrames() {
    var lv = S.level, T = S.time; T.solved = true;
    say('Все кадры верные! Смотри, как дрон пролетает через твои точки.', 'good');
    T.t = 0; T.playing = true; UI.play.textContent = '❚❚ Пауза';
    T.onEnd = function () { refreshTime(); setTimeout(function () { if (S.screen === 'level' && S.level === lv) winLevel(); }, 700); };
    refreshTime();
  }

  function submitMeet() {
    var lv = S.level, T = S.time; if (T.solved) return;
    var tt = Math.round(T.t), res = L.checkMeet(lv, tt);
    if (res.ok) {
      T.solved = true; T.playing = false; T.t = tt; UI.play.textContent = '▶ Полёт';
      var p = L.droneAt(lv.drones[0], tt); burst(ST.V.px(p.x), ST.V.py(p.y), COL.gold, 26);
      say('Столкнулись при time = ' + tt + '! У обоих дронов X = ' + p.x + '.', 'good'); sfx.pick(3);
      setTimeout(function () { if (S.screen === 'level' && S.level === lv) winLevel(); }, 900);
    } else { S.fails++; sfx.bad(); say(res.text, 'bad'); }
  }

  function buildTimePanel(panel) {
    var lv = S.level;
    S.time = { t: 0, playing: false, solved: false, frames: [], rows: [], onEnd: null };
    UI.err = h('div', { class: 'err', 'aria-live': 'polite' });
    panel.appendChild(bubbleBox(lv.story));
    var forms = h('div', { class: 'box' }, h('h3', { text: 'Формула полёта' }));
    lv.drones.forEach(function (d) {
      forms.appendChild(h('div', { class: 'formula' }, h('span', { class: 'name' }, h('i', { class: 'sw', style: 'background:' + d.color }), ' ' + d.name), formulaNode(d)));
    });
    if (lv.mode === 'frames') {
      var ex = L.droneAt(lv.drones[0], lv.example);
      forms.appendChild(h('div', { class: 'example' }, 'Пример: при ', span('num', 'time = ' + lv.example), ' слово time заменяем числом ' + lv.example + ' и получаем ', coord(ex.x, ex.y), '.'));
    }
    panel.appendChild(forms);
    if (lv.mode === 'frames') panel.appendChild(buildFramesBox());
    UI.play = h('button', { type: 'button', class: 'btn small', text: '▶ Полёт', onclick: togglePlay });
    UI.slider = h('input', { type: 'range', min: 0, max: 100, step: 1, value: 0, 'aria-label': 'Время' });
    UI.slider.addEventListener('input', function () { S.time.playing = false; S.time.t = Number(UI.slider.value); UI.play.textContent = '▶ Полёт'; refreshTime(); sfx.tick(); });
    UI.stage.appendChild(h('div', { class: 'fly bar-under' }, UI.play, h('span', { class: 'num', text: '0' }), UI.slider, h('span', { class: 'num', text: '100' })));
    UI.read = h('div', { class: 'box readout' }); panel.appendChild(UI.read);
    if (lv.mode === 'meet') {
      UI.hintBtn = h('button', { type: 'button', class: 'btn small ghost', text: 'Подсказка (1)', onclick: function () {
        if (S.hints >= 1) { say(lv.hint, 'info'); return; } S.hints = 1; say(lv.hint, 'info'); UI.hintBtn.textContent = 'Подсказка (0)'; sfx.click();
      } });
      panel.appendChild(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn primary grow', text: 'Столкнулись!', onclick: submitMeet }), UI.hintBtn));
    }
    panel.appendChild(journalBox());
    refreshTime();
  }

  /* ---------- конец уровня ---------- */
  function winLevel() {
    if (S.done) return;
    S.done = true;
    var lv = S.level, k = lvKey(), stars = L.stars(S.fails, S.hints);
    var short = lv.type === 'walk' && S.cmds.length <= lv.par;
    var wasDone = chapterDone(S.ci), prev = P.prog[k];
    P.prog[k] = { stars: Math.max(prev ? prev.stars : 0, stars), short: !!((prev && prev.short) || short) };
    save(); updateBar(); sfx.win();
    var nowDone = !wasDone && chapterDone(S.ci);
    var next = nextLevel();
    var win = h('div', { class: 'win' }, h('h2', { text: 'Уровень пройден!' }),
      h('div', { class: 'stars', 'aria-label': stars + ' из 3 звёзд' }, span('', '★'.repeat(stars)), span('off', '★'.repeat(3 - stars))),
      short ? h('div', { class: 'badge', text: 'Короткий путь: ' + S.cmds.length + ' ' + plural(S.cmds.length, 'команда', 'команды', 'команд') }) : null,
      lv.type === 'walk' && !short ? h('p', { class: 'note', text: 'Можно короче: хватит ' + lv.par + ' ' + plural(lv.par, 'команды', 'команд', 'команд') + '. Попробуешь ещё раз?' }) : null,
      nowDone ? h('div', { class: 'rule' }, h('b', { text: 'НОВАЯ ЗАПИСЬ В ЖУРНАЛЕ' }), CH[S.ci].rule) : null,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn', text: 'Ещё раз', onclick: function () { startLevel(S.ci, S.li); } }),
        next ? h('button', { type: 'button', class: 'btn primary', text: next.label, onclick: function () { startLevel(next.ci, next.li); } }) : h('button', { type: 'button', class: 'btn primary', text: 'К главам', onclick: showChapters })));
    UI.stage.appendChild(h('div', { class: 'modal' }, win));
  }

  function plural(n, a, b, c) { var m = n % 10, m100 = n % 100; if (m === 1 && m100 !== 11) return a; if (m >= 2 && m <= 4 && (m100 < 10 || m100 >= 20)) return b; return c; }

  function nextLevel() {
    var c = CH[S.ci];
    if (S.li + 1 < c.levels.length) return { ci: S.ci, li: S.li + 1, label: 'Дальше' };
    if (S.ci + 1 < CH.length) return { ci: S.ci + 1, li: 0, label: 'Следующая глава' };
    return null;
  }

  /* ---------- экран уровня ---------- */
  function startLevel(ci, li) {
    ctxAudio();
    S.screen = 'level'; S.ci = ci; S.li = li; S.level = CH[ci].levels[li];
    S.cmds = []; S.draft = { x: '', y: '' }; S.hints = 0; S.fails = 0; S.guides = 0; S.done = false; S.fast = false; S.mouse = null;
    S.beacon = null; S.time = null; UI = {};
    var lv = S.level;
    var canvas = makeStage(lv);
    UI.stage = h('div', { class: 'stage' }, canvas);
    var panel = h('aside', { class: 'panel' });
    clear(app); app.appendChild(h('div', { class: 'level' }, UI.stage, panel));
    if (lv.type === 'walk') { replan(); buildWalkPanel(panel); resetHero(); }
    else if (lv.type === 'beacon') buildBeaconPanel(panel);
    else buildTimePanel(panel);
    crumbs(['Приключение', CH[ci].title, lv.title]);
    var first = UI.inx || UI.iny; if (first) first.focus();
  }

  /* ---------- шапка ---------- */
  function updateBar() {
    var t = totalStars(); document.getElementById('total').textContent = '★ ' + t.s + ' / ' + t.max;
  }
  function crumbs(parts) {
    var box = document.getElementById('crumbs'); clear(box);
    parts.forEach(function (p, i) { if (i) box.appendChild(h('span', { class: 'sep', text: '›' })); box.appendChild(i === parts.length - 1 ? h('b', { text: p }) : h('span', { text: p })); });
  }

  /* ---------- главная и главы ---------- */
  function heroArt(side) {
    var dpr = window.devicePixelRatio || 1, hh = side + 40, cv = h('canvas', { width: side * dpr, height: hh * dpr, 'aria-hidden': 'true' });
    cv.style.width = side + 'px'; cv.style.height = hh + 'px';
    var c = cv.getContext('2d'); c.scale(dpr, dpr);
    var lv = { axes: 'xy', size: { w: 6, h: 6 }, scale: 1, rocks: [{ x0: 3, y0: 1, x1: 3, y1: 3 }] };
    var V = viewFor(lv, side, hh); drawBase(c, V, lv, 0);
    c.setLineDash([7, 6]); c.lineWidth = 3;
    c.strokeStyle = COL.x; c.beginPath(); c.moveTo(V.px(0), V.py(0)); c.lineTo(V.px(2), V.py(0)); c.stroke();
    c.strokeStyle = COL.y; c.beginPath(); c.moveTo(V.px(2), V.py(0)); c.lineTo(V.px(2), V.py(4)); c.stroke(); c.setLineDash([]);
    drawCrystal(c, V.px(2), V.py(4), 15, 0); drawCrystal(c, V.px(5), V.py(5), 13, 1); drawCrystal(c, V.px(5), V.py(1), 13, 2);
    drawBit(c, V.px(0), V.py(0) - 6, 40, { x: 1, y: 0 }, 0, false, 1);
    return cv;
  }

  function showHome() {
    S.screen = 'home'; ST = null; UI = {};
    crumbs(['Главное меню']);
    var cards = h('div', { class: 'cards' });
    if (MODE !== 'radar') cards.appendChild(h('button', { type: 'button', class: 'card', onclick: showChapters },
      h('span', { class: 'n', text: 'РЕЖИМ 1' }), h('h3', { text: 'Приключение' }),
      h('span', { class: 'sub', text: '6 глав, 18 уровней: от одной линии до времени. Для первого знакомства с осями X и Y.' }),
      h('span', { class: 'dots' }, span('', 'Выбери главу'))));
    if (MODE !== 'adventure') cards.appendChild(h('button', { type: 'button', class: 'card', onclick: showRadar },
      h('span', { class: 'n', text: 'РЕЖИМ 2' }), h('h3', { text: 'Радар' }),
      h('span', { class: 'sub', text: 'Блиц на 60 секунд: найди точку по числам или назови числа точки. Серии дают больше очков.' }),
      h('span', { class: 'dots' }, span('', P.best ? 'Рекорд: ' + P.best : 'Пока без рекорда'))));
    var heroText = h('div', null, h('h1', { text: 'Остров координат' }),
      h('p', { class: 'lead' }, 'Ты управляешь роботом Бит. Нажимать стрелки нельзя: ', h('b', { text: 'Бит слушается только чисел' }), '. Собирай кристаллы, обходи камни и разберись, что такое оси X и Y.'));
    clear(app); app.appendChild(h('div', { class: 'home' }, h('div', { class: 'hero' }, heroArt(300), heroText), cards,
      h('p', { class: 'note', text: 'Игра рассчитана на урок. Главы можно проходить в любом порядке, но лучше по очереди. Прогресс хранится только пока открыта вкладка.' })));
    if (MODE === 'adventure') showChapters(); else if (MODE === 'radar') showRadar();
  }

  function showChapters() {
    S.screen = 'chapters'; ST = null; UI = {};
    crumbs(['Приключение', 'Главы']);
    var cards = h('div', { class: 'cards' });
    CH.forEach(function (c, ci) {
      var dots = h('span', { class: 'dots' });
      c.levels.forEach(function (_, li) {
        var p = P.prog[keyOf(ci, li)];
        dots.appendChild(h('span', { class: 'dot' + (p ? ' done' : ''), title: p ? p.stars + ' из 3' : 'Не пройден', text: p ? '★' : String(li + 1) }));
      });
      cards.appendChild(h('button', { type: 'button', class: 'card', onclick: (function (c2, ci2) { return function () { var first = 0; for (var i = 0; i < c2.levels.length; i++) { if (!P.prog[keyOf(ci2, i)]) { first = i; break; } } startLevel(ci2, first); }; })(c, ci) },
        h('span', { class: 'n', text: 'ГЛАВА ' + (ci + 1) }), h('h3', { text: c.title }), h('span', { class: 'sub', text: c.sub }), dots));
    });
    clear(app); app.appendChild(h('div', { class: 'home' }, h('h1', { text: 'Главы' }), cards,
      h('p', { class: 'note', text: 'Нажми на главу: откроется первый непройденный уровень. После каждой главы в журнале исследователя появляется правило.' })));
    updateBar();
  }

  /* ---------- Радар (блиц) ---------- */
  function showRadar() {
    ctxAudio();
    S.screen = 'radar'; UI = {}; S.mouse = null; S.particles = []; S.floaters = [];
    S.blitz = { phase: 'ready', time: 60, score: 0, combo: 0, maxCombo: 0, ok: 0, bad: 0, q: null, lock: 0, flash: null, msg: '' };
    var canvas = makeStage(RADAR_LEVEL);
    UI.stage = h('div', { class: 'stage' }, canvas);
    var panel = h('aside', { class: 'panel' }); UI.panel = panel;
    clear(app); app.appendChild(h('div', { class: 'level' }, UI.stage, panel));
    crumbs(['Радар']);
    renderRadarPanel();
  }

  function pointsFor(combo) { return 10 * Math.min(4, 1 + Math.floor(combo / 3)); }

  function renderRadarPanel() {
    var B = S.blitz, p = UI.panel; clear(p); UI.say = null;
    if (B.phase === 'ready') {
      p.appendChild(h('div', { class: 'box' }, h('h3', { text: 'Радар: блиц 60 секунд' }),
        h('p', null, 'Бит видит точки только по числам. Два вида заданий:'),
        h('p', null, h('b', { text: 'Нажми на точку: ' }), 'даны числа ', coord('7', '2'), ', нужно нажать на карту.'),
        h('p', null, h('b', { text: 'Назови точку: ' }), 'на карте метка, нужно ввести её X и Y.'),
        h('p', null, 'Верный ответ даёт очки, подряд верные ответы увеличивают множитель. Ошибка сбрасывает серию.'),
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn run grow', text: 'Старт', onclick: startRadar }),
          h('button', { type: 'button', class: 'btn', text: 'Назад', onclick: function () { if (MODE === 'radar') showRadar(); else showHome(); } })),
        P.best ? h('p', { class: 'fog', text: 'Рекорд во вкладке: ' + P.best }) : null));
      return;
    }
    if (B.phase === 'end') {
      var acc = B.ok + B.bad ? Math.round(100 * B.ok / (B.ok + B.bad)) : 0;
      p.appendChild(h('div', { class: 'box' }, h('h3', { text: 'Время вышло' }),
        h('div', { class: 'ask' }, h('span', { class: 'lbl', text: L.blitzRank(B.score) }), String(B.score)),
        h('p', null, 'Верно: ' + B.ok + ', ошибок: ' + B.bad + ', точность ' + acc + '%. Лучшая серия: ' + B.maxCombo + '.'),
        B.newBest ? h('p', { class: 'combo', text: 'Новый рекорд!' }) : h('p', { class: 'fog', text: 'Рекорд: ' + P.best }),
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn run grow', text: 'Сыграть ещё', onclick: function () { showRadar(); startRadar(); } }),
          h('button', { type: 'button', class: 'btn', text: 'В меню', onclick: function () { if (MODE === 'radar') showRadar(); else showHome(); } }))));
      return;
    }
    // игра
    UI.score = h('div', { class: 'score', text: String(B.score) });
    UI.combo = h('div', { class: 'combo' });
    UI.timer = h('div', { class: 'timer' }, h('i'));
    p.appendChild(h('div', { class: 'blitz-head' }, UI.score, UI.combo));
    p.appendChild(UI.timer);
    UI.ask = h('div', { class: 'box' }); p.appendChild(UI.ask);
    UI.msg = h('div', { class: 'bubble' }, avatar(), h('div', null, h('span', { class: 'tag', text: 'БИТ' }), h('div', { class: 'say', 'aria-live': 'polite' })));
    UI.say = UI.msg.querySelector('.say'); UI.bubble = UI.msg; p.appendChild(UI.msg);
    say('Поехали! Смотри на числа и оси.', 'info');
    renderAsk();
  }

  function renderAsk() {
    var B = S.blitz, q = B.q; clear(UI.ask);
    if (q.kind === 'click') {
      UI.ask.appendChild(h('div', { class: 'ask' }, h('span', { class: 'lbl', text: 'Нажми на точку' }), coord(q.target.x, q.target.y)));
    } else {
      UI.err = h('div', { class: 'err' });
      var inx = h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 10, step: 1, id: 'rx', 'aria-label': 'X' });
      var iny = h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 10, step: 1, id: 'ry', 'aria-label': 'Y' });
      UI.rx = inx; UI.ry = iny;
      function submit() { if (inx.value === '' || iny.value === '') { UI.err.textContent = 'Введи оба числа.'; return; } answerRadar({ x: Number(inx.value), y: Number(iny.value) }); }
      inx.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (iny.value === '') iny.focus(); else submit(); } });
      iny.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (inx.value === '') inx.focus(); else submit(); } });
      UI.ask.appendChild(h('div', { class: 'ask' }, h('span', { class: 'lbl', text: 'Назови точку с меткой на карте' })));
      UI.ask.appendChild(h('div', { class: 'build' },
        h('div', { class: 'field fx' }, h('label', { for: 'rx', text: 'X — вбок' }), h('div', { class: 'stepper' }, inx)),
        h('div', { class: 'field fy' }, h('label', { for: 'ry', text: 'Y — вверх' }), h('div', { class: 'stepper' }, iny)),
        h('button', { type: 'button', class: 'btn primary', text: 'Ответить', onclick: submit })));
      UI.ask.appendChild(UI.err);
      setTimeout(function () { inx.focus(); }, 0);
    }
  }

  function startRadar() {
    var B = S.blitz; B.phase = 'play'; B.newBest = false; B.time = 60; B.score = 0; B.combo = 0; B.maxCombo = 0; B.ok = 0; B.bad = 0; B.lock = 0; B.flash = null;
    B.q = L.makeQuestion(Math.random, 10, null); renderRadarPanel();
  }

  function radarClick(e) {
    var B = S.blitz; if (!B || B.phase !== 'play' || B.lock > 0 || B.q.kind !== 'click') return;
    var r = ST.canvas.getBoundingClientRect(), V = ST.V;
    var wx = Math.round(V.wx(e.clientX - r.left)), wy = Math.round(V.wy(e.clientY - r.top));
    if (wx < 0 || wy < 0 || wx > 10 || wy > 10) return;
    answerRadar({ x: wx, y: wy });
  }

  function answerRadar(a) {
    var B = S.blitz, q = B.q, res, V = ST.V;
    if (B.lock > 0 || B.phase !== 'play') return;
    res = L.checkBeacon(q.target, a);
    if (res.ok) {
      B.combo++; B.maxCombo = Math.max(B.maxCombo, B.combo); var pts = pointsFor(B.combo - 1); B.score += pts; B.ok++;
      sfx.pick(Math.min(B.combo, 8)); burst(V.px(q.target.x), V.py(q.target.y), COL.crystal, 16); floater(V.px(q.target.x), V.py(q.target.y) - 14, '+' + pts, COL.gold);
      B.flash = { x: q.target.x, y: q.target.y, ok: true, t0: clockT };
      next();
    } else {
      B.combo = 0; B.bad++; sfx.bad(); B.flash = { x: q.target.x, y: q.target.y, ok: false, t0: clockT, wrong: a };
      say(res.text, 'bad'); B.lock = 1.6; UI.combo.textContent = '';
    }
    UI.score.textContent = String(B.score);
    function next() { B.q = L.makeQuestion(Math.random, 10, q); renderAsk(); say('Верно!', 'good'); updateCombo(); }
  }

  function updateCombo() {
    var B = S.blitz; if (!UI.combo) return;
    UI.combo.textContent = B.combo >= 3 ? 'Серия ' + B.combo + ' · ×' + Math.min(4, 1 + Math.floor(B.combo / 3)) : '';
  }

  function updateRadar(dt) {
    var B = S.blitz; if (!B || B.phase !== 'play') return;
    B.time -= dt;
    if (B.lock > 0) { B.lock -= dt; if (B.lock <= 0) { B.q = L.makeQuestion(Math.random, 10, B.q); B.flash = null; renderAsk(); } }
    if (UI.timer) { UI.timer.firstChild.style.width = clamp(B.time / 60, 0, 1) * 100 + '%'; UI.timer.classList.toggle('low', B.time < 10); }
    if (B.time <= 0) {
      B.phase = 'end'; if (B.score > P.best) { var wasBest = P.best; P.best = B.score; save(); B.newBest = B.score > wasBest; }
      sfx.win(); renderRadarPanel();
    }
  }

  function drawRadar(dt, t) {
    var c = ST.ctx, V = ST.V, lv = RADAR_LEVEL, B = S.blitz;
    drawBase(c, V, lv, t);
    if (B && B.phase === 'play' && B.q) {
      var q = B.q.target;
      if (B.q.kind === 'name') {
        c.save(); c.shadowColor = COL.gold; c.shadowBlur = 18; c.fillStyle = COL.gold; circle(c, V.px(q.x), V.py(q.y), 10 + Math.sin(t * 6) * 1.5); c.fill(); c.restore();
        label(c, '?', V.px(q.x), V.py(q.y), '#3B2A00', 'center', 14);
      }
      if (B.flash && B.lock > 0) {
        drawProjection(c, V, lv, q, 0.9, true);
        c.save(); c.shadowColor = COL.good; c.shadowBlur = 16; c.fillStyle = COL.good; circle(c, V.px(q.x), V.py(q.y), 10); c.fill(); c.restore();
        if (B.flash.wrong) { var w = B.flash.wrong; c.strokeStyle = COL.bad; c.lineWidth = 4; var px = V.px(w.x), py = V.py(w.y); c.beginPath(); c.moveTo(px - 9, py - 9); c.lineTo(px + 9, py + 9); c.moveTo(px + 9, py - 9); c.lineTo(px - 9, py + 9); c.stroke(); }
      }
    }
    if (S.mouse && B && B.phase === 'play' && B.q && B.q.kind === 'click' && B.lock <= 0) {
      var wx = Math.round(V.wx(S.mouse.px)), wy = Math.round(V.wy(S.mouse.py));
      if (wx >= 0 && wy >= 0 && wx <= 10 && wy <= 10) { drawProjection(c, V, lv, { x: wx, y: wy }, 0.9, false); c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 2; circle(c, V.px(wx), V.py(wy), 9); c.stroke(); }
    }
    drawFx(c, dt);
  }

  /* ---------- запуск ---------- */
  document.getElementById('brand').addEventListener('click', function () { if (MODE === 'radar') showRadar(); else if (MODE === 'adventure') showChapters(); else showHome(); });
  document.getElementById('snd').addEventListener('click', function (e) {
    sound = !sound; e.currentTarget.setAttribute('aria-pressed', String(sound)); e.currentTarget.textContent = sound ? 'Звук включён' : 'Звук выключен'; if (sound) sfx.click();
  });
  updateBar();
  showHome();
  requestAnimationFrame(frame);
})();
