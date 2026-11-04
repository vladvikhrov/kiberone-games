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

  let catalog = { games: [], skipped: 0, missing: false, net: { configured: false } };
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
    // Каталог по сети (ADR-0003, 2.1; М3)
    queued: { tag: 'в очереди', note: 'Игра скоро скачается. Нажми «Играть», чтобы она скачалась первой' },
    ondemand: { tag: 'скачается по кнопке', note: 'Большая игра. Нажми «Играть», и она начнёт скачиваться' },
    downloading: { tag: 'скачивается', note: 'Игра скачивается. Нажми «Играть», чтобы она скачалась первой' },
    waiting: { tag: 'ждём очереди', note: 'Ждём очереди у тьютора' },
    offline: { tag: 'нужна связь', note: 'Попроси тьютора включить раздачу' },
    failed: { tag: 'не скачалась', note: 'Скажи тьютору: игра не скачалась' },
    nospace: { tag: 'мало места', note: 'Скажи тьютору: на ноутбуке мало места' },
  };
  // Игру нельзя запустить и нечего нажимать. Остальные состояния сети — «Играть» ставит игру первой в очередь
  const BLOCKED = new Set(['untrusted', 'update', 'offline', 'failed', 'nospace']);
  const PENDING = new Set(['queued', 'ondemand', 'downloading', 'waiting']);
  const tagText = (game) => {
    if (game.state === 'downloading') return `скачивается ${game.progress} %`;
    if (game.state === 'ondemand') return `скачается по кнопке · ${game.mb} МБ`;
    return STATE_TEXT[game.state].tag;
  };
  const etaText = (sec) => (sec === null ? '' : sec < 60 ? ' · меньше минуты' : ` · ещё ${Math.ceil(sec / 60)} мин`);
  /* Надпись на кнопке, когда игра уже первая в очереди: процент и примерное время (ADR-0003, 2.1). */
  const firstText = (game) => (game.state === 'waiting' ? 'Ждём очереди у тьютора'
    : game.state === 'downloading' ? `Скачивается ${game.progress} %${etaText(game.eta)}` : 'Скоро начнёт скачиваться');
  const authorText = (game) => (game.byTutor ? 'опубликовал тьютор' : game.author ? `автор: ${game.author}` : 'автор не проверен школой');

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
    const author = authorText(game);
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
        state ? h('span', { class: 'tag', text: tagText(game) }) : null,
        PENDING.has(game.state) && game.progress > 0 ? progressBar(game.progress) : null));
  }

  // Атрибут style запрещён CSP, поэтому ширина полосы задаётся через CSSOM
  function progressBar(percent) {
    const bar = h('span', { class: 'progress-bar' });
    bar.style.transform = `scaleX(${percent / 100})`;
    return h('span', { class: 'progress', 'aria-hidden': 'true' }, bar);
  }

  function renderGrid() {
    const shown = catalog.games.filter((g) => group === 'all' || g.groups.includes(group));
    grid.replaceChildren(...shown.map(card));
    const empty = $('empty');
    empty.hidden = shown.length > 0 || !$('ask').hidden; // на экране «Попроси тьютора» своя подпись
    if (!catalog.games.length && catalog.net.configured && !catalog.net.online) setText(empty, 'Ищу программу тьютора в сети…');
    else if (!catalog.games.length) setText(empty, 'Игр пока нет. Попроси тьютора добавить игры.');
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
    const { modal, returnId, cleanup, opener } = current;
    current = null;
    if (cleanup) cleanup();
    const finish = () => {
      for (const a of overlay.getAnimations()) a.cancel(); // иначе прозрачность из анимации закрытия останется
      overlay.hidden = true;
      overlay.replaceChildren();
      document.getElementById('page').removeAttribute('aria-hidden');
      const back = returnId ? cardOf(returnId) : opener && $('status').querySelector('button');
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
    offline: STATE_TEXT.offline.note,
    nospace: STATE_TEXT.nospace.note,
    changed: 'Файл игры изменился. Попроси тьютора перезапустить программу',
    failed: 'Эта игра сейчас не открывается. Скажи тьютору',
  };

  function openGame(id, fromEl, modeId) {
    let game = findGame(id);
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
    const playLabel = h('span', { text: 'Играть' });
    const play = h('button', { class: 'btn-play', type: 'button' }, playIcon(), playLabel);
    const author = authorText(game);
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
      const blocked = BLOCKED.has(game.state) ? STATE_TEXT[game.state] : null;
      const pending = PENDING.has(game.state);
      // Игра уже первая в очереди: на кнопке ход загрузки, нажимать снова незачем
      play.disabled = !!blocked || (pending && game.first);
      setText(playLabel, pending && game.first ? firstText(game) : 'Играть');
      sideNote.classList.toggle('alert', !!blocked);
      let note = `режим: ${m.title}\nигра на этом ноутбуке, сеть во время игры выключена`;
      if (blocked) note = blocked.note;
      else if (pending && game.first) note = 'Когда скачается, нажми «Играть»';
      else if (pending) note = game.state === 'downloading' ? `Игра скачивается: ${game.progress} %. Нажми «Играть», чтобы она скачалась первой` : STATE_TEXT[game.state].note;
      setText(sideNote, note);
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
      } else if (result.reason === 'queued') {
        // Игра встала первой: кнопка покажет ход загрузки после catalog.changed
        game = { ...game, first: true };
        current.game = game;
        renderMode();
        announce('Игра скачивается первой');
      } else {
        renderMode();
        play.disabled = BLOCKED.has(game.state);
        sideNote.classList.add('alert');
        setText(sideNote, LAUNCH_ERRORS[result.reason] || LAUNCH_ERRORS.failed);
      }
    });

    renderMode();
    current = {
      kind: 'game', game, modal, returnId: game.id,
      // Новый каталог или ход загрузки: окно остаётся открытым, меняются только кнопка и подпись
      refresh: (fresh) => {
        if (fresh.state === game.state && fresh.progress === game.progress && fresh.cover === game.cover && fresh.eta === game.eta && fresh.first === game.first
          && JSON.stringify(fresh.modes) === JSON.stringify(game.modes)) return;
        game = fresh;
        current.game = fresh;
        const focused = document.activeElement === play;
        renderMode();
        if (focused && play.disabled) closeBtn.focus();
      },
    };
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
  const sentValues = new Map(); // "игра/режим" -> сколько звёзд поставили (до закрытия программы, только для показа)

  /* Что сказать после оценки. На настроенном ноутбуке голос уходит тьютору; пока он в очереди — «отправлю, когда будет связь». */
  function doneText(game, modeId) {
    const m = game && game.modes.find((x) => x.id === modeId);
    if (!catalog.net || !catalog.net.configured) return 'Спасибо! Оценка сохранена без имени';
    return m && m.votePending ? 'Спасибо! Отправлю тьютору, когда будет связь' : 'Спасибо! Оценка ушла тьютору';
  }

  async function sendVote(gameId, modeId, value) {
    const key = `${gameId}/${modeId}`;
    results.set(key, 'sending');
    sentValues.set(key, value);
    refreshRate(gameId, modeId);
    let res;
    try { res = await api.vote(gameId, modeId, value); } catch { res = { ok: false, reason: 'error' }; }
    if (res.ok) {
      results.set(key, 'done');
      replaceGame(res.game);
      announce(doneText(res.game, modeId));
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
      // После отправки звёзды остаются залитыми: ребёнок видит, что поставил
      const shown = locked ? (pending || (st === 'done' || st === 'sending' ? sentValues.get(key) || 0 : 0)) : (hover || pending || 0);
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
        panel.replaceChildren(h('div', { class: 'done', 'aria-live': 'polite' }, checkIcon(), h('span', { text: doneText(findGame(gameId), modeId) })));
        if (!modal.contains(document.activeElement) || document.activeElement.disabled) closeBtn.focus();
      } else if (st === 'already') {
        panel.replaceChildren(h('p', { class: 'rate-hint', text: fresh().votePending
          ? 'Ты уже оценил этот режим сегодня. Отправлю тьютору, когда будет связь.' : 'Ты уже оценил этот режим сегодня. Завтра можно снова.' }));
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

  /* ---------- Связь с тьютором (только на настроенном ноутбуке) ---------- */

  const ADDRESS_ERRORS = {
    'not-ip': 'Это не адрес. Нужны четыре числа через точку, например 192.168.1.50',
    'not-subnet': 'Этот адрес не из сети, к которой подключён ноутбук',
    'no-answer': 'По этому адресу программа тьютора не отвечает. Проверь, что тьютор включил раздачу',
    busy: 'Сначала закрой игру',
  };
  const fingerprintText = (fp) => fp.match(/.{1,4}/g).join(' ');
  const dot = (on) => svg('svg', { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': 'true' },
    svg('circle', { cx: 7, cy: 7, r: 5, fill: on ? '#111111' : 'none', stroke: '#111111', 'stroke-width': 2 }));

  /* Поле адреса: на экране «Попроси тьютора» и в окне «Связь с тьютором». */
  function addressForm(idPrefix) {
    const input = h('input', { class: 'field', id: `${idPrefix}-ip`, type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', maxlength: '15', placeholder: '192.168.1.50' });
    const message = h('p', { class: 'form-note', 'aria-live': 'polite' });
    const button = h('button', { class: 'btn-main', type: 'submit', text: 'Подключиться' });
    const form = h('form', { class: 'address-form', novalidate: true },
      h('label', { class: 'field-label', for: `${idPrefix}-ip`, text: 'Адрес программы тьютора' }),
      h('span', { class: 'field-row' }, input, button), message);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const ip = input.value.trim();
      button.disabled = true;
      message.classList.remove('alert');
      setText(message, 'Подключаюсь…');
      let result;
      try { result = await api.setAddress(ip); } catch { result = { ok: false, reason: 'no-answer' }; }
      button.disabled = false;
      message.classList.toggle('alert', !result.ok);
      setText(message, result.ok ? 'Подключились. Каталог загружается' : (ADDRESS_ERRORS[result.reason] || ADDRESS_ERRORS['no-answer']));
      if (result.ok) refresh();
    });
    return { form, input };
  }

  function renderStatus() {
    const net = catalog.net;
    if (!net.configured || net.broken) return;
    const box = $('status');
    const label = net.online ? 'есть связь' : 'нет связи';
    const button = h('button', { class: 'btn-status', type: 'button', 'aria-label': `${label}. Связь с тьютором`, onclick: (e) => openLink(e.currentTarget) },
      dot(net.online), h('span', { text: label }));
    const hadFocus = box.contains(document.activeElement);
    box.replaceChildren(button);
    if (hadFocus) button.focus();
  }

  /* Экран «Попроси тьютора»: каталога нет и сервер не нашёлся (ADR-0003, 2). */
  function renderAsk() {
    const net = catalog.net;
    const ask = $('ask');
    const broken = net.configured && net.broken;
    const show = broken || (net.configured && net.ask && !catalog.games.length);
    $('page-head').hidden = show;
    ask.hidden = !show;
    if (!show) { ask.replaceChildren(); return; }
    if (broken) {
      ask.replaceChildren(h('h1', { text: 'Ноутбук настроен с ошибкой' }), h('p', { class: 'note', text: 'Скажи тьютору: игры на этом ноутбуке не открываются.' }));
      return;
    }
    if (ask.dataset.kind === 'ask' && ask.childElementCount) return; // не сбрасываем то, что ребёнок уже набрал
    ask.dataset.kind = 'ask';
    const { form } = addressForm('ask');
    ask.replaceChildren(
      h('h1', { text: 'Попроси тьютора' }),
      h('p', { class: 'note', text: 'Не нашли программу тьютора в сети. Попроси тьютора включить раздачу и назвать адрес: он написан в его программе.' }),
      form);
  }

  function openLink(fromEl) {
    if (current) hide(true);
    const closeBtn = h('button', { class: 'btn-x', type: 'button', 'aria-label': 'Закрыть', onclick: () => hide() }, closeIcon());
    const info = h('div', { class: 'link-info' });
    const journal = h('pre', { class: 'journal', tabindex: '0', 'aria-label': 'Журнал для тьютора' });
    const { form, input } = addressForm('link');
    const modal = h('section', { class: 'modal link', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'link-title' },
      closeBtn,
      h('h2', { id: 'link-title', text: 'Связь с тьютором' }),
      info, form,
      h('span', { class: 'field-label', text: 'Журнал для тьютора' }), journal);
    function render() {
      const net = catalog.net;
      info.replaceChildren(
        h('span', { class: 'link-row' }, dot(net.online), h('span', { text: net.online ? `есть связь · сервер ${net.server}` : 'нет связи с программой тьютора' })),
        h('span', { class: 'meta', text: `школа: ${net.school.name} · отпечаток ${fingerprintText(net.school.fingerprint)}` }));
      setText(journal, net.log.length ? net.log.join('\n') : 'Пока пусто');
    }
    render();
    current = { kind: 'link', modal, returnId: null, render, opener: fromEl };
    show(modal, null);
    input.focus();
  }

  let lastJson = '';
  async function refresh() {
    let fresh;
    try { fresh = await api.catalogList(); } catch { return; }
    const json = JSON.stringify(fresh);
    if (json === lastJson) return;
    lastJson = json;
    catalog = fresh;
    renderStatus();
    renderAsk();
    const focused = document.activeElement && document.activeElement.closest && document.activeElement.closest('.card');
    renderGrid();
    if (focused && !current) { const again = cardOf(focused.dataset.id); if (again) again.focus(); }
    if (current && current.kind === 'game') { const g = findGame(current.game.id); if (g) current.refresh(g); }
    if (current && current.kind === 'link') current.render();
    // Голос ушёл тьютору или пришёл новый рейтинг (М4)
    if (current && current.kind === 'rate' && findGame(current.game.id)) current.render();
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

  api.onCatalogChanged(() => { refresh(); });

  async function start() {
    renderFilters();
    try {
      catalog = await api.catalogList();
      lastJson = JSON.stringify(catalog);
    } catch {
      catalog = { games: [], skipped: 0, missing: true, net: { configured: false } };
    }
    renderStatus();
    renderAsk();
    renderGrid();
  }
  start();
})();
