# Voice messages: the team sends voice notes, and the AI understands voice

Date: 2026-10-06 · Status: **draft, waiting for owner decisions (section 6)** · Owner request: "add voice msg feature". The owner chose "Team sends voice notes" and "AI understands voice".

## 1. What exists today (verified in code)

- Incoming WhatsApp voice notes already arrive and play. `packages/wa/src/baileys/mapping.ts` maps `audioMessage` to type `audio`, with mime `audio/ogg; codecs=opus` for voice notes (`ptt`). `apps/web/src/inbox/MediaView.tsx` renders an `<audio>` player.
- Outgoing audio is possible only as a file attachment. `adapter.sendMedia` sends `{ audio, mimetype }` without `ptt: true`, so the customer receives a file, not a voice note.
- The AI Sales Agent hands off any non-text customer message (`service.ts`: `customer.type !== 'text'` leads to handoff).

## 2. Goals

1. **The team records and sends real WhatsApp voice notes from the inbox.** They play inline on the customer's phone with a waveform, like a phone-recorded note.
2. **The AI understands customer voice notes.** It transcribes them, answers like text, and shows the team the transcript under the audio.

Non-goals: AI replying with voice (text replies only), voice in groups beyond what already works, and live calls.

## 3. Sending voice notes (team)

- **Composer:** a mic button (shadcn `Button`, 44px touch target) next to Paperclip.
  - **Recording:** hold or tap to start, with a timer, a cancel (slide or ✕) and a send action; maximum length 5 minutes.
  - **Before sending:** listen back.
  - **Errors:** if microphone permission is denied, a clear i18n message explains it.
  - **Layout:** works at 360px.
- **Recording format:** WhatsApp voice notes must be **OGG/Opus mono**. Browsers record WebM/Opus (Chrome, Edge, Firefox) or MP4/AAC (Safari), so conversion is needed.
  - **Option A (recommended):** encode to OGG/Opus **in the browser** with a small WASM Opus encoder, for example the `opus-recorder` library (about 300 KB, MIT; verify the licence and maintenance before adding). It works the same in every browser, needs no server binaries, and keeps the installer small.
  - **Option B:** record WebM/Opus and **remux to OGG on the server**. The Opus packets are copied with no re-encoding, so a small pure-JS muxer is enough. Safari MP4/AAC would still need real transcoding, so this alone doesn't cover iPhone or iPad.
  - **Option C:** bundle `ffmpeg` (about 70–80 MB). Rejected: it reverses the 140 MB Codex removal.
- **Server and WhatsApp:**
  - **Upload:** a new `POST /api/chats/:jid/voice` (or `sendMedia` with a `voice: true` flag) accepts `audio/ogg; codecs=opus` up to the size limit.
  - **Validation:** checks the OGG header and duration ≤ 300 s.
  - **Storage:** stored like other media.
  - **Sending:** the adapter sends `{ audio, mimetype: 'audio/ogg; codecs=opus', ptt: true, seconds }`. This is a change under `packages/wa/src/baileys/**`, so it is **untested against real WhatsApp** until the owner tests it on a test number.
  - **Send queue:** the voice note goes through the existing queue (FIFO, `recording` presence instead of `composing`).
- **UI:** the sent voice note shows in the conversation with the same audio player, plus a "voice note" label.

## 4. AI understands voice (customers)

- **When:** a customer voice note arrives in a chat that the AI owns or that is unassigned.
- **Flow:**
  1. The server downloads the audio (history media is downloaded on demand; live notes are downloaded now).
  2. It **transcribes** it.
  3. It stores the transcript on the message (new nullable column `messages.transcript`, migration 005).
  4. It emits `message:updated` so the team sees "Transcript: …" under the player.
  5. The AI's conversation input uses `[voice note] <transcript>` as the customer text.
  6. If transcription fails or is empty, the current behaviour stays: hand off to a human.
- **Transcription provider:**
  - **Option 1, OpenAI API key mode (recommended first):** use OpenAI's speech-to-text endpoint, a current transcription model chosen at build time, about US$0.003–0.006 per minute. It is reliable and supports Malay, English and Chinese.
  - **Option 2, ChatGPT sign-in mode:** the unofficial ChatGPT backend has **no known transcription endpoint**. A short spike would test whether the Codex responses endpoint accepts audio input. If not, voice notes in ChatGPT mode keep handing off to humans, unless an API key is also configured just for transcription.
  - **Option 3, local transcription (whisper.cpp):** private and free per minute, but it adds about 75–150 MB of model data and CPU load. This could be an optional download later.
- **Privacy:** the transcript is stored like message text, redacted from logs, and included in support exports only under the existing rules.
- **Limits:** transcribe only notes ≤ 5 minutes; at most 1 transcription per message.

## 5. Testing

- **Web:**
  - recorder state machine (permission denied, record, cancel, send);
  - 360px layout;
  - i18n x3;
  - the encoder is mocked in unit tests.
- **Server:**
  - voice upload validation (wrong type, too long);
  - the queue sends `ptt: true` to FakeWaAdapter;
  - the transcript is stored, emitted and redacted;
  - the AI uses the transcript, and a failed transcription hands off.
- **Fake WhatsApp:** simulate an incoming voice note with a fixture OGG and a fake transcriber.
- **Owner checks:**
  - real-WhatsApp smoke test on a **test number**: the voice note plays as a voice note on a phone;
  - a customer voice note gets transcribed and answered.

## 6. Decisions needed from the owner

1. **Recording format:** Option A (in-browser OGG encoder, recommended) or B?
2. **Transcription:**
   - OpenAI API key only (recommended)?
   - Also try the ChatGPT-mode spike?
   - Or local whisper later?
3. **In ChatGPT sign-in mode without an API key:** voice notes hand off to a human (as today), or ask the admin for an API key just for voice?
4. Should the team also see transcripts on chats the AI doesn't handle (useful for everyone, costs per minute)?
