# Local Spanish speech fixtures

These six WAV files contain real Spanish speech generated locally with the
already installed **Microsoft Sabina Desktop** (`es-MX`) voice through Windows
`System.Speech.Synthesis`. They are speech recordings, not tones, silent buffers,
placeholder text files, downloaded models, or evidence of a custom trained voice.

`manifest.json` is the runtime inventory. Each clip has an ID, title, complete
Spanish transcript, relative filename, duration in seconds, SHA-256 checksum,
byte count, language and voice. All recordings use mono PCM WAV, 22,050 Hz,
16 bits per sample. The bounded six-clip library is one Spanish voice; choosing
other installed voices in the assistant uses browser speech synthesis instead.

Regenerate from the repository root with Windows PowerShell:

```powershell
powershell.exe -NoProfile -File tooling/assets/generate-test-voice.ps1
```

The generator requires the existing Sabina `es-MX` desktop voice, writes only
to this repository's explicit `packages/voice-assistant/assets` directory, and
fails if that voice is unavailable. It performs no network requests, voice
installation, or registry modifications. The clips are deterministic fixtures
for testing intelligible local playback; speech engines or OS updates may change
the bytes, so regeneration also rewrites their manifest checksums.

Run `node tooling/qa/voice-assistant.cjs --assets-only` to validate WAV headers,
PCM parameters, durations, nonzero signal energy, and manifest checksums.

The supplied transcripts are original project text. The recordings were made
using an installed Microsoft Windows speech engine. No Microsoft speech engine,
voice binary or trained model is included or relicensed here. Redistribution
of generated speech remains subject to the applicable Windows/voice terms; this
inventory records provenance and does not claim a separate Microsoft license.
