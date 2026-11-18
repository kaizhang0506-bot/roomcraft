$project = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $project '.sites-runtime/offline-tools'
$node = Join-Path $tools 'node-v24.22.3-win-x64'
if (-not (Test-Path -LiteralPath (Join-Path $node 'node.exe'))) {
    throw 'Run scripts/install-windows-offline.ps1 first.'
}
if (($env:Path -split ';') -notcontains $node) {
    $env:Path = "$node;$env:Path"
}
$env:HOUSE_PLAN_DESIGNER_DIR = Join-Path $tools 'house-plan-designer'
$env:HOUSE_PLAN_PYTHON = Join-Path $project 'recognition/.venv/Scripts/python.exe'
$env:ROOMSMITH_SOURCE_DIR = Join-Path $tools 'roomsmith'
$env:NEWERA_EXECUTABLE = Join-Path $tools '3D New Era AI/newera.exe'
