@echo off
chcp 65001 >nul
title 何解（本地服务）
cd /d "%~dp0"

set "PORT=%~1"
if "%PORT%"=="" set "PORT=8099"
set "URL=http://127.0.0.1:%PORT%/solver/index.html"
set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
set "PROFILE=%LOCALAPPDATA%\Hegy\browser"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [错误] 没有找到 Node.js，无法启动。
  echo  请先安装 Node.js：https://nodejs.org  （装好后重新双击本文件即可）
  echo.
  pause
  exit /b 1
)

netstat -ano -p tcp | findstr "LISTENING" | findstr /c:":%PORT% " >nul
if not errorlevel 1 (
  echo 服务已经在运行，直接打开专用浏览器窗口……
  call :openbrowser
  exit /b 0
)

echo ============================================
echo   何解 启动中（端口 %PORT%）……
echo   页面地址：%URL%
echo   用完关闭本窗口即可停止服务。
echo ============================================
echo.

call :openbrowser
node "%~dp0solver\serve.js" %PORT%

echo.
echo 服务已停止。
pause
exit /b 0

:openbrowser
if exist "%EDGE%" (
  start "" "%EDGE%" --user-data-dir="%PROFILE%" --no-first-run "%URL%"
) else (
  echo  [提示] 未找到 Edge，改用默认浏览器打开（历史与配置可能和专用窗口不同）。
  start "" "%URL%"
)
exit /b 0
