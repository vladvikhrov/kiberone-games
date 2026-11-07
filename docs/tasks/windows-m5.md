# Проверка этапа М5 на Windows: установщики

Делают Claude Code на Windows и Влад. Постановка: [`etap-m5.md`](etap-m5.md), критерии И1–И14 и П2. Железо (ответ Влада от 06.11.2026): домашний ПК Влада (Windows 11 Домашняя, запись `vladv` — администратор с UAC) и ноутбуки с Windows. Виртуальной машины нет, поэтому «чистый Windows» здесь — компьютер, на котором «Игры KIBERone» и «KIBERone Сервер» ещё не ставились через установщик (папки `C:\K1`, `C:\kibtest` от прошлых проверок не мешают).

Все команды — PowerShell. «Админ» — окно PowerShell «от имени администратора». «Ученик» — команды от тестовой записи ученика (раздел 1). Результаты вписывайте в таблицу в конце: OK, ПРОВАЛ или НЕ ПРОВЕРЕНО с причиной, и что видели.

## 0. Сборка установщиков на этом компьютере (И1, И13, И14)

Нужен Node 22 или новее (на ПК Влада уже стоит Node 26, поставлен через winget).

```powershell
cd <папка kiberone-games>\app
npm ci
npm test                                   # строка "# fail 0"
node redteam/run.js --portable             # строка «Итог», К1–К14, К23, К24, В0, М1
npm run build:win                          # dist\KIBERone-Games-Setup-1.2.0.exe
npm run build:tutor-win                    # dist\tutor\KIBERone-Server-Setup-1.2.0.exe
node scripts/check-builds.js --no-build    # OK Т14, OK К19
node scripts/check-installers.js           # fuses, значки в exe, dist\installers\ + SHA256SUMS.txt
```

Если `npm ci` не запустил скрипт `electron-winstaller` (`allowScripts` в npm 11, находка 6 из `ОТЧЁТ-WINDOWS.md`), а `build:win` падает, это находка. Её можно обойти `npm ci --foreground-scripts` или `npm rebuild`, записав, что помогло.

**И14, мигание К3:** 10 прогонов подряд, считаем провалы контрольного прогона.

```powershell
1..10 | ForEach-Object { node redteam/run.js --portable 2>&1 | Select-String 'Итог|молчат|ПРОВАЛ' }
```

Во время контрольного прогона может выскочить окно «Получите приложение, чтобы открыть эту ссылку kibgame» (находка 3 из `ОТЧЁТ-WINDOWS.md`): его просто закрыть, на результат оно не влияет.

**Сборка 1.2.1 для проверки обновления (И10)**, не меняя `package.json`:

```powershell
npx electron-builder --win nsis --x64 '-c.extraMetadata.version=1.2.1'
npx electron-builder -c builder-tutor.json --win nsis --x64 '-c.extraMetadata.version=1.2.1'
```

