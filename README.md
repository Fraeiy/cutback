# Cutback

Cutback is a voice-controlled editor for short video. You add one or more clips, watch them, and tell an [AssemblyAI](https://www.assemblyai.com/docs/voice-agents/voice-agent-api) voice agent what to change. The agent calls editing tools. The preview and the exported MP4 are built from the same edit.

## What you need

One credential:

- `ASSEMBLYAI_API_KEY` from [the AssemblyAI dashboard](https://www.assemblyai.com/dashboard/api-keys)

The server keeps that key. The browser asks the server for a one-time voice token (`GET https://agents.assemblyai.com/v1/token`) and connects to `wss://agents.assemblyai.com/v1/ws`. Transcription is a separate pre-recorded job: stream the upload to `https://api.assemblyai.com/v2/upload`, then `POST /v2/transcript` with `speech_models: ["universal-3-5-pro", "universal-2"]`, then poll and fetch sentences.

The voice agent uses AssemblyAI's managed model through an inline `session.update`. An OpenAI or OpenRouter key is not used.

Copy `.env.example` to `.env` and set the key.

If you put the server on a public URL, set `CUTBACK_ACCESS_TOKEN` first. Anyone who can open the app can otherwise start voice sessions billed to your key. The client sends it as `x-cutback-token`; the UI prompts for it on a 401 and keeps it in `sessionStorage`.

## Run it

Requirements: Node 22, FFmpeg and ffprobe on `PATH`.

```bash
npm install
npm run sample
npm run dev
```

Open http://localhost:5173. The API is http://localhost:8791. `npm start` serves the built UI and the API on `PORT` (8791 by default).

```bash
npm test
npm run build
npm start
```

Do not deploy the export or transcription work to a short-lived frontend function. FFmpeg runs in this Node process. A volume mounted at `/data` keeps uploads and renders.

## Clips and the timeline

A project holds a list of clips, laid end to end on one flattened source timeline. A clip's `offsetMs` is where it starts on that timeline, so any source time in the project maps to exactly one clip. Adding a clip keeps the cuts already made on the earlier ones.

Keep-spans are stored in source milliseconds, alongside a pause policy, caption settings and a framing choice. Undo and redo are snapshots of that state. `resolveSegments` turns spans plus the pause policy into source ranges and matching output times, and splits them at clip boundaries so no segment ever crosses two clips. The player, the on-screen captions and the FFmpeg export all use those ranges.

FFmpeg receives one input per clip and levels mixed resolutions and frame rates before concatenating, so clips shot at different settings still join. A clip with no audio is padded with silence to keep audio in step with video. FFmpeg is invoked with an argument array; the model never supplies a shell command.

Tool calls are idempotent by `call_id`. A proposal that was already applied returns the same summary and does not cut again. A proposal from an older revision is rejected. Ambiguous quotes and a playhead sitting in a pause return `needs_clarification` and change nothing. Read-only tools are not memoised, so a long transcript does not bloat the project file.

Transcribing a clip keeps the existing edit, including cuts made on clips that were already done. Keep-spans are absolute source times, so a new transcript cannot invalidate them.

## Voice

The browser freezes the playhead when local voice activity starts, and again when AssemblyAI emits `input.speech.started`. That snapshot is what “remove that bit” uses, and it is a real source time on the combined timeline, not a position inside whichever file happens to be loaded. Starting to speak pauses playback so the video is not treated as an instruction. The mic uses echo cancellation with noise suppression off, matching the voice-agent browser guide.

Turn on **PTT** in the assistant panel and audio only reaches the agent while you hold `V`, or hold the assistant button. The video can then play at full volume without the agent hearing it as an instruction. The hold has a short grace period, so an ordinary click or a drag of the button never opens the microphone by accident.

The assistant is a floating panel you can drag, reposition with `Alt` + arrow keys, and collapse with `Escape`. It does not open the microphone until you ask it to.

## Demo

Open the **Media** panel and choose **Load the demo project**. That creates a project from `samples/demo.mp4` with the prepared transcript in `samples/demo.transcript.json`, so you can try the voice tools without paying for a transcription first. Use **Transcribe this clip** to replace the fixture with real AssemblyAI word timestamps.

`samples/demo.mp4` is generated with `npm run sample`. Word times inside a sentence in the fixture are evenly split and labelled `transcriptSource: "demo-fixture"`.

With the demo loaded, a spoken pass is:

1. “Start where I say ‘I tested this tool yesterday’.”
2. “Remove the long pauses.”
3. “Keep the pause before the last sentence.”
4. “Add captions.”
5. “Highlight the current word in yellow.”
6. “Turn captions off.”
7. “Make it vertical.”
8. “Undo that.”
9. “Export the video.”

The agent should only say a change is done after the tool result says `applied`, and only say the file is ready after export returns `completed`.

## Limits

- Up to 2 minutes of video and 200 MB per file, across all clips in a project. Clips are added end to end; there is no drag-to-reorder in the timeline, but sections within the sequence can be reordered by voice.
- Real transcription and the live voice session need `ASSEMBLYAI_API_KEY`. The demo fixture is not a simulated voice call, and the MP4 export is a real FFmpeg render.
- A project needs a transcript before it can be edited, because cuts target sentences. Any clip without words shows a **Transcribe** action.
- Projects live on local disk in one long-running process. Refresh restores clip order, segment order, edit history, captions, framing, audio settings and pending cut proposals.
- Caption burn-in needs Arial, Liberation Sans, or DejaVu Sans. DejaVu Sans is bundled in `assets/fonts`, so exports with captions work on hosts without system fonts. The preview and the export share the same caption settings, the same position and the same edited timeline; the burn-in is scaled to the real output frame, so a vertical export places captions where the preview shows them.
- Background music is mixed under the speech with ducking and fades. The preview ducks on the same rule the export uses.
- Cutback supports reordered source segments, but it does not invent missing speech or perform automatic subject tracking.
- The editor has responsive phone controls, a status line and safe-area handling. The microphone needs a secure context, so on a handset you need HTTPS or localhost rather than a plain LAN address. It does not include accounts.

## Deployment

The complete editor deploys to Vercel as a single Function (`vercel deploy --prod`, remote build). Projects, uploaded media, and rendered exports live in Vercel Blob storage, FFmpeg comes from `ffmpeg-static` (its Linux binary is fetched by the remote build), exports run inside the Function under a 300 second limit, and the DejaVu Sans font in `assets/fonts` is bundled so caption burn-in works without system fonts. Required environment variables: `ASSEMBLYAI_API_KEY`, `BLOB_READ_WRITE_TOKEN`, and `CUTBACK_ACCESS_TOKEN` for any public URL. The Function's `/tmp` is ephemeral, so durable state always comes from Blob storage. The included Docker setup remains the option for local or long-lived hosting with disk storage.

## Layout

- `packages/timeline` — edit math, clip flattening, tool behaviour, voice tool schema, FFmpeg argument builder, tests
- `apps/server` — upload, AssemblyAI transcription, voice tokens, export
- `apps/web` — player, transcript, timeline, clip bin, voice session
- `samples` — the generated demo
- `scripts/generate-sample.ts` — rebuilds the demo
