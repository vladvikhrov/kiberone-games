/* Оживи картинку: уровни и тексты. Код в game.js менять не нужно.
   Движения, камера и «вокруг» лежат в k1video.js, герои и места — в k1world.js. */
window.OK = {
  title: "Оживи картинку",
  hello: "Бип умеет оживлять картинки. Попробуем?",

  /* «Как в мультике»: какие карточки нужны на уровне. move — герой, cam — камера, fx — вокруг. */
  match: [
    ["move"],
    ["move"],
    ["move", "cam"],
    ["move", "cam"],
    ["move", "cam", "fx"],
    ["move", "cam", "fx"],
  ],

  /* «Кадры»: мультик из картинок. Первый кадр уже стоит на месте.
     Кадр: sky (цвет неба, если нужен) и items: e — значок, x, y — центр в %, s — размер. */
  frames: [
    { name: "Мяч", place: "forest", frames: [
      { items: [{ e: "⚽", x: 50, y: 14, s: 13 }] },
      { items: [{ e: "⚽", x: 50, y: 38, s: 13 }] },
      { items: [{ e: "⚽", x: 50, y: 62, s: 13 }] },
    ] },
    { name: "Рассвет", place: "sea", noSun: true, frames: [
      { sky: "#2E3561", items: [{ e: "☀️", x: 50, y: 62, s: 16 }] },
      { sky: "#F4A46A", items: [{ e: "☀️", x: 50, y: 38, s: 16 }] },
      { sky: "#9ED8FF", items: [{ e: "☀️", x: 50, y: 14, s: 16 }] },
    ] },
    { name: "Цветок", place: "forest", frames: [
      { items: [{ e: "🌰", x: 50, y: 70, s: 8 }] },
      { items: [{ e: "🌱", x: 50, y: 64, s: 11 }] },
      { items: [{ e: "🌿", x: 50, y: 58, s: 16 }] },
      { items: [{ e: "🌻", x: 50, y: 50, s: 24 }] },
    ] },
    { name: "Цыплёнок", place: "castle", frames: [
      { items: [{ e: "🥚", x: 50, y: 60, s: 16 }] },
      { items: [{ e: "🐣", x: 50, y: 60, s: 16 }] },
      { items: [{ e: "🐥", x: 50, y: 60, s: 16 }] },
      { items: [{ e: "🐔", x: 50, y: 54, s: 24 }] },
    ] },
    { name: "Ракета", place: "city", frames: [
      { items: [{ e: "🚀", x: 50, y: 60, s: 16, r: -45 }] },
      { items: [{ e: "🚀", x: 50, y: 42, s: 16, r: -45 }, { e: "💨", x: 50, y: 64, s: 12 }] },
      { items: [{ e: "🚀", x: 50, y: 24, s: 16, r: -45 }, { e: "💨", x: 50, y: 46, s: 12 }] },
      { items: [{ e: "🚀", x: 50, y: 8, s: 12, r: -45 }, { e: "💨", x: 50, y: 26, s: 10 }] },
    ] },
    { name: "Снеговик", place: "forest", weather: "snow", frames: [
      { items: [{ e: "⚪", x: 50, y: 70, s: 7 }] },
      { items: [{ e: "⚪", x: 50, y: 64, s: 15 }] },
      { items: [{ e: "⚪", x: 50, y: 64, s: 15 }, { e: "⚪", x: 50, y: 48, s: 11 }] },
      { items: [{ e: "⚪", x: 50, y: 64, s: 15 }, { e: "⚪", x: 50, y: 48, s: 11 }, { e: "⚪", x: 50, y: 36, s: 8 }] },
      { items: [{ e: "⛄", x: 50, y: 50, s: 28 }] },
    ] },
  ],

  /* «Найди ошибку»: Бип оживил картинку, но через пару секунд в видео что-то ломается.
     kind: twin — появился двойник, moon — луна днём, odd — лишний предмет e в небе,
     morph — герой превратился в to, walk — дерево или дом пошли гулять. */
  glitch: [
    { kind: "twin",  req: { hero: "cat", place: "forest", time: "day", weather: "clear", move: "jump" } },
    { kind: "moon",  req: { hero: "dog", place: "sea", time: "day", weather: "clear", move: "run" } },
    { kind: "odd",   e: "🐟", req: { hero: "unicorn", place: "desert", time: "day", weather: "clear", move: "jump" } },
    { kind: "morph", to: "🐸", req: { hero: "dragon", place: "castle", time: "day", weather: "rainbow", move: "run" } },
    { kind: "walk",  req: { hero: "car", place: "city", time: "day", weather: "clear", move: "jump" } },
    { kind: "odd",   e: "🌲", req: { hero: "dino", place: "space", time: "night", weather: "clear", move: "spin" } },
  ],

  /* Теория: подписи читает тьютор, dur — сколько длится кадр, мс. */
  theory: [
    { caption: "Это Бип. Бип умеет оживлять картинки!", dur: 5500 },
    { caption: "Картинка стоит. А видео двигается.", dur: 6500 },
    { caption: "Видео — это много картинок подряд.", dur: 9000 },
    { caption: "Бип сам рисует новые кадры. Картинка оживает!", dur: 7000 },
    { caption: "Можно попросить, как двигаться: прыгать, бегать, крутиться.", dur: 8500 },
    { caption: "Иногда Бип ошибается. Смотри видео внимательно!", dur: 7500 },
  ],
  intro: {
    match:  { caption: "Посмотри мультик. Собери такой же запрос!", dur: 5000 },
    frames: { caption: "Поставь картинки по порядку — получится мультик!", dur: 5500 },
    glitch: { caption: "В видео ошибка. Найди её и нажми!", dur: 5500 },
  },
};
