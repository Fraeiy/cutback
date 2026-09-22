# Cutback

Cutback is a voice-controlled editor for a short video. You upload one clip, watch it, and tell an [AssemblyAI](https://www.assemblyai.com/docs/voice-agents/voice-agent-api) voice agent what to change. The agent calls editing tools. Preview and the exported MP4 are built from the same edit.

## What you need

One credential:

- `ASSEMBLYAI_API_KEY` from [the AssemblyAI dashboard](https://www.assemblyai.com/dashboard/api-keys)

The server keeps that key. The browser asks the server for a one-time voice token (`GET https://agents.assemblyai.com/v1/token`) and connects to `wss://agents.assemblyai.com/v1/ws`. Transcription is a separate pre-recorded job: upload to `https://api.assemblyai.com/v2/upload`, then `POST /v2/transcript` with `speech_models: ["universal-3-5-pro", "universal-2"]`, then poll and fetch sentences.

The voice agent uses AssemblyAI's managed model through an inline `session.update`. An OpenAI or OpenRouter key is not used.

Copy `.env.example` to `.env` and set the key. Set `CUTBACK_ACCESS_TOKEN` before you put the server on a public URL. Anyone who can open the app can otherwise start sessions billed to your key.

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

Docker, for a host that can run a long-lived process:

```bash
docker compose up --build
```

Do not deploy the export or transcription work to a short-lived frontend function. FFmpeg runs in this Node process. A volume mounted at `/data` keeps uploads and renders.

## How an edit is stored

The original file stays on disk. The project JSON stores keep-spans in source milliseconds, a pause policy, caption settings, and a framing choice. Undo and redo are snapshots of that state.

`resolveSegments` turns spans plus the pause policy into source ranges and matching output times. The player, the on-screen captions, and the FFmpeg export all use those ranges. FFmpeg is invoked with an argument array. The model never supplies a shell command.

Tool calls are idempotent by `call_id`. A proposal that was already applied returns the same summary and does not cut again. A proposal from an older revision is rejected. Ambiguous quotes and a playhead sitting in a pause return `needs_clarification` and change nothing.

The browser freezes the playhead when local voice activity starts, and again when AssemblyAI emits `input.speech.started`. That snapshot is what “remove that bit” uses. The mic uses echo cancellation with noise suppression off, matching the voice-agent browser guide. Open mic ducks the video. Push-to-talk (hold `V` or hold the button) leaves the video at full volume until you talk. Starting to speak pauses playback so the video is not treated as an instruction.

## Demo

`samples/demo.mp4` is generated here with Windows Speech and FFmpeg. Sentence times in `samples/demo.transcript.json` match that audio. Word times inside a sentence are evenly split and labeled as a fixture (`transcriptSource: "demo-fixture"`). Use **Transcribe** to replace them with AssemblyAI word timestamps.

With the demo loaded, a spoken pass is:

1. “Start where I say ‘I tested this tool yesterday’.”
2. “Remove the long pauses.”
3. “Keep the pause before the last sentence.”
4. “Add captions.”
5. “Make it vertical.”
6. “Undo that.”
7. “Export the video.”

The agent should only say a change is done after the tool result says `applied`, and only say the file is ready after export returns `completed`.

## Limits

- One video per project, up to 2 minutes and 200 MB.
- Real transcription and the live voice session need `ASSEMBLYAI_API_KEY`. The demo fixture is not a simulated voice call, and the MP4 export is a real FFmpeg render.
- Projects live on local disk in one long-running process. Refresh restores segment order, edit history, captions, framing, audio settings, and pending cut proposals.
- Retrying transcription replaces the transcript and resets the edit, because word ids are rebuilt.
- Caption burn-in needs Arial, Liberation Sans, or DejaVu Sans on the machine. The preview and export use the same caption settings and edited timeline.
- Cutback supports reordered source segments, but it does not invent missing speech or perform automatic subject tracking.
- The editor has responsive phone controls and safe-area handling. It does not include accounts.

## Deployment

The included Docker setup is the production path for the complete editor because uploads, project JSON, and rendered files require durable storage while FFmpeg runs in a long-lived Node process. A static Vercel deployment can host the Vite interface, but it cannot provide working upload, transcription, or export by itself. Moving the complete app to Vercel requires an external durable media store and a rendering worker; do not point the interface at an ephemeral Function and treat it as a complete deployment.

## Layout

- `packages/timeline` — edit math, tool behavior, voice tool schema, FFmpeg argument builder, tests
- `apps/server` — upload, AssemblyAI transcription, voice tokens, export
- `apps/web` — player, transcript, timeline, voice session
- `samples` — the generated demo
- `scripts/generate-sample.ts` — rebuilds the demo
