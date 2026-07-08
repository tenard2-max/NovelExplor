# Foreshadow Engine 로컬 서버 (PowerShell)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host '========================================'
Write-Host ' Foreshadow Engine 로컬 서버 시작'
Write-Host '========================================'
Write-Host ''

$py = $null
foreach ($cmd in @('py', 'python', 'python3')) {
  if (Get-Command $cmd -ErrorAction SilentlyContinue) {
    $py = $cmd
    break
  }
}

if (-not $py) {
  Write-Host '[오류] Python을 찾을 수 없습니다.' -ForegroundColor Red
  Write-Host 'Python 설치 후 PATH에 등록하고 다시 실행하세요.'
  Read-Host 'Enter 키로 종료'
  exit 1
}

function Test-PortFree([int]$Port) {
  return -not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

# 저장 데이터(IndexedDB)는 origin(host:port)별로 분리됩니다.
# 재시작 후에도 같은 DB를 쓰려면 반드시 같은 주소로 접속해야 하므로 host/port를 고정합니다.
# (host도 127.0.0.1 로 고정 — localhost 와 127.0.0.1 은 서로 다른 origin 이라 저장소가 갈립니다)
$port = 9000
$url = "http://127.0.0.1:$port/"

if (-not (Test-PortFree $port)) {
  Write-Host "[안내] 포트 $port 에서 서버가 이미 실행 중입니다. 기존 서버로 접속합니다." -ForegroundColor Yellow
  Write-Host "  $url"
  Start-Process $url
  exit 0
}

Write-Host "Python: $py"
Write-Host "폴더: $(Get-Location)"
Write-Host "주소: $url"
Write-Host ''
Write-Host '[중요] index.html을 직접 열지 말고 위 http 주소로 접속하세요.'
Write-Host '종료: Ctrl+C'
Write-Host ''

Start-Process $url
& $py -m http.server $port --bind 127.0.0.1
