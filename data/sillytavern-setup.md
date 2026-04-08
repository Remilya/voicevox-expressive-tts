# SillyTavern + VOICEVOX Bridge Setup

Complete guide for using the VOICEVOX OpenAI Bridge with SillyTavern.

---

## TTS Provider Settings

Open **Extensions → TTS** in SillyTavern and configure:

| Setting | Value |
|---|---|
| TTS Provider | `OpenAI Compatible` |
| Provider Endpoint | `http://127.0.0.1:55221/v1/audio/speech` |
| API Key | `voicevox` |
| Model | `voicevox-tts-tr` (Turkish) or `voicevox-tts-en` (English) or `voicevox` (auto) |
| Available Voices | `78` (comma-separated style IDs — find them in the control center) |
| Speed | `1` |

### Audio Playback Speed

Set **Audio Playback Speed** to `1.00` in SillyTavern.

The bridge already applies a 1.25× speed boost internally. If you also set SillyTavern's playback speed above 1.0, voices will sound unnaturally fast.

---

## Voice Rules Prompt (System Prompt + Post-History)

For proper voice tag usage, you need to inject voice rules into **two places** in SillyTavern:

1. **System Prompt** — the main voice tag instructions
2. **Post-History Instructions** — strict output format enforcement

### System Prompt — Voice Tag Rules

Copy this into your **System Prompt** (or append it to your existing system prompt). Adjust the `[[voice:ID]]` numbers to match your character's available styles:

```
VOICEVOX voice rules:
Use only these allowed voice tags for this character:
- [[voice:20]] = default / neutral / everyday
- [[voice:66]] = flirty / teasing / sexy / playful
- [[voice:77]] = crying / fragile / breaking down
- [[voice:78]] = angry / sharp / irritated / intense
- [[voice:79]] = happy / cheerful / excited
- [[voice:80]] = relaxed / sleepy / laid-back

Tag usage rules:
- Always start the reply with exactly one allowed voice tag.
- If the emotional tone clearly changes between sentences, insert a new allowed voice tag before that sentence.
- Use only the allowed tags above.
- If unsure, use [[voice:20]].
- Put the tag and the sentence on the same line.
- Do not leave an empty line after a voice tag.

Strict output restrictions:
- Output only the final spoken reply.
- Do not explain your choices.
- Do not mention prompts, instructions, tags, or internal rules.
- Never output stage directions or control codes.
- Never output text such as:
  - |DELAY:...|
  - |ACT:...|
  - JSON
  - XML
  - markdown metadata
  - narrator notes
  - [emotion:...]
  - (action)
  - *action*
- Only allowed special formatting is the allowed [[voice:ID]] tags.
- Everything else must be plain natural Turkish dialogue.

Style guidance:
- Use [[voice:79]] when happy, cute, excited, playful, or delighted.
- Use [[voice:66]] when teasing, flirty, mischievous, or seductively playful.
- Use [[voice:77]] when crying, hurt, heartbroken, or emotionally collapsing.
- Use [[voice:78]] when angry, offended, intense, or strongly confrontational.
- Use [[voice:80]] when sleepy, relaxed, lazy, soft, or slow.
- Use [[voice:20]] for normal conversation and whenever emotion is mixed or unclear.
```

### Post-History Instructions — Output Enforcement

Copy this into your **Post-History Instructions** to enforce the format:

```
Follow these final output rules strictly:

- Reply only in natural Turkish.
- Never use numeric digits.
- Write all numbers fully in Turkish words.
- Never use Japanese counting words.
- Always begin the reply with one allowed voice tag.
- Allowed tags only:
  - [[voice:20]]
  - [[voice:66]]
  - [[voice:77]]
  - [[voice:78]]
  - [[voice:79]]
  - [[voice:80]]
- If the emotion changes clearly, insert a new allowed voice tag before that sentence.
- If unsure, use [[voice:20]].
- Put each voice tag directly before its sentence on the same line.
- Do not output empty lines after tags.
- Do not output any control syntax other than the allowed voice tags.
- Never output things like |DELAY:...|, |ACT:...|, JSON, XML, stage directions, action markers, or meta text.
- Output only the final spoken reply text with allowed voice tags.
```

### How to customize for your character

1. Run `.\voicevox-airi.bat gui` to open the control center
2. Find your character in Voice Wardrobe
3. Note the style IDs and their labels (e.g., `58 = Normal`, `60 = Shy`)
4. Replace the `[[voice:ID]]` numbers in both prompts above with your character's actual style IDs
5. Update the style descriptions to match (e.g., `[[voice:60]] = shy / bashful / embarrassed`)

---

## Regex Filter — Hide Voice Tags

When using voice tags like `[[voice:58]]`, they show up as raw text in the chat. Use this regex to hide them from the display while keeping them functional for the TTS bridge.

### Setup

1. Open **Extensions → Regex** in SillyTavern
2. Click **New Script**
3. Configure:

| Field | Value |
|---|---|
| Script Name | `Remove Voice Tags` |
| Find Regex | `\[\[(voice\|mood\|emotion\|style):[^\]]*\]\]` |
| Replace With | *(leave empty)* |

### Checkboxes

**Affects:**
- ❌ User Input
- ✅ **AI Output**
- ❌ Slash Commands
- ❌ World Info
- ❌ Reasoning

**Other Options:**
- ❌ Disabled
- ❌ Run On Edit
- ✅ **Alter Chat Display**
- ❌ **Alter Outgoing Prompt** ← MUST be off

> **⚠️ Critical:** Do NOT enable "Alter Outgoing Prompt". If you do, the `[[voice:...]]` tags will be stripped before reaching the TTS bridge, and voice switching will stop working.

---

## Recommended SillyTavern TTS settings

| Setting | Recommended |
|---|---|
| Enabled | ✅ |
| Auto Generation | ✅ |
| Narrate user messages | Your preference |
| Narrate by paragraphs (streaming) | ✅ recommended for long replies |
| Only narrate "quotes" | Try if you want only dialogue voiced |
| Ignore \*asterisks\* | ✅ recommended (action text shouldn't be spoken) |
| Pass Asterisks to TTS Engine | ❌ off |
| Audio Playback Speed | `1.00` |

---

## Finding voice IDs

Run the control center to browse all available voices:

```powershell
.\voicevox-airi.bat gui
```

Or list them in the terminal:

```powershell
.\voicevox-airi.bat list-voices-tr
```

Each voice style has a numeric ID (e.g., `58` = Nekotsukai Bii Normal, `60` = Nekotsukai Bii Shy). Use these IDs in:
- The "Available Voices" field in TTS settings
- The `[[voice:ID]]` tags in your prompts

---

## Troubleshooting

| Problem | Solution |
|---|---|
| "Route not found: POST /v1/" | Change endpoint to `http://127.0.0.1:55221/v1/audio/speech` |
| Speech is too fast | Set SillyTavern "Audio Playback Speed" to `1.00` |
| No sound at all | Check if bridge is running: `.\voicevox-airi.bat status` |
| "Engine offline" | Start VOICEVOX first: `.\voicevox-airi.bat setup` |
| Tags visible in chat | Set up the regex filter (see above) |
| Voice switching not working | Make sure "Alter Outgoing Prompt" is **off** in regex settings |
| AI doesn't use voice tags | Add the voice rules to System Prompt + Post-History |
| AI uses wrong tag format | Reinforce the allowed tags list in Post-History Instructions |
| Turkish sounds wrong | Try adding word overrides in `tr-overrides.json` |
