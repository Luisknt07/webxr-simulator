param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '../../packages/voice-assistant/assets')
)

# Local, bounded speech fixtures. Run with Windows PowerShell and an already
# installed Sabina desktop voice. This script never installs voices or edits
# registry entries, and never makes a network request.
$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$assetDirectory = [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'packages/voice-assistant/assets'))
$requestedDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if (-not [String]::Equals($requestedDirectory.TrimEnd([IO.Path]::DirectorySeparatorChar), $assetDirectory.TrimEnd([IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase)) {
  throw 'OutputDirectory must be this repository''s packages/voice-assistant/assets directory.'
}

Add-Type -AssemblyName System.Speech
$voiceName = 'Microsoft Sabina Desktop'
$language = 'es-MX'
# ASCII JSON escapes keep this script portable to Windows PowerShell 5.1 even
# when checked out without a UTF-8 BOM. The resulting text is ordinary Spanish.
$clips = @'
[
  {"id":"welcome","title":"Bienvenida","text":"Hola. Soy el asistente de SmartTwin. Puedo leer las instrucciones y ayudarte con tus misiones."},
  {"id":"pickup","title":"Recoger pallet","text":"Introduce ambas horquillas en los huecos del pallet. Comprueba la altura y avanza despacio."},
  {"id":"route","title":"Transportar carga","text":"Sigue las flechas del pasillo hasta el destino indicado. Transporta la carga a baja altura."},
  {"id":"deposit","title":"Depositar pallet","text":"Alinea el pallet con la ubicaci\u00f3n marcada. Baja hasta confirmar el apoyo y retira ambas horquillas."},
  {"id":"completed","title":"Misi\u00f3n completada","text":"Misi\u00f3n completada. La carga est\u00e1 confirmada en su ubicaci\u00f3n."},
  {"id":"safety","title":"Comprobaci\u00f3n de seguridad","text":"Det\u00e9n el montacargas y comprueba que el pasillo est\u00e9 libre antes de continuar."}
]
'@ | ConvertFrom-Json
$synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $installedVoice = $synthesizer.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Name -eq $voiceName -and $_.VoiceInfo.Culture.Name -eq $language } | Select-Object -First 1
  if (-not $installedVoice) { throw 'The already installed Microsoft Sabina Desktop es-MX voice is required. No replacement or download is attempted.' }
  $synthesizer.SelectVoice($voiceName)
  $synthesizer.Rate = 0
  $synthesizer.Volume = 100
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  [void][IO.Directory]::CreateDirectory($assetDirectory)
  $records = @()
  foreach ($clip in $clips) {
    $file = $clip.id + '.wav'
    $destination = Join-Path $assetDirectory $file
    $synthesizer.SetOutputToWaveFile($destination, $format)
    try { $synthesizer.Speak([string]$clip.text) } finally { $synthesizer.SetOutputToNull() }
    $bytes = [IO.File]::ReadAllBytes($destination)
    if ($bytes.Length -lt 44 -or [Text.Encoding]::ASCII.GetString($bytes, 0, 4) -ne 'RIFF' -or [Text.Encoding]::ASCII.GetString($bytes, 8, 4) -ne 'WAVE') { throw "Invalid WAV output: $file" }
    $dataSize = 0
    for ($offset = 12; $offset + 8 -le $bytes.Length;) {
      $chunk = [Text.Encoding]::ASCII.GetString($bytes, $offset, 4)
      $size = [BitConverter]::ToUInt32($bytes, $offset + 4)
      if ($chunk -eq 'data') { $dataSize = $size; break }
      $offset += 8 + $size + ($size % 2)
    }
    $duration = [Math]::Round($dataSize / 44100.0, 6)
    if ($duration -le 0 -or $duration -gt 20) { throw "Clip duration must be positive and at most 20 seconds: $file" }
    $records += [pscustomobject][ordered]@{id=$clip.id;title=$clip.title;text=$clip.text;file=$file;duration=$duration;sha256=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant();bytes=$bytes.Length;language=$language;voice=$voiceName}
  }
  $manifest = [ordered]@{
    version=1
    language=$language
    voice=$voiceName
    format=[ordered]@{container='wav';encoding='PCM';sampleRate=22050;channels=1;bitsPerSample=16}
    generatedWith='Windows System.Speech.Synthesis (installed desktop voice; offline)'
    purpose='Bounded local Spanish speech fixtures for SmartTwin voice-assistant testing'
    samples=$records
  }
  $json = $manifest | ConvertTo-Json -Depth 6
  [IO.File]::WriteAllText((Join-Path $assetDirectory 'manifest.json'), $json + [Environment]::NewLine, (New-Object Text.UTF8Encoding($false)))
  $records | Select-Object id,duration,bytes,sha256 | Format-Table -AutoSize
} finally { $synthesizer.Dispose() }
