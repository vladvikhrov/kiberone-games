# Проверка В0 и М1 на Windows без Node: готовые exe

Обе программы собраны на Linux папкой для Windows x64, без подписи и без установщика. В архивах уже код этапа М2. Пока на ноутбуке нет метки школы `C:\ProgramData\KIBERone Games\school.json`, программа ученика ведёт себя как на В0: игры из папки, сети нет. Поэтому для В0 и М1 метку не ставьте, её кладёт только `windows-m2.md`. Node, git и `npm` на ПК не нужны. Так проверяются ручные шаги `windows-v0.md` и `windows-m1.md`. Автоматические тесты (`npm test`, `run.js --portable`) без Node не запустить, про них ниже.

## Что взять

Архивы лежат на Linux-ноутбуке в `kiberone-games/app/dist/windows-exe/`. Пересоздать: `npm run build:win-dir`, `npm run build:tutor-win-dir`, затем `node scripts/make-win-zips.js` в `kiberone-games/app`.

| Файл | Что внутри | SHA-256 |
| --- | --- | --- |
| `KIBERone-Games-1.1.0-win-x64.zip` | Программа ученика «Игры KIBERone», 151 МБ | `6FBF3DAA99A80AD182A6905F7F3F93C09E637BA433D6194D3181B3D5451AC374` |
| `KIBERone-Server-1.1.0-win-x64.zip` | Программа тьютора «KIBERone Сервер», 151 МБ | `6C7A7AC8B5BCE5630075265DA517B5ACAF8421CE35B3BBE289DA6616A94759A6` |
| `K1-test-games.zip` | Киберпочта, Сейф, «Три режима» под ключом разработки `ce07b8b044d2df0d`, `trusted-keys.json` с этим ключом, плохие файлы `bitaya` и `poddelka`. Заменяет `npm run dev-catalog` и команду «плохие файлы» | `932218C5E365EC6FA4B5A607C501E580DDDBEB670BF7486DC98FD0DF04A27098` |
| `K1-big-games.zip` | Этап М3: «Большая игра 50 МБ» и «Большая игра 195 МБ» под тем же ключом, со звуком для проверки перемотки (`windows-m3.md`), 219 МБ | `D95D57C981EA419E6C45F09B73014695F17E3FDC4606781ACF11EEA027613DD7` |

Перенесите три архива на ПК с Windows флешкой или через Telegram, например в «Загрузки».

## Распаковка

PowerShell, из папки с архивами:

```powershell
# Хеши должны совпасть с таблицей выше
Get-FileHash *.zip

# Распаковать в C:\K1
Expand-Archive KIBERone-Games-1.1.0-win-x64.zip  C:\K1 -Force
Expand-Archive KIBERone-Server-1.1.0-win-x64.zip C:\K1 -Force
Expand-Archive K1-test-games.zip                 C:\K1 -Force
```

Получится:

| Путь | Что это |
| --- | --- |
| `C:\K1\KIBERone-Games\kiberone-games.exe` | Программа ученика |
| `C:\K1\KIBERone-Server\kiberone-server.exe` | Программа тьютора |
| `C:\K1\K1-test-games\` | Игры, список доверия, плохие файлы |

Exe не подписаны и без своего значка: у них стандартный значок Electron. Если архив распаковать Проводником, Windows может показать «Windows защитила ваш компьютер». Тогда «Подробнее» → «Выполнить в любом случае». `Expand-Archive` обычно обходится без этого окна (см. `ОТЧЁТ-WINDOWS.md`, раздел 2).

Exe не принимают ключи запуска: с `--catalog`, `--data` и любым другим ключом программа сразу закрывается. Это защита, а не ошибка. Файл `.kibgames` передать можно.

## Где лежат данные

| Программа | Папка | Что там |
| --- | --- | --- |
| Ученик | `%APPDATA%\Игры KIBERone\` | `games\`, `trusted-keys.json`, `ratings.json`, `state.json` |
| Тьютор | `%LOCALAPPDATA%\KIBERone Server\` | `school-key.enc`, `school.kibschool`, `catalog.json`, `blobs\` и т. д. |

Ключа `--data` у exe нет, но программа тьютора берёт папку из переменной `LOCALAPPDATA`. Если задать её в окне PowerShell перед запуском, данные пойдут во временную папку, а настоящая `%LOCALAPPDATA%` останется нетронутой. Переменная действует только в этом окне PowerShell.

## Проверка В0 по `windows-v0.md`

Копию прежних файлов сделайте, как написано в начале `windows-v0.md`. Раздел «Команды» замените этим:

```powershell
# Вместо npm run dev-catalog: игры и список доверия в папку витрины
New-Item -ItemType Directory "$env:APPDATA\Игры KIBERone\games" -Force | Out-Null
Copy-Item C:\K1\K1-test-games\games\*.kibgames "$env:APPDATA\Игры KIBERone\games\" -Force
Copy-Item C:\K1\K1-test-games\trusted-keys.json "$env:APPDATA\Игры KIBERone\" -Force

