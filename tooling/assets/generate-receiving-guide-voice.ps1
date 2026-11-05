param([Parameter(Mandatory=$true)][string]$ScriptFile,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$allowed = [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'data/qa-studio/receiving-video'))
$destination = [IO.Path]::GetFullPath($OutputDirectory)
if ($destination -ne (Join-Path $allowed 'audio')) { throw 'Use the bounded receiving-video/audio output directory.' }
$story = [IO.File]::ReadAllText([IO.Path]::GetFullPath($ScriptFile),[Text.Encoding]::UTF8) | ConvertFrom-Json
if ($story.practiceId -ne 'CEDI-01' -or $story.slides.Count -lt 7 -or $story.slides.Count -gt 60) { throw 'Invalid tutorial script.' }
[void][IO.Directory]::CreateDirectory($destination)
$voice = New-Object -ComObject SAPI.SpVoice
$spanish = $null
foreach ($candidate in $voice.GetVoices()) { if ($candidate.GetDescription() -eq 'Microsoft Sabina Desktop - Spanish (Mexico)') { $spanish = $candidate; break } }
if (-not $spanish) { throw 'An already installed Spanish Sabina voice is required. No voice is downloaded or installed.' }
$voice.Voice = $spanish
$voice.Rate = 0
$voice.Volume = 100
foreach ($slide in $story.slides) {
 if ($slide.id -notmatch '^s\d{2}$' -or $slide.narration.Length -gt 4000) { throw 'Invalid audio segment.' }
 $stream = New-Object -ComObject SAPI.SpFileStream
 try {
  $stream.Format.Type = 22
  $stream.Open((Join-Path $destination ($slide.id + '.wav')),3,$false)
  $voice.AudioOutputStream = $stream
  [void]$voice.Speak([string]$slide.narration)
 } finally { $stream.Close() }
}
Write-Output ('Generated ' + $story.slides.Count + ' Spanish audio segments locally.')
