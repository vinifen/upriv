# Install the official WinFsp MSI that ships beside this script.
# Windows asks for administrator permission. Declining leaves the in-app file manager working.
$ErrorActionPreference = "Stop"
$msi = Join-Path $PSScriptRoot "winfsp-2.1.25156.msi"
if (-not (Test-Path -LiteralPath $msi)) {
  Write-Error "WinFsp installer is missing."
  exit 1
}
$proc = Start-Process -FilePath "$env:SystemRoot\System32\msiexec.exe" -ArgumentList @("/i", $msi, "/qn", "/norestart") -Verb RunAs -Wait -PassThru
if ($null -eq $proc) {
  exit 1
}
exit $proc.ExitCode
