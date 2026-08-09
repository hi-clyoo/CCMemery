$ws = New-Object -ComObject WScript.Shell

$target = "$env:LOCALAPPDATA\Programs\CC Memory\CC Memory.exe"
$wd = "$env:LOCALAPPDATA\Programs\CC Memory"
$icon = "$env:LOCALAPPDATA\Programs\CC Memory\icon.ico"

$sm = $ws.CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\CC Memory.lnk")
$sm.TargetPath = $target
$sm.WorkingDirectory = $wd
$sm.IconLocation = "$icon,0"
$sm.WindowStyle = 1
$sm.Save()

$dt = $ws.CreateShortcut("$env:USERPROFILE\Desktop\CC Memory.lnk")
$dt.TargetPath = $target
$dt.WorkingDirectory = $wd
$dt.IconLocation = "$icon,0"
$dt.WindowStyle = 1
$dt.Save()

Write-Host "Done"
