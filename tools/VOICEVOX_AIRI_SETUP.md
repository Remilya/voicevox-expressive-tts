# VOICEVOX with AIRI

This bridge lets AIRI use VOICEVOX through AIRI's existing `OpenAI Compatible` speech provider.

## 1. Start the bridge

```powershell
node .\tools\voicevox-openai-bridge.mjs
```

Optional:

```powershell
node .\tools\voicevox-openai-bridge.mjs --list-voices
```

The bridge listens on:

```text
http://127.0.0.1:55221/v1/
```

## 2. Configure AIRI

Speech provider:

```text
OpenAI Compatible
```

Base URL:

```text
http://127.0.0.1:55221/v1/
```

API key:

```text
voicevox
```

Model:

```text
voicevox
```

If you want to force Turkish preprocessing on every line, use:

```text
voicevox-tts-tr
```

If you want fixed voice output with no mood-based style switching, use:

```text
voicevox-tts-raw
```

Voice:

```text
3
```

Current default speed:

```text
Bridge applies a 1.25x speed multiplier
```

## Notes

- AIRI does not talk to raw VOICEVOX directly. AIRI expects OpenAI-style `POST /v1/audio/speech`.
- VOICEVOX uses `/audio_query` plus `/synthesis`, so the bridge translates between the two APIs.
- If `VOICEVOX` is installed in the default Windows location, the bridge will try to auto-start the engine when needed.
- `voicevox` and `voicevox-tts` auto-detect Turkish text and switch preprocessing on when needed.
- `voicevox` and `voicevox-tts` also auto-switch between styles from the same character when the line reads as calm, shy, strong, sad, or excited.
- You can force a mood by putting tags like `[[mood:shy]]` or `[[mood:strong]]` inside the text before it reaches TTS.
- The bridge applies a default `1.25x` speed boost. You can override it with `VOICEVOX_SPEED_MULTIPLIER`.
- The last decisions are written to `voicevox-bridge.log` and are also available from `GET /v1/debug/recent`.
