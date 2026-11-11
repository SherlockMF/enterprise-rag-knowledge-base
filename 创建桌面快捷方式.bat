@echo off
chcp 65001 >nul
title 创建企业知识库 RAG 桌面快捷方式

cd /d "%~dp0"

echo 正在生成桌面快捷方式...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\create_shortcut.ps1"

echo.
echo 按任意键退出...
pause >nul
