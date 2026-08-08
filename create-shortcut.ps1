$ws = New-Object -ComObject WScript.Shell

# User Start Menu
$sm = $ws.CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\CC Memory.lnk")
$sm.TargetPath = "$env:LOCALAPPDATA\Programs\CC-Memory\CC Memory.exe"
$sm.WorkingDirectory = "$env:LOCALAPPDATA\Programs\CC-Memory"
$sm.IconLocation = "$env:LOCALAPPDATA\Programs\CC-Memory\CC Memory.exe,0"
$sm.Save()

# Desktop
$dt = $ws.CreateShortcut("$env:USERPROFILE\Desktop\CC Memory.lnk")
$dt.TargetPath = "$env:LOCALAPPDATA\Programs\CC-Memory\CC Memory.exe"
$dt.WorkingDirectory = "$env:LOCALAPPDATA\Programs\CC-Memory"
$dt.IconLocation = "$env:LOCALAPPDATA\Programs\CC-Memory\CC Memory.exe,0"
$dt.Save()

Write-Host "Done"
