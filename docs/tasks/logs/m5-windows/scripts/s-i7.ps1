# От ученика: попытки изменить метку (И7). Каждая должна получить отказ, чтение должно пройти.
param([string]$Dir = 'C:\ProgramData\KIBERone Games', [string]$Tag = 'i7')
. C:\K1-m5\scripts\common.ps1
$ErrorActionPreference = 'Stop'
$log = "student-$Tag"
Step $log "кто: $Tag, папка $Dir" { whoami; whoami /groups | findstr /i "S-1-5-32-544" ; 'строка выше с S-1-5-32-544 должна отсутствовать' }

function Try-It { param([string]$Name, [scriptblock]$Do)
  # В контрольной папке каждая попытка проходит, поэтому перед следующей папка и файл восстанавливаются
  if ($Tag -like 'kontrol*') { New-Item $Dir -ItemType Directory -Force | Out-Null; if (-not (Test-Path "$Dir\school.json")) { 'x' | Set-Content "$Dir\school.json" } }
  $global:LASTEXITCODE = 0
  $r = try { & $Do 2>&1 | Out-Null; if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { "ОТКАЗ (код $LASTEXITCODE)" } else { 'ПРОШЛО' } } catch { "ОТКАЗ: $($_.Exception.Message)" }
  $global:LASTEXITCODE = 0
  "{0,-34} {1}" -f $Name, $r
}

Step $log 'И7: 8 попыток записи и чтение' {
  Try-It 'Set-Content school.json' { Set-Content "$Dir\school.json" 'подмена' }
  Try-It 'Add-Content school.json' { Add-Content "$Dir\school.json" ' ' }
  Try-It 'Remove-Item school.json' { Remove-Item "$Dir\school.json" }
  Try-It 'Rename-Item school.json' { Rename-Item "$Dir\school.json" school.old }
  Try-It 'New-Item novyi.json' { New-Item "$Dir\novyi.json" -ItemType File }
  Try-It 'New-Item papka' { New-Item "$Dir\papka" -ItemType Directory }
  Try-It 'icacls /grant себе F' { icacls $Dir /grant "${env:USERNAME}:(OI)(CI)F" }
  Try-It 'Remove-Item папки -Recurse' { Remove-Item $Dir -Recurse }
  Try-It 'доп.: icacls /setowner себе' { icacls $Dir /setowner $env:USERNAME }
  Try-It 'доп.: icacls school.json /grant' { icacls "$Dir\school.json" /grant "${env:USERNAME}:F" }
  Try-It 'чтение Get-Content (должно пройти)' { Get-Content "$Dir\school.json" }
}
Step $log 'после попыток' { Get-ChildItem $Dir -Force -ErrorAction SilentlyContinue | ForEach-Object Name; icacls $Dir }
