'use strict';
/* Группы школы (claude/как-веду-занятия.md): младшая — дошкольники и 1–3 класс, средняя — 4–5 класс, старшая — 6 класс и старше.
   Берутся из поля grades, другого источника в формате пока нет. Не распознали — игра видна только во «Все». */
function groupsOf(grades) {
  const g = grades.toLowerCase();
  const nums = (g.match(/\d{1,2}/g) || []).map(Number);
  const groups = new Set();
  if (/дошкол/.test(g)) groups.add('junior');
  if (nums.length && /класс/.test(g)) {
    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    if (lo <= 3) groups.add('junior');
    if (lo <= 5 && hi >= 4) groups.add('middle');
    if (hi >= 6) groups.add('senior');
  } else if (nums.length && /(лет|год)/.test(g)) {
    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    if (lo <= 9) groups.add('junior');
    if (lo <= 11 && hi >= 10) groups.add('middle');
    if (hi >= 12) groups.add('senior');
  }
  return ['junior', 'middle', 'senior'].filter((x) => groups.has(x));
}

module.exports = { groupsOf };
