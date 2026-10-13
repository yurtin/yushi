# Pure-Node regression runner for the yushi repo.
# ASCII-only source on purpose: PowerShell 5.1 decodes BOM-less files as GBK,
# so any non-ASCII literal in here would corrupt the script. Paths come from $PSScriptRoot.
param(
  [string]$Log = ''
)
$here = $PSScriptRoot
$repo = Split-Path $here -Parent
if ([string]::IsNullOrEmpty($Log)) { $Log = Join-Path $here 'regress-now.txt' }
$enc = New-Object System.Text.UTF8Encoding($false)
$scripts = @()
$scripts += Get-ChildItem "$repo\_ref" -File -Filter '*-regress.mjs' | Sort-Object Name
$scripts += Get-Item "$repo\_ref\_check-dupdef.mjs", "$repo\_ref\_parse-regress.mjs"
$fail = 0
$summary = @()
$head = (git -C $repo log --oneline -1)
[System.IO.File]::WriteAllText($Log, "run @ $(Get-Date -Format o) HEAD=$head`n", $enc)
foreach ($s in $scripts) {
  $out = & node $s.FullName 2>&1
  $code = $LASTEXITCODE
  $tail = (($out | Select-Object -Last 6) -join " | ")
  if ($code -ne 0) { $fail++ }
  [System.IO.File]::AppendAllText($Log, "=== $($s.Name) exit=$code`n$tail`n", $enc)
  $count = ($out | Select-String -Pattern '(\d+)\s*[/]\s*(\d+)' | Select-Object -Last 1)
  $cv = ''
  if ($count) { $cv = $count.Matches[0].Value }
  $summary += ("{0,-24} exit={1}  {2}" -f $s.Name, $code, $cv)
  Write-Output ("{0,-24} exit={1}  {2}" -f $s.Name, $code, $cv)
}
[System.IO.File]::AppendAllText($Log, "`n--- summary ---`n" + ($summary -join "`n") + "`n", $enc)
Write-Output "----"
Write-Output ("failures: " + $fail + " / scripts: " + $scripts.Count)
Write-Output ("log: " + $Log)
