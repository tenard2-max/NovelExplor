@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "PORT=9000"
set "APP_URL=http://127.0.0.1:%PORT%/index.html"

echo NovelExplor — Live Server 접속: %APP_URL%
echo.
echo [중요] IndexedDB 저장 데이터는 127.0.0.1:9000 에 있습니다.
echo        Live Server 포트를 9000 으로 맞추고 Go Live 하세요.
echo.

netstat -ano | findstr /C:":%PORT% " | findstr LISTENING >nul
if not errorlevel 1 start "" "%APP_URL%"

pause
