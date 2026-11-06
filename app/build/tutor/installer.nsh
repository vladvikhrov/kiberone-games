; Установщик «KIBERone Сервер» (этап М5). Подключается electron-builder через nsis.include (builder-tutor.json).
; Правило брандмауэра (ADR-0002, 3.7): входящие TCP и UDP 47800 только для kiberone-server.exe,
; только из своей подсети (remoteip=localsubnet), для всех профилей: школьный Wi-Fi часто «общедоступная сеть».
; Имя правила латиницей: netsh из установщика с кириллицей в имени не проверялся.
; Данные школы (%LOCALAPPDATA%\KIBERone Server) не трогаются ни здесь, ни при удалении (deleteAppDataOnUninstall: false).

!define K1_RULE "KIBERone Server 47800"
!define K1_PORT "47800"

!macro K1_RULE_DELETE
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${K1_RULE}"'
  Pop $1
!macroend

!macro customInstall
  ; Повторная установка не плодит копии: прежние правила с этим именем удаляются
  !insertmacro K1_RULE_DELETE
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${K1_RULE}" dir=in action=allow program="$INSTDIR\kiberone-server.exe" protocol=TCP localport=${K1_PORT} remoteip=localsubnet profile=any enable=yes'
  Pop $1
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${K1_RULE}" dir=in action=allow program="$INSTDIR\kiberone-server.exe" protocol=UDP localport=${K1_PORT} remoteip=localsubnet profile=any enable=yes'
  Pop $2
  StrCpy $3 "ok"
  ${If} $1 != 0
    StrCpy $3 "fail"
  ${EndIf}
  ${If} $2 != 0
    StrCpy $3 "fail"
  ${EndIf}
  ${If} $3 == "fail"
  ${AndIfNot} ${Silent}
    MessageBox MB_OK|MB_ICONEXCLAMATION "Правило брандмауэра для порта ${K1_PORT} создать не удалось. При первом включении раздачи Windows спросит про доступ к сети: отметьте сеть школы и нажмите «Разрешить»."
  ${EndIf}
  ${IfNot} ${Silent}
    MessageBox MB_OK|MB_ICONINFORMATION "Программа тьютора поставлена. Запишите код восстановления на бумагу при создании школы и сохраните резервную копию: «Школа» → «Резервная копия». Данные школы не удаляются вместе с программой."
  ${EndIf}
!macroend

; Удаление снимает правило, обновление — нет. Ключ школы, каталог и оценки остаются
!macro customUnInstall
  ${IfNot} ${isUpdated}
    !insertmacro K1_RULE_DELETE
  ${EndIf}
!macroend
