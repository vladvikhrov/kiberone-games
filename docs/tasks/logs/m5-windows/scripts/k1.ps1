# Админ. Этапы разделов 3–7 и 10 windows-m5.md. Запуск: . C:\K1-m5\scripts\k1.ps1 <этап>
param([Parameter(Mandatory)][string]$Stage)
. C:\K1-m5\scripts\common.ps1
Need-Admin
$L = "k1-$Stage"
$TUTOR_EXE = 'C:\Program Files\kiberone-server\kiberone-server.exe'
$GAMES_EXE = 'C:\Program Files\kiberone-games\kiberone-games.exe'
$GAME = 'C:\K1-m5\games\K1-test-games\games\kiberpochta.kibgames'
function Detections { 'Обнаружения Защитника (последние 3):'; Get-MpThreatDetection | Select-Object -Last 3 | Format-List InitialDetectionTime, ThreatID, Resources | Out-String }
function Shortcuts { foreach ($p in "$env:PUBLIC\Desktop", "$env:ProgramData\Microsoft\Windows\Start Menu\Programs") { Get-ChildItem $p -Recurse -Filter '*KIBERone*.lnk' -ErrorAction SilentlyContinue | ForEach-Object FullName } ; 'ярлыки — конец' }
function Assoc { cmd /c assoc .kibgames 2>&1; cmd /c ftype 2>&1 | findstr /i kib; 'ассоциация — конец' }

