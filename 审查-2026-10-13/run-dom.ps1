# Serial runner for the CDP / headless-browser assertion scripts (ASCII-only source).
# Captures each script's tail into one log so we have a pre-fix DOM baseline.
param(
  [string]$Log = '',
  [string]$Only = ''
)
$here = $PSScriptRoot
$repo = Split-Path $here -Parent
if ([string]::IsNullOrEmpty($Log)) { $Log = Join-Path $here 'dom-baseline.txt' }
$enc = New-Object System.Text.UTF8Encoding($false)

# Curated: the CDP / headless-Chrome scripts that belong to the active suite.
$names = @(
  '_0b-dom.mjs','_0c-dom.mjs','_0d-geom.mjs','_0e-dom.mjs','_0g-dom.mjs','_0g-contrast.mjs',
  '_1-notify.mjs','_2b-hover.mjs','_3b-dom.mjs','_4b-dom.mjs','_4d-dom.mjs',
  '_5-dom.mjs','_5d-dom.mjs','_5e-dom.mjs','_5g-dom.mjs','_5h-dom.mjs','_5i-dom.mjs',
  '_6a-dom.mjs','_6b-dom.mjs','_6c-dom.mjs','_6d-shadow.mjs',
  '_7a-dom.mjs','_7b-dom.mjs','_7d-dom.mjs','_7e-dom.mjs','_7f-dom.mjs',
  '_8a-aside.mjs','_8a-geom.mjs','_8b-hw.mjs','_8b-tabbar.mjs','_8c-icon.mjs',
  '_8d-geom.mjs','_8d-heat.mjs','_8e-aside-right.mjs','_8g-misc.mjs',
  '_verify-a11y.mjs','_verify-idea.mjs','_verify-mobile.mjs'
)
if ($Only -ne '') { $names = $Only.Split(',') }

$head = (git -C $repo log --oneline -1)
[System.IO.File]::WriteAllText($Log, "dom-baseline @ $(Get-Date -Format o) HEAD=$head`n", $enc)
$fail = 0
$done = 0
$missing = @()
foreach ($n in $names) {
  $p = Join-Path "$repo\_ref" $n
  if (-not (Test-Path $p)) { $missing += $n; continue }
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $out = & node $p 2>&1
  $code = $LASTEXITCODE
  $sw.Stop()
  if ($code -ne 0) { $fail++ }
  $done++
  $tail = (($out | Select-Object -Last 4) -join " | ")
  [System.IO.File]::AppendAllText($Log, "=== $n exit=$code ms=$($sw.ElapsedMilliseconds)`n$tail`n", $enc)
  Write-Output ("{0,-22} exit={1} {2}ms" -f $n, $code, $sw.ElapsedMilliseconds)
}
[System.IO.File]::AppendAllText($Log, "`nran=$done fail=$fail missing=$($missing -join ',')`n", $enc)
Write-Output "----"
Write-Output ("ran=$done fail=$fail missing=$($missing.Count)")
Write-Output ("log: " + $Log)
