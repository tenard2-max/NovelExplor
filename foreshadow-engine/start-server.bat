@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo  Foreshadow Engine 로컬 서버 시작
echo ========================================
echo.

set "PY="
where py >nul 2>&1 && set "PY=py"
if not defined PY where python >nul 2>&1 && set "PY=python"
if not defined PY where python3 >nul 2>&1 && set "PY=python3"

if not defined PY (
  echo [오류] Python을 찾을 수 없습니다.
  echo.
  echo 1. https://www.python.org/downloads/ 에서 Python 설치
  echo 2. 설치 시 "Add python.exe to PATH" 체크
  echo 3. 설치 후 이 파일을 다시 실행
  echo.
  pause
  exit /b 1
)

REM 저장 데이터(IndexedDB)는 origin(host:port)별로 분리됩니다.
REM 재시작 후에도 같은 DB를 쓰려면 반드시 같은 주소(127.0.0.1:9000)로 접속해야 하므로
REM 포트를 9000으로 고정합니다. (포트를 바꾸면 브라우저가 다른 빈 DB를 열어 초기화된 것처럼 보입니다)
set "PORT=9000"

netstat -ano | findstr /C:":%PORT% " | findstr LISTENING >nul
if not errorlevel 1 (
  echo [안내] 포트 %PORT% 에서 서버가 이미 실행 중입니다.
  echo        기존 서버로 접속합니다 ^(같은 주소여야 저장 데이터가 유지됩니다^).
  echo.
  echo   http://127.0.0.1:%PORT%/
  echo.
  start "" "http://127.0.0.1:%PORT%/"
  exit /b 0
)

:start_server
echo Python: %PY%
echo 폴더: %CD%
echo.
echo 접속 주소:
echo   http://127.0.0.1:%PORT%/
echo   http://localhost:%PORT%/
echo.
echo [중요] index.html 파일을 직접 더블클릭하지 마세요.
echo        반드시 위 http 주소로 접속해야 합니다.
echo.
echo 서버를 종료하려면 이 창에서 Ctrl+C 를 누르세요.
echo.

start "" "http://127.0.0.1:%PORT%/"

%PY% -m http.server %PORT% --bind 127.0.0.1
if errorlevel 1 (
  echo.
  echo [오류] 서버 시작에 실패했습니다.
  echo - 방화벽에서 Python 허용 여부 확인
  echo - 다른 포트로 다시 시도
  echo.
  pause
  exit /b 1
)

pause
