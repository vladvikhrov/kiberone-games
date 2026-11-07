# Админ. Отладка «замка»: какой способ забрать папку ученика работает от администратора.
. C:\K1-m5\scripts\common.ps1
Need-Admin
$L = 'a3-zamok'
$d = $LABEL_DIR
Step $L 'ProgramData и права окна' { icacls C:\ProgramData; whoami /priv | findstr /i "TakeOwnership Restore Backup" }
Step $L 'ученик ставит замок' { As-Student 's-pre.ps1' @('zamok'); "Attributes: $((Get-Item $d -Force).Attributes)"; "Owner: $((Get-Acl $d).Owner)" }
Step $L '1. [IO.Directory]::Move' { try { [IO.Directory]::Move($d, "$d.t1"); "ПРОШЛО"; [IO.Directory]::Move("$d.t1", $d) } catch { "ОТКАЗ: $($_.Exception.InnerException.Message) $($_.Exception.Message)" } }
Step $L '2. cmd ren' { cmd /c ren "$d" "KIBERone Games.t2" 2>&1; "код $LASTEXITCODE"; if (Test-Path "$d.t2") { cmd /c ren "$d.t2" "KIBERone Games" } }
Step $L '3. takeown /A без /R, потом Move' {
  takeown /F "$d" /A 2>&1; "код takeown $LASTEXITCODE"
  "Owner: $((Get-Acl $d).Owner)"
  icacls "$d" /grant "*S-1-5-32-544:(OI)(CI)F" 2>&1; "код icacls $LASTEXITCODE"
  try { [IO.Directory]::Move($d, "$d.t3"); "Move ПРОШЛО" } catch { "Move ОТКАЗ: $($_.Exception.Message)" }
}
Step $L 'уборка' {
  foreach ($x in $d, "$d.t1", "$d.t2", "$d.t3") { if (Test-Path $x) { takeown /F "$x" /A | Out-Null; icacls "$x" /reset /T /C /Q; cmd /c rmdir /s /q "$x"; "убрано: $x — $(-not (Test-Path $x))" } }
}
Write-Host "Готово: $LOGS\$L.txt" -ForegroundColor Green
