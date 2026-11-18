[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$BundlePath,
    [string]$PythonExe = 'python'
)

$ErrorActionPreference = 'Stop'
$bundle = (Resolve-Path -LiteralPath $BundlePath).Path
$project = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $project '.sites-runtime/offline-tools'
$cache = Join-Path $bundle 'npm-cache'
$wheels = Join-Path $bundle 'wheels'

function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program exited with code $LASTEXITCODE" }
}

Push-Location -LiteralPath $project
try {
    Invoke-Checked $PythonExe @('-c', "import sys, sysconfig; sys.exit(0 if sys.version_info[:2] == (3,14) and sysconfig.get_platform() == 'win-amd64' and not sysconfig.get_config_var('Py_GIL_DISABLED') else 'Install 64-bit CPython 3.14 from the bundle first.')")
    $lockHash = Invoke-Checked $PythonExe @('-c', "import hashlib, pathlib; print(hashlib.sha256(pathlib.Path('package-lock.json').read_text(encoding='utf-8').encode()).hexdigest())")
    if ($lockHash -ne (Get-Content -Raw -LiteralPath (Join-Path $bundle 'package-lock.sha256')).Trim()) {
        throw 'The offline bundle belongs to a different package-lock.json.'
    }
    New-Item -ItemType Directory -Force -Path $tools | Out-Null
    $archives = @(
        @('tools/node-v24.22.3-win-x64.zip', $tools),
        @('addons/newera-windows-x64.zip', $tools),
        @('addons/house-plan-designer.zip', (Join-Path $tools 'house-plan-designer')),
        @('addons/roomsmith.zip', (Join-Path $tools 'roomsmith'))
    )
    foreach ($archive in $archives) {
        New-Item -ItemType Directory -Force -Path $archive[1] | Out-Null
        Invoke-Checked 'tar.exe' @('-xf', (Join-Path $bundle $archive[0]), '-C', $archive[1])
    }
    & (Join-Path $PSScriptRoot 'use-windows-offline.ps1')
    Invoke-Checked 'node' @((Join-Path $tools 'node-v24.22.3-win-x64/node_modules/npm/bin/npm-cli.js'), 'ci', '--offline', '--cache', $cache, '--include=dev', '--include=optional', '--no-audit', '--no-fund')
    Invoke-Checked $PythonExe @('-m', 'venv', 'recognition/.venv')
    Invoke-Checked $env:HOUSE_PLAN_PYTHON @('-m', 'pip', '--isolated', 'install', '--disable-pip-version-check', '--no-index', '--find-links', $wheels, '-r', 'recognition/requirements-lock.txt', 'opencv-python-headless==5.0.0.93')
    Invoke-Checked $env:HOUSE_PLAN_PYTHON @('-m', 'pip', 'check')
} finally {
    Pop-Location
}
