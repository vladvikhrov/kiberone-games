'use strict';
/* Окно программы тьютора. Названия игр, имена авторов и режимы пишут чужие люди, поэтому всё, что пришло из файлов,
   выводится только через setText (textContent). innerHTML здесь не используется, CSP с Trusted Types его и не пустит. */
(() => {
  const api = window.k1t;
  const SVG = 'http://www.w3.org/2000/svg';
  const STAR = '12,2.5 14.9,8.6 21.5,9.4 16.6,14 17.9,20.6 12,17.3 6.1,20.6 7.4,14 2.5,9.4 9.1,8.6';
  const STAR_HALF = '12,2.5 9.1,8.6 2.5,9.4 7.4,14 6.1,20.6 12,17.3';
  const BAR_FILL = { 5: '#111111', 4: '#4A4F55', 3: '#7D838A', 2: '#A9AEB3', 1: '#D3D6D9' };
  const GROUP_NAMES = { junior: 'младшая', middle: 'средняя', senior: 'старшая' };

  const $ = (id) => document.getElementById(id);
  const screen = $('screen');
  const overlay = $('overlay');
  const toastEl = $('toast');

  let state = null;
  let selected = null; // id выбранной игры
  let modal = null; // { el, returnFocus, onClose }
  let afterCode = false; // показан код восстановления, ждём «Готово»
  let busy = false;

  /* ---------- DOM без разметки ---------- */

  // Единственное место, где текст попадает в страницу. Тест К24 проверяет, что именно здесь нет innerHTML.
  function setText(el, value) {
    /*K24*/el.textContent = String(value);
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
  const clear = (el) => { while (el.firstChild) el.firstChild.remove(); };

  function starIcon(kind, size) {
    const icon = svg('svg', { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true' });
    if (kind === 'half') icon.append(svg('polygon', { points: STAR_HALF, fill: '#111111' }));
    icon.append(svg('polygon', { points: STAR, fill: kind === 'full' ? '#111111' : 'none', stroke: '#111111', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }));
    return icon;
  }
  function stars(avg, size) {
    const wrap = h('span', { class: 'stars', 'aria-hidden': 'true' });
    for (let i = 0; i < 5; i += 1) {
      const full = avg >= i + 0.75;
      const half = !full && avg >= i + 0.25;
      wrap.append(starIcon(full ? 'full' : half ? 'half' : 'empty', size));
    }
    return wrap;
  }
  const keyIcon = (color) => svg('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    svg('circle', { cx: 7.5, cy: 15.5, r: 4.5 }), svg('path', { d: 'M11 12 L20 3 M16 7 L19 10 M18 5 L21 8' }));
  const lockIcon = (color) => svg('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linecap': 'square', 'aria-hidden': 'true' },
    svg('rect', { x: 5, y: 11, width: 14, height: 10 }), svg('path', { d: 'M8 11 V7 A4 4 0 0 1 16 7 V11' }));
  const upIcon = () => svg('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: '#111111', 'stroke-width': 3, 'stroke-linecap': 'square', 'aria-hidden': 'true' },
    svg('path', { d: 'M12 20 V5 M5 11 L12 4 L19 11' }));
  const closeIcon = () => svg('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: '#111111', 'stroke-width': 3, 'stroke-linecap': 'square', 'aria-hidden': 'true' },
    svg('path', { d: 'M5 5 L19 19 M19 5 L5 19' }));

  function plural(n, one, few, many) {
    const d = n % 10;
    const dd = n % 100;
    if (d === 1 && dd !== 11) return one;
    if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
    return many;
  }
  const votes = (n) => `${n} ${plural(n, 'оценка', 'оценки', 'оценок')}`;
  const ageText = (g) => {
    if (!g.groups.length) return g.grades;
    if (g.groups.length === 3) return 'Все группы';
    const names = g.groups.map((x) => GROUP_NAMES[x]);
    const text = names.length === 1 ? names[0] : `${names[0]}–${names[names.length - 1]}`;
    return text[0].toUpperCase() + text.slice(1);
  };

  let toastTimer = null;
  function toast(message) {
    setText(toastEl, message);
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 6000);
  }

  /* Вызов основного процесса: блокирует повторные нажатия, показывает ошибку. Возвращает результат или null. */
  async function call(fn, { errorEl } = {}) {
    if (busy) return null;
    busy = true;
    document.body.setAttribute('aria-busy', 'true');
    try {
      const result = await fn();
      if (result && result.state) { state = result.state; }
      if (result && result.ok === false && !result.cancelled) {
        if (result.code === 'locked') { render(); openLogin(); }
        if (errorEl) setText(errorEl, result.error);
        else toast(result.error);
      }
      return result;
    } catch (err) {
      toast('Программа не смогла выполнить действие');
      return null;
    } finally {
      busy = false;
      document.body.removeAttribute('aria-busy');
    }
  }

  /* ---------- Шапка ---------- */

  function renderHeader() {
    const keyState = $('key-state');
    const main = $('btn-main');
    const school = $('btn-school');
    const ready = state.school && !afterCode;
    keyState.hidden = !ready;
    main.hidden = !ready;
    school.hidden = !ready;
    if (!ready) return;
    clear(keyState);
    clear(main);
    if (state.unlocked) {
      keyState.append(keyIcon('#C4C8CC'), h('span', { text: 'ключ школы открыт' }));
      main.append(upIcon(), h('span', { text: 'Опубликовать .kibgames' }));
      main.onclick = pickGame;
    } else {
      keyState.append(lockIcon('#C4C8CC'), h('span', { text: 'ключ школы закрыт' }));
      main.append(h('span', { text: 'Открыть ключ' }));
      main.onclick = () => openLogin();
    }
    school.onclick = openSchool;
  }

  /* ---------- Экран без школы ---------- */

  function renderSetup() {
    const err = h('p', { class: 'error', role: 'alert' });
    const name = h('input', { class: 'input', id: 'f-name', maxlength: 80, autocomplete: 'off' });
    const pass = h('input', { class: 'input', id: 'f-pass', type: 'password', autocomplete: 'new-password' });
    const again = h('input', { class: 'input', id: 'f-again', type: 'password', autocomplete: 'new-password' });
    const create = h('button', { class: 'btn btn-dark', type: 'submit', text: 'Создать школу' });
    const form = h('form', { class: 'card', 'aria-labelledby': 'h-new' },
      h('h1', { id: 'h-new', text: 'Новая школа' }),
      h('p', { class: 'small', text: 'Программа создаст ключ школы. Им подписывается каталог игр, ноутбуки учеников доверяют только ему. На диске ключ хранится только зашифрованным паролем.' }),
      h('label', { class: 'field' }, h('span', { text: 'Название школы' }), name),
      h('label', { class: 'field' }, h('span', { text: 'Пароль тьютора, не меньше 10 знаков' }), pass),
      h('label', { class: 'field' }, h('span', { text: 'Пароль ещё раз' }), again),
      err, h('div', { class: 'modal-buttons' }, create),
      h('p', { class: 'small', text: 'Пароль вводится только на этом ноутбуке. На ноутбуках учеников пароль тьютора не вводится никогда.' }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setText(err, '');
      const r = await call(() => api.createSchool(name.value, pass.value, again.value), { errorEl: err });
      if (r && r.ok) { pass.value = ''; again.value = ''; afterCode = true; renderCode(r.recoveryCode); renderHeader(); }
    });
    const restoreErr = h('p', { class: 'error', role: 'alert' });
    const restore = h('section', { class: 'card card-narrow', 'aria-labelledby': 'h-restore' },
      h('h2', { id: 'h-restore', text: 'Второй тьютор' }),
      h('p', { class: 'small', text: 'Если школа уже создана на другом ноутбуке, восстановите её из резервной копии: папки с файлами school-key.enc и school.kibschool. Войти можно будет паролем той школы.' }),
      restoreErr,
      h('div', { class: 'modal-buttons' }, h('button', { class: 'btn', type: 'button', text: 'Восстановить из копии', onclick: async () => {
        const r = await call(() => api.restoreSchool(), { errorEl: restoreErr });
        if (r && r.ok) { toast('Школа восстановлена. Войдите паролем школы'); render(); openLogin(); }
      } })));
    clear(screen);
    screen.append(h('div', { class: 'center' }, form, restore));
    name.focus();
  }

  function renderCode(code) {
    const ok = h('input', { type: 'checkbox', id: 'f-wrote' });
    const done = h('button', { class: 'btn btn-dark', type: 'button', text: 'Готово', disabled: true, onclick: () => { afterCode = false; render(); toast('Школа создана, ключ открыт'); } });
    ok.addEventListener('change', () => { done.disabled = !ok.checked; });
    clear(screen);
    screen.append(h('div', { class: 'center' }, h('section', { class: 'card', 'aria-labelledby': 'h-code' },
      h('h1', { id: 'h-code', text: 'Код восстановления' }),
      h('div', { class: 'code', text: code }),
      h('p', { class: 'small', text: 'Запишите код на бумагу и храните не в классе. Если пароль забыт, код откроет ключ школы и позволит задать новый пароль. Больше программа этот код не покажет.' }),
      h('p', { class: 'small', text: 'Потеряны и пароль, и код — школу придётся создать заново и настроить все ноутбуки учеников.' }),
      h('label', { class: 'check' }, ok, h('span', { text: 'Я записал код на бумагу' })),
      h('div', { class: 'modal-buttons' }, done))));
    ok.focus();
  }

  /* ---------- Главный экран ---------- */

  function ratingCell(rating) {
    const cell = h('span', { class: 'cell-rating' });
    if (!rating.n) cell.append(h('span', { class: 'num', text: '—' }));
    else if (rating.few) cell.append(h('span', { class: 'num', text: `мало · ${rating.n}` }));
    else cell.append(stars(rating.avg, 12), h('span', { class: 'num', text: rating.avg.toFixed(1) }));
    return cell;
  }

  function renderMain() {
    const games = state.games;
    if (!games.some((g) => g.id === selected)) selected = games.length ? games[0].id : null;
    const game = games.find((g) => g.id === selected) || null;

    const rows = h('div', { class: 'table-rows' });
    if (!games.length) rows.append(h('p', { class: 'empty-row', text: 'В каталоге пока нет игр. Нажмите «Опубликовать .kibgames» и выберите файл игры.' }));
    for (const g of games) {
      rows.append(h('button', {
        class: 'row row-game', type: 'button', 'aria-pressed': String(g.id === selected), 'data-id': g.id,
        onclick: () => { selected = g.id; renderMain(); const b = screen.querySelector(`[data-id="${CSS.escape(g.id)}"]`); if (b) b.focus(); },
      },
      h('span', { class: 'cell-title', text: g.title }),
      h('span', { class: 'cell-age', text: ageText(g) }),
      h('span', { class: 'cell', text: g.author || 'автор не в списке' }),
      ratingCell(g.rating),
      h('span', {}, h('span', { class: 'badge', text: g.lesson ? 'на занятии' : 'в каталоге' }))));
    }
    const table = h('div', { class: 'plate plate-shadow table' },
      h('div', { class: 'row row-head', 'aria-hidden': 'true' }, ...['ИГРА', 'ВОЗРАСТ', 'АВТОР', 'РЕЙТИНГ', 'СТАТУС'].map((t) => h('span', { text: t }))),
      rows);

    const col = h('div', { class: 'col' });
    if (state.catalogError) col.append(h('div', { class: 'alert-plate', role: 'alert', text: state.catalogError }));
    col.append(servePanel());
    col.append(table);
    if (game) col.append(actionsFor(game));
    col.append(h('div', { class: 'plate info' },
      h('span', { class: 'label', text: 'КАРТИНКИ В .kibgames' }),
      h('p', { class: 'small', text: 'Обложку игры и каждого режима автор кладёт прямо в файл: только PNG или WebP до 512 КБ. JPEG не принимаем: в нём часто остаются GPS-координаты из фото.' }),
      h('p', { class: 'small', text: 'При публикации картинки уходят в каталог отдельно, поэтому дети видят обложку ещё до того, как скачалась игра.' }),
      state.seq ? h('p', { class: 'small mono', text: `Каталог № ${state.seq} подписан ключом школы.` }) : null));

    clear(screen);
    screen.append(h('div', { class: 'main' }, col, ratingsPanel(game)));
  }

  /* Раздача ученикам (М2): выключена при каждом запуске, сеть выбирает тьютор. */
  let serveChoice = null;
  function servePanel() {
    const serve = state.serve;
    // Одна строка: на 1366 × 768 под плашкой должна остаться таблица игр
    const box = h('div', { class: 'plate serve', role: 'group', 'aria-label': 'Раздача ученикам' },
      h('span', { class: 'label', text: 'РАЗДАЧА УЧЕНИКАМ' }));
    if (serve.on) {
      box.append(
        h('span', { class: 'badge badge-on', text: 'включена' }),
        h('span', { class: 'small', text: serve.name }),
        h('span', { class: 'address', title: 'Адрес для учеников', text: serve.address }),
        h('button', { class: 'btn push', type: 'button', text: 'Выключить раздачу', onclick: async () => {
          const res = await call(() => api.stopServer());
          if (res && res.ok) { render(); toast('Раздача выключена'); }
        } }));
      return box;
    }
    const nets = state.interfaces;
    if (!nets.length) {
      box.append(h('span', { class: 'small', text: 'Не нашёл школьную сеть. Подключите ноутбук к Wi-Fi или кабелю. VPN школьной сетью не считается.' }),
        h('button', { class: 'btn push', type: 'button', text: 'Проверить снова', onclick: async () => { state = await api.state(); render(); } }));
      return box;
    }
    if (!nets.some((n) => n.name === serveChoice)) serveChoice = nets[0].name;
    box.append(h('span', { class: 'small', text: 'выключена · сеть класса:' }));
    for (const n of nets) {
      box.append(h('button', {
        class: 'btn btn-net', type: 'button', 'aria-pressed': String(n.name === serveChoice),
        onclick: () => { serveChoice = n.name; render(); const btn = screen.querySelector('.btn-net[aria-pressed="true"]'); if (btn) btn.focus(); },
      }, h('span', { text: n.name }), h('span', { class: 'mono', text: n.address })));
    }
    box.append(
      h('button', { class: 'btn btn-dark push', type: 'button', text: 'Включить раздачу', onclick: async () => {
        const res = await call(() => api.startServer(serveChoice));
        if (res && res.ok) { render(); toast(`Раздача включена. Адрес для учеников: ${res.state.serve.address}`); }
      } }),
      h('span', { class: 'small serve-hint', text: 'Если Windows спросит про доступ к сети, отметьте сеть, к которой подключены, и нажмите «Разрешить».' }));
    if (serve.error) box.append(h('p', { class: 'error serve-hint', role: 'alert', text: serve.error }));
    return box;
  }


  function actionsFor(game) {
    const locked = !state.unlocked;
    const box = h('div', { class: 'plate actions', role: 'group', 'aria-label': `Действия: ${game.title}` });
    box.append(h('span', { class: 'actions-title', text: `${game.title.toUpperCase()} · ВЕРСИЯ ${game.version}` }));
    const tryLabel = (m) => (game.modes.length > 1 ? `Пробный запуск: ${m.title}` : 'Пробный запуск');
    for (const m of game.modes) {
      box.append(h('button', { class: 'btn', type: 'button', text: tryLabel(m), onclick: () => call(() => api.tryGame('catalog', game.id, m.id)) }));
    }
    box.append(h('button', {
      class: 'btn push', type: 'button', 'aria-pressed': String(game.lesson), text: 'На этом занятии', title: locked ? 'Нужен вход по паролю' : null,
      onclick: async () => {
        if (!state.unlocked) { openLogin(); return; }
        const r = await call(() => api.setLesson(game.id, !game.lesson));
        if (r && r.ok) { render(); focusAction('На этом занятии'); }
      },
    }));
    box.append(h('button', { class: 'btn', type: 'button', text: 'Снять', onclick: () => (state.unlocked ? confirmUnpublish(game) : openLogin()) }));
    return box;
  }
  const focusAction = (text) => { const b = [...screen.querySelectorAll('.actions .btn')].find((x) => x.textContent === text); if (b) b.focus(); };

  function ratingsPanel(game) {
    const aside = h('aside', { class: 'plate plate-shadow aside', 'aria-labelledby': 'h-ratings' });
    aside.append(h('div', {}, h('h2', { id: 'h-ratings', text: 'Оценки за занятие' }),
      h('span', { class: 'sub', text: game ? `${game.title} · всего · ${votes(game.rating.n)}` : 'выберите игру в таблице' })));
    if (game) {
      for (const m of game.modes) {
        const r = m.rating;
        const head = h('div', { class: 'mode-head' }, h('span', { class: 'mode-title', text: m.title }));
        if (r.n && !r.few) head.append(stars(r.avg, 14), h('span', { class: 'num', text: r.avg.toFixed(1) }));
        else if (r.n) head.append(h('span', { class: 'num', text: 'мало оценок' }));
        head.append(h('span', { class: 'mode-count', text: votes(r.n) }));
        const block = h('div', { class: 'mode' }, head);
        for (const s of [5, 4, 3, 2, 1]) {
          const n = m.counts[String(s)];
          const pct = r.n ? Math.round((n / r.n) * 100) : 0;
          const fill = h('span', { class: 'bar-fill' });
          fill.style.width = `${pct}%`;
          fill.style.background = BAR_FILL[s];
          block.append(h('div', { class: 'bar', 'aria-label': `${s} ${plural(s, 'звезда', 'звезды', 'звёзд')}: ${n}` },
            h('span', { class: 'bar-star', 'aria-hidden': 'true' }, h('span', { text: String(s) }), starIcon('full', 10)),
            h('span', { class: 'bar-track', 'aria-hidden': 'true' }, fill),
            h('span', { class: 'bar-n', 'aria-hidden': 'true', text: String(n) })));
        }
        aside.append(block);
      }
    }
    aside.append(h('p', { class: 'aside-note', text: 'Оценки без имён и ников. Ученик оценивает режим, в который сыграл, не чаще раза в день с ноутбука. С ноутбуков учеников оценки пока не приходят: отправка оценок по сети — следующий этап.' }));
    return aside;
  }

  function render() {
    if (!state) return;
    renderHeader();
    if (afterCode) return;
    if (!state.school) {
      if (state.schoolError) {
        clear(screen);
        screen.append(h('div', { class: 'center' }, h('section', { class: 'card', role: 'alert' }, h('h1', { text: 'Файлы школы повреждены' }), h('p', { class: 'small', text: state.schoolError }))));
        return;
      }
      renderSetup();
      return;
    }
    renderMain();
  }

  /* ---------- Окна поверх экрана ---------- */

  function openModal(content, { label, onClose, cover } = {}) {
    closeModal(true);
    const close = h('button', { class: 'btn-x', type: 'button', 'aria-label': 'Закрыть', onclick: () => closeModal() }, closeIcon());
    const el = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': label });
    el.append(close);
    if (cover) el.append(h('div', { class: 'modal-cover' }, h('img', { src: `kibtutor://cover/${cover}`, alt: '' })));
    el.append(h('div', { class: 'modal-body' }, content));
    modal = { el, returnFocus: document.activeElement, onClose };
    clear(overlay);
    overlay.append(el);
    overlay.hidden = false;
    const first = el.querySelector('input, .modal-body button:not(:disabled)') || close;
    first.focus();
    return el;
  }
  function closeModal(silent = false) {
    if (!modal) return;
    const { returnFocus, onClose } = modal;
    modal = null;
    overlay.hidden = true;
    clear(overlay);
    if (onClose && !silent) onClose();
    if (returnFocus && document.contains(returnFocus) && !silent) returnFocus.focus();
  }
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (!modal) return;
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
    if (e.key !== 'Tab') return;
    const list = [...modal.el.querySelectorAll('button, input, [href]')].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (!modal.el.contains(document.activeElement)) { e.preventDefault(); first.focus(); } else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* Вход по паролю и восстановление кодом */
  let waitTimer = null;
  function openLogin() {
    const err = h('p', { class: 'error', role: 'alert' });
    const pass = h('input', { class: 'input', type: 'password', id: 'f-login', autocomplete: 'current-password' });
    const submit = h('button', { class: 'btn btn-dark', type: 'submit', text: 'Открыть ключ' });
    const showWait = (seconds) => {
      clearInterval(waitTimer);
      let left = seconds;
      const tick = () => {
        if (left <= 0) { clearInterval(waitTimer); submit.disabled = false; setText(err, err.dataset.base || ''); return; }
        submit.disabled = true;
        setText(err, `${err.dataset.base ? `${err.dataset.base}. ` : ''}Следующая попытка через ${left} с`);
        left -= 1;
      };
      tick();
      waitTimer = setInterval(tick, 1000);
    };
    const form = h('form', { class: 'field' },
      h('h2', { text: 'Вход' }),
      h('p', { class: 'small', text: `Ключ школы закрыт. Он закрывается сам через ${state.idleMinutes} минут без действий. Отходя от ноутбука, блокируйте Windows: Win+L.` }),
      h('label', { class: 'field' }, h('span', { text: 'Пароль тьютора' }), pass),
      err,
      h('div', { class: 'modal-buttons' }, submit, h('button', { class: 'btn-link push', type: 'button', text: 'Забыли пароль?', onclick: openRecover })));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.dataset.base = '';
      setText(err, '');
      const r = await call(() => api.unlock(pass.value), { errorEl: err });
      pass.value = '';
      if (r && r.ok) { clearInterval(waitTimer); closeModal(true); render(); toast('Ключ школы открыт'); $('btn-main').focus(); return; }
      if (r && r.wait) { err.dataset.base = r.code === 'wrong' ? r.error : ''; showWait(r.wait); }
    });
    openModal(form, { label: 'Вход', onClose: () => clearInterval(waitTimer) });
    if (state.wait) showWait(state.wait);
  }

  function openRecover() {
    const err = h('p', { class: 'error', role: 'alert' });
    const code = h('input', { class: 'input input-code', id: 'f-code', autocomplete: 'off', spellcheck: 'false', maxlength: 40 });
    const pass = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
    const again = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
    const form = h('form', { class: 'field' },
      h('h2', { text: 'Восстановление' }),
      h('p', { class: 'small', text: 'Введите код восстановления с бумаги и задайте новый пароль. Старый пароль после этого перестанет подходить.' }),
      h('label', { class: 'field' }, h('span', { text: 'Код восстановления, 26 знаков' }), code),
      h('label', { class: 'field' }, h('span', { text: 'Новый пароль, не меньше 10 знаков' }), pass),
      h('label', { class: 'field' }, h('span', { text: 'Новый пароль ещё раз' }), again),
      err,
      h('div', { class: 'modal-buttons' }, h('button', { class: 'btn btn-dark', type: 'submit', text: 'Восстановить' })));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setText(err, '');
      const r = await call(() => api.recover(code.value, pass.value, again.value), { errorEl: err });
      if (r && r.ok) { code.value = ''; pass.value = ''; again.value = ''; closeModal(true); render(); toast('Новый пароль задан, ключ школы открыт'); }
    });
    openModal(form, { label: 'Восстановление' });
  }

  /* Школа: отпечаток, файл для ноутбуков учеников, резервная копия */
  function openSchool() {
    const err = h('p', { class: 'error', role: 'alert' });
    const content = h('div', { class: 'field' },
      h('h2', { text: state.school.name }),
      h('span', { class: 'label', text: 'ОТПЕЧАТОК КЛЮЧА ШКОЛЫ' }),
      h('span', { class: 'fp', text: state.school.fingerprint }),
      h('p', { class: 'small', text: 'Тот же отпечаток покажет программа ученика после настройки ноутбука. Сверьте его.' }),
      h('p', { class: 'small', text: 'Файл school.kibschool содержит только открытый ключ школы, секрета в нём нет. Его установщик кладёт на ноутбуки учеников.' }),
      h('p', { class: 'small', text: 'Резервная копия — папка с зашифрованным ключом и файлом школы. Она нужна второму тьютору и на случай поломки ноутбука. Открыть её можно только паролем школы.' }),
      err,
      h('div', { class: 'modal-buttons' },
        h('button', { class: 'btn', type: 'button', text: 'Сохранить school.kibschool', onclick: async () => {
          const r = await call(() => api.saveSchoolFile(), { errorEl: err });
          if (r && r.ok) toast('Файл школы сохранён');
        } }),
        h('button', { class: 'btn', type: 'button', text: 'Резервная копия', onclick: async () => {
          if (!state.unlocked) { openLogin(); return; }
          const r = await call(() => api.backup(), { errorEl: err });
          if (r && r.ok) toast(`Резервная копия сохранена в папку ${r.folder}`);
        } }),
        state.unlocked ? h('button', { class: 'btn btn-dark', type: 'button', text: 'Закрыть ключ', onclick: async () => {
          const r = await call(() => api.lock());
          if (r && r.ok) { closeModal(true); render(); toast('Ключ школы закрыт'); $('btn-main').focus(); }
        } }) : null));
    openModal(content, { label: 'Школа' });
  }

  function confirmUnpublish(game) {
    const content = h('div', { class: 'field' },
      h('h2', { text: `Снять «${game.title}»?` }),
      h('p', { class: 'small', text: 'Ученики больше не увидят игру. Файл игры удалится с этого ноутбука, оценки останутся. Вернуть игру можно, опубликовав файл снова.' }),
      h('div', { class: 'modal-buttons' },
        h('button', { class: 'btn', type: 'button', text: 'Отмена', onclick: () => closeModal() }),
        h('button', { class: 'btn btn-dark', type: 'button', text: 'Снять', onclick: async () => {
          const r = await call(() => api.unpublish(game.id));
          if (r && r.ok) { closeModal(true); render(); toast(`«${game.title}» снята с каталога`); }
        } })));
    openModal(content, { label: 'Снять игру' });
  }

  /* Проверка выбранного файла перед публикацией */
  async function pickGame() {
    if (!state.unlocked) { openLogin(); return; }
    const r = await call(() => api.pickGame());
    if (!r || !r.ok) return;
    const g = r.game;
    const err = h('p', { class: 'error', role: 'alert' });
    const publishBtn = h('button', { class: 'btn btn-dark', type: 'button', text: 'Опубликовать' });
    const checks = [];
    const content = h('div', { class: 'field' });
    content.append(h('span', { class: 'label', text: g.replace ? 'ЗАМЕНА ИГРЫ ДРУГОГО АВТОРА' : g.update ? 'НОВАЯ ВЕРСИЯ ИГРЫ' : 'НОВАЯ ИГРА' }),
      h('h2', { text: g.title }),
      h('span', { class: 'meta', text: `${g.grades} · ${g.minutes} мин · ${g.topic} · версия ${g.version}` }),
      h('p', { class: 'about', text: g.description }));
    const facts = h('dl', { class: 'facts' });
    const fact = (term, value) => facts.append(h('dt', { text: term }), h('dd', { text: value }));
    fact('АВТОР НАЗЫВАЕТ СЕБЯ', g.claimedAuthors.join(', '));
    fact('ОТПЕЧАТОК КЛЮЧА', g.authorKey.match(/.{4}/g).join(' '));
    fact('СПИСОК ДОВЕРИЯ', g.unknownAuthor ? 'автора в нём нет' : g.trustedName);
    fact('РЕЖИМЫ', g.modes.map((m) => m.title).join(', '));
    fact('РАЗМЕР', `${Math.max(1, Math.round(g.bytes / 1024))} КБ`);
    if (g.update) fact('В КАТАЛОГЕ СЕЙЧАС', `версия ${g.replaced.version}`);
    content.append(facts);

    let trustInput = null;
    if (g.warnings.includes('unknown')) {
      const box = h('input', { type: 'checkbox' });
      trustInput = h('input', { class: 'input', maxlength: 80, autocomplete: 'off' });
      checks.push(box);
      content.append(h('div', { class: 'warn' },
        h('span', { class: 'warn-title', text: 'Автор неизвестен школе' }),
        h('p', { class: 'small', text: 'Подпись доказывает только то, что файл не менялся после автора. Имя в файле может быть любым. Перед публикацией сделайте пробный запуск.' }),
        h('label', { class: 'check' }, box, h('span', { text: 'Публикую игру неизвестного автора' })),
        h('label', { class: 'field' }, h('span', { text: 'Внести автора в список доверия под именем (можно оставить пустым)' }), trustInput)));
    }
    if (g.warnings.includes('replace')) {
      const box = h('input', { type: 'checkbox' });
      checks.push(box);
      content.append(h('div', { class: 'warn' },
        h('span', { class: 'warn-title', text: 'Игра с таким id уже есть у другого автора' }),
        h('p', { class: 'small', text: `В каталоге «${g.id}» версии ${g.replaced.version}, автор ${g.replaced.author || 'не в списке'}, отпечаток ${g.replaced.authorKey.match(/.{4}/g).join(' ')}. Новый файл подписан другим ключом: это может быть самозванец. Публикация заменит игру у всех учеников.` }),
        h('label', { class: 'check' }, box, h('span', { text: 'Заменить игру другого автора' }))));
    }
    if (g.warnings.includes('app-version')) content.append(h('div', { class: 'warn' }, h('span', { class: 'warn-title', text: `Игре нужна программа ученика ${g.minAppVersion} или новее` }), h('p', { class: 'small', text: 'На ноутбуках со старой программой игра не откроется.' })));
    if (g.warnings.includes('icon')) content.append(h('p', { class: 'small', text: 'Файл icon.png не PNG до 64 КБ, значка у игры не будет.' }));

    const sync = () => { publishBtn.disabled = checks.some((c) => !c.checked); };
    for (const c of checks) c.addEventListener('change', sync);
    sync();
    publishBtn.addEventListener('click', async () => {
      setText(err, '');
      const unknown = g.warnings.includes('unknown');
      const replace = g.warnings.includes('replace');
      const res = await call(() => api.publish(g.token, unknown && checks[0].checked, replace && checks[checks.length - 1].checked, trustInput ? trustInput.value : ''), { errorEl: err });
      if (res && res.ok) { selected = res.id; closeModal(true); render(); toast(`«${g.title}» в каталоге`); }
    });
    const buttons = h('div', { class: 'modal-buttons' });
    for (const m of g.modes) buttons.append(h('button', { class: 'btn', type: 'button', text: g.modes.length > 1 ? `Пробный запуск: ${m.title}` : 'Пробный запуск', onclick: () => call(() => api.tryGame('pending', g.token, m.id), { errorEl: err }) }));
    buttons.append(h('button', { class: 'btn push', type: 'button', text: 'Отмена', onclick: () => closeModal() }), publishBtn);
    content.append(err, buttons);
    openModal(content, { label: `Проверка файла: ${g.title}`, cover: g.cover, onClose: () => { api.cancel(g.token); } });
  }

  /* ---------- Старт ---------- */

  api.onLocked(() => {
    closeModal(true);
    if (!state) return;
    state.unlocked = false;
    render();
    toast(`Ключ школы закрыт: ${state.idleMinutes} минут без действий`);
  });

  (async () => {
    state = await api.state();
    render();
    document.documentElement.dataset.ready = 'true';
  })();
})();
