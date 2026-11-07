# Админ. И7: ученик готовит папку метки до установки, потом тихая установка и попытки ученика.
# Метка здесь — заглушка {"zaglushka":1}: установщик проверяет только размер и «{», подпись проверяет программа.
# Запуск: . C:\K1-m5\scripts\a2-podvoh.ps1   (после a1-prep.ps1 в том же окне)
param([string]$Setup = 'C:\K1-m5\KIBERone-Games-Setup-1.2.0.exe', [string]$Tag = 'A')
. C:\K1-m5\scripts\common.ps1
Need-Admin
$L = "a2-podvoh-$Tag"
$pre = "$K1\pre"
New-Item $pre -ItemType Directory -Force | Out-Null
Copy-Item $Setup "$pre\setup.exe" -Force
'{"zaglushka":1}' | Set-Content "$pre\school.kibschool" -Encoding ascii
Step $L 'исходно' { Show-Installed; Show-Label }
if (Uninstall-Key 'Игры KIBERone') { Step $L 'снимаю прежнюю установку' { Uninstall-Silent 'Игры KIBERone'; Show-Label } }

foreach ($mode in 'plain', 'ace', 'zamok', 'junction') {
  Step $L "== ${mode}: ученик готовит" { As-Student 's-pre.ps1' @($mode); Show-Label }
  Step $L "== ${mode}: установка /S с меткой рядом" { Install-Silent "$pre\setup.exe"; Show-Label }
  if ($mode -eq 'junction') { Step $L "== ${mode}: что попало в fake" { As-Student 's-pre.ps1' @('fakelist'); Get-Content "$LOGS\student-pre.txt" -Tail 6 } }
  Step $L "== ${mode}: попытки ученика" { As-Student 's-i7.ps1' @('-Tag', "$Tag-$mode"); Get-Content "$LOGS\student-$Tag-$mode.txt" }
  Step $L "== ${mode}: удаление" { Uninstall-Silent 'Игры KIBERone'; Show-Label }
  if (Test-Path $LABEL_DIR) { Step $L "== ${mode}: папка осталась после удаления, убираю" { icacls "$LABEL_DIR" /setowner *S-1-5-32-544 /T /C /Q; icacls "$LABEL_DIR" /reset /T /C /Q; cmd /c rmdir /s /q "$LABEL_DIR"; Show-Label } }
}
Step $L 'контроль: своя папка ученика' { As-Student 's-pre.ps1' @('kontrol'); As-Student 's-i7.ps1' @('-Dir', 'C:\ProgramData\K1-kontrol', '-Tag', "kontrol-$Tag"); Get-Content "$LOGS\student-kontrol-$Tag.txt" }
Step $L 'уборка ученика' { As-Student 's-pre.ps1' @('cleanup'); Remove-Item $pre -Recurse -Force }
Write-Host "Готово: $LOGS\$L.txt" -ForegroundColor Green