# Вместо npx electron .
& C:\K1\KIBERone-Games\kiberone-games.exe
```

`trusted-keys.json` заменяет прежний, поэтому тестовый ключ `8dca609cf099c343` из прошлой проверки из списка уйдёт. Это нормально, после проверки вернёте копию.

Шаги 1–13 таблицы «Что проверить руками» те же. Где написано «открыть витрину», запускайте `& C:\K1\KIBERone-Games\kiberone-games.exe`. Команды «вчера», «оценки», «соединения» работают без изменений: «соединения» уже ищет процесс `kiberone-games`.

В таблице результата строки `npm test` и `run.js --portable` отметьте «НЕ ПРОВЕРЕНО: без Node».

## Проверка М1 по `windows-m1.md`

Раздел «Команды» замените этим:

```powershell
# Вместо npm run dev-catalog (если ещё не сделали для В0)
New-Item -ItemType Directory "$env:APPDATA\Игры KIBERone\games" -Force | Out-Null
Copy-Item C:\K1\K1-test-games\games\*.kibgames "$env:APPDATA\Игры KIBERone\games\" -Force
Copy-Item C:\K1\K1-test-games\trusted-keys.json "$env:APPDATA\Игры KIBERone\" -Force

# Вместо команды 5: программа тьютора с тестовой папкой данных
$env:LOCALAPPDATA = "$env:TEMP\k1-tutor-a"
& C:\K1\KIBERone-Server\kiberone-server.exe
```

Шаги 1–21 таблицы те же, кроме команд:

| Где в `windows-m1.md` | Что выполнить вместо |
| --- | --- |
| Шаг 15, «открыть снова (команда 5)» | В том же окне PowerShell снова `& C:\K1\KIBERone-Server\kiberone-server.exe`. Переменная уже задана |
| Шаг 19, «второй ноутбук» | **Новое** окно PowerShell: `$env:LOCALAPPDATA = "$env:TEMP\k1-tutor-b"; & C:\K1\KIBERone-Server\kiberone-server.exe` |
| Шаг 20, «плохие файлы» | `& C:\K1\KIBERone-Games\kiberone-games.exe C:\K1\K1-test-games\bad\bitaya.kibgames`, затем то же с `poddelka.kibgames` |
| Шаг 21, «соединения» | Те же две строки, но вместо `electron` имя процесса `kiberone-server`: `Get-NetTCPConnection \| Where-Object { $_.OwningProcess -in (Get-Process kiberone-server -ErrorAction SilentlyContinue).Id }` и то же с `Get-NetUDPEndpoint` |

Если с заданной переменной `LOCALAPPDATA` программа тьютора не откроется, запишите это в «Что ещё заметили» и запустите её из обычного окна PowerShell. Данные тогда пойдут в настоящую `%LOCALAPPDATA%\KIBERone Server`. Настоящей школы там пока нет, после проверки папку можно удалить. Для шага 19 эту папку перед запуском переименуйте в `KIBERone Server-a`, тогда программа откроется как на новом ноутбуке.

В таблице результата:

| Строка | Что вписать |
| --- | --- |
| `npm test`, `run.js --portable` | НЕ ПРОВЕРЕНО: без Node |
| `check:builds`: строка «OK Т14» | OK: проверено на Linux на этих же сборках для Windows, в `app.asar` ученика 57 файлов, кода тьютора и сервера нет. В сборке тьютора 14 файлов и 15 строк тьютора (контроль) |

После проверки удалите тестовые папки: `Remove-Item "$env:TEMP\k1-tutor-a", "$env:TEMP\k1-tutor-b" -Recurse -Force`.

## Автоматические тесты на Windows без Node

`npm test` и `node redteam/run.js --portable` на настоящей Windows можно прогнать в GitHub Actions: `.github/workflows/build-windows.yml` (Actions → Windows build → Run workflow). Он ставит Node 22, запускает оба теста и собирает установщик. Для этого код надо закоммитить и запушить. Результат: лог прогона и `KIBERone-Games-Setup-1.1.0.exe` в артефактах. Установщика тьютора в этом задании пока нет.

## Что не проверено

Exe собраны на Linux, на Windows и под Wine я их не запускал. Те же программы, собранные для Linux, проходят тесты М1. Если exe не открывается или сразу закрывается, пришлите снимок экрана и вывод `& C:\K1\KIBERone-Games\kiberone-games.exe; $LASTEXITCODE`.
