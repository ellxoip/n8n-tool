$ErrorActionPreference = "Stop"

$Version = "3.12.10"
$InstallerMd5 = "5eddb0b6f12c852725de071ae681dde4"
$RuntimeDir = Join-Path $PSScriptRoot "..\.runtime\python"
$InstallerPath = Join-Path $env:TEMP "python-$Version-amd64.exe"
$InstallerLog = Join-Path $env:TEMP "python-$Version-install.log"
$Url = "https://www.python.org/ftp/python/$Version/python-$Version-amd64.exe"
$TaskRunnerDir = Join-Path $PSScriptRoot "..\node_modules\@n8n\task-runner-python"
$TaskRunnerVenv = Join-Path $TaskRunnerDir ".venv"

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

$pythonExeCandidate = Join-Path $RuntimeDir "python.exe"
$needsInstall = -not (Test-Path $pythonExeCandidate)
if (-not $needsInstall) {
  $check = Start-Process -FilePath $pythonExeCandidate -ArgumentList @("-m", "venv", "--help") -NoNewWindow -Wait -PassThru -RedirectStandardOutput "$env:TEMP\python-venv-check.out" -RedirectStandardError "$env:TEMP\python-venv-check.err"
  $needsInstall = $check.ExitCode -ne 0
}

if ($needsInstall) {
  Write-Host "Downloading Python $Version installer..."
  Invoke-WebRequest -Uri $Url -OutFile $InstallerPath

  $hash = (Get-FileHash -Algorithm MD5 $InstallerPath).Hash.ToLowerInvariant()
  if ($hash -ne $InstallerMd5) {
    throw "Python installer checksum mismatch. Expected $InstallerMd5, got $hash"
  }

  Write-Host "Installing Python into project runtime..."
  $targetDir = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..')).Path ".runtime\python"
  $args = @(
    "/quiet",
    "/log",
    "`"$InstallerLog`"",
    "InstallAllUsers=0",
    "TargetDir=`"$targetDir`"",
    "Include_launcher=0",
    "InstallLauncherAllUsers=0",
    "PrependPath=0",
    "Include_test=0"
  )
  $process = Start-Process -FilePath $InstallerPath -ArgumentList $args -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Python installer failed with exit code $($process.ExitCode). Log: $InstallerLog"
  }
}

$pythonExePath = Join-Path $RuntimeDir "python.exe"
if (-not (Test-Path $pythonExePath)) {
  throw "Python installer finished but python.exe was not found at $pythonExePath. Log: $InstallerLog"
}
$pythonExe = Resolve-Path $pythonExePath
Write-Host "Python installed: $pythonExe"
& $pythonExe --version

if (Test-Path $TaskRunnerDir) {
  if (-not (Test-Path (Join-Path $TaskRunnerVenv "Scripts\python.exe"))) {
    Write-Host "Creating n8n Python task runner virtual environment..."
    & $pythonExe -m venv $TaskRunnerVenv
  }
  & (Join-Path $TaskRunnerVenv "Scripts\python.exe") --version
}

Write-Host ""
Write-Host "Add this to .env if n8n needs an explicit Python path:"
Write-Host "PYTHON_PATH=$pythonExe"
