; Установщик «Игры KIBERone» (этап М5). Подключается electron-builder через nsis.include.
; Метка школы (ADR-0002, 3.3): school.kibschool рядом с установщиком -> C:\ProgramData\KIBERone Games\school.json.
; Путь буквами, как в desktop/main.js (schoolPath): не из переменной, её ученик может подменить.
; Права: Администраторы (S-1-5-32-544) и SYSTEM (S-1-5-18) — полный доступ, Пользователи (S-1-5-32-545) — только чтение.

!include "WordFunc.nsh"

!define K1_DIR "C:\ProgramData\KIBERone Games"
; Класс файлов .kibgames: package.json, build.fileAssociations[0].name
!define K1_FILECLASS "Игра KIBERone"

!define K1_LABEL "C:\ProgramData\KIBERone Games\school.json"
!define K1_ACL '/inheritance:r /grant:r *S-1-5-32-544:(OI)(CI)F *S-1-5-18:(OI)(CI)F *S-1-5-32-545:(OI)(CI)RX'

; Права папки и всего в ней: владелец — Администраторы, наследование снято.
; Владелец меняется, чтобы ученик, создавший папку заранее, не сохранил право менять её права.
; М5, Windows: /reset /T убирает явные правила, которые ученик мог добавить себе на заранее созданную папку
; (/grant:r заменяет права только перечисленных групп). Права с (OI)(CI) ставятся только на папку, без /T:
; на файле /T с (OI)(CI) оставлял пустой список доступа, school.json не читал никто. Файлы получают права наследованием.
!macro K1_LOCK_DIR
  nsExec::ExecToLog 'icacls "${K1_DIR}" /setowner *S-1-5-32-544 /T /C /Q'
  Pop $1
  nsExec::ExecToLog 'icacls "${K1_DIR}" /reset /T /C /Q'
  Pop $1
  nsExec::ExecToLog 'icacls "${K1_DIR}" ${K1_ACL} /C /Q'
  Pop $1
!macroend

; Прежняя папка метки отодвигается, на её месте создаётся новая с правами установщика. М5, Windows: ученик, создавший
; папку заранее, мог оставить права только себе — тогда ни /setowner, ни icacls от администратора её не берут («замок»).
; Полного доступа к C:\ProgramData для переименования мало (проверено на Windows 11: «Отказано в доступе»), поэтому
; сначала takeown /A — он берёт папку «Администраторам» привилегией SeTakeOwnership; без /R он ничего не спрашивает.
; Ссылка (junction) не забирается, а переименовывается как ссылка. $R4 — куда отодвинута, пусто — папки не было.
!macro K1_FRESH_DIR
  StrCpy $R4 ""
  System::Call 'kernel32::GetFileAttributesW(w "${K1_DIR}") i .r2'
  ${If} $2 != -1
    IntOp $3 $2 & 0x400
    ${If} $3 == 0
      nsExec::ExecToLog 'takeown /F "${K1_DIR}" /A'
      Pop $1
      nsExec::ExecToLog 'icacls "${K1_DIR}" /grant *S-1-5-32-544:F /C /Q'
      Pop $1
    ${EndIf}
    System::Call 'kernel32::GetTickCount() i .r4'
    StrCpy $R4 "${K1_DIR}.old-$4"
    ClearErrors
    Rename "${K1_DIR}" "$R4"
    ${If} ${Errors}
      ; Не вышло переименовать: папка-ссылка снимается как ссылка, иначе папка остаётся и K1_LOCK_DIR пробует её взять
      IntOp $3 $2 & 0x400
      ${If} $3 != 0
        RMDir "${K1_DIR}"
      ${EndIf}
      StrCpy $R4 ""
    ${EndIf}
  ${EndIf}
  CreateDirectory "${K1_DIR}"
  !insertmacro K1_LOCK_DIR
!macroend

; Отодвинутая папка удаляется. rmdir /s не идёт по ссылкам внутри неё, а снимает их: ссылка ученика на системную папку
; не превратится в удаление системных файлов. Если ученик закрыл её от администратора, она остаётся под именем .old-…
!macro K1_DROP_OLD
  ${If} $R4 != ""
    nsExec::ExecToLog 'cmd /c rmdir /s /q "$R4"'
    Pop $1
  ${EndIf}
!macroend

