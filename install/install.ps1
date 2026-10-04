# vibi installer for Windows: https://vibivibi.com
#
#   irm https://vibivibi.com/install.ps1 | iex
#
# Downloads the vibi executable from the GitHub release, checks its SHA-256
# against the release's checksums.txt, puts it in %LOCALAPPDATA%\vibi\bin (no
# administrator rights needed) and adds that directory to your PATH.
#
#   $env:VIBI_VERSION = 'v0.2.0'   install that release instead of the latest one
#   $env:VIBI_INSTALL_DIR = ...    install somewhere else
#   $env:VIBI_RELEASE_URL = ...    fetch the assets from there instead of GitHub
$ErrorActionPreference = 'Stop'

$Repo = if ($env:VIBI_REPO) { $env:VIBI_REPO } else { 'subconscious-systems/vibi-cli' }
$InstallDir = if ($env:VIBI_INSTALL_DIR) { $env:VIBI_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'vibi\bin' }
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
  throw "vibi has no Windows build for $($env:PROCESSOR_ARCHITECTURE) yet (x64 only)."
}
$Asset = 'vibi-windows-x64.zip'
$Base = if ($env:VIBI_RELEASE_URL) { $env:VIBI_RELEASE_URL.TrimEnd('/') }
  elseif ($env:VIBI_VERSION) { "https://github.com/$Repo/releases/download/$($env:VIBI_VERSION)" }
  else { "https://github.com/$Repo/releases/latest/download" }

$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('vibi-install-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  Write-Host "Downloading $Asset from $Base ..."
  Invoke-WebRequest -Uri "$Base/$Asset" -OutFile (Join-Path $Tmp $Asset) -UseBasicParsing
  Invoke-WebRequest -Uri "$Base/checksums.txt" -OutFile (Join-Path $Tmp 'checksums.txt') -UseBasicParsing

  $Expected = Get-Content (Join-Path $Tmp 'checksums.txt') |
    Where-Object { $_ -match "\s$([regex]::Escape($Asset))$" } |
    ForEach-Object { ($_ -split '\s+')[0] } | Select-Object -First 1
  if (-not $Expected) { throw "$Asset is not listed in checksums.txt" }
  $Actual = (Get-FileHash -Algorithm SHA256 (Join-Path $Tmp $Asset)).Hash.ToLower()
  if ($Actual -ne $Expected.ToLower()) { throw "checksum mismatch for $Asset (expected $Expected, got $Actual)" }

  Expand-Archive -Path (Join-Path $Tmp $Asset) -DestinationPath $Tmp -Force
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  $Target = Join-Path $InstallDir 'vibi.exe'
  $Old = "$Target.old"
  if (Test-Path $Old) { Remove-Item $Old -Force -ErrorAction SilentlyContinue }
  # A vibi.exe that is running right now (vibi upgrade) cannot be overwritten, but it can be renamed.
  if (Test-Path $Target) { Move-Item $Target $Old -Force }
  Move-Item (Join-Path $Tmp 'vibi.exe') $Target -Force

  $UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (($UserPath -split ';') -contains $InstallDir)) {
    [Environment]::SetEnvironmentVariable('Path', ($UserPath.TrimEnd(';') + ';' + $InstallDir), 'User')
    Write-Host "Added $InstallDir to your PATH; open a new terminal to use vibi there."
  }
  if (-not (($env:Path -split ';') -contains $InstallDir)) { $env:Path = "$env:Path;$InstallDir" }

  Write-Host "Installed vibi $(& $Target --version) to $Target"
  Write-Host "Next: vibi enroll <code>   (codes come from https://vibivibi.com/dashboard/machines)"
} finally {
  Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}
