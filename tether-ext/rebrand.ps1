$path = 'src\extension.ts'
$content = Get-Content $path -Raw -Encoding UTF8
$content = $content -replace 'ai-ai\.', 'tether.'
$content = $content -replace 'AI-AI Debug', 'Tether Debug'
$content = $content -replace 'AI-AI Accept/Reject', 'Tether Accept/Reject'
$content = $content -replace 'Antigravity Remote Ready', 'Tether Ready'
[System.IO.File]::WriteAllText((Resolve-Path $path), $content, [System.Text.Encoding]::UTF8)
Write-Host "Rebrand complete."
