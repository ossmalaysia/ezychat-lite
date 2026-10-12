# Workbook: feat/voice-note-recording

Branch: `feat/voice-note-recording` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Updated |
| --- | --- | --- | --- |
| Design | done | interactive mockup approved (desktop + phone prototypes, 9 states): tap to record, Delete/Review/Send, 5:00 cap, mic greyed with reason on LAN http, blocked-mic help | 2026-10-12 |
| Dev | done | web: opus-recorder (WASM Ogg/Opus, mono 48 kHz voice) lazily loaded, mic replaces Send when empty, record/review/send; server: voiceNote upload checked as Ogg/Opus <=5 min, voice_note column, duration + 64-bar waveform from Opus packets at send; wa: ptt send; CSP wasm-unsafe-eval; desktop: microphone (audio only); macOS mic usage text | 2026-10-12 |
| Unit tests | pass | typecheck + lint green; shared 29, wa 88, server 900, desktop 310 (+1 skipped), web 506 (maxWorkers=2); web build green | 2026-10-12 |
| E2E | pass | 56 passed, 8 skipped incl. new voice-note.spec (desktop Chromium fake microphone: record, review, send; server got an Ogg/Opus voice note) | 2026-10-12 |
| Dev Build | pass | fake WA + Chrome fake microphone: record 2 s, review (play back), send, bubble 'Voice note', preview [Voice note]; blocked mic and LAN http simulated; 1280 + 360, en/ms/zh-CN, light/dark; no page errors or horizontal scroll. Real-WhatsApp check pending (owner) | 2026-10-12 |
| Screen review | done | vs approved mockup at 1280/360 in 4 language/theme combos; fixed: waveform spread to full width, review length rounded down to match player; phone recording row kept on one line (fits 360) | 2026-10-12 |

## Log

- 2026-10-12 Design: done — interactive mockup approved (desktop + phone prototypes, 9 states): tap to record, Delete/Review/Send, 5:00 cap, mic greyed with reason on LAN http, blocked-mic help
- 2026-10-12 Dev: done — web: opus-recorder (WASM Ogg/Opus, mono 48 kHz voice) lazily loaded, mic replaces Send when empty, record/review/send; server: voiceNote upload checked as Ogg/Opus <=5 min, voice_note column, duration + 64-bar waveform from Opus packets at send; wa: ptt send; CSP wasm-unsafe-eval; desktop: microphone (audio only); macOS mic usage text
- 2026-10-12 Dev Build: pass — fake WA + Chrome fake microphone: record 2 s, review (play back), send, bubble 'Voice note', preview [Voice note]; blocked mic and LAN http simulated; 1280 + 360, en/ms/zh-CN, light/dark; no page errors or horizontal scroll. Real-WhatsApp check pending (owner)
- 2026-10-12 Screen review: done — vs approved mockup at 1280/360 in 4 language/theme combos; fixed: waveform spread to full width, review length rounded down to match player; phone recording row kept on one line (fits 360)
- 2026-10-12 Unit tests: pass — typecheck + lint green; shared 29, wa 88, server 900, desktop 310 (+1 skipped), web 506 (maxWorkers=2); web build green
- 2026-10-12 E2E: pass — 56 passed, 8 skipped incl. new voice-note.spec (desktop Chromium fake microphone: record, review, send; server got an Ogg/Opus voice note)
- 2026-10-12 Review fixes (Codex + SonarCloud): a start abandoned by Delete/unmount switches the mic off when it resolves; a declined send confirmation keeps the recording in Review; recorder stop promises handled; voice bar split into smaller components. ComposerVoice 11 pass, voice e2e pass
- 2026-10-12 Review fixes (Codex round 2): a finish invalidated by Delete/unmount is dropped; encoder stop failure or 10 s timeout closes the mic and shows 'couldn't be saved'. ComposerVoice 13 pass
- 2026-10-12 Packaged --dir smoke: pass — packaged server + web, Chrome fake mic: CSP wasm-unsafe-eval, encoder worker 200, voice note stored (audio/ogg; codecs=opus) and delivered, no errors. Review fixes (Codex round 3): shared SendMediaFields schema; sync throw from recorder.stop still closes the mic
