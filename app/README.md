# Игры KIBERone: приложение

Из этого кода собираются две программы:

- **«Игры KIBERone»** для учеников: открывается на витрину «K1 Игры» и запускает игры в песочнице: без сети, без доступа к файлам и устройствам, без следов на диске. Без метки школы игры берутся из папки и сети нет совсем. С меткой школы (этап М2) — только из каталога школы по локальной сети;
- **«KIBERone Сервер»** для тьютора (этапы М1, М2): ключ школы, публикация игр, подписанный каталог, раздача в локальной сети. Код в `desktop/tutor/`, в сборку ученика он не входит.

Как устроены программы, сеть, данные и установщики — [`../docs/kak-ustroeno.md`](../docs/kak-ustroeno.md). Как сделать и упаковать игру — [`../docs/kak-sdelat-igru.md`](../docs/kak-sdelat-igru.md). Установка в классе — [`../docs/ustanovka.md`](../docs/ustanovka.md). Решения — `../docs/adr/`.

Нужен Node 22.12 или новее.

| Команда | Что делает |
| --- | --- |
| `npm ci` | Ставит зависимости |
| `npm test` | Модульные тесты: формат `.kibgames`, обложки и режимы, оценки, витрина, ключ школы, каталог, публикация, выбор сети, сервер, каталог по сети, оценки по сети (М4) |
| `npm run test:redteam` | Тест-«взломщик» на Linux с захватом трафика: К1–К14, К23, К24, проверки В0 и М1, раздача (С7, С8) и этап М2 в двух сетевых пространствах (К4, К15–К19, К21, С1, С3, С4, С6). Только М2: `node redteam/run.js --m2`. Снимки М2: `M2_SHOTS=../docs/img node redteam/run.js --m2` |
| `npm run dev-catalog` | Собирает Киберпочту, Сейф и тестовую игру с режимами в папку игр витрины и вносит ключ разработки в список доверия |
| `npx electron .` | Витрина из исходников. Своя папка игр: `npx electron . --catalog=папка` |
| `npm run shots:vitrina` | Снимки витрины 1366×768 и 1920×1080 в `../docs/img/` |
| `npm run tutor` | Программа тьютора из исходников. Тестовая папка данных: `npx electron desktop/tutor/main.js --data=папка` |
| `npm run shots:tutor` | Снимки программы тьютора в `../docs/img/` |
| `npm run check:builds` | Собирает обе программы папкой и проверяет, что в `app.asar` ученика нет кода тьютора и сервера, а в обеих сборках нет стенда теста-«взломщика» (Т14, К19) |
| `npm run build:tutor-win-dir` | Программа тьютора для Windows папкой, в `dist/tutor/` |
| `python3 scripts/make-covers.py` | Перерисовывает обложки Киберпочты, Сейфа и тестовой игры (нужен Pillow) |
| `node redteam/run.js --portable` | Тот же тест на Windows, без захвата трафика (К4) |
| `npx electron . игра.kibgames` | Запускает игру из исходников |
| `npm run build:win-dir` | Собирает папку для Windows `dist/win-unpacked`, можно на Linux |
| `npm run build:win`, `npm run build:tutor-win` | Установщики ученика и тьютора (NSIS, М5). Только на Windows или в `../.github/workflows/build-windows.yml`: на Linux без Wine значок в exe не встраивается |
| `node scripts/check-installers.js` | После обоих `build:*-win`: fuses и значки в exe, установщики и `SHA256SUMS.txt` в `dist/installers/` (И1, И2, И13). Для сборок папкой — `--dir` |
| `python3 scripts/make-icons.py` | Перерисовывает значки `build/icon.ico` и `build/tutor/icon.ico` (нужны Pillow и fontTools) |
| `node_modules/.bin/electron redteam/splash-shots.js` | Снимки заставок М5 в `../docs/img/` |
| `node scripts/make-test-kit.js` | Собирает комплект для проверки на Windows |
| `node scripts/make-win-zips.js` | После `build:win-dir` и `build:tutor-win-dir`: архивы обеих программ и тестовых игр в `dist/windows-exe/`, см. `../docs/tasks/windows-exe.md` |

## Ключи только для исходников

У установленной программы любые ключи запуска отклоняются. Из исходников: витрина со своей папкой игр — `npx electron . --catalog=папка`, настроенный ноутбук — `npx electron . --school=файл --local-data=папка`, программа тьютора с тестовой папкой — `npx electron desktop/tutor/main.js --data=папка`.

## Проверки по этапам

Проверки М4: `node redteam/run.js --m4` (скрипт ученика шлёт повторы и мусор, поиск адреса на диске тьютора, оценка во время игры и без сервера в настоящей витрине — всё с контрольными прогонами без защиты), `test/m4-votes.test.js`, К29 в `redteam/load-run.js`.

Проверки М3: `node redteam/run.js --m3` (подмена при докачке с контрольным прогоном, «Играть» в настоящей витрине), `node redteam/load-run.js` (15 учеников, 20/50/150 Мбит/с, около 10 минут; `--quick` — только 50 Мбит/с), `node redteam/big-game.js` (запуск игры на 200 МБ: время, память, перемотка звука).

Проверки М5: `test/m5-install.test.js` (значки, NSIS-скрипты: путь и права метки, правило брандмауэра, снятие при удалении, fuses, заставка), `node scripts/check-installers.js`. Сама установка на Windows — `../docs/tasks/windows-m5.md`.
