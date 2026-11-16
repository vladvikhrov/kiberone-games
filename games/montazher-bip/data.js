/* Бип-монтажёр: истории, уровни и тексты. Код в game.js менять не нужно.
   Кусочек видео (клип): hero, place, time, weather, move, cam, fx, items — как в k1video.js. */
window.MB = {
  title: "Бип-монтажёр",
  hello: "Бип оживил картинки. Соберём из них трейлер?",

  /* Истории. Клипы идут в правильном порядке, игра их перемешает. mood — музыка трейлера. */
  stories: {
    flower: { mood: "happy", clips: [
      { place: "forest", items: [{ e: "🌱", x: 50, y: 64, s: 11, m: "sway" }] },
      { place: "forest", weather: "rain", items: [{ e: "🌿", x: 50, y: 58, s: 17, m: "sway" }] },
      { place: "forest", weather: "rainbow", fx: "spark", items: [{ e: "🌻", x: 50, y: 50, s: 26, m: "sway" }] },
    ] },
    chick: { mood: "happy", clips: [
      { place: "castle", items: [{ e: "🥚", x: 50, y: 60, s: 18, m: "sway" }] },
      { place: "castle", items: [{ e: "🐣", x: 50, y: 60, s: 18, m: "jump" }] },
      { place: "castle", fx: "balls", items: [{ e: "🐔", x: 42, y: 54, s: 22, m: "run" }, { e: "🐥", x: 62, y: 64, s: 12, m: "jump" }] },
    ] },
    cat: { mood: "sleepy", clips: [
      { hero: "cat", place: "forest", weather: "rain", move: "run" },
      { hero: "cat", place: "forest", weather: "rainbow", move: "jump", fx: "birds" },
      { hero: "cat", place: "forest", time: "night", move: "sleep" },
    ] },
    snowman: { mood: "happy", clips: [
      { place: "forest", weather: "snow", items: [{ e: "⚪", x: 50, y: 70, s: 8, m: "run" }] },
      { place: "forest", weather: "snow", items: [{ e: "⚪", x: 50, y: 64, s: 15 }, { e: "⚪", x: 50, y: 48, s: 11, m: "jump" }] },
      { place: "forest", weather: "snow", cam: "zoom", items: [{ e: "⛄", x: 50, y: 50, s: 28, m: "sway" }] },
    ] },
    rocket: { mood: "space", clips: [
      { place: "city", items: [{ e: "🚀", x: 50, y: 58, s: 18, r: -45, m: "sway" }] },
      { place: "city", cam: "pan", items: [{ e: "🚀", x: 50, y: 24, s: 16, r: -45, m: "fly" }, { e: "💨", x: 50, y: 48, s: 13 }] },
      { place: "space", fx: "spark", items: [{ e: "🚀", x: 40, y: 40, s: 16, r: 45, m: "fly" }] },
      { place: "space", items: [{ e: "🚀", x: 30, y: 58, s: 14, r: -45 }, { e: "👽", x: 62, y: 56, s: 18, m: "jump" }] },
    ] },
    dragon: { mood: "hero", clips: [
      { place: "castle", items: [{ e: "🥚", x: 50, y: 60, s: 16, m: "sway" }] },
      { place: "castle", items: [{ e: "🐲", x: 50, y: 58, s: 16, m: "jump" }] },
      { hero: "dragon", place: "castle", move: "run", cam: "pan" },
      { hero: "dragon", place: "castle", time: "night", move: "spin", fx: "spark" },
    ] },
  },

  /* «По порядку»: истории по уровням. fixFirst — первый кусочек уже стоит на месте. */
  order: [
    { story: "flower", fixFirst: true },
    { story: "chick", fixFirst: true },
    { story: "cat", fixFirst: true },
    { story: "snowman" },
    { story: "rocket" },
    { story: "dragon" },
  ],

  /* «Лишний кусочек»: в историю story попал чужой клип [история, номер клипа]. */
  cut: [
    { story: "flower", odd: ["rocket", 0] },
    { story: "chick", odd: ["cat", 1] },
    { story: "snowman", odd: ["dragon", 2] },
    { story: "rocket", odd: ["flower", 2] },
    { story: "dragon", odd: ["chick", 2] },
  ],

  /* «Мой трейлер»: из чего выбирать */
  pool: [
    { hero: "cat", place: "forest", move: "jump", fx: "leaves" },
    { hero: "dog", place: "sea", move: "run", fx: "birds" },
    { hero: "dragon", place: "castle", time: "night", move: "spin", fx: "spark" },
    { hero: "car", place: "city", move: "run", cam: "pan" },
    { hero: "unicorn", place: "space", move: "jump", fx: "spark" },
    { hero: "dino", place: "desert", move: "run", cam: "zoom" },
    { place: "space", items: [{ e: "🚀", x: 40, y: 40, s: 16, r: 45, m: "fly" }], fx: "spark" },
    { hero: "cat", place: "castle", weather: "rainbow", move: "sleep", fx: "balls" },
  ],
  moods: [
    { id: "happy", e: "😄" },
    { id: "scary", e: "👻" },
    { id: "space", e: "🪐" },
    { id: "hero",  e: "🦸" },
  ],

  /* Теория: подписи читает тьютор, dur — сколько длится кадр, мс. */
  theory: [
    { caption: "Бип оживил картинки. Получились короткие видео!", dur: 6000 },
    { caption: "Трейлер — это маленькое кино из лучших кусочков.", dur: 7000 },
    { caption: "Монтаж: ставим кусочки по порядку.", dur: 7500 },
    { caption: "Лишний кусочек убираем. Трейлер короткий!", dur: 6500 },
    { caption: "Добавим музыку — и трейлер готов!", dur: 9500 },
  ],
  intro: {
    order: { caption: "Поставь кусочки по порядку!", dur: 5000 },
    cut:   { caption: "Один кусочек лишний. Убери его!", dur: 5000 },
    mine:  { caption: "Собери свой трейлер: кусочки, музыка, экран.", dur: 6000 },
  },
};
