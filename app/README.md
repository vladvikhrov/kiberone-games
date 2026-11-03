# Игры KIBERone: приложение

Открывается на витрину «K1 Игры» (этап В0: игры из папки, без сети) и запускает игры из файлов `.kibgames` в песочнице: без сети, без доступа к файлам и устройствам, без следов на диске. Архитектура: `../docs/adr/0001-prilozhenie-kibgames.md`, витрина: `../docs/adr/0003-vitrina.md`.

Нужен Node 22.12 или новее.

| Команда | Что делает |
| --- | --- |
| `npm ci` | Ставит зависимости |
| `npm test` | Модульные тесты: формат `.kibgames`, обложки и режимы, оценки, IPC и стиль витрины |
| `npm run test:redteam` | Тест-«взломщик» на Linux с захватом трафика: К1–К14, К23 и проверки витрины В3–В5, В9, В11, В12 |
| `npm run dev-catalog` | Собирает Киберпочту, Сейф и тестовую игру с режимами в папку игр витрины и вносит ключ разработки в список доверия |
| `npx electron .` | Витрина из исходников. Своя папка игр: `npx electron . --catalog=папка` |
| `npm run shots:vitrina` | Снимки витрины 1366×768 и 1920×1080 в `../docs/img/` |
| `python3 scripts/make-covers.py` | Перерисовывает обложки Киберпочты, Сейфа и тестовой игры (нужен Pillow) |
| `node redteam/run.js --portable` | Тот же тест на Windows, без захвата трафика (К4) |
| `npx electron . игра.kibgames` | Запускает игру из исходников |
| `npm run build:win-dir` | Собирает папку для Windows `dist/win-unpacked`, можно на Linux |
| `npm run build:win` | Собирает установщик. Нужна Windows или Wine, см. `../.github/workflows/build-windows.yml` |
| `node scripts/make-test-kit.js` | Собирает комплект для проверки на Windows |

## Как выпустить игру

В папке игры должен лежать `kibgame.json` (пример: `../games/kiberpochta/kibgame.json`).

```bash
npm run kibpack -- keygen vlad
npm run kibpack -- pack ../games/kiberpochta --key ~/.config/kibgames/keys/vlad.key.pem
npm run kibpack -- verify kiberpochta-1.0.0.kibgames
```

Обложка и режимы в `kibgame.json` необязательны, пути пишутся от папки игры:

```json
"cover": "cover.png",
"modes": [
  { "id": "training", "title": "Тренировка", "about": "С подсказками", "cover": "cover-training.png" },
  { "id": "exam", "title": "Экзамен", "entry": "exam.html" }
]
```

Обложка только PNG или WebP до 512 КБ, лучше 1280 × 800. Окно игры показывает её полосой 3 : 1 по центру, поэтому главное держите в полосе от 200 до 600 px по высоте. Режимов от 1 до 12, `id` латиницей, цифрами и дефисом. Режим получает свой `id` в адресе страницы: `?mode=training`. Пример: `testgames/tri-rezhima/`.

Закрытый ключ нельзя никому передавать и класть в репозиторий. При его потере обновления игр придётся ставить как новые игры, поэтому сделайте резервную копию.

Школа отмечает авторов, которым доверяет, в файле `%APPDATA%\Игры KIBERone\trusted-keys.json`: `{ "отпечаток ключа": "Имя" }`. Отпечаток показывает `kibpack verify`. Игры остальных авторов запускаются только после предупреждения.

## Витрина

Без файла в аргументах приложение открывает витрину. Игры берутся из `%APPDATA%\Игры KIBERone\games\`, каждая проверяется так же, как при запуске файла. Игры авторов не из `trusted-keys.json` видны с меткой «автор не проверен», запустить их с витрины нельзя. Оценки пишутся в `ratings.json`, отметка «сегодня уже оценил» в `state.json` в той же папке данных.

Код: `desktop/vitrina/` (окно, IPC, каталог, хранилище) и `desktop/vitrina/ui/` (страница, стили, шрифты Golos Text и JetBrains Mono под OFL). Логика оценок: `shared/ratings.js`.
