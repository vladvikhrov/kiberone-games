# Админ. Разделы 1 и 2 windows-m5.md: тестовый ученик, брандмауэр до установки, состояние защиты. Запуск: . C:\K1-m5\scripts\a1-prep.ps1
. C:\K1-m5\scripts\common.ps1
Need-Admin
$L = 'a1-prep'
Step $L 'система' {
  $os = Get-CimInstance Win32_OperatingSystem; "$($os.Caption) $($os.Version) $($os.OSArchitecture)"
  "Smart App Control (0 выкл, 1 вкл, 2 оценка): $((Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -ErrorAction SilentlyContinue).VerifiedAndReputablePolicyState)"
  Get-MpComputerStatus | Select-Object AMRunningMode, RealTimeProtectionEnabled, AntivirusSignatureLastUpdated | Format-List
  Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' | Select-Object EnableLUA, ConsentPromptBehaviorAdmin | Format-List
}
if (-not (Get-LocalUser k1-uchenik -ErrorAction SilentlyContinue)) {
  $p = Read-Host -AsSecureString 'Придумайте временный пароль для k1-uchenik'
  New-LocalUser k1-uchenik -Password $p -FullName 'Ученик М5' -AccountNeverExpires | Out-Null
  Add-LocalGroupMember -SID 'S-1-5-32-545' -Member k1-uchenik
}
Step $L 'раздел 1: запись ученика' {
  Get-LocalUser k1-uchenik | Select-Object Name, Enabled, PasswordRequired | Format-List
  'Администраторы:'; Get-LocalGroupMember -SID 'S-1-5-32-544' | ForEach-Object Name
  'Пользователи:'; Get-LocalGroupMember -SID 'S-1-5-32-545' | ForEach-Object Name
}
$global:cred = Get-Credential k1-uchenik -Message 'Тот же пароль k1-uchenik ещё раз'
Step $L 'раздел 1: окно ученика' { As-Student 's-pre.ps1' @('who'); Get-Content "$LOGS\student-who.txt" }
if (-not $global:k1before) { $global:k1before = (Get-NetFirewallRule -Direction Inbound).Count }
Step $L 'раздел 2: брандмауэр до установки' { "входящих правил: $global:k1before"; Show-Rules; Show-Installed; Show-Label }
Step $L 'раздел 3: подпись и метка «из интернета»' {
  Copy-Item "$K1\KIBERone-Server-Setup-1.2.0.exe", "$K1\KIBERone-Games-Setup-1.2.0.exe" "$K1\motw\" -Force
  foreach ($f in Get-ChildItem "$K1\motw\*.exe") {
    Set-Content $f.FullName -Stream Zone.Identifier -Value "[ZoneTransfer]`r`nZoneId=3"
    "$($f.Name): подпись $((Get-AuthenticodeSignature $f.FullName).Status), Zone: $((Get-Content $f.FullName -Stream Zone.Identifier) -join ' ')"
  }
  'Обнаружения Защитника (последние 3):'; Get-MpThreatDetection | Select-Object -Last 3 | Format-List InitialDetectionTime, ThreatID, Resources
}
Write-Host "Готово: $LOGS\$L.txt" -ForegroundColor Green
