; Установщик «Игры KIBERone» (этап М5). Подключается electron-builder через nsis.include.
; Метка школы (ADR-0002, 3.3): school.kibschool рядом с установщиком -> C:\ProgramData\KIBERone Games\school.json.
; Путь буквами, как в desktop/main.js (schoolPath): не из переменной, её ученик может подменить.
; Права: Администраторы (S-1-5-32-544) и SYSTEM (S-1-5-18) — полный доступ, Пользователи (S-1-5-32-545) — только чтение.

!define K1_DIR "C:\ProgramData\KIBERone Games"
!define K1_LABEL "C:\ProgramData\KIBERone Games\school.json"
!define K1_ACL '/inheritance:r /grant:r *S-1-5-32-544:(OI)(CI)F *S-1-5-18:(OI)(CI)F *S-1-5-32-545:(OI)(CI)RX'

; Права папки и всего в ней: владелец — Администраторы, наследование снято.
; Владелец меняется, чтобы ученик, создавший папку заранее, не сохранил право менять её права.
!macro K1_LOCK_DIR
  nsExec::ExecToLog 'icacls "${K1_DIR}" /setowner *S-1-5-32-544 /T /C /Q'
  Pop $1
  nsExec::ExecToLog 'icacls "${K1_DIR}" ${K1_ACL} /T /C /Q'
  Pop $1
!macroend

!macro customInstall
  StrCpy $R9 "$EXEDIR\school.kibschool"
  StrCpy $R8 "" ; что сказать в конце
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
      ; Папка-ссылка (junction), созданная учеником, удаляется как ссылка: писать надо в настоящую папку ProgramData
      System::Call 'kernel32::GetFileAttributesW(w "${K1_DIR}") i .r2'
      ${If} $2 != -1
        IntOp $3 $2 & 0x400
        ${If} $3 != 0
          RMDir "${K1_DIR}"
        ${EndIf}
      ${EndIf}
      CreateDirectory "${K1_DIR}"
      !insertmacro K1_LOCK_DIR
      ; Прежнюю метку (или подложенную ссылку с тем же именем) убираем, потом копируем заново
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
  ${ElseIf} ${FileExists} "${K1_LABEL}"
    ; Обновление без файла рядом: прежняя метка остаётся, права ставятся заново
    !insertmacro K1_LOCK_DIR
  ${Else}
    StrCpy $R8 "Рядом с установщиком нет файла school.kibschool, поэтому программа поставлена без метки школы: игры открываются только из файлов, сети нет. Чтобы подключить ноутбук к школе, положите school.kibschool рядом с установщиком и запустите его ещё раз."
  ${EndIf}
  ${If} $R8 != ""
  ${AndIfNot} ${Silent}
    MessageBox MB_OK|MB_ICONINFORMATION "$R8"
  ${EndIf}
!macroend

; Удаление снимает метку, обновление (старая версия удаляется перед новой) — нет
!macro customUnInstall
  ${IfNot} ${isUpdated}
    Delete "${K1_LABEL}"
    RMDir "${K1_DIR}"
  ${EndIf}
!macroend
