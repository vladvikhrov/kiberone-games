'use strict';
/* Витрина K1 Игры. Тексты каталога пишут чужие авторы, поэтому всё, что пришло из каталога,
   выводится только через setText (textContent). innerHTML здесь не используется, а CSP с Trusted Types его и не пустит. */
(() => {
  const api = window.k1;
  const SVG = 'http://www.w3.org/2000/svg';
  const OPEN_MS = 200;
  const CLOSE_MS = 150;
  const EASE = 'cubic-bezier(0.2, 0, 0, 1)';
  const VOTE_MS = 5000;
  const GROUPS = [['all', 'Все'], ['junior', 'Младшая группа'], ['middle', 'Средняя группа'], ['senior', 'Старшая группа']];
  const STAR = '12,2.5 14.9,8.6 21.5,9.4 16.6,14 17.9,20.6 12,17.3 6.1,20.6 7.4,14 2.5,9.4 9.1,8.6';
  const STAR_HALF = '12,2.5 9.1,8.6 2.5,9.4 7.4,14 6.1,20.6 12,17.3';
  const STAR_NAMES = ['', '1 звезду', '2 звезды', '3 звезды', '4 звезды', '5 звёзд'];

  const $ = (id) => document.getElementById(id);
  const grid = $('grid');
  const overlay = $('overlay');
  const live = $('live');
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let catalog = { games: [], skipped: 0, missing: false };
  let group = 'all';
  let current = null; // открытое окно: { kind, game, modeId, modal, returnId, ... }

  /* ---------- Построение DOM без разметки ---------- */

  // Единственное место, где текст попадает в страницу. Тест К23 проверяет, что именно здесь нет innerHTML.
  function setText(el, value) {
    /*K23*/el.textContent = String(value);
  }

  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'text') setText(el, value);
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat()) if (child) el.append(child);
    return el;
  }

  function svg(tag, attrs = {}, ...children) {
    const el = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    for (const child of children) el.append(child);
    return el;
  }

  function starIcon(kind, size) {
    const icon = svg('svg', { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true' });
    if (kind === 'half') icon.append(svg('polygon', { points: STAR_HALF, fill: '#111111' }));
    icon.append(svg('polygon', { points: STAR, fill: kind === 'full' ? '#111111' : 'none', stroke: '#111111', 'stroke-width': size > 40 ? 1.4 : 1.5, 'stroke-linejoin': 'round' }));
    return icon;
  }

  function starsFor(avg, size) {
    const wrap = h('span', { class: 'stars', 'aria-hidden': 'true' });
    for (let i = 0; i < 5; i += 1) {
      const full = avg !== null && avg >= i + 0.75;
      const half = !full && avg !== null && avg >= i + 0.25;
      wrap.append(starIcon(full ? 'full' : half ? 'half' : 'empty', size));
    }
    return wrap;
  }

  const closeIcon = () => svg('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: '#111111', 'stroke-width': 3, 'stroke-linecap': 'square', 'aria-hidden': 'true' },
    svg('path', { d: 'M5 5 L19 19 M19 5 L5 19' }));
  const playIcon = () => svg('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: '#111111', stroke: '#111111', 'stroke-width': 2, 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    svg('path', { d: 'M6 4 L20 12 L6 20 Z' }));
  const checkIcon = () => svg('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: '#FFFFFF', 'stroke-width': 3, 'stroke-linecap': 'square', 'aria-hidden': 'true' },
    svg('path', { d: 'M4 12 L10 18 L20 6' }));

  function plural(n, one, few, many) {
    const d = n % 10;
    const dd = n % 100;
    if (d === 1 && dd !== 11) return one;
    if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
    return many;
  }
  const votesText = (n) => `${n} ${plural(n, 'оценка', 'оценки', 'оценок')}`;
  const modesText = (n) => `${n} ${plural(n, 'режим', 'режима', 'режимов')}`;
  const avgText = (avg) => avg.toFixed(1);

  function initials(title) {
    const words = title.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
    const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2);
    return letters.toUpperCase();
  }

  /* Обложка или заглушка: штриховка и первые буквы названия (ADR-0003, 4.5). */
  function coverBox(className, sha, title) {
    if (sha) return h('span', { class: className }, h('img', { src: `kibapp://cover/${sha}`, alt: '', draggable: 'false' }));
    return h('span', { class: `${className} cover-stub`, 'aria-hidden': 'true' }, h('span', { class: 'initials', text: initials(title) }));
  }

  const STATE_TEXT = {
    untrusted: { tag: 'автор не проверен', note: 'Скажи тьютору: автор этой игры не проверен школой' },
    update: { tag: 'обнови приложение', note: 'Скажи тьютору: для этой игры нужно обновить приложение' },
  };

  function announce(text) {
    setText(live, '');
    setTimeout(() => setText(live, text), 30);
  }

  /* ---------- Витрина ---------- */

  function renderFilters() {
    const nav = $('filters');
    nav.replaceChildren(...GROUPS.map(([id, label]) => h('button', {
      class: 'btn-filter', type: 'button', 'aria-pressed': String(group === id), text: label,
      onclick: () => { group = id; renderFilters(); renderGrid(); },
    })));
  }

  function card(game) {
    const author = game.author ? `автор: ${game.author}` : 'автор не проверен школой';
    const rating = h('span', { class: 'rating-line' },
      starsFor(game.rating.few ? null : game.rating.avg, 14),
      h('span', { class: 'rating-num', text: game.rating.few ? 'мало оценок' : avgText(game.rating.avg) }),
      h('span', { class: 'meta', text: `· ${modesText(game.modes.length)}` }));
    const state = STATE_TEXT[game.state];
    return h('button', { class: 'card', type: 'button', 'data-id': game.id, 'data-state': game.state, onclick: (e) => openGame(game.id, e.currentTarget) },
      coverBox('cover', game.cover, game.title),
      h('span', { class: 'card-body' },
        h('span', { class: 'card-title', text: game.title }),
        h('span', { class: 'meta', text: author }),
        rating,
        state ? h('span', { class: 'tag', text: state.tag }) : null));
  }

  function renderGrid() {
    const shown = catalog.games.filter((g) => group === 'all' || g.groups.includes(group));
    grid.replaceChildren(...shown.map(card));
    const empty = $('empty');
    empty.hidden = shown.length > 0;
    if (!catalog.games.length) setText(empty, 'Игр пока нет. Попроси тьютора добавить игры.');
    else if (!shown.length) setText(empty, 'Для этой группы игр пока нет. Нажми «Все».');
    const skipped = $('skipped');
    skipped.hidden = !catalog.skipped;
    if (catalog.skipped) setText(skipped, `Ещё ${catalog.skipped} ${plural(catalog.skipped, 'файл не прошёл', 'файла не прошли', 'файлов не прошли')} проверку. Скажи тьютору.`);
  }

  const findGame = (id) => catalog.games.find((g) => g.id === id);
  const cardOf = (id) => grid.querySelector(`.card[data-id="${CSS.escape(id)}"]`);

  function replaceGame(fresh) {
    const i = catalog.games.findIndex((g) => g.id === fresh.id);
    if (i < 0) return;
    catalog.games[i] = fresh;
    const old = cardOf(fresh.id);
    if (old) {
      const hadFocus = document.activeElement === old;
      const next = card(fresh);
      old.replaceWith(next);
      if (hadFocus) next.focus();
    }
  }

  /* ---------- Общее для окон: показ, анимация, фокус ---------- */

  function show(modal, fromEl, extra = []) {
    overlay.replaceChildren(modal, ...extra);
    overlay.hidden = false;
    document.getElementById('page').setAttribute('aria-hidden', 'true');
    if (reduced()) return;
    const from = fromEl && fromEl.isConnected ? fromEl.getBoundingClientRect() : null;
    overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: OPEN_MS, easing: 'linear' });
    if (from) {
      // Окно вырастает из карточки: FLIP, только transform и opacity
      const to = modal.getBoundingClientRect();
      modal.style.transformOrigin = '0 0';
      modal.animate([
        { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`, opacity: 0.3 },
        { transform: 'none', opacity: 1 },
      ], { duration: OPEN_MS, easing: EASE });
    } else {
      modal.animate([{ transform: 'translateY(12px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: OPEN_MS, easing: EASE });
    }
  }

  function hide(instant = false) {
    if (!current) return Promise.resolve();
    const { modal, returnId, cleanup } = current;
    current = null;
    if (cleanup) cleanup();
    const finish = () => {
      for (const a of overlay.getAnimations()) a.cancel(); // иначе прозрачность из анимации закрытия останется
      overlay.hidden = true;
      overlay.replaceChildren();
      document.getElementById('page').removeAttribute('aria-hidden');
      const back = returnId && cardOf(returnId);
      if (back) back.focus();
    };
    const target = returnId && cardOf(returnId);
    if (instant || reduced() || !target) { finish(); return Promise.resolve(); }
    const from = modal.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    modal.style.transformOrigin = '0 0';
    overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CLOSE_MS, easing: 'linear', fill: 'forwards' });
    const anim = modal.animate([
      { transform: 'none', opacity: 1 },
      { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`, opacity: 0.3 },
    ], { duration: CLOSE_MS, easing: EASE, fill: 'forwards' });
    return anim.finished.then(finish, finish);
  }

  const focusables = (root) => [...root.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && el.getClientRects().length > 0);

  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) hide(); });
  document.addEventListener('keydown', (e) => {
    if (!current) return;
    if (e.key === 'Escape') { e.preventDefault(); hide(); return; }
    if (e.key === 'Tab') {
      // Tab ходит только внутри окна
      const list = focusables(current.modal);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (!current.modal.contains(document.activeElement)) { e.preventDefault(); first.focus(); } else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ---------- Окно игры ---------- */

  const LAUNCH_ERRORS = {
    untrusted: STATE_TEXT.untrusted.note,
    update: STATE_TEXT.update.note,
    changed: 'Файл игры изменился. Попроси тьютора перезапустить программу',
    failed: 'Эта игра сейчас не открывается. Скажи тьютору',
  };

  function openGame(id, fromEl, modeId) {
    const game = findGame(id);
    if (!game) return;
    if (current) hide(true);
    const state = { modeId: modeId || game.modes[0].id };
    const mode = () => game.modes.find((m) => m.id === state.modeId) || game.modes[0];

    const coverSlot = h('div');
    const closeBtn = h('button', { class: 'btn-x', type: 'button', 'aria-label': 'Закрыть', onclick: () => hide() }, closeIcon());
    const tabs = game.modes.length > 1 ? h('div', { class: 'tabs' }) : null;
    const ratingRow = h('span', { class: 'modal-rating' });
    const about = h('p', { class: 'about' });
    const sideNote = h('span', { class: 'side-note' });
    const play = h('button', { class: 'btn-play', type: 'button' }, playIcon(), 'Играть');
    const author = game.author ? `автор: ${game.author}` : 'автор не проверен школой';
    const titleId = `title-${game.id}`;

    const modal = h('section', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      coverSlot, tabs,
      h('div', { class: 'modal-body' },
        h('div', { class: 'modal-info' },
          h('h2', { id: titleId, text: game.title }),
          h('span', { class: 'meta', text: `${author} · ${game.minutes} мин · ${game.grades}` }),
          ratingRow, about),
        h('div', { class: 'modal-side' }, play, sideNote)));

    function renderMode() {
      const m = mode();
      const cover = coverBox('modal-cover', m.cover || game.cover, game.title);
      cover.append(closeBtn);
      coverSlot.replaceChildren(cover);
      if (tabs) {
        // До 4 вкладок в ряд, последняя растягивается, чтобы не было пустых клеток
        const cols = game.modes.length <= 4 ? game.modes.length : (game.modes.length % 3 === 0 ? 3 : 4);
        tabs.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
        tabs.replaceChildren(...game.modes.map((x, i) => {
          const tab = h('button', { class: 'tab', type: 'button', 'aria-pressed': String(x.id === m.id), text: x.title, onclick: () => { state.modeId = x.id; renderMode(); tab.focus(); } });
          const rest = game.modes.length % cols;
          if (rest && i === game.modes.length - 1) tab.style.gridColumn = `span ${cols - rest + 1}`;
          return tab;
        }));
      }
      ratingRow.replaceChildren(
        starsFor(m.rating.few ? null : m.rating.avg, 18),
        h('span', { class: 'rating-num', text: m.rating.few ? 'мало оценок' : `${avgText(m.rating.avg)} / 5.0` }),
        h('span', { class: 'meta', text: `· ${votesText(m.rating.n)}` }));
      setText(about, m.about);
      const blocked = STATE_TEXT[game.state];
      play.disabled = !!blocked;
      sideNote.classList.toggle('alert', !!blocked);
      setText(sideNote, blocked ? blocked.note : `режим: ${m.title}\nигра на этом ноутбуке, сеть во время игры выключена`);
    }

    play.addEventListener('click', async () => {
      const m = mode();
      play.disabled = true;
      sideNote.classList.remove('alert');
      setText(sideNote, 'Запускаю…');
      let result;
      try { result = await api.launch(game.id, m.id); } catch { result = { ok: false, reason: 'failed' }; }
      if (!current || current.game !== game) return;
      if (result.ok) {
        current.launched = m.id;
        renderMode();
      } else {
        renderMode();
        play.disabled = !!STATE_TEXT[game.state];
        sideNote.classList.add('alert');
        setText(sideNote, LAUNCH_ERRORS[result.reason] || LAUNCH_ERRORS.failed);
      }
    });

    renderMode();
    current = { kind: 'game', game, modal, returnId: game.id };
    show(modal, fromEl, [h('span', { class: 'hint', text: 'Esc или щелчок мимо окна — закрыть' })]);
    (play.disabled ? closeBtn : play).focus();
  }

  /* ---------- Окно оценки ---------- */

  const votes = window.K1VoteTimer.createPendingVotes({
    delayMs: VOTE_MS,
    now: () => performance.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (id) => clearTimeout(id),
    send: sendVote,
  });
  const results = new Map(); // "игра/режим" -> 'sending' | 'done' | 'error' | 'already'

  async function sendVote(gameId, modeId, value) {
    const key = `${gameId}/${modeId}`;
    results.set(key, 'sending');
    refreshRate(gameId, modeId);
    let res;
    try { res = await api.vote(gameId, modeId, value); } catch { res = { ok: false, reason: 'error' }; }
    if (res.ok) {
      results.set(key, 'done');
      replaceGame(res.game);
      announce('Спасибо! Оценка сохранена без имени');
    } else {
      results.set(key, res.reason === 'already' ? 'already' : 'error');
    }
    refreshRate(gameId, modeId);
  }

  function refreshRate(gameId, modeId) {
    if (current && current.kind === 'rate' && current.game.id === gameId && current.modeId === modeId) current.render();
  }

  function openRate(gameId, modeId) {
    const game = findGame(gameId);
    if (!game) return;
    const mode = game.modes.find((m) => m.id === modeId);
    if (!mode) return;
    if (current) hide(true);
    const key = `${gameId}/${modeId}`;
    let hover = 0;
    let ticker = null;

    const caption = game.modes.length > 1 || game.multiMode ? `${game.title} · ${mode.title}` : game.title;
    const valueText = h('span', { class: 'value-text', 'aria-live': 'polite' });
    const panel = h('div');
    const starButtons = [1, 2, 3, 4, 5].map((n) => h('button', {
      class: 'star', type: 'button', 'aria-label': `Поставить ${STAR_NAMES[n]}`,
      onclick: () => { votes.start(gameId, modeId, n); results.delete(key); hover = 0; render(); },
      onmouseenter: () => { hover = n; paintStars(); },
    }));
    const row = h('div', { class: 'star-row', onmouseleave: () => { hover = 0; paintStars(); } }, starButtons);
    const closeBtn = h('button', { class: 'btn-x', type: 'button', 'aria-label': 'Закрыть', onclick: () => hide() }, closeIcon());
    const modal = h('section', { class: 'modal rate', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rate-title' },
      closeBtn,
      h('div', { class: 'rate-head' }, h('span', { class: 'meta', text: caption }), h('h2', { id: 'rate-title', text: 'Как тебе?' })),
      h('div', { class: 'star-block' }, row, valueText),
      panel);

    const fresh = () => findGame(gameId).modes.find((m) => m.id === modeId);
    const status = () => {
      if (votes.value(gameId, modeId) !== null) return 'count';
      if (results.has(key)) return results.get(key);
      if (fresh().votedToday) return 'already';
      if (!fresh().played) return 'unplayed';
      return 'idle';
    };

    function paintStars() {
      const st = status();
      const pending = votes.value(gameId, modeId);
      const locked = st === 'done' || st === 'sending' || st === 'already' || st === 'unplayed' || st === 'error';
      const shown = locked ? (pending || 0) : (hover || pending || 0);
      starButtons.forEach((b, i) => {
        b.replaceChildren(starIcon(i + 1 <= shown ? 'full' : 'empty', 56));
        b.disabled = locked;
        b.classList.toggle('locked', st === 'done' || st === 'sending');
        b.setAttribute('aria-pressed', String(pending === i + 1));
      });
      setText(valueText, shown ? `${shown} из 5` : (locked ? '' : 'выбери от 1 до 5'));
    }

    function render() {
      const st = status();
      paintStars();
      if (ticker) { clearInterval(ticker); ticker = null; }
      if (st === 'count') {
        const bar = h('span', { class: 'countdown-bar', 'aria-hidden': 'true' });
        const sec = h('span', { class: 'countdown-sec' });
        const update = () => {
          const left = votes.remaining(gameId, modeId);
          if (left === null) return;
          bar.style.transform = `scaleX(${left / VOTE_MS})`;
          setText(sec, `${Math.ceil(left / 1000)} с`);
        };
        const undo = h('button', { class: 'btn-undo', type: 'button', text: 'Отменить',
          onclick: () => { votes.cancel(gameId, modeId); render(); starButtons[0].focus(); announce('Оценка отменена'); } });
        panel.replaceChildren(h('div', { class: 'countdown' }, bar,
          h('span', { class: 'countdown-text', text: `Записали: ${votes.value(gameId, modeId)} из 5` }), sec, undo));
        update();
        ticker = setInterval(update, reduced() ? 1000 : 100);
        if (!modal.contains(document.activeElement) || document.activeElement.disabled) undo.focus();
      } else if (st === 'sending') {
        panel.replaceChildren(h('p', { class: 'rate-hint', text: 'Сохраняю…' }));
      } else if (st === 'done') {
        panel.replaceChildren(h('div', { class: 'done', 'aria-live': 'polite' }, checkIcon(), h('span', { text: 'Спасибо! Оценка сохранена без имени' })));
        closeBtn.focus();
      } else if (st === 'already') {
        panel.replaceChildren(h('p', { class: 'rate-hint', text: 'Ты уже оценил этот режим сегодня. Завтра можно снова.' }));
      } else if (st === 'unplayed') {
        panel.replaceChildren(h('p', { class: 'rate-hint', text: 'Сыграй, чтобы оценить.' }));
      } else if (st === 'error') {
        panel.replaceChildren(h('p', { class: 'rate-hint', text: 'Не получилось сохранить оценку. Скажи тьютору.' }));
      } else {
        panel.replaceChildren(h('p', { class: 'rate-hint', text: 'Нажми на звезду. Если промахнёшься, будет 5 секунд на отмену.' }));
      }
    }

    current = {
      kind: 'rate', game, modeId, modal, returnId: gameId, render,
      // Закрытие окна не отменяет голос: он уйдёт, когда пройдут 5 с
      cleanup: () => { if (ticker) clearInterval(ticker); },
    };
    render();
    show(modal, null);
    const firstEnabled = starButtons.find((b) => !b.disabled);
    if (!modal.contains(document.activeElement)) (firstEnabled || closeBtn).focus();
  }

  /* ---------- Запуск ---------- */

  api.onGameClosed(({ id, mode }) => {
    const game = findGame(id);
    if (!game) return;
    const m = game.modes.find((x) => x.id === mode);
    if (m) m.played = true;
    // Новая игра в этот режим: прошлое «Спасибо» больше не показываем, решает votedToday
    if (results.get(`${id}/${mode}`) === 'done') results.delete(`${id}/${mode}`);
    replaceGame(game);
    openRate(id, mode);
  });

  async function start() {
    renderFilters();
    try {
      catalog = await api.catalogList();
    } catch {
      catalog = { games: [], skipped: 0, missing: true };
    }
    renderGrid();
  }
  start();
})();
