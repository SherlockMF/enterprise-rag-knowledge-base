# 创建桌面快捷方式脚本
param(
    [string]$ShortcutName = "企业知识库 RAG.lnk"
)

$desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)
$projectDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$targetBat = Join-Path $projectDir "一键启动.bat"
$shortcutPath = Join-Path $desktop $ShortcutName

$wshShell = New-Object -ComObject WScript.Shell
$shortcut = $wshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetBat
$shortcut.WorkingDirectory = $projectDir
$shortcut.Description = "企业知识库 RAG｜文档问答与审计系统"
# 使用系统内置网页/知识文档图标 (shell32.dll, 220 为知识/文档/网页图标)
$shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,220"
$shortcut.Save()

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host " [成功] 桌面快捷方式已创建: $shortcutPath" -ForegroundColor Green
Write-Host " 目标文件: $targetBat" -ForegroundColor Gray
Write-Host " 工作目录: $projectDir" -ForegroundColor Gray
Write-Host "====================================================" -ForegroundColor Cyan
