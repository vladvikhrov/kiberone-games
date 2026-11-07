# От ученика: кеш программы ученика (И10)
param([string]$Mode)
. C:\K1-m5\scripts\common.ps1
switch ($Mode) {
  'cache' { Step 'student-cache' 'кеш ученика' { "LOCALAPPDATA: $env:LOCALAPPDATA"; Get-ChildItem "$env:LOCALAPPDATA\KIBERone Games" -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object { "$($_.FullName.Replace($env:LOCALAPPDATA, '%LOCALAPPDATA%'))  $($_.Length)  $($_.LastWriteTime.ToString('HH:mm:ss'))" }; 'кеш — конец' } }
}
