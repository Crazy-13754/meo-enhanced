param(
  [Parameter(Mandatory=$true)][string]$CodePath,
  [ValidateRange(1024,65535)][int]$Port=9347
)
$ErrorActionPreference='Stop'
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
  throw 'The debugging port is already in use; choose another -Port.'
}
$repoRoot=Split-Path $PSScriptRoot -Parent
$codeExecutable=(Resolve-Path -LiteralPath $CodePath).Path
$output=Join-Path $repoRoot ('.local/probes/preview-shortcuts-'+[guid]::NewGuid().ToString('N'))
$profileDirectory=Join-Path $output 'profile'
$profileUser=Join-Path $profileDirectory 'User'
$workspace=Join-Path $output 'workspace'
$extensions=Join-Path $output 'extensions'
New-Item -ItemType Directory -Force $profileUser,$workspace,$extensions | Out-Null
@'
[
  {"key":"ctrl+alt+p","command":"workbench.action.showCommands"},
  {"key":"ctrl+alt+o","command":"workbench.action.quickOpen"},
  {"key":"ctrl+k ctrl+m","command":"workbench.action.showCommands"}
]
'@ | Set-Content -LiteralPath (Join-Path $profileUser 'keybindings.json') -Encoding utf8
'{"git.openRepositoryInParentFolders":"never","workbench.startupEditor":"none"}' | Set-Content -LiteralPath (Join-Path $profileUser 'settings.json') -Encoding utf8
$env:MEO_SHORTCUT_OUTPUT=$output
$env:MEO_SHORTCUT_BROWSER_URL='http://127.0.0.1:'+ $Port
$entry=Join-Path $PSScriptRoot 'test-vscode-preview-shortcuts.cjs'
$launchArgs=@('--new-window','--skip-welcome','--skip-release-notes','--disable-updates','--disable-workspace-trust',('--remote-debugging-port='+$Port),('--user-data-dir="'+$profileDirectory+'"'),('--extensions-dir="'+$extensions+'"'),('--extensionDevelopmentPath="'+$repoRoot+'"'),('--extensionTestsPath="'+$entry+'"'),('"'+$workspace+'"'))
$child=Start-Process -FilePath $codeExecutable -ArgumentList $launchArgs -WindowStyle Hidden -RedirectStandardOutput (Join-Path $output 'stdout.log') -RedirectStandardError (Join-Path $output 'stderr.log') -PassThru
try {
  if (-not $child.WaitForExit(180000)) {
    $child.Kill($true)
    throw 'VS Code shortcut checks timed out after 180 seconds.'
  }
  Write-Output ('Report: '+(Join-Path $output 'result.json'))
  if ($child.ExitCode -ne 0) { throw ('VS Code shortcut checks failed with exit code '+$child.ExitCode) }
  Get-Content -LiteralPath (Join-Path $output 'result.json') -Raw
} finally {
  if (-not $child.HasExited) { $child.Kill($true) }
  Remove-Item Env:MEO_SHORTCUT_OUTPUT,Env:MEO_SHORTCUT_BROWSER_URL -ErrorAction SilentlyContinue
}
