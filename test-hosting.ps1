param(
  [int]$Port = 5000,
  [int]$StartupTimeoutSec = 60
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$firebaseCmd = (Get-Command firebase.cmd -ErrorAction SilentlyContinue).Source
if (-not $firebaseCmd) {
  $firebaseCmd = (Get-Command firebase -ErrorAction SilentlyContinue).Source
}
if (-not $firebaseCmd) {
  throw "Firebase CLI not found. Install with: npm i -g firebase-tools"
}

function Invoke-Endpoint {
  param([string]$Path)
  $uri = "http://localhost:$Port$Path"
  try {
    $resp = Invoke-WebRequest -Uri $uri -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
    return [pscustomobject]@{
      Path = $Path
      Status = [int]$resp.StatusCode
      Body = [string]$resp.Content
    }
  } catch {
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $status = [int]$_.Exception.Response.StatusCode
      return [pscustomobject]@{
        Path = $Path
        Status = $status
        Body = ""
      }
    }
    throw
  }
}

$job = Start-Job -ScriptBlock {
  param($WorkingDir, $CmdPath, $ServePort)
  Set-Location $WorkingDir
  & $CmdPath serve --only hosting --port $ServePort
} -ArgumentList $root, $firebaseCmd, $Port

try {
  $init = $null
  for ($i = 0; $i -lt $StartupTimeoutSec; $i++) {
    try {
      $init = Invoke-Endpoint "/__/firebase/init.json"
      if ($init.Status -eq 200) { break }
    } catch {
      Start-Sleep -Seconds 1
      continue
    }
    Start-Sleep -Seconds 1
  }

  if (-not $init -or $init.Status -ne 200) {
    $logs = ""
    if ($job) {
      $logs = (Receive-Job $job -Keep | Out-String)
    }
    throw "Firebase Hosting did not become ready at http://localhost:$Port/__/firebase/init.json`n$logs"
  }

  $index = Invoke-Endpoint "/index.html"
  $login = Invoke-Endpoint "/login.html"
  $missing = Invoke-Endpoint "/_route_that_should_not_exist_"

  $checks = @(
    [pscustomobject]@{ Check = "init.json returns 200"; Passed = ($init.Status -eq 200); Detail = "status=$($init.Status)" },
    [pscustomobject]@{ Check = "init.json is valid JSON"; Passed = $false; Detail = "" },
    [pscustomobject]@{ Check = "index.html returns 200"; Passed = ($index.Status -eq 200); Detail = "status=$($index.Status)" },
    [pscustomobject]@{ Check = "login.html returns 200"; Passed = ($login.Status -eq 200); Detail = "status=$($login.Status)" },
    [pscustomobject]@{ Check = "unknown route is not SPA rewrite"; Passed = ($missing.Status -eq 404); Detail = "status=$($missing.Status)" }
  )

  try {
    $json = $init.Body | ConvertFrom-Json
    $valid = -not [string]::IsNullOrWhiteSpace($json.projectId)
    $checks[1].Passed = $valid
    $checks[1].Detail = if ($valid) { "projectId=$($json.projectId)" } else { "missing projectId" }
  } catch {
    $checks[1].Passed = $false
    $checks[1].Detail = "invalid JSON"
  }

  Write-Host ""
  Write-Host "Hosting smoke test results:"
  $checks | ForEach-Object {
    $mark = if ($_.Passed) { "[OK]" } else { "[FAIL]" }
    Write-Host ("{0} {1} ({2})" -f $mark, $_.Check, $_.Detail)
  }

  if ($checks.Passed -contains $false) {
    exit 1
  }
} finally {
  if ($job) {
    Stop-Job $job -ErrorAction SilentlyContinue
    Remove-Job $job -ErrorAction SilentlyContinue
  }
}
