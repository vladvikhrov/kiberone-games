'use strict';
/* Заставка при запуске (этап М5): знак K1, короткая подсказка, что делать, и полоса загрузки на 3 с.
   Загрузка выдуманная: каталог грузится сам, заставка ничего не ждёт. Убирается сама, по щелчку и по любой клавише.
   Текст заставки задан в index.html, из каталога сюда ничего не попадает. */
(() => {
  const splash = document.getElementById('splash');
  if (!splash) return;
  const label = document.getElementById('splash-step');
  const steps = (splash.dataset.steps || '').split('|').filter(Boolean);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TOTAL_MS = 3000;
  const timers = [];
  let gone = false;

  function hide(e) {
    // Первая клавиша только убирает заставку: Enter не должен заодно открыть карточку под ней
    if (e && e.type === 'keydown') { e.preventDefault(); e.stopPropagation(); }
    if (gone) return;
    gone = true;
    timers.forEach(clearTimeout);
    document.removeEventListener('keydown', hide, true);
    if (reduced) { splash.remove(); return; }
    splash.classList.add('splash-out');
    setTimeout(() => splash.remove(), 150);
  }

  steps.forEach((text, i) => {
    timers.push(setTimeout(() => { label.textContent = text; }, (TOTAL_MS / steps.length) * i));
  });
  if (!reduced) requestAnimationFrame(() => requestAnimationFrame(() => splash.classList.add('splash-run')));
  else splash.classList.add('splash-run');
  timers.push(setTimeout(hide, TOTAL_MS + 300));
  splash.addEventListener('click', hide);
  document.addEventListener('keydown', hide, true);
})();
