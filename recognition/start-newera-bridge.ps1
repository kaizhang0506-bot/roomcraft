$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
$exe = Join-Path (Split-Path -Parent $projectRoot) 'newera-test/app/3D New Era AI/newera.exe'
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) { throw '未找到识别服务 Python 环境，请先按 README 安装 recognition 依赖。' }
if (-not $env:NEWERA_EXECUTABLE -and -not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw '未找到 New Era 程序，请设置 NEWERA_EXECUTABLE。' }
function Test-Port {
  $client = [System.Net.Sockets.TcpClient]::new()
  try { return $client.ConnectAsync('127.0.0.1', 8002).Wait(500) -and $client.Connected }
  catch { return $false }
  finally { $client.Dispose() }
}
if (Test-Port) { Write-Host '127.0.0.1:8002 已被占用；未修改任何已有进程。'; exit 1 }
$process = Start-Process -FilePath $python -WorkingDirectory $projectRoot -ArgumentList @('-m','uvicorn','recognition.newera_bridge:app','--host','127.0.0.1','--port','8002') -WindowStyle Hidden -PassThru
for ($i=0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Port) { Write-Host 'New Era 独立渲染桥已启动：http://127.0.0.1:8002'; exit 0 }
  $process.Refresh()
  if ($process.HasExited) { throw "渲染桥启动失败，退出码：$($process.ExitCode)。" }
}
throw '渲染桥未在 15 秒内就绪。'