Установщики `…-1.2.1.exe` переложите в отдельную папку `C:\K1-m5\v121\`: следующая сборка 1.2.0 их не тронет, но так их не перепутать.

Дальше всё на собранных файлах из `dist\installers\`. Скопируйте их в `C:\K1-m5\`.

## 1. Тестовая запись ученика

Админ:

```powershell
$p = Read-Host -AsSecureString 'Пароль для k1-uchenik (временный)'
New-LocalUser k1-uchenik -Password $p -FullName 'Ученик М5' -AccountNeverExpires
Add-LocalGroupMember -Group 'Пользователи' -Member k1-uchenik   # если группа по-английски: 'Users'
Get-LocalGroupMember -Group 'Администраторы' | Select-Object Name  # k1-uchenik здесь быть не должно
$cred = Get-Credential k1-uchenik
```

Команда «от ученика» ниже — так (окно откроется под учеником):

```powershell
Start-Process powershell -Credential $cred -ArgumentList '-NoExit','-Command','whoami; whoami /groups | findstr /i "S-1-5-32-544"'
```

В новом окне `whoami` должен показать `…\k1-uchenik`, а строки с `S-1-5-32-544` (Администраторы) быть не должно. В конце проверки запись удаляется (раздел 9).

## 2. Брандмауэр до установки (И4)

Админ:

```powershell
$before = (Get-NetFirewallRule -Direction Inbound).Count; $before
Get-NetFirewallRule -DisplayName 'KIBERone Server 47800' -ErrorAction SilentlyContinue   # пусто
```

## 3. SmartScreen и Защитник (И3)

Установщик, собранный здесь, не помечен как «скачанный из интернета», поэтому SmartScreen его не проверяет. Ставим метку так, как её ставит браузер, а для честности хотя бы один раз скачайте файл браузером (например, отправьте себе в Telegram Web и скачайте).

```powershell
# Состояние «Интеллектуального управления приложениями»: 0 выкл., 1 вкл., 2 оценка
Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -Name VerifiedAndReputablePolicyState -ErrorAction SilentlyContinue
# Метка «из интернета» на копии установщика
Copy-Item C:\K1-m5\KIBERone-Server-Setup-1.2.0.exe C:\K1-m5\motw\ -Force
Set-Content C:\K1-m5\motw\KIBERone-Server-Setup-1.2.0.exe -Stream Zone.Identifier -Value "[ZoneTransfer]`r`nZoneId=3"
Get-AuthenticodeSignature C:\K1-m5\motw\KIBERone-Server-Setup-1.2.0.exe | Select-Object Status
Get-MpThreatDetection | Select-Object -Last 3    # обнаружения Защитника после запуска
```

Запустите `C:\K1-m5\motw\KIBERone-Server-Setup-1.2.0.exe` двойным щелчком. Запишите точный текст окна, какие кнопки есть, что нажали. То же для установщика ученика. Ничего глобально не выключать.

## 4. Установщик тьютора (И2, И4, И5, И11)

1. Двойной щелчок `C:\K1-m5\KIBERone-Server-Setup-1.2.0.exe` → UAC «Да» → «Установить». Должно появиться напоминание про код восстановления.
2. Значки: на рабочем столе, в «Пуске», в панели задач при запуске, у `C:\Program Files\kiberone-server\kiberone-server.exe` в Проводнике — чёрный с оранжевой полосой.
3. Правило (админ):

```powershell
$r = Get-NetFirewallRule -DisplayName 'KIBERone Server 47800'
$r | Select-Object DisplayName, Direction, Action, Enabled, Profile
$r | Get-NetFirewallPortFilter        | Select-Object Protocol, LocalPort
$r | Get-NetFirewallAddressFilter     | Select-Object RemoteAddress
$r | Get-NetFirewallApplicationFilter | Select-Object Program
(Get-NetFirewallRule -Direction Inbound).Count - $before   # должно быть 2
```

Ожидается: два правила, Inbound, Allow, True, `Any`, TCP 47800 и UDP 47800, `LocalSubnet`, программа `C:\Program Files\kiberone-server\kiberone-server.exe`.

4. Повторная установка того же файла поверх: правил по-прежнему 2.
5. Тестовая школа, чтобы не трогать настоящие данные: запуск с временной папкой данных.

```powershell
$env:LOCALAPPDATA = "$env:TEMP\k1-m5-tutor"
& 'C:\Program Files\kiberone-server\kiberone-server.exe'
```

Заставка 3 с со знаком и тремя шагами (убирается клавишей). Создайте школу «Тест М5», пароль `тест-пароль-м5`, «Школа» → «Сохранить school.kibschool» в `C:\K1-m5\`, рядом с `KIBERone-Games-Setup-1.2.0.exe`. Опубликуйте `kiberpochta.kibgames` из `app\dist\windows-exe\K1-test-games.zip` (лежит в переданной папке; распакуйте в `C:\K1-m5\`), отметьте «Публикую игру неизвестного автора».

6. **И5.** «Включить раздачу». Появилось ли окно Windows про доступ к сети? Ожидается: нет.

## 5. Установщик ученика (И2, И6, И7, И8, И9, И12)

**И8, без метки.** Скопируйте только установщик в `C:\K1-m5\bez\` и запустите. Ожидается сообщение «Рядом с установщиком нет файла school.kibschool…». Программа без метки: витрина из папки, двойной щелчок по `kiberpochta.kibgames` открывает игру (с предупреждением о неизвестном авторе). Удалите программу.

**И8, кривая метка.** В `C:\K1-m5\krivaya\` установщик и `school.kibschool` с текстом `привет`. Ожидается «…не похож на метку школы. Метка не поставлена». Потом файл из 10 КБ `{` + пробелы: тоже не поставлена. Удалите программу.

```powershell
'{' + (' ' * 10240) | Set-Content C:\K1-m5\krivaya\school.kibschool -Encoding ascii
```

**И6.** Запуск `C:\K1-m5\KIBERone-Games-Setup-1.2.0.exe` (метка рядом). Ожидается «Метка школы поставлена».

```powershell
Get-Content 'C:\ProgramData\KIBERone Games\school.json'      # то же, что school.kibschool
icacls 'C:\ProgramData\KIBERone Games'
icacls 'C:\ProgramData\KIBERone Games\school.json'
(Get-Acl 'C:\ProgramData\KIBERone Games').Owner             # BUILTIN\Администраторы
(Get-NetFirewallRule -Direction Inbound).Count - $before     # по-прежнему 2: у ученика своих правил нет
cmd /c assoc .kibgames; cmd /c ftype | findstr /i kibgames   # ассоциация с программой
```

От ученика откройте «Игры KIBERone» с рабочего стола: заставка, витрина. Щёлкните по надписи о связи в шапке → «Связь с тьютором»: школа «Тест М5» и отпечаток как в «Школа» у тьютора. Если раздача включена, игры появились.

**И12.** От ученика двойной щелчок по `kiberpochta.kibgames` → «На этом ноутбуке игры запускаются только из каталога школы». Ключи запуска:

```powershell
& 'C:\Program Files\kiberone-games\kiberone-games.exe' --school=C:\K1-m5\school.kibschool   # окно не открывается или ключ отклонён
& 'C:\Program Files\kiberone-games\kiberone-games.exe' --inspect=9229
Get-NetTCPConnection -LocalPort 9229 -ErrorAction SilentlyContinue                           # пусто
```

**И7, метка неизменна для ученика.** В окне ученика (каждая строка должна дать «Отказано в доступе» / Access denied):

```powershell
$d = 'C:\ProgramData\KIBERone Games'
Set-Content "$d\school.json" 'подмена'
Add-Content "$d\school.json" ' '
Remove-Item "$d\school.json"
Rename-Item "$d\school.json" school.old
New-Item "$d\novyi.json" -ItemType File
New-Item "$d\papka" -ItemType Directory
icacls $d /grant "${env:USERNAME}:(OI)(CI)F"
Remove-Item $d -Recurse
Get-Content "$d\school.json"     # а это должно работать: читать можно
```

**Контроль** (иначе проверка ничего не доказывает): от ученика те же команды в своей папке — должны пройти.

```powershell
$d = 'C:\ProgramData\K1-kontrol'; New-Item $d -ItemType Directory; 'x' | Set-Content "$d\school.json"
# … те же строки, что выше, все без ошибок; в конце Remove-Item $d -Recurse
```

**И7, ученик создал папку заранее.** Удалите программу (Параметры → Приложения). Проверьте, что `C:\ProgramData\KIBERone Games` исчезла. От ученика:

```powershell
New-Item 'C:\ProgramData\KIBERone Games' -ItemType Directory
'{"chuzhaya":1}' | Set-Content 'C:\ProgramData\KIBERone Games\school.json'
icacls 'C:\ProgramData\KIBERone Games'   # владелец — k1-uchenik
```

Админ: снова установщик с меткой рядом. Потом от ученика — все команды И7. Ожидается: владелец «Администраторы», подмена не проходит, в `school.json` настоящая метка.

**И7, папка-ссылка.** Удалите программу. От ученика:

```powershell
New-Item "$env:USERPROFILE\fake" -ItemType Directory
cmd /c mklink /J "C:\ProgramData\KIBERone Games" "$env:USERPROFILE\fake"
```

Админ: установщик с меткой. Затем:

```powershell
(Get-Item 'C:\ProgramData\KIBERone Games' -Force).Attributes   # без ReparsePoint
Get-ChildItem "C:\Users\k1-uchenik\fake"                         # school.json туда не попал
```

**И9, молча.** Удалите программу. Админ:

```powershell
$p = Start-Process C:\K1-m5\KIBERone-Games-Setup-1.2.0.exe -ArgumentList '/S' -Wait -PassThru; $p.ExitCode   # 0
Test-Path 'C:\ProgramData\KIBERone Games\school.json'                                                       # True
```

## 6. Обновление (И10)

1. Стоят обе программы 1.2.0, школа «Тест М5», у ученика скачана Киберпочта (`Get-ChildItem "$env:LOCALAPPDATA\KIBERone Games\cache"` от ученика — есть файлы). Запомните `Get-FileHash 'C:\ProgramData\KIBERone Games\school.json'`.
2. Админ: `C:\K1-m5\v121\KIBERone-Games-Setup-1.2.1.exe` **без** `school.kibschool` рядом, потом `KIBERone-Server-Setup-1.2.1.exe`.
3. Ожидается: хеш метки тот же, права те же (`icacls`), правил брандмауэра 2, кеш ученика на месте, программа ученика после запуска ничего не качает заново, школа тьютора открывается тем же паролем. В «Параметры → Приложения» версия 1.2.1, по одной записи на программу.
4. Поставьте обратно 1.2.0 (так же поверх) — понижение версии: запишите, что сказал установщик.

## 7. Удаление (И4, И11)

1. Админ, перед удалением: `Get-ChildItem "$env:TEMP\k1-m5-tutor\KIBERone Server"` — запомните список. Если школа делалась без временной папки, смотрите `%LOCALAPPDATA%\KIBERone Server`.
2. «Параметры» → «Приложения» → «KIBERone Сервер» → «Удалить».
3. `Get-NetFirewallRule -DisplayName 'KIBERone Server 47800'` — пусто, `(Get-NetFirewallRule -Direction Inbound).Count - $before` — 0. Папка данных школы — на месте, тот же список.
4. Поставьте программу тьютора снова и войдите паролем `тест-пароль-м5` в ту же школу (И11).
5. Удалите «Игры KIBERone»: `Test-Path 'C:\ProgramData\KIBERone Games'` — False, ярлыков нет, `cmd /c assoc .kibgames` — нет связи.

## 8. Два компьютера (И5)

ПК Влада — тьютор, ноутбук — ученик, одна сеть. На ноутбук ставится только `KIBERone-Games-Setup-1.2.0.exe` с `school.kibschool` рядом. Тьютор включает раздачу. Записать: было ли окно брандмауэра у тьютора, было ли у ученика, нашёл ли ученик сервер сам (без адреса) и за сколько секунд, профиль сети (`Get-NetConnectionProfile`). Если окно у ученика было — что нажали и нашёлся ли сервер после «Отмена».

## 9. Учётные записи на школьных ноутбуках (П2)

На одном школьном ноутбуке под записью ребёнка, без прав администратора, ничего не меняя:

```powershell
whoami
whoami /groups | findstr /i "S-1-5-32-544 S-1-5-32-545"
net localgroup Администраторы
Get-LocalUser | Select-Object Name, Enabled, PasswordRequired
```

И руками: запустите любой установщик — попросил ли UAC пароль администратора или пропустил по кнопке «Да»? Пароль не подбирать. Вывод — по таблице ADR-0002, раздел 12.

## 10. Уборка

Админ: удалите обе программы, `Remove-Item "$env:TEMP\k1-m5-tutor" -Recurse`, `Remove-LocalUser k1-uchenik`, `Remove-Item C:\Users\k1-uchenik -Recurse -Force`, `Remove-Item C:\K1-m5 -Recurse`. Убедитесь, что `Get-NetFirewallRule -DisplayName 'KIBERone*'` пусто.

## Результат

| Проверка | Результат | Что видели |
| --- | --- | --- |
| Система: Windows, сборка, Node, антивирус, Smart App Control | OK | ПК Влада: Windows 11 Домашняя 24H2 (10.0.26100), x64, ru-RU. Node 26.13.0, npm 11.20.0. Защитник: Normal, защита в реальном времени вкл. Smart App Control 0 (выкл.). UAC: `EnableLUA=1`, `ConsentPromptBehaviorAdmin=5`. Запись `vladv` — администратор с UAC. Путь с кириллицей (`Documents\владв\…`) сборке не мешает |
| 0. `npm test` | OK | 210 из 210 (и после каждой правки) |
| 0. `run.js --portable` | OK со сбоем | Первый прогон 22 из 23: К3, контрольный прогон, «молчат: nav-meta-refresh». Второй — 23 из 23. См. И14 |
| 0. Сборка обоих установщиков, размеры | OK | `build:win` и `build:tutor-win` без ошибок NSIS, по 115,8 МБ. Electron не скачался в `npm ci` (в пакете нет `postinstall`), помог `node node_modules/electron/install.js`. Сборка 1.2.1 — только с аргументом в кавычках |
| 0. `check-builds.js --no-build` (Т14, К19) | OK после исправления | Сначала ПРОВАЛ Т14 и К19: скрипт на Windows не читал файлы `app.asar` (пути с `\`), контроль тьютора — «строк тьютора: 0». Исправлен `check-builds.js`, теперь OK, у тьютора 30 строк |
| 0. `check-installers.js` (fuses, значки, хеши) | OK | Fuses 8 из 8 у обеих, значок встроен в оба exe, `dist/installers/` и `SHA256SUMS.txt` (итоговые хеши — в `otchet-m5.md`) |
| И14. 10 прогонов `--portable`: сколько провалов К3 | OK, с оговоркой | 10 подряд: К3 провалов 0. Отдельно: прогон 6 — ПРОВАЛ В12 (шёл одновременно с установками в окне администратора), и в разделе 0 один провал К3 до цикла. Итого К3 — 1 провал из 12 прогонов, В12 — 1 из 12 |
| И3. SmartScreen и Защитник: тьютор (текст окна, кнопки) | OK (Влад) | Копия с `Zone.Identifier` ZoneId=3, подпись NotSigned. Синее окно SmartScreen было, Влад прошёл «Подробнее» → «Выполнить в любом случае». Защитник: обнаружений нет |
| И3. SmartScreen и Защитник: ученик | OK (снимки Влада) | «Система Windows защитила ваш компьютер. Фильтр SmartScreen в Microsoft Defender предотвратил запуск неопознанного приложения, которое может подвергнуть компьютер риску». Кнопка «Не выполнять», ссылка «Подробнее» → «Приложение: KIBERone-Games-Setup-1.2.0.exe, Издатель: Неизвестный издатель», кнопки «Выполнить в любом случае», «Не выполнять». UAC — обычный запрос, издателя нет (ответ Влада). Защитник: обнаружений нет. Файл, реально скачанный браузером, не проверялся |
| И2. Значки: exe, ярлыки, панель задач, файлы `.kibgames`, различимы ли | Частично (Влад) | Тьютор: значок на ярлыках, в «Пуске», в окне установщика — «везде есть», знак тьютора с оранжевой полосой (снимок). Ученик: панель задач и файлы `.kibgames` — НЕ ПРОВЕРЕНО, ответа нет |
| И4. Правило тьютора: 2 правила, поля как ожидается | OK | `KIBERone Server 47800` ×2: Inbound, Allow, True, Profile Any, TCP 47800 и UDP 47800, RemoteAddress LocalSubnet, Program `C:\Program Files\kiberone-server\kiberone-server.exe`. Входящих было 432, стало 434 |
| И4. Повторная установка: правил 2 | OK | Тот же файл `/S` поверх, код 0: правил 2, входящих 434 |
| И4. У ученика новых правил нет | OK | До всех установок входящих правил 432; после 12 установок и удалений программы ученика (подвохи) и установки тьютора — 434, то есть только 2 правила тьютора |
| Заставка тьютора и ученика: видна, уходит сама и по клавише | Частично (Влад) | Тьютор: видна, загрузка с разгоном к концу — «супер». Уход по клавише и заставка ученика — НЕ ПРОВЕРЕНО |
| И5. Окно брандмауэра у тьютора при включении раздачи (один ПК) | OK (Влад) | Окна не было. Раздача на 192.168.1.50:47800. Профиль сети «Ethernet» — **Public**: правило с `profile=any` сработало |
| И8. Без метки: сообщение, программа работает без сети | Частично (Влад) | Установщик из `motw` без метки рядом встал. Витрина без метки открывается, двойной щелчок по `kiberpochta.kibgames` — окно «Автор игры «Киберпочта» неизвестен этой школе… Не запускать / Запустить» (снимок). Текст последнего окна установщика — НЕ ПРОВЕРЕНО |
| И8. Кривая метка (текст, 10 КБ) | НЕ ПРОВЕРЕНО | Не успели: установщик с меткой «привет» запущен, сообщение не снято. Завтра: `C:\K1-m5\krivaya\`, затем `k1.ps1 krivaya2` и снова |
| И6. Метка поставлена, права, владелец, отпечаток у ученика | Частично | Права и владелец проверены на заглушке `{"zaglushka":1}` (подвохи, тихая установка): владелец `BUILTIN\Администраторы`, папка `Пользователи:(OI)(CI)(RX)`, SYSTEM и Администраторы F, наследование снято, у `school.json` те же права наследованием. С настоящей меткой «Тест М5» и сверкой отпечатка `c3d6 7d9e 00a2 f62b` в витрине — НЕ ПРОВЕРЕНО |
| И12. Посторонний `.kibgames` и ключи запуска | НЕ ПРОВЕРЕНО | Завтра: `k1.ps1 i12`, `k1.ps1 i12-keys` |
| И7. Ученик не меняет метку (8 команд) и может читать | OK (на заглушке) | После установки от `k1-uchenik` все 10 попыток (8 из задания + `/setowner` себе + `/grant` на файл) — «Отказано в доступе», чтение проходит. С настоящей меткой — завтра `k1.ps1 i7` |
| И7. Контроль в своей папке: команды проходят | OK | `C:\ProgramData\K1-kontrol`: все 11 действий прошли |
| И7. Папка создана учеником заранее | OK после двух исправлений | `plain` (папка и своя `school.json`): OK. `ace` (плюс явное «мне F»): на Linux-версии метка не читалась бы (пустые права); после первого исправления OK. **`zamok`** (права только у ученика): ПРОВАЛ дважды — владелец остался ученик, метки нет, ученик удалял и создавал файлы; после `takeown` + переименования — OK (прогон C) |
| И7. Папка-ссылка | OK | Junction на `C:\Users\k1-uchenik\fake`: после установки атрибута ReparsePoint нет, в `fake` ничего не попало, все попытки ученика отказаны |
| И9. `/S`: код выхода, метка | OK (на заглушке) | 12 тихих установок, код 0, метка на месте; удаление `/allusers /S` снимает метку и папку. С настоящей меткой — завтра `k1.ps1 i9` |
| И10. Обновление до 1.2.1: метка, права, кеш, правила, школа | НЕ ПРОВЕРЕНО | Установщики 1.2.1 собраны (`C:\K1-m5\v121\`), завтра `k1.ps1 update` |
| И10. Возврат на 1.2.0 | НЕ ПРОВЕРЕНО | Завтра |
| И11. Удаление тьютора: правила сняты, данные школы на месте, вход тем же паролем | НЕ ПРОВЕРЕНО | Завтра `k1.ps1 tutor-uninstall` |
| Удаление ученика: метка, ярлыки, ассоциация сняты | Частично | Тихое удаление снимает запись в «Приложениях», метку и папку `C:\ProgramData\KIBERone Games` (12 раз). Ярлыки и ассоциация — завтра `k1.ps1 student-uninstall` |
| И5. Два компьютера: окна брандмауэра, обнаружение, секунд до связи | НЕ ПРОВЕРЕНО | Делает Влад, раздел 8 |
| П2. Учётная запись ребёнка на школьном ноутбуке | НЕ ПРОВЕРЕНО | Делает Влад, раздел 9 |
| Что ещё заметили | | 1) Программы ставятся в `C:\Program Files\kiberone-games\` и `…\kiberone-server\` (electron-builder не берёт кириллическое имя папки), инструкции исправлены. 2) Программа тьютора с ярлыка берёт обычный `%LOCALAPPDATA%`: для тестовой школы её надо запускать с подменённой переменной, иначе «школа пропала». 3) Пароль тестового ученика `PasswordRequired: False` — так создаёт `New-LocalUser`, на проверку не влияет |
