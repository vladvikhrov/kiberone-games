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
npx electron-builder --win nsis --x64 -c.extraMetadata.version=1.2.1
npx electron-builder -c builder-tutor.json --win nsis --x64 -c.extraMetadata.version=1.2.1
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
2. Значки: на рабочем столе, в «Пуске», в панели задач при запуске, у `C:\Program Files\KIBERone Сервер\kiberone-server.exe` в Проводнике — чёрный с оранжевой полосой.
3. Правило (админ):

```powershell
$r = Get-NetFirewallRule -DisplayName 'KIBERone Server 47800'
$r | Select-Object DisplayName, Direction, Action, Enabled, Profile
$r | Get-NetFirewallPortFilter        | Select-Object Protocol, LocalPort
$r | Get-NetFirewallAddressFilter     | Select-Object RemoteAddress
$r | Get-NetFirewallApplicationFilter | Select-Object Program
(Get-NetFirewallRule -Direction Inbound).Count - $before   # должно быть 2
```

Ожидается: два правила, Inbound, Allow, True, `Any`, TCP 47800 и UDP 47800, `LocalSubnet`, программа `C:\Program Files\KIBERone Сервер\kiberone-server.exe`.

4. Повторная установка того же файла поверх: правил по-прежнему 2.
5. Тестовая школа, чтобы не трогать настоящие данные: запуск с временной папкой данных.

```powershell
$env:LOCALAPPDATA = "$env:TEMP\k1-m5-tutor"
& 'C:\Program Files\KIBERone Сервер\kiberone-server.exe'
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
& 'C:\Program Files\Игры KIBERone\kiberone-games.exe' --school=C:\K1-m5\school.kibschool   # окно не открывается или ключ отклонён
& 'C:\Program Files\Игры KIBERone\kiberone-games.exe' --inspect=9229
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
| Система: Windows, сборка, Node, антивирус, Smart App Control | | |
| 0. `npm test` | | |
| 0. `run.js --portable` | | |
| 0. Сборка обоих установщиков, размеры | | |
| 0. `check-builds.js --no-build` (Т14, К19) | | |
| 0. `check-installers.js` (fuses, значки, хеши) | | |
| И14. 10 прогонов `--portable`: сколько провалов К3 | | |
| И3. SmartScreen и Защитник: тьютор (текст окна, кнопки) | | |
| И3. SmartScreen и Защитник: ученик | | |
| И2. Значки: exe, ярлыки, панель задач, файлы `.kibgames`, различимы ли | | |
| И4. Правило тьютора: 2 правила, поля как ожидается | | |
| И4. Повторная установка: правил 2 | | |
| И4. У ученика новых правил нет | | |
| Заставка тьютора и ученика: видна, уходит сама и по клавише | | |
| И5. Окно брандмауэра у тьютора при включении раздачи (один ПК) | | |
| И8. Без метки: сообщение, программа работает без сети | | |
| И8. Кривая метка (текст, 10 КБ) | | |
| И6. Метка поставлена, права, владелец, отпечаток у ученика | | |
| И12. Посторонний `.kibgames` и ключи запуска | | |
| И7. Ученик не меняет метку (8 команд) и может читать | | |
| И7. Контроль в своей папке: команды проходят | | |
| И7. Папка создана учеником заранее | | |
| И7. Папка-ссылка | | |
| И9. `/S`: код выхода, метка | | |
| И10. Обновление до 1.2.1: метка, права, кеш, правила, школа | | |
| И10. Возврат на 1.2.0 | | |
| И11. Удаление тьютора: правила сняты, данные школы на месте, вход тем же паролем | | |
| Удаление ученика: метка, ярлыки, ассоциация сняты | | |
| И5. Два компьютера: окна брандмауэра, обнаружение, секунд до связи | | |
| П2. Учётная запись ребёнка на школьном ноутбуке | | |
| Что ещё заметили | | |
