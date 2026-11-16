/* Голоса героев: голоса, герои, сцены и тексты. Код в game.js менять не нужно.
   Голос: pitch — высота (Гц), speed — скорость, wave — тембр (sine мягкий, triangle обычный,
   square «роботный», sawtooth рычащий), bright — яркость. draw — какую волну рисовать на карточке. */
window.GG = {
  title: "Голоса героев",
  hello: "Герои хотят заговорить. Поможем?",

  voices: {
    high:  { pitch: 900, speed: 1.6, wave: "sine",     bright: 3000, draw: "high" },
    low:   { pitch: 95,  speed: .7,  wave: "sawtooth", bright: 600,  draw: "low" },
    robot: { pitch: 260, speed: 1,   wave: "square",   bright: 1600, wobble: 0, draw: "robot" },
    mid:   { pitch: 330, speed: 1.1, wave: "triangle", bright: 1800, draw: "mid" },
    ghost: { pitch: 500, speed: .6,  wave: "sine",     bright: 900,  wobble: .35, draw: "ghost" },
  },

  /* «Подбери голос»: герой и его голос. Неправильные варианты берутся из других голосов. */
  voiceLevels: [
    { e: "🐭", t: "Мышка",   voice: "high",  line: "Пи-пи! Я маленькая мышка!" },
    { e: "🐻", t: "Медведь", voice: "low",   line: "Я большой медведь. Где мой мёд?" },
    { e: "🤖", t: "Робот",   voice: "robot", line: "Я робот. Включаю программу." },
    { e: "👻", t: "Призрак", voice: "ghost", line: "У-у-у! Я весёлое привидение!" },
    { e: "🐉", t: "Дракон",  voice: "low",   line: "Я дракон! Я охраняю замок!" },
    { e: "🐤", t: "Цыплёнок",voice: "high",  line: "Цып-цып! Я только вылупился!" },
  ],

  /* «Музыка для сцены»: сцена из мира k1world и нужное настроение музыки.
     Настроения: happy весёлая, sad грустная, scary страшная, hero подвиг, sleepy сонная, space космос. */
  musicLevels: [
    { scene: { hero: "unicorn", place: "castle", time: "day", weather: "rainbow" }, mood: "happy", wrong: ["scary", "sad"] },
    { scene: { hero: "dog", place: "city", time: "night", weather: "rain" }, mood: "sad", wrong: ["happy", "hero"] },
    { scene: { hero: "dragon", place: "castle", time: "night", weather: "clear" }, mood: "scary", wrong: ["happy", "sleepy"] },
    { scene: { hero: "car", place: "space", time: "night", weather: "clear" }, mood: "space", wrong: ["sad", "scary"] },
    { scene: { hero: "cat", place: "forest", time: "night", weather: "snow" }, mood: "sleepy", wrong: ["hero", "happy"] },
    { scene: { hero: "dino", place: "desert", time: "day", weather: "clear" }, mood: "hero", wrong: ["sleepy", "sad"] },
  ],
  moodPic: { happy: "😄", sad: "😢", scary: "😱", hero: "💪", sleepy: "😴", space: "🚀" },

  /* «Озвучь комикс»: три кадра истории. Герой подставляется тот, кого выбрал ребёнок. */
  dub: [
    { place: "forest", time: "day",   weather: "clear",   line: "Какой чудесный день! Пойду гулять." },
    { place: "castle", time: "night", weather: "rain",    line: "Ой! Темно и страшно. Кто там?" },
    { place: "sea",    time: "day",   weather: "rainbow", line: "Ура! Я нашёл друзей! Конец!" },
  ],
  dubVoices: ["high", "mid", "low", "robot", "ghost"],
  dubMoods: ["happy", "sad", "scary", "hero", "sleepy"],

  theory: [
    { caption: "Нейросеть умеет говорить!", say: "Нейросеть умеет говорить. Послушай!", dur: 5500 },
    { caption: "Она слушала тысячи голосов.", say: "Чтобы говорить, нейросеть слушала тысячи голосов. Так она научилась.", dur: 7500 },
    { caption: "У каждого героя свой голос.", say: "У каждого героя свой голос: тонкий, низкий, как у робота.", dur: 9000 },
    { caption: "Нейросеть сочиняет музыку.", say: "Нейросеть сочиняет музыку. Весёлую или страшную — как попросишь.", dur: 9000 },
    { caption: "Голос и музыка оживляют историю!", dur: 6500 },
  ],
  intro: {
    voice: { caption: "Послушай голоса. Какой подходит герою?", dur: 5000 },
    music: { caption: "Послушай музыку. Какая подходит к картинке?", dur: 5000 },
    dub:   { caption: "Выбери героя, голос и музыку — и смотри мультик!", dur: 5000 },
  },
};
