[CmdletBinding()]
param(
    [switch]$RecognitionOnly,
    [switch]$NewEraOnly,
    [string]$NewEraExecutable
)

$ErrorActionPreference = 'Stop'
if ($RecognitionOnly -and $NewEraOnly) { throw 'Choose only one service switch, or omit both to start both services.' }
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$pythonPath = Join-Path $projectRoot 'recognition/.venv/Scripts/python.exe'
$logDirectory = Join-Path $projectRoot '.sites-runtime'
if (-not (Test-Path -LiteralPath $pythonPath -PathType Leaf)) {
    throw 'Install recognition/requirements.txt in recognition/.venv first; see README.md.'
}
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

function Start-RoomcraftService {
    param([int]$Port, [string]$Module, [string]$Name)
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    $started = $false
    if ($listeners.Count) {
        foreach ($listener in $listeners) {
            $owner = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listener.OwningProcess)
            $command = [string]$owner.CommandLine
            $normalizedCommand = $command.Replace('/', '\')
            $normalizedPython = $pythonPath.Replace('/', '\')
            if (-not $normalizedCommand.Contains($normalizedPython) -or $command -notmatch [regex]::Escape($Module) -or $command -notmatch ('--port\s+' + $Port + '(?:\s|$)')) {
                throw "Port $Port is occupied by another process. No process was changed."
            }
        }
    } else {
        # Launch only the local adapter. New Era itself starts only when a render is requested.
        $process = Start-Process -FilePath $pythonPath -WorkingDirectory $projectRoot `
            -ArgumentList @('-m', 'uvicorn', $Module, '--host', '127.0.0.1', '--port', [string]$Port) `
            -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $logDirectory "$Name-service.log") `
            -RedirectStandardError (Join-Path $logDirectory "$Name-service-error.log")
        $started = $true
    }
    $health = $null
    for ($attempt = 0; $attempt -lt 15; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 6
            break
        } catch {
            if ($started) {
                $process.Refresh()
                if ($process.HasExited) { throw "The $Name service exited. Check .sites-runtime/$Name-service-error.log." }
            }
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not $health) { throw "The $Name service did not become ready. Check its local log." }
    if ($Name -eq 'recognition') {
        if ($health.status -ne 'ok' -or $health.provider -ne 'cpu-geometric') { throw 'Unexpected recognition health response.' }
        [pscustomobject]@{ Service = $Name; Port = $Port; Started = $started; HouseAvailable = ($health.houseAvailable -eq $true); RoomsmithAvailable = ($health.roomsmithAvailable -eq $true) }
    } else {
        if ($health.ok -ne $true -or $health.renderer -ne 'newera-render-photo' -or $health.installed -ne $true) { throw 'New Era bridge is reachable, but its renderer is not installed. Set NEWERA_EXECUTABLE and restart the bridge.' }
        [pscustomobject]@{ Service = $Name; Port = $Port; Started = $started; RendererInstalled = $true }
    }
}

if (-not $NewEraOnly) { Start-RoomcraftService -Port 8001 -Module 'recognition.app:app' -Name 'recognition' }
if (-not $RecognitionOnly) {
    $originalExecutable = $env:NEWERA_EXECUTABLE
    try {
        if ($NewEraExecutable) { $env:NEWERA_EXECUTABLE = [IO.Path]::GetFullPath($NewEraExecutable) }
        $executable = if ($env:NEWERA_EXECUTABLE) { $env:NEWERA_EXECUTABLE } else { Join-Path (Split-Path -Parent $projectRoot) 'newera-test/app/3D New Era AI/newera.exe' }
        if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'New Era is not installed. Pass -NewEraExecutable with the installed newera.exe path.' }
        Start-RoomcraftService -Port 8002 -Module 'recognition.newera_bridge:app' -Name 'newera'
    } finally {
        $env:NEWERA_EXECUTABLE = $originalExecutable
    }
}
