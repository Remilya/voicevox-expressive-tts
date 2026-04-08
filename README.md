# VOICEVOX Expressive TTS Bridge

> ✨ **Created by [@Remilya](https://github.com/Remilya) · [remilya.dev](https://remilya.dev)**

An advanced local toolkit that turns **VOICEVOX** into an **OpenAI-compatible TTS endpoint** — built specifically for AI Companions, **SillyTavern**, **Project AIRI**, **AIVTubers**, and multi-character roleplay dialogue.

Unlike basic API wrappers, this bridge is highly modified to support **inline multi-voice dialogue, automatic emotion switching, Turkish & English phonetic transliteration, and a built-in Anime Phrase Atelier**.

---

## 🔥 Why this is different (The Killer Features)

| Feature | What it means for you |
|---|---|
| **🎭 Multi-Voice in 1 Chat** | Use `[[voice:58]] Hello, [[voice:77]] I'm crying...` to change voices/accents per sentence! Make group chats where one bot speaks with 3 different character voices. |
| **🧠 Auto Emotion Switching** | Detects the mood of the text and automatically switches the character's voice style from "Normal" to "Shy", "Angry", or "Happy" mid-speech. |
| **🌍 TR & EN Full Support** | Normal VOICEVOX only reads Japanese. This bridge auto-romanizes Turkish and English into katakana so your anime girl speaks your language seamlessly. |
| **✨ Anime Phrase Atelier** | 430+ built-in anime expressions (`ara ara`, `yamete`, `nyan`) injected directly into the synthesized audio. Includes a full HTML Control Center for phrase management. |
| **🔌 100% OpenAI Compatible** | Just paste `http://127.0.0.1:55221/v1/audio/speech` into SillyTavern, AIRI, or any TTS client. |
| **⚡ Zero Extra API Costs** | Runs entirely locally on your CPU/GPU hardware. |

---

## 🚀 Quick start

### Prerequisites

- [VOICEVOX](https://voicevox.hiroshiba.jp/) installed (engine only is enough)
- [Node.js](https://nodejs.org/) 18+ in PATH

### First run

```powershell
.\voicevox-airi.bat setup
```

This starts the VOICEVOX engine, launches the bridge on `http://127.0.0.1:55221/v1/`, and prints the config you need.

### Open the control center

```powershell
.\voicevox-control-center.bat
```

Generates and opens the HTML control center with voice browser, TTS playground, and Anime Phrase Atelier.

---

## Connect your app

### Any OpenAI-compatible client

```text
Provider:  OpenAI Compatible
Base URL:  http://127.0.0.1:55221/v1/audio/speech
API Key:   voicevox (or anything, not checked)
Model:     voicevox
Voice:     3 (or any style ID from the voice list)
```

> **Note:** Different apps expect different endpoint formats. Try these in order until one works:
> 1. `http://127.0.0.1:55221/v1/audio/speech` (SillyTavern, most clients)
> 2. `http://127.0.0.1:55221/v1/` (AIRI)
> 3. `http://127.0.0.1:55221` (some clients append `/v1/audio/speech` themselves)

### AIRI

```text
Provider:  OpenAI Compatible
Base URL:  http://127.0.0.1:55221/v1/
API key:   voicevox
Model:     voicevox
Voice:     3
```

### SillyTavern

```text
TTS Provider:      OpenAI Compatible
Provider Endpoint: http://127.0.0.1:55221/v1/audio/speech
API Key:           voicevox
Model:             voicevox-tts-tr  (or voicevox-tts-en for English)
Available Voices:  78  (comma-separated style IDs)
Speed:             1
```

> **Important:** Set SillyTavern's "Audio Playback Speed" to `1.00`. The bridge already applies a 1.25× speed boost — stacking both makes speech unnaturally fast.

See [SillyTavern setup guide](data/sillytavern-setup.md) for the full walkthrough including regex filters.

---

## Models

| Model | Text mode | Emotion | Use case |
|---|---|---|---|
| `voicevox` | Auto TR/EN detect | Auto mood switch | **Default — works for everything** |
| `voicevox-tts` | Auto TR/EN detect | Auto mood switch | Alias of `voicevox` |
| `voicevox-tts-tr` | Forced Turkish | Auto mood switch | When input is always Turkish |
| `voicevox-tts-en` | Forced English | Auto mood switch | When input is always English |
| `voicevox-tts-raw` | No preprocessing | Fixed voice | For native Japanese input or testing |

---

## Emotion & voice control

### Auto mood (default)

The bridge analyzes each line and automatically switches to the best style within the selected character's family:

```
Input: "I'm so happy today!"  →  switches to character's cheerful/sweet style
Input: "Stop it right now!"   →  switches to character's angry/strong style
Input: "I'm sorry..."         →  switches to character's sad/whisper style
```

### Explicit mood tags

Force a specific mood anywhere in the text:

```text
[[mood:shy]] hello...
[[mood:strong]] no way!
[[mood:calm]] it is okay.
[[mood:happy]] yay!
[[mood:sad]] I miss you...
```

### Explicit voice/style tags

Switch to exact style IDs within the character family:

```text
[[voice:58]] hello there
[[voice:60]] i am a little shy
[[style:112]] no, I said stop!
```

### Multi-segment chaining

Combine multiple tags in a single reply for shifting emotions:

```text
[[mood:happy]] Good morning! [[mood:shy]] Um... I made you breakfast... [[mood:calm]] I hope you like it.
```

Each segment is synthesized separately and concatenated into one audio response.

### Fixed voice (no auto-switching)

Use `voicevox-tts-raw` model to disable all preprocessing and emotion switching.

---

## Anime Phrase Atelier

The bridge includes 430+ built-in anime/Japanese verbal phrase mappings in `data/anime-japanese-phrases.json`. These are automatically applied before synthesis:

```
"ara ara"      →  "あら、あら"
"doki doki"    →  "ドキ、ドキ"
"yamete"       →  "やめて"
"daisuki"      →  "だいすき"
"nyan"         →  "にゃん"
```

### Control Center panel

The HTML control center includes a full **Anime Phrase Atelier** panel with:

- **8 categories**: Reactions, Greetings, Commands, Cute/Moe, Fillers, Romance, Drama/Battle, Onomatopoeia
- **Search**: Filter by romaji or kana
- **Insert Fixed**: Click to insert TTS-safe kana directly into the test textarea
- **Copy Fixed**: Copy kana to clipboard for pasting into any app
- **Test ▶**: Instantly hear the phrase with the selected voice
- **Compose Queue**: Stack multiple phrases → batch insert or replace
- **★ Favorites**: Pin frequently used phrases (saved in browser localStorage)
- **⏱ Recent**: Auto-tracked last 12 inserted phrases
- **Mood hints**: Auto-assigned mood badge per phrase (happy, cute, love, battle, etc.)

---

## Custom word overrides

Fine-tune how specific words are pronounced:

### Turkish overrides

```powershell
# Copy the example file
copy tr-overrides.example.json tr-overrides.json
# Edit tr-overrides.json with your Turkish word → katakana pairs
```

### English overrides

```powershell
copy en-overrides.example.json en-overrides.json
# Edit en-overrides.json with your English word → katakana pairs
```

### Japanese phrase overrides

Edit `data/anime-japanese-phrases.json` directly. This is a flat `{ "romaji": "kana" }` map. The phrase list focuses on spoken anime expressions: reactions, greetings, commands, cute sounds, romance lines, battle cries, and onomatopoeia.

> Restart the bridge after editing any override file.

---

## CLI commands (Advanced)

```powershell
.\tools\voicevox-airi.bat help               # Show all commands
.\tools\voicevox-airi.bat doctor             # Check paths, ports, tools
.\tools\voicevox-airi.bat restart-bridge     # Restart the bridge
.\tools\voicevox-airi.bat status             # Show bridge and engine health
.\tools\voicevox-airi.bat export-voices-html # Generate control center HTML

# Text preprocessing preview
.\tools\voicevox-airi.ps1 preview-tr -Text "Merhaba nasilsin?"
.\tools\voicevox-airi.ps1 preview-en -Text "Hello, how are you?"
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `VOICEVOX_BASE_URL` | `http://127.0.0.1:50021` | VOICEVOX engine URL |
| `VOICEVOX_BRIDGE_PORT` | `55221` | Bridge listen port |
| `VOICEVOX_SPEED_MULTIPLIER` | `1.25` | Speed multiplier applied to all synthesis |
| `VOICEVOX_MODEL` | `voicevox-tts` | Default model |
| `VOICEVOX_TEXT_MODE` | `auto` | Default text preprocessing mode |
| `VOICEVOX_EMOTION_MODE` | `auto` | Default emotion detection mode |
| `VOICEVOX_DEFAULT_VOICE` | *(none)* | Default style ID or name |
| `VOICEVOX_LOG_PATH` | `voicevox-bridge.log` | Bridge log file |
| `VOICEVOX_AUTO_START` | `1` | Auto-start VOICEVOX engine |
| `VOICEVOX_RUN_EXE` | *(auto-detected)* | Path to VOICEVOX run.exe |

---

## API routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/healthz` | Bridge health + engine status |
| `GET` | `/v1/models` | List available models |
| `GET` | `/v1/voices` | List all voice styles |
| `GET` | `/v1/debug/recent` | Recent speech events |
| `POST` | `/v1/audio/speech` | **Synthesize speech** (OpenAI-compatible) |

### Speech request body

```json
{
  "model": "voicevox-tts-tr",
  "voice": "78",
  "input": "Merhaba, bugun nasil hissediyorsun?",
  "speed": 1.0,
  "response_format": "wav"
}
```

### Response headers

| Header | Example | Description |
|---|---|---|
| `X-Voicevox-Voice-Id` | `60` | Resolved voice style ID |
| `X-Voicevox-Base-Voice-Id` | `58` | Base voice you selected |
| `X-Voicevox-Text-Mode` | `tr` | Text preprocessing used |
| `X-Voicevox-Emotion` | `shy` | Detected/applied mood |
| `X-Voicevox-Emotion-Reason` | `auto` | Why this mood was chosen |
| `X-Voicevox-Segment-Count` | `3` | Number of audio segments |

---

## Project files

| File | Purpose |
|---|---|
| `tools/voicevox-airi.ps1` | Main CLI script |
| `tools/voicevox-airi.bat` | BAT launcher for the CLI |
| `tools/voicevox-openai-bridge.mjs` | Node.js OpenAI-compatible bridge server |
| `tools/voice-browser.template.html` | HTML template for the control center |
| `voicevox-control-center.html` | Generated control center (from template + data) |
| `data/voicevox-translations.tr.json` | Turkish voice name translations |
| `data/available-voices.md` | Full list of character names, descriptions, and IDs |
| `data/anime-japanese-phrases.json` | 430+ anime romaji→kana phrase mappings |
| `data/sillytavern-setup.md` | SillyTavern integration guide |
| `tr-overrides.example.json` | Example Turkish word override file |
| `en-overrides.example.json` | Example English word override file |
| `tools/list-voicevox-voices.bat` | Quick voice list shortcut |
| `tools/voicevox-recent.bat` | Quick recent events shortcut |
| `voicevox-control-center.bat` | Quick control center shortcut |
| `tools/restart-voicevox-bridge.bat` | Quick bridge restart shortcut |

---

## Notes

- 100% local — no paid API, no external servers
- VOICEVOX is a Japanese TTS engine — non-Japanese text will have a Japanese accent (that's the charm)
- The bridge transliterates Turkish and English into Japanese phonetics before synthesis
- Style IDs are character-specific — see [Available Voices List](data/available-voices.md) or use `list-voices-tr` / the control center to find them
- The `recent` command shows the bridge's last mood decisions like `58 → 60 | mood=shy`
- Override files and phrase data are hot-reloaded on bridge restart

---

## License & Credits

Created and maintained by [@Remilya](https://github.com/Remilya) — [remilya.dev](https://remilya.dev).
This project is open-source and available under the [MIT License](LICENSE).
