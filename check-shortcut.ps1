$w = New-Object -ComObject WScript.Shell
$lnk = $w.CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\CC Memory.lnk")
Write-Host "Target: $($lnk.TargetPath)"
Write-Host "Icon: $($lnk.IconLocation)"