switch ($Stage) {
  'motw' {
    Step $L 'метка «из интернета» на копиях' {
      Copy-Item "$K1\KIBERone-Server-Setup-1.2.0.exe", "$K1\KIBERone-Games-Setup-1.2.0.exe" "$K1\motw\" -Force
      foreach ($f in Get-ChildItem "$K1\motw\*.exe") {
        Set-Content $f.FullName -Stream Zone.Identifier -Value "[ZoneTransfer]`r`nZoneId=3"
        "$($f.Name): подпись $((Get-AuthenticodeSignature $f.FullName).Status); $((Get-Content $f.FullName -Stream Zone.Identifier) -join ' ')"
      }
      Detections
    }
  }
  'tutor' {
    Step $L 'после установки тьютора' { Show-Installed; "папка: $(Split-Path $TUTOR_EXE)"; Test-Path $TUTOR_EXE; (Get-Item $TUTOR_EXE).VersionInfo | Format-List FileDescription, ProductName, ProductVersion, CompanyName | Out-String; Show-Rules; Shortcuts; Detections }
    Step $L 'повторная установка того же файла /S' { Install-Silent "$K1\KIBERone-Server-Setup-1.2.0.exe"; Show-Rules; Show-Installed }
  }
  'tutor-app' { Step $L 'правила после «Включить раздачу»' { Show-Rules; Get-NetConnectionProfile | Select-Object Name, InterfaceAlias, NetworkCategory | Format-List | Out-String; Get-NetTCPConnection -LocalPort 47800 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress, OwningProcess | Out-String } }
  'bez' { Step $L 'подготовка: установщик без метки' { Copy-Item "$K1\KIBERone-Games-Setup-1.2.0.exe" "$K1\bez\" -Force; Get-ChildItem "$K1\bez" | ForEach-Object Name } }
  'krivaya1' { Step $L 'подготовка: метка «привет»' { if (Uninstall-Key 'Игры KIBERone') { Uninstall-Silent 'Игры KIBERone' }; Copy-Item "$K1\KIBERone-Games-Setup-1.2.0.exe" "$K1\krivaya\" -Force; 'привет' | Set-Content "$K1\krivaya\school.kibschool" -Encoding utf8; Show-Label } }
  'krivaya2' { Step $L 'подготовка: метка 10 КБ' { Show-Label; if (Uninstall-Key 'Игры KIBERone') { Uninstall-Silent 'Игры KIBERone' }; '{' + (' ' * 10240) | Set-Content "$K1\krivaya\school.kibschool" -Encoding ascii; (Get-Item "$K1\krivaya\school.kibschool").Length } }
  'label' { Step $L 'после установки ученика с меткой' { Show-Installed; Show-Label; "school.kibschool: $((Get-FileHash "$K1\school.kibschool").Hash)"; Show-Rules; Assoc; Shortcuts; Detections } }
  'student-app' { Step $L 'витрина от ученика' { Start-Process $GAMES_EXE -Credential $global:cred -LoadUserProfile -WorkingDirectory 'C:\Program Files\kiberone-games'; 'запущено' } }
  'i12' {
    Step $L 'И12: файл .kibgames от ученика (как двойной щелчок)' { Start-Process $GAMES_EXE -ArgumentList "`"$GAME`"" -Credential $global:cred -LoadUserProfile -WorkingDirectory 'C:\Program Files\kiberone-games'; 'запущено с файлом' }
  }
  'i12-keys' {
    Step $L 'И12: ключи запуска от ученика' {
      $p1 = Start-Process $GAMES_EXE -ArgumentList "--school=$K1\school.kibschool" -Credential $global:cred -LoadUserProfile -WorkingDirectory 'C:\Program Files\kiberone-games' -PassThru
      Start-Sleep 6; "--school: процесс жив: $(-not $p1.HasExited), код $(if ($p1.HasExited) { $p1.ExitCode })"
      $p2 = Start-Process $GAMES_EXE -ArgumentList '--inspect=9229' -Credential $global:cred -LoadUserProfile -WorkingDirectory 'C:\Program Files\kiberone-games' -PassThru
      Start-Sleep 6; "--inspect: процесс жив: $(-not $p2.HasExited), код $(if ($p2.HasExited) { $p2.ExitCode })"
      "порт 9229: $(@(Get-NetTCPConnection -LocalPort 9229 -ErrorAction SilentlyContinue).Count) соединений (должно быть 0)"
    }
  }
  'i7' { Step $L 'И7 с настоящей меткой' { Show-Label; As-Student 's-i7.ps1' @('-Tag', 'real'); Get-Content "$LOGS\student-real.txt" -Tail 20; Show-Label } }
  'i9' {
    Step $L 'И9: удаление и тихая установка с меткой' {
      Uninstall-Silent 'Игры KIBERone'; Show-Label
      $p = Start-Process "$K1\KIBERone-Games-Setup-1.2.0.exe" -ArgumentList '/S' -Wait -PassThru; "код выхода /S: $($p.ExitCode)"
      Show-Installed; Show-Label; Shortcuts; Assoc
    }
  }
  'cache' { Step $L 'кеш ученика' { As-Student 's-misc.ps1' @('cache'); Get-Content "$LOGS\student-cache.txt" -Tail 25 } }
  'update' {
    Step $L 'И10: до обновления' { Show-Installed; Show-Label; Show-Rules }
    Step $L 'И10: 1.2.1 поверх, без school.kibschool рядом' {
      "рядом с 1.2.1: $((Get-ChildItem "$K1\v121" | ForEach-Object Name) -join ', ')"
      Install-Silent "$K1\v121\KIBERone-Games-Setup-1.2.1.exe"; Install-Silent "$K1\v121\KIBERone-Server-Setup-1.2.1.exe"
      Show-Installed; Show-Label; Show-Rules; Shortcuts; Assoc
      Get-ChildItem C:\ProgramData -Force -Filter 'KIBERone*' | ForEach-Object Name
    }
  }
  'downgrade' { Step $L 'И10: после возврата на 1.2.0' { Show-Installed; Show-Label; Show-Rules } }
  'tutor-data' { Step $L 'данные тестовой школы' { Get-ChildItem "C:\Users\vladv\AppData\Local\Temp\k1-m5-tutor\KIBERone Server" -Force | ForEach-Object { "$($_.Name)  $($_.Length)" } } }
  'tutor-uninstall' {
    Step $L 'И11: до удаления тьютора' { Get-ChildItem "C:\Users\vladv\AppData\Local\Temp\k1-m5-tutor\KIBERone Server" -Force | ForEach-Object { "$($_.Name)  $($_.Length)" }; Show-Rules }
    Step $L 'И11: удаление тьютора' { Uninstall-Silent 'KIBERone Сервер'; Show-Rules; Show-Installed; "папка программы: $(Test-Path (Split-Path $TUTOR_EXE))"; Shortcuts; 'данные школы после:'; Get-ChildItem "C:\Users\vladv\AppData\Local\Temp\k1-m5-tutor\KIBERone Server" -Force | ForEach-Object { "$($_.Name)  $($_.Length)" } }
    Step $L 'И11: тьютор снова' { Install-Silent "$K1\KIBERone-Server-Setup-1.2.0.exe"; Show-Rules; Show-Installed }
  }
  'student-uninstall' { Step $L 'удаление ученика' { Uninstall-Silent 'Игры KIBERone'; Show-Installed; Show-Label; "папка программы: $(Test-Path (Split-Path $GAMES_EXE))"; Shortcuts; Assoc } }
  'cleanup' {
    Step $L 'уборка (раздел 10)' {
      Get-Process kiberone-games, kiberone-server -ErrorAction SilentlyContinue | Stop-Process -Force
      Uninstall-Silent 'Игры KIBERone'; Uninstall-Silent 'KIBERone Сервер'
      if (Get-LocalUser k1-uchenik -ErrorAction SilentlyContinue) { Remove-LocalUser k1-uchenik; 'запись k1-uchenik удалена' }
      Get-CimInstance Win32_UserProfile | Where-Object LocalPath -like '*\k1-uchenik' | Remove-CimInstance
      if (Test-Path C:\Users\k1-uchenik) { cmd /c rmdir /s /q C:\Users\k1-uchenik }
      Remove-Item 'C:\Users\vladv\AppData\Local\Temp\k1-m5-tutor' -Recurse -Force -ErrorAction SilentlyContinue
      Remove-Item 'C:\ProgramData\K1-kontrol' -Recurse -Force -ErrorAction SilentlyContinue
      "профиль k1-uchenik: $(Test-Path C:\Users\k1-uchenik); запись: $([bool](Get-LocalUser k1-uchenik -ErrorAction SilentlyContinue)); тестовая школа: $(Test-Path 'C:\Users\vladv\AppData\Local\Temp\k1-m5-tutor')"
      Show-Installed; Show-Label; Shortcuts; Assoc
      "правил KIBERone*: $(@(Get-NetFirewallRule -DisplayName 'KIBERone*' -ErrorAction SilentlyContinue).Count); правил с программой kiberone: $(@(Get-NetFirewallApplicationFilter | Where-Object Program -like '*kiberone*').Count)"
      "входящих правил: $((Get-NetFirewallRule -Direction Inbound).Count) (было до проверки: 432)"
      Get-ChildItem C:\ProgramData -Force -Filter 'KIBERone*' | ForEach-Object Name
    }
  }
  default { "неизвестный этап $Stage" }
}
Write-Host "Готово: $LOGS\$L.txt" -ForegroundColor Green
