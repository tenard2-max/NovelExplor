# NovelExplor — Live Server 접속 안내 (포트 9000)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$port = 9000
$appUrl = "http://127.0.0.1:$port/index.html"

Write-Host '========================================'
Write-Host ' NovelExplor — Live Server (포트 9000)'
Write-Host '========================================'
Write-Host ''
Write-Host "접속: $appUrl"
Write-Host ''
Write-Host '상위 폴더 index.html 에서 Go Live 하세요.'
Write-Host 'IndexedDB 데이터는 127.0.0.1:9000 에 저장됩니다.'
Write-Host ''

function Test-PortListening([int]$Port) {
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

if (Test-PortListening $port) {
  Start-Process $appUrl
} else {
  Write-Host "[안내] 포트 $port 에 서버가 없습니다. Live Server Go Live 후 다시 실행하세요." -ForegroundColor Yellow
  Read-Host 'Enter 키로 종료'
}
