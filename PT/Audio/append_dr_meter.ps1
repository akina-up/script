param(
    [string] $Directory,

    [string] $TargetPath,

    [long] $StartFileTimeUtc = 0,

    [ValidateRange(1, 86400)]
    [int] $TimeoutSeconds = 1800
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Directory)) {
    Write-Error "Missing DR log directory."
    exit 10
}

if ([string]::IsNullOrWhiteSpace($TargetPath)) {
    Write-Error "Missing target TXT path."
    exit 11
}

if ($StartFileTimeUtc -le 0) {
    Write-Error "Missing or invalid DR measurement start time."
    exit 12
}

if (-not (Test-Path -LiteralPath $Directory -PathType Container)) {
    Write-Error "DR log directory does not exist: '$Directory'"
    exit 13
}

$startTimeUtc = [DateTime]::FromFileTimeUtc($StartFileTimeUtc)
$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
$waitStartedUtc = [DateTime]::UtcNow
$nextStatusUtc = $waitStartedUtc
$targetFullPath = [System.IO.Path]::GetFullPath($TargetPath)
$logFile = $null
$lines = $null

# Ignore files that were not created or updated by the current measurement.
# Accept custom DR Meter log names, but only use a text/log file that contains
# an Official DR value. The report being assembled is always excluded.
while ([DateTime]::UtcNow -lt $deadline) {
    $nowUtc = [DateTime]::UtcNow
    if ($nowUtc -ge $nextStatusUtc) {
        $elapsedSeconds = [Math]::Floor(
            ($nowUtc - $waitStartedUtc).TotalSeconds
        )
        Write-Host ((
            "Waiting for the DR Meter log... {0}s elapsed. " +
            "The batch is not frozen; check foobar2000 and click Save Log " +
            "if automatic log writing is disabled."
        ) -f $elapsedSeconds)
        $nextStatusUtc = $nowUtc.AddSeconds(10)
    }

    $candidates = @(Get-ChildItem -LiteralPath $Directory -File -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -match '\.(txt|log)$' -and
            $_.LastWriteTimeUtc -ge $startTimeUtc.AddSeconds(-2) -and
            $_.FullName -ne $targetFullPath
        } |
        Sort-Object LastWriteTimeUtc -Descending)

    foreach ($candidate in $candidates) {
        try {
            $candidateLines = @(Get-Content -LiteralPath $candidate.FullName)
            if ($candidateLines -match '^Official DR value:') {
                $logFile = $candidate
                $lines = $candidateLines
                break
            }
        }
        catch {
            # The component may still have the log open. Retry until timeout.
        }
    }

    if ($null -ne $logFile) {
        break
    }

    Start-Sleep -Seconds 1
}

if ($null -eq $logFile -or $null -eq $lines) {
    Write-Error ((
        "Timed out waiting for a new DR Meter TXT/LOG file in '{0}'. " +
        "Enable automatic log writing in DR Meter, or write the log from " +
        "the result window."
    ) -f $Directory)
    exit 1
}

$officialIndex = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^Official DR value:') {
        $officialIndex = $i
        break
    }
}

$peakIndex = -1
for ($i = $officialIndex; $i -ge 0; $i--) {
    if ($lines[$i] -match '^Peak Value:') {
        $peakIndex = $i
        break
    }
}

$startIndex = -1
for ($i = $peakIndex; $i -ge 0; $i--) {
    if ($lines[$i] -match '^-{10,}\s*$') {
        $startIndex = $i
        break
    }
}

if ($officialIndex -lt 0 -or $peakIndex -lt 0 -or $startIndex -lt 0) {
    Write-Error "The DR Meter log format was not recognized: '$($logFile.FullName)'"
    exit 2
}

$selectedLines = @($lines[$startIndex..$officialIndex])
$textToAppend = (
    [Environment]::NewLine +
    ($selectedLines -join [Environment]::NewLine) +
    [Environment]::NewLine
)
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::AppendAllText($TargetPath, $textToAppend, $utf8WithoutBom)

Write-Host "Appended DR Meter data from: $($logFile.FullName)"
