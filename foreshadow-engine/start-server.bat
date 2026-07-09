@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "PORT=9000"
set "APP_URL=http://127.0.0.1:%PORT%/index.html"

echo ========================================
echo  NovelExplor — Live Server (포트 9000)
echo ========================================
echo.
echo 접속: %APP_URL%
echo.
echo 상위 폴더 index.html 에서 Go Live 하세요.
echo IndexedDB 데이터는 127.0.0.1:9000 에 저장됩니다.
echo.

netstat -ano | findstr /C:":%PORT% " | findstr LISTENING >nul
if not errorlevel 1 (
  start "" "%APP_URL%"
  exit /b 0
)

echo [안내] 포트 %PORT% 에 서버가 없습니다. Live Server Go Live 후 다시 실행하세요.
pause
