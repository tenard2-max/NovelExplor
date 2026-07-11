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
if not errorlevel 1 (
  echo [경고] 포트 %PORT% 이(가) 이미 사용 중입니다.
  echo        Live Server가 아닌 오래된 python 서버일 수 있습니다.
  echo        작업 관리자에서 python 을 종료하거나 포트를 비운 뒤 다시 시도하세요.
  echo.
  start "" "%APP_URL%"
) else (
  echo 포트 %PORT% 이 비어 있습니다. Cursor에서 루트 index.html 을 열고 Go Live 하세요.
)

pause
