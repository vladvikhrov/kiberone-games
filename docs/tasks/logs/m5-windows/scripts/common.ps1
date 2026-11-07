# Общие функции проверки М5 (windows-m5.md). Подключается точкой: . C:\K1-m5\scripts\common.ps1
[Console]::OutputEncoding = [Text.Encoding]::GetEncoding(866)
$K1 = 'C:\K1-m5'; $LOGS = "$K1\logs"
$LABEL_DIR = 'C:\ProgramData\KIBERone Games'
$RULE = 'KIBERone Server 47800'

function Step {
  param([string]$Log, [string]$Title, [scriptblock]$Do)
  $t = "### $Title  ($(Get-Date -Format HH:mm:ss))"
  $o = try { & $Do 2>&1 | Out-String -Width 250 } catch { "ОШИБКА: $_" }
  ($t, $o) | Out-File -Append -Encoding utf8 "$LOGS\$Log.txt"
  Write-Host $t -ForegroundColor Cyan
  Write-Host $o
}

function Need-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Это окно не от имени администратора'
  }
}

# Скрипт из C:\K1-m5\scripts от имени k1-uchenik, ждём окончания
function As-Student {
  param([string]$Script, [string[]]$More = @())
  if (-not $global:cred) { $global:cred = Get-Credential k1-uchenik -Message 'Пароль k1-uchenik' }
  $args2 = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "$K1\scripts\$Script") + $More
  $p = Start-Process powershell -Credential $global:cred -LoadUserProfile -WorkingDirectory $K1 -ArgumentList $args2 -Wait -PassThru
  "ученик: $Script $($More -join ' '), код выхода $($p.ExitCode)"
}

function Uninstall-Key { param([string]$Name)
  Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like "$Name*" }
}

function Show-Installed {
  Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like '*KIBERone*' } | Select-Object DisplayName, DisplayVersion, Publisher, PSPath | Format-List
}

# Тихая установка: код выхода
function Install-Silent { param([string]$Exe)
  $p = Start-Process $Exe -ArgumentList '/S' -Wait -PassThru
  "установка /S $Exe, код выхода $($p.ExitCode)"
}

# Тихое удаление. Деинсталлятор NSIS перезапускает себя из TEMP, поэтому ждём, пока исчезнет запись в реестре
function Uninstall-Silent { param([string]$Name)
  $k = Uninstall-Key $Name
  if (-not $k) { return "не установлено: $Name" }
  $cmd = if ($k.QuietUninstallString) { $k.QuietUninstallString } else { "$($k.UninstallString) /S" }
  $exe = ([regex]'^"([^"]+)"').Match($cmd).Groups[1].Value
  $rest = $cmd.Substring($exe.Length + 2).Trim()
  $p = Start-Process $exe -ArgumentList $rest -Wait -PassThru
  for ($i = 0; $i -lt 120 -and (Uninstall-Key $Name); $i++) { Start-Sleep 1 }
  "удаление $Name ($cmd), код $($p.ExitCode), запись в реестре: $(if (Uninstall-Key $Name) { 'осталась' } else { 'снята' })"
}

function Show-Label {
  "Test-Path: $(Test-Path $LABEL_DIR)"
  if (Test-Path $LABEL_DIR) {
    $i = Get-Item $LABEL_DIR -Force; "Attributes: $($i.Attributes)"
    "Owner: $((Get-Acl $LABEL_DIR).Owner)"
    icacls $LABEL_DIR
    Get-ChildItem $LABEL_DIR -Force | ForEach-Object { "$($_.Name)  $($_.Length)  $($_.Attributes)" }
    if (Test-Path "$LABEL_DIR\school.json") {
      icacls "$LABEL_DIR\school.json"
      "Owner school.json: $((Get-Acl "$LABEL_DIR\school.json").Owner)"
      "содержимое: $(Get-Content "$LABEL_DIR\school.json" -Raw)"
      (Get-FileHash "$LABEL_DIR\school.json").Hash
    }
  }
}

function Show-Rules {
  $r = Get-NetFirewallRule -DisplayName $RULE -ErrorAction SilentlyContinue
  "правил '$RULE': $(@($r).Count)"
  foreach ($x in $r) {
    $x | Select-Object DisplayName, Direction, Action, Enabled, Profile | Format-List | Out-String
    $x | Get-NetFirewallPortFilter | Select-Object Protocol, LocalPort | Format-List | Out-String
    $x | Get-NetFirewallAddressFilter | Select-Object RemoteAddress | Format-List | Out-String
    $x | Get-NetFirewallApplicationFilter | Select-Object Program | Format-List | Out-String
  }
  "всего входящих: $((Get-NetFirewallRule -Direction Inbound).Count); KIBERone*: $(@(Get-NetFirewallRule -DisplayName 'KIBERone*' -ErrorAction SilentlyContinue).Count)"
  if ($global:k1before) { "прибавилось с начала проверки: $((Get-NetFirewallRule -Direction Inbound).Count - $global:k1before)" }
}
