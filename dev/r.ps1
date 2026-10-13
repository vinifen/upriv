# r means run. It is the dev workspace runner and starts scripts/run.mjs.
$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "scripts\run.mjs"
& node $script @args
exit $LASTEXITCODE
