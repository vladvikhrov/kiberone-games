# От ученика: подготовка подвоха до установки (И7).
#  plain    — папка метки создана заранее, внутри своя school.json (как в windows-m5.md)
#  ace      — то же и явное правило «мне полный доступ» на папку (переживает /inheritance:r)
#  zamok    — папка, где права есть только у самого ученика (Администраторы и SYSTEM убраны)
#  junction — папка метки как ссылка на свою папку в профиле
#  kontrol  — своя папка C:\ProgramData\K1-kontrol без установщика (контроль: команды И7 проходят)
#  cleanup  — убрать свою папку fake и K1-kontrol
param([string]$Mode)
. C:\K1-m5\scripts\common.ps1
$log = 'student-pre'
$d = 'C:\ProgramData\KIBERone Games'
switch ($Mode) {
  'who' { Step 'student-who' 'раздел 1: кто я' { whoami; whoami /groups | findstr /i "S-1-5-32-544 S-1-5-32-545"; 'S-1-5-32-544 (Администраторы) в списке быть не должно' } }
  'plain' { Step $log 'pre plain' { New-Item $d -ItemType Directory; '{"chuzhaya":1}' | Set-Content "$d\school.json"; icacls $d; (Get-Acl $d).Owner } }
  'ace' { Step $log 'pre ace' { New-Item $d -ItemType Directory; '{"chuzhaya":1}' | Set-Content "$d\school.json"; icacls $d /grant "${env:USERNAME}:(OI)(CI)F"; icacls $d; (Get-Acl $d).Owner } }
  'zamok' { Step $log 'pre zamok' { New-Item $d -ItemType Directory; '{"chuzhaya":1}' | Set-Content "$d\school.json"; icacls $d /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)F" /T; icacls $d; (Get-Acl $d).Owner } }
  'junction' { Step $log 'pre junction' { New-Item "$env:USERPROFILE\fake" -ItemType Directory -Force; cmd /c mklink /J "$d" "$env:USERPROFILE\fake"; (Get-Item $d -Force).Attributes } }
  'kontrol' { Step $log 'pre kontrol' { $k = 'C:\ProgramData\K1-kontrol'; New-Item $k -ItemType Directory -Force; 'x' | Set-Content "$k\school.json"; icacls $k } }
  'fakelist' { Step $log 'fake после установки' { "$env:USERPROFILE\fake:"; Get-ChildItem "$env:USERPROFILE\fake" -Force | ForEach-Object Name; 'конец списка' } }
  'cleanup' { Step $log 'cleanup' { Remove-Item "$env:USERPROFILE\fake" -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item 'C:\ProgramData\K1-kontrol' -Recurse -Force -ErrorAction SilentlyContinue; 'ok' } }
}