!macro customInstall
  StrCpy $R9 "$EXEDIR\school.kibschool"
  StrCpy $R8 "" ; что сказать в конце
  StrCpy $R4 ""
  ${If} ${FileExists} "$R9"
    ; Простейшая проверка: файл до 4 КБ и начинается с «{». Подпись и поля проверяет сама программа (parseSchoolFile)
    FileOpen $R7 "$R9" r
    FileSeek $R7 0 END $R6
    FileSeek $R7 0 SET
    FileReadByte $R7 $R5
    FileClose $R7
    ${If} $R6 > 4096
    ${OrIf} $R6 < 2
    ${OrIf} $R5 != 123
      StrCpy $R8 "Файл school.kibschool рядом с установщиком не похож на метку школы. Метка не поставлена. Сохраните файл заново в программе тьютора: «Школа» → «Сохранить school.kibschool»."
    ${Else}
      ; Папка-ссылка (junction) и папка, созданная учеником, отодвигаются: писать надо в свою папку ProgramData
      !insertmacro K1_FRESH_DIR
      ; Если папку отодвинуть не вышло: прежнюю метку (или подложенную ссылку с тем же именем) убираем
      RMDir "${K1_LABEL}"
      Delete "${K1_LABEL}"
      ClearErrors
      CopyFiles /SILENT "$R9" "${K1_LABEL}"
      ${If} ${Errors}
        StrCpy $R8 "Не удалось скопировать метку школы в ${K1_DIR}. Программа поставлена без метки."
      ${Else}
        !insertmacro K1_LOCK_DIR
        StrCpy $R8 "Метка школы поставлена. Программа будет брать игры из каталога школы по сети. Название школы и отпечаток видны в программе, сверьте их с программой тьютора."
      ${EndIf}
    ${EndIf}
  ${Else}
    ; Обновление без файла рядом: прежняя метка переносится в новую папку (копия получает её права), если её можно прочитать
    System::Call 'kernel32::GetFileAttributesW(w "${K1_DIR}") i .r2'
    ${If} $2 != -1
      !insertmacro K1_FRESH_DIR
      ${If} $R4 != ""
        ClearErrors
        CopyFiles /SILENT "$R4\school.json" "${K1_LABEL}"
      ${EndIf}
    ${EndIf}
    ${IfNot} ${FileExists} "${K1_LABEL}"
      StrCpy $R8 "Рядом с установщиком нет файла school.kibschool, поэтому программа поставлена без метки школы: игры открываются только из файлов, сети нет. Чтобы подключить ноутбук к школе, положите school.kibschool рядом с установщиком и запустите его ещё раз."
    ${EndIf}
  ${EndIf}
  !insertmacro K1_DROP_OLD
  ${If} $R8 != ""
  ${AndIfNot} ${Silent}
    MessageBox MB_OK|MB_ICONINFORMATION "$R8"
  ${EndIf}
!macroend

; Удаление снимает метку, обновление (старая версия удаляется перед новой) — нет.
; Разбор М5: штатный APP_UNASSOCIATE electron-builder снимает только класс «Игра KIBERone», а значение по умолчанию
; у .kibgames оставляет (на Windows после удаления: assoc .kibgames=Игра KIBERone). Снимаем его сами, только если оно наше;
; ключ .kibgames удаляется, лишь когда в нём больше ничего нет (другая программа могла дописать свои значения).
!macro customUnInstall
  ${IfNot} ${isUpdated}
    Delete "${K1_LABEL}"
    RMDir "${K1_DIR}"
    ReadRegStr $R0 HKLM "Software\Classes\.kibgames" ""
    ${If} $R0 == "${K1_FILECLASS}"
      DeleteRegValue HKLM "Software\Classes\.kibgames" ""
      DeleteRegValue HKLM "Software\Classes\.kibgames\OpenWithProgids" "${K1_FILECLASS}"
      DeleteRegKey /ifempty HKLM "Software\Classes\.kibgames\OpenWithProgids"
      DeleteRegKey /ifempty HKLM "Software\Classes\.kibgames"
    ${EndIf}
  ${EndIf}
!macroend

; Разбор М5 (после пилота): установщик не ставит молча версию старше той, что уже стоит.
; Проверяет внешний экземпляр, до запроса прав администратора: внутренний (после UAC) не спрашивает второй раз.
; Тихая установка (/S) поверх более новой версии завершается с кодом 2 и ничего не меняет.
; Откат на старую версию: удалить программу и поставить старую с school.kibschool рядом.
!macro customInit
  ${IfNot} ${UAC_IsInnerInstance}
    ReadRegStr $R0 HKLM "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
    ${If} $R0 != ""
      ${VersionCompare} "$R0" "${VERSION}" $R1
      ${If} $R1 == 1
        MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "На этом компьютере уже стоит более новая версия «Игр KIBERone» ($R0), а этот установщик — версии ${VERSION}. Обычно это значит, что на флешке старый установщик. Всё равно поставить старую версию?" /SD IDNO IDYES k1_downgrade_ok
        SetErrorLevel 2
        Quit
        k1_downgrade_ok:
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend
