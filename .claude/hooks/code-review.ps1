Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = $env:CLAUDE_PROJECT_DIR

if ([string]::IsNullOrWhiteSpace($repo)) {
  $repo = (Get-Location).Path
}

Set-Location $repo

node ".claude/hooks/code-review.mjs"
