$desktop = [System.Environment]::GetFolderPath('Desktop')
$target = "e:\colo\rocco\INICIAR_JARVIS.bat"
$shortcutPath = Join-Path $desktop "JARVIS.lnk"

$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut($shortcutPath)
$sc.TargetPath = $target
$sc.WorkingDirectory = "e:\colo\rocco"
$sc.Description = "J.A.R.V.I.S. Asistente Local"
$sc.Save()

Write-Output "Acceso directo creado con éxito en: $shortcutPath"
