import { createReadStream, existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { waitUntil } from "@vercel/functions";
import {
  MAX_DURATION_MS,
  MAX_UPLOAD_BYTES,
  applyTool,
  attachClip,
  present,
  projectSourceDurationMs,
  removeClip,
  setClipTranscript,
  setPlayback,
  type PlaybackContext,
  type Project,
} from "../../../packages/timeline/src/index.js";
import { renderExport } from "./exportJob.js";
import {
  materializeProjectFile,
  projectBlobPath,
  signedReadUrl,
  signedUploadUrl,
  uploadPrivateFile,
  usesBlobStorage,
} from "./cloud.js";
import { ffmpegBin, ffprobeBin, probeMedia, runProcess } from "./ffmpeg.js";
import {
  assertId,
  createEmptyProject,
  dataRoot,
  loadProject,
  projectDir,
  saveProject,
  withProjectLock,
} from "./store.js";
import { fetchSentences, pollTranscript, submitTranscript, toTranscript, uploadMedia } from "./transcribe.js";

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(srcDir, "../../..");
if (process.env.VERCEL) {
  // Never read the repo .env on Vercel: it gets bundled into the function and
  // would point CUTBACK_DATA_DIR at the read-only task dir. Force /tmp instead.
  process.env.CUTBACK_DATA_DIR = path.join(process.env.TMPDIR || "/tmp", "cutback");
} else {
  loadEnvFile(path.join(repoRoot, ".env"));
  if (!process.env.CUTBACK_DATA_DIR) {
    process.env.CUTBACK_DATA_DIR = path.join(repoRoot, "data");
  }
}

const app = Fastify({
  logger: {
    redact: ["req.headers.authorization", "req.headers.x-cutback-token"],
  },
  requestTimeout: 0,
  bodyLimit: 1_000_000,
});

const allowedExt = new Set([".mp4", ".mov", ".webm", ".mkv", ".m4v"]);
const allowedAudioExt = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);

function loadEnvFile(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function apiKey(): string | null {
  const key = process.env.ASSEMBLYAI_API_KEY?.trim();
  return key ? key : null;
}

function sendProject(project: Project) {
  return present(project);
}

/**
 * A clip change invalidates both the rendered file and the transcript job: the
 * new clip has no words yet, and the export is stale either way.
 */
function resetJobs(project: Project): void {
  project.jobs.transcription = {
    status: "idle",
    error: null,
    progress: 0,
    updatedAt: new Date().toISOString(),
    transcriptId: null,
  };
  project.jobs.export = {
    status: "idle",
    error: null,
    progress: 0,
    updatedAt: null,
    file: null,
    bytes: null,
    revision: null,
  };
}

app.addHook("onRequest", async (request, reply) => {
  if (!request.url.startsWith("/api") || request.url.startsWith("/api/health")) return;
  const required = process.env.CUTBACK_ACCESS_TOKEN;
  if (!required) return;
  if (request.headers["x-cutback-token"] !== required) {
    return reply.code(401).send({ error: "This server requires the x-cutback-token header." });
  }
});

await app.register(cors, {
  origin: (process.env.CUTBACK_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173").split(","),
});
await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

app.get("/api/health", async () => {
  const ffmpeg = await runProcess(ffmpegBin(), ["-version"]);
  let ffprobe = ffmpeg;
  if (!process.env.VERCEL) {
    try {
      ffprobe = await runProcess(ffprobeBin(), ["-version"]);
    } catch {
      // probeMedia falls back to the bundled FFmpeg binary.
    }
  }
  return {
    ok: ffmpeg.code === 0 && ffprobe.code === 0,
    ffmpeg: ffmpeg.code === 0,
    ffprobe: ffprobe.code === 0,
    assemblyai: Boolean(apiKey()),
    accessTokenRequired: Boolean(process.env.CUTBACK_ACCESS_TOKEN),
    cloudStorage: usesBlobStorage(),
    maxDurationMs: MAX_DURATION_MS,
    maxUploadBytes: MAX_UPLOAD_BYTES,
  };
});

app.post("/api/projects", async (request) => {
  const body = (request.body ?? {}) as { title?: string };
  const project = await createEmptyProject(body.title);
  return sendProject(project);
});

app.post("/api/projects/demo", async (_request, reply) => {
  const sample = path.join(repoRoot, "samples", "demo.mp4");
  const transcriptFile = path.join(repoRoot, "samples", "demo.transcript.json");
  if (!existsSync(sample) || !existsSync(transcriptFile)) {
    return reply.code(404).send({ error: "Demo sample is missing. Run npm run sample." });
  }
  const project = await createEmptyProject("Demo");
  const dir = projectDir(project.id);
  await mkdir(dir, { recursive: true });
  const storedName = usesBlobStorage()
    ? projectBlobPath(project.id, `source/demo-${crypto.randomUUID()}.mp4`)
    : `clip-${crypto.randomUUID()}.mp4`;
  const localSample = path.join(dir, path.basename(storedName));
  await copyFile(sample, localSample);
  const probed = await probeMedia(localSample);
  const bytes = (await stat(localSample)).size;
  if (usesBlobStorage()) await uploadPrivateFile(localSample, storedName, "video/mp4");
  const transcript = JSON.parse(await readFile(transcriptFile, "utf8"));
  attachClip(
    project,
    {
      filename: "demo.mp4",
      storedName,
      bytes,
      durationMs: probed.durationMs,
      width: probed.width,
      height: probed.height,
      hasAudio: probed.hasAudio,
      mime: "video/mp4",
    },
    "clip_demo",
    transcript,
    "demo-fixture",
  );
  project.title = "Demo";
  await saveProject(project);
  return sendProject(project);
});

app.get("/api/projects/:id", async (request, reply) => {
  try {
    const project = await loadProject(assertId((request.params as { id: string }).id));
    return sendProject(project);
  } catch {
    return reply.code(404).send({ error: "Project not found." });
  }
});

app.patch("/api/projects/:id", async (request) => {
  const id = assertId((request.params as { id: string }).id);
  const body = (request.body ?? {}) as { title?: string };
  return withProjectLock(id, async () => {
    const project = await loadProject(id);
    const title = String(body.title || "").trim().slice(0, 120);
    if (title) project.title = title;
    project.updatedAt = new Date().toISOString();
    await saveProject(project);
    return sendProject(project);
  });
});

app.post("/api/projects/:id/uploads", async (request, reply) => {
  if (!usesBlobStorage()) return reply.code(404).send({ error: "Direct cloud uploads are not enabled." });
  const id = assertId((request.params as { id: string }).id);
  await loadProject(id);
  const body = (request.body ?? {}) as { filename?: string; contentType?: string; bytes?: number; kind?: string };
  const filename = path.basename(String(body.filename || ""));
  const ext = path.extname(filename).toLowerCase();
  const kind = body.kind === "music" ? "music" : "media";
  const allowed = kind === "music" ? allowedAudioExt : allowedExt;
  if (!allowed.has(ext)) {
    return reply.code(400).send({ error: kind === "music" ? "Use MP3, WAV, M4A, AAC, OGG, or FLAC." : "Use an MP4, MOV, WEBM, or MKV up to two minutes." });
  }
  const bytes = Number(body.bytes || 0);
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_UPLOAD_BYTES) {
    return reply.code(413).send({ error: "That file is over 200 MB." });
  }
  const contentType = String(body.contentType || (kind === "music" ? "audio/mpeg" : "video/mp4")).slice(0, 120);
  if (!(kind === "music" ? contentType.startsWith("audio/") : contentType.startsWith("video/"))) {
    return reply.code(400).send({ error: "The selected file type does not match its contents." });
  }
  const pathname = projectBlobPath(id, `${kind}/${crypto.randomUUID()}${ext}`);
  const uploadUrl = await signedUploadUrl(pathname, contentType, MAX_UPLOAD_BYTES);
  return { uploadUrl, pathname, filename, contentType, bytes, kind };
});

app.post("/api/projects/:id/uploads/attach", async (request, reply) => {
  if (!usesBlobStorage()) return reply.code(404).send({ error: "Direct cloud uploads are not enabled." });
  const id = assertId((request.params as { id: string }).id);
  const body = (request.body ?? {}) as { pathname?: string; filename?: string; contentType?: string; bytes?: number; kind?: string };
  const kind = body.kind === "music" ? "music" : "media";
  const pathname = String(body.pathname || "");
  const expectedPrefix = projectBlobPath(id, `${kind}/`);
  if (!pathname.startsWith(expectedPrefix) || pathname.includes("..")) {
    return reply.code(400).send({ error: "Invalid uploaded file path." });
  }
  return withProjectLock(id, async () => {
    const project = await loadProject(id);
    if (kind === "music") {
      project.music = {
        filename: path.basename(String(body.filename || "music")),
        storedName: pathname,
        bytes: Math.max(0, Number(body.bytes || 0)),
        mime: String(body.contentType || "audio/mpeg"),
      };
      project.revision += 1;
      project.updatedAt = new Date().toISOString();
      await saveProject(project);
      return sendProject(project);
    }
    const localFile = await materializeProjectFile(id, pathname);
    const probed = await probeMedia(localFile);
    const used = (project.clips ?? []).reduce((sum, clip) => sum + clip.media.durationMs, 0);
    if (used + probed.durationMs > MAX_DURATION_MS + 250) {
      return reply.code(400).send({
        error: (project.clips ?? []).length === 0
          ? "Cutback's hackathon build accepts videos up to 2 minutes."
          : "Clips together can be at most 2 minutes long.",
      });
    }
    attachClip(project, {
      filename: path.basename(String(body.filename || "video")),
      storedName: pathname,
      bytes: Math.max(0, Number(body.bytes || 0)),
      durationMs: probed.durationMs,
      width: probed.width,
      height: probed.height,
      hasAudio: probed.hasAudio,
      mime: String(body.contentType || "video/mp4"),
    });
    resetJobs(project);
    await saveProject(project);
    return sendProject(project);
  });
});

app.post("/api/projects/:id/media", async (request, reply) => {
  if (usesBlobStorage()) return reply.code(413).send({ error: "Use the direct cloud upload flow for this deployment." });
  const id = assertId((request.params as { id: string }).id);
  const incoming = await request.file();
  if (!incoming) return reply.code(400).send({ error: "Choose a video file." });
  const ext = path.extname(incoming.filename || "").toLowerCase();
  if (!allowedExt.has(ext)) {
    return reply.code(400).send({ error: "Use an MP4, MOV, WEBM, or MKV up to two minutes." });
  }
  const dir = projectDir(id);
  await mkdir(dir, { recursive: true });
  // Each clip gets its own file so adding a second clip cannot overwrite the first.
  const storedName = `clip-${crypto.randomUUID()}${ext}`;
  const target = path.join(dir, storedName);
  await pipeline(incoming.file, createWriteStream(target));
  if (incoming.file.truncated) {
    await rm(target, { force: true });
    return reply.code(413).send({ error: "That file is over 200 MB." });
  }
  return withProjectLock(id, async () => {
    const project = await loadProject(id);
    let probed;
    try {
      probed = await probeMedia(target);
    } catch (error) {
      await rm(target, { force: true });
      const message = error instanceof Error ? error.message : "Could not read that video.";
      return reply.code(400).send({ error: message });
    }
    const remaining = (MAX_DURATION_MS + 250) - (project.clips ?? []).reduce((sum, clip) => sum + clip.media.durationMs, 0);
    if (probed.durationMs > remaining) {
      await rm(target, { force: true });
      return reply.code(400).send({
        error: (project.clips ?? []).length === 0
          ? "Cutback's hackathon build accepts videos up to 2 minutes."
          : "Clips together can be at most 2 minutes long.",
      });
    }
    const bytes = (await stat(target)).size;
    for (const name of ["export.mp4", "captions.srt"]) await rm(path.join(dir, name), { force: true });
    // Appending keeps any cuts already made on the earlier clips.
    attachClip(project, {
      filename: path.basename(incoming.filename || storedName),
      storedName,
      bytes,
      durationMs: probed.durationMs,
      width: probed.width,
      height: probed.height,
      hasAudio: probed.hasAudio,
      mime: incoming.mimetype || "video/mp4",
    });
    resetJobs(project);
    await saveProject(project);
    return sendProject(project);
  });
});

app.delete("/api/projects/:id/clips/:clipId", async (request, reply) => {
  const id = assertId((request.params as { id: string }).id);
  const clipId = String((request.params as { clipId: string }).clipId);
  return withProjectLock(id, async () => {
    const project = await loadProject(id);
    const clip = (project.clips ?? []).find((item) => item.id === clipId);
    if (!clip) return reply.code(404).send({ error: "That clip is not on the timeline." });
    removeClip(project, clipId);
    resetJobs(project);
    if (!usesBlobStorage()) await rm(path.join(projectDir(id), clip.media.storedName), { force: true });
    await saveProject(project);
    return sendProject(project);
  });
});

app.post("/api/projects/:id/music", async (request, reply) => {
  if (usesBlobStorage()) return reply.code(413).send({ error: "Use the direct cloud upload flow for this deployment." });
  const id = assertId((request.params as { id: string }).id);
  const incoming = await request.file();
  if (!incoming) return reply.code(400).send({ error: "Choose an audio file." });
  const ext = path.extname(incoming.filename || "").toLowerCase();
  if (!allowedAudioExt.has(ext)) return reply.code(400).send({ error: "Use MP3, WAV, M4A, AAC, OGG, or FLAC." });
  const dir = projectDir(id);
  await mkdir(dir, { recursive: true });
  const storedName = `music${ext}`;
  const target = path.join(dir, storedName);
  await pipeline(incoming.file, createWriteStream(target));
  if (incoming.file.truncated) {
    await rm(target, { force: true });
    return reply.code(413).send({ error: "That audio file is too large." });
  }
  return withProjectLock(id, async () => {
    const project = await loadProject(id);
    project.music = {
      filename: path.basename(incoming.filename || storedName),
      storedName,
      bytes: (await stat(target)).size,
      mime: incoming.mimetype || "audio/mpeg",
    };
    project.revision += 1;
    project.updatedAt = new Date().toISOString();
    await saveProject(project);
    return sendProject(project);
  });
});

app.post("/api/projects/:id/playback", async (request, reply) => {
  const id = assertId((request.params as { id: string }).id);
  const body = request.body as PlaybackContext;
  if (!body || typeof body.sourceTimeMs !== "number") {
    return reply.code(400).send({ error: "Playback context needs a source time." });
  }
  return withProjectLock(id, async () => {
    const project = await loadProject(id);
    const duration = projectSourceDurationMs(project);
    setPlayback(project, {
      sourceTimeMs: Math.max(0, Math.min(duration, body.sourceTimeMs)),
      outputTimeMs: Math.max(0, body.outputTimeMs || 0),
      selectedWordIds: Array.isArray(body.selectedWordIds) ? body.selectedWordIds.slice(0, 80) : [],
      capturedAt: body.capturedAt || new Date().toISOString(),
      reason: body.reason || "speech-start",
    });
    await saveProject(project);
    return { ok: true, playback: project.playback };
  });
});

app.post("/api/projects/:id/transcribe", async (request, reply) => {
  const id = assertId((request.params as { id: string }).id);
  const key = apiKey();
  if (!key) {
    return reply.code(400).send({
      error: "Add ASSEMBLYAI_API_KEY to the server environment, then retry transcription.",
    });
  }
  const body = (request.body ?? {}) as { clipId?: string };
  const started: { ok: true; queue: string[] } | { error: string; code: number } = await withProjectLock(id, async () => {
    const project = await loadProject(id);
    const clips = project.clips ?? [];
    if (clips.length === 0) return { error: "Upload a video first.", code: 400 };
    if (project.jobs.transcription.status === "running") return { error: "Transcription is already running.", code: 409 };
    // A single clipId transcribes just that clip; otherwise every clip still
    // missing words, so "add a clip then transcribe" just works.
    const targets = body.clipId
      ? clips.filter((clip) => clip.id === body.clipId)
      : clips.filter((clip) => !clip.transcript);
    const queue = targets.length > 0 ? targets : clips;
    if (queue.length === 0) return { error: "Nothing to transcribe.", code: 400 };
    project.jobs.transcription = {
      status: "running",
      error: null,
      progress: 0.05,
      updatedAt: new Date().toISOString(),
      transcriptId: null,
    };
    await saveProject(project);
    return { ok: true, queue: queue.map((clip) => clip.id) };
  });
  if ("error" in started) return reply.code(started.code).send({ error: started.error });
  const work = runTranscription(id, key, started.queue);
  if (process.env.VERCEL) waitUntil(work);
  else void work;
  const project = await loadProject(id);
  return sendProject(project);
});

async function runTranscription(id: string, key: string, clipIds: string[]): Promise<void> {
  try {
    for (let index = 0; index < clipIds.length; index += 1) {
      const clipId = clipIds[index];
      const share = 1 / clipIds.length;
      const base = index * share;
      const project = await loadProject(id);
      const clip = (project.clips ?? []).find((item) => item.id === clipId);
      if (!clip) continue;
      const filePath = await materializeProjectFile(id, clip.media.storedName);
      const uploadUrl = await uploadMedia(filePath, key);
      const transcriptId = await submitTranscript(uploadUrl, key);
      await withProjectLock(id, async () => {
        const current = await loadProject(id);
        current.jobs.transcription.transcriptId = transcriptId;
        current.jobs.transcription.progress = base + share * 0.2;
        current.jobs.transcription.updatedAt = new Date().toISOString();
        await saveProject(current);
      });
      const completed = await pollTranscript(transcriptId, key, async (status) => {
        await withProjectLock(id, async () => {
          const current = await loadProject(id);
          if (current.jobs.transcription.status !== "running") return;
          current.jobs.transcription.progress = base + share * (status === "processing" ? 0.55 : 0.35);
          current.jobs.transcription.updatedAt = new Date().toISOString();
          await saveProject(current);
        });
      });
      const sentences = await fetchSentences(transcriptId, key);
      const transcript = toTranscript(transcriptId, completed.model, completed.text, sentences, completed.words);
      await withProjectLock(id, async () => {
        const current = await loadProject(id);
        setClipTranscript(current, clipId, transcript, "assemblyai");
        // Keep spans are absolute source times, so a new transcript does not
        // invalidate them. Resetting the edit here used to silently throw away
        // cuts the creator had already made. Only the pending proposals go,
        // because they were resolved against sentences that may no longer exist.
        current.proposals = [];
        current.lastTarget = null;
        current.highlight = null;
        current.revision += 1;
        current.jobs.export = {
          status: "idle",
          error: null,
          progress: 0,
          updatedAt: null,
          file: null,
          bytes: null,
          revision: null,
        };
        await saveProject(current);
      });
    }
    await withProjectLock(id, async () => {
      const current = await loadProject(id);
      current.jobs.transcription = {
        status: "completed",
        error: null,
        progress: 1,
        updatedAt: new Date().toISOString(),
        transcriptId: current.jobs.transcription.transcriptId,
      };
      await saveProject(current);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcription failed.";
    await withProjectLock(id, async () => {
      const current = await loadProject(id);
      current.jobs.transcription = {
        status: "error",
        error: message,
        progress: 0,
        updatedAt: new Date().toISOString(),
        transcriptId: current.jobs.transcription.transcriptId,
      };
      await saveProject(current);
    }).catch(() => undefined);
  }
}

app.post("/api/projects/:id/tools/:name", async (request, reply) => {
  const params = request.params as { id: string; name: string };
  const id = assertId(params.id);
  const body = (request.body ?? {}) as { callId?: string; arguments?: Record<string, unknown> };
  const callId = typeof body.callId === "string" ? body.callId.slice(0, 120) : undefined;
  try {
    return await withProjectLock(id, async () => {
      const project = await loadProject(id);
      if (
        params.name === "export_video" &&
        callId &&
        project.appliedCalls[callId]?.result.status === "export_requested"
      ) {
        delete project.appliedCalls[callId];
      }
      const outcome = applyTool(project, params.name, body.arguments ?? {}, callId);
      const batchWantsExport = params.name === "apply_instruction_batch" && outcome.result.export_requested === true;
      if ((params.name === "export_video" || batchWantsExport) && outcome.result.status !== "error" && !outcome.duplicate && (params.name === "export_video" ? outcome.result.status === "export_requested" : true)) {
        project.jobs.export = {
          status: "running",
          error: null,
          progress: 0.02,
          updatedAt: new Date().toISOString(),
          file: null,
          bytes: null,
          revision: project.revision,
        };
        await saveProject(project);
        try {
          const bytes = await renderExport(project, async (progress) => {
            project.jobs.export.progress = progress;
            project.jobs.export.updatedAt = new Date().toISOString();
            await saveProject(project);
          });
          const exportStoredName = usesBlobStorage() ? projectBlobPath(project.id, "export/export.mp4") : "export.mp4";
          const captionsStoredName = usesBlobStorage() ? projectBlobPath(project.id, "export/captions.srt") : "captions.srt";
          if (usesBlobStorage()) {
            await uploadPrivateFile(path.join(projectDir(project.id), "export.mp4"), exportStoredName, "video/mp4");
            await uploadPrivateFile(path.join(projectDir(project.id), "captions.srt"), captionsStoredName, "application/x-subrip");
          }
          const earlier = typeof outcome.result.summary === "string" ? outcome.result.summary : "";
          const result = {
            status: "completed",
            summary: params.name === "apply_instruction_batch" && earlier ? `${earlier} Then export ready.` : "Export ready.",
            completed: outcome.result.completed,
            revision: project.revision,
            bytes,
            download_path: `/api/projects/${project.id}/export`,
          };
          project.jobs.export = {
            status: "completed",
            error: null,
            progress: 1,
            updatedAt: new Date().toISOString(),
            file: exportStoredName,
            bytes,
            revision: project.revision,
          };
          if (callId) {
            project.appliedCalls[callId] = { at: new Date().toISOString(), isError: false, result };
          }
          await saveProject(project);
          return { ok: true, isError: false, duplicate: false, result, project: sendProject(project) };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Export failed.";
          const earlier = typeof outcome.result.summary === "string" ? outcome.result.summary : "";
          const result =
            params.name === "apply_instruction_batch"
              ? {
                  status: "partial",
                  summary: earlier ? `${earlier} Then export failed: ${message}` : message,
                  completed: outcome.result.completed,
                  failed: { tool: "export_video", error: message },
                }
              : { status: "error", error: message };
          project.jobs.export = {
            status: "error",
            error: message,
            progress: 0,
            updatedAt: new Date().toISOString(),
            file: null,
            bytes: null,
            revision: project.revision,
          };
          if (callId) delete project.appliedCalls[callId];
          await saveProject(project);
          return reply.code(500).send({ ok: false, isError: true, duplicate: false, result, project: sendProject(project) });
        }
      }
      await saveProject(outcome.project);
      return {
        ok: !outcome.isError,
        isError: outcome.isError,
        duplicate: outcome.duplicate,
        result: outcome.result,
        project: sendProject(outcome.project),
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool failed.";
    return reply.code(400).send({ error: message });
  }
});

/** Resolve `?clip=` to a clip, defaulting to the first one. */
function requestedClip(project: Project, query: unknown) {
  const clips = project.clips ?? [];
  if (clips.length === 0) return null;
  const clipId = typeof query === "string" ? query : "";
  return clips.find((clip) => clip.id === clipId) ?? clips[0];
}

app.get("/api/projects/:id/waveform", async (request, reply) => {
  const id = assertId((request.params as { id: string }).id);
  const project = await loadProject(id);
  const clip = requestedClip(project, (request.query as { clip?: string } | undefined)?.clip);
  if (!clip) return reply.code(404).send({ error: "Upload a video first." });
  if (!clip.media.hasAudio) return { peaks: [] };
  const filePath = await materializeProjectFile(id, clip.media.storedName);
  const result = await runProcess(ffmpegBin(), [
    "-hide_banner",
    "-i", filePath,
    "-vn",
    "-filter_complex", "ebur128=peak=true",
    "-f", "null",
    "-",
  ]);
  const values = [...result.stderr.matchAll(/\bM:\s*(-?\d+(?:\.\d+)?)/g)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  if (!values.length) return { peaks: [] };
  // Peaks are a fixed-width summary, so each clip returns the same count and the
  // client can lay them end to end across the flattened timeline.
  const target = 120;
  const peaks = Array.from({ length: target }, (_, index) => {
    const start = Math.floor(index * values.length / target);
    const end = Math.max(start + 1, Math.floor((index + 1) * values.length / target));
    const loudness = Math.max(...values.slice(start, end));
    return Math.max(0.08, Math.min(1, (loudness + 60) / 54));
  });
  return { peaks, clipId: clip.id, durationMs: clip.media.durationMs };
});

app.get("/api/projects/:id/media", async (request, reply) => {
  const id = assertId((request.params as { id: string }).id);
  const project = await loadProject(id);
  const clip = requestedClip(project, (request.query as { clip?: string } | undefined)?.clip);
  if (!clip) return reply.code(404).send({ error: "No video yet." });
  if (usesBlobStorage()) return reply.redirect(await signedReadUrl(clip.media.storedName));
  const filePath = path.join(projectDir(id), clip.media.storedName);
  const info = await stat(filePath);
  const range = request.headers.range;
  reply.header("Accept-Ranges", "bytes");
  reply.header("Content-Type", clip.media.mime || "video/mp4");
  reply.header("Cache-Control", "private, max-age=3600");
  if (!range) {
    reply.header("Content-Length", info.size);
    return reply.send(createReadStream(filePath));
  }
  const match = /bytes=(\d+)-(\d*)/.exec(range);
  if (!match) return reply.code(416).send();
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : info.size - 1;
  if (start >= info.size || end >= info.size || start > end) return reply.code(416).send();
  reply.code(206);
  reply.header("Content-Range", `bytes ${start}-${end}/${info.size}`);
  reply.header("Content-Length", end - start + 1);
  return reply.send(createReadStream(filePath, { start, end }));
});

app.get("/api/projects/:id/music", async (request, reply) => {
  const id = assertId((request.params as { id: string }).id);
  const project = await loadProject(id);
  if (!project.music) return reply.code(404).send({ error: "No background music." });
  if (usesBlobStorage()) return reply.redirect(await signedReadUrl(project.music.storedName));
  reply.header("Content-Type", project.music.mime || "audio/mpeg");
  reply.header("Cache-Control", "private, max-age=3600");
  return reply.send(createReadStream(path.join(projectDir(id), project.music.storedName)));
});

app.get("/api/projects/:id/export", async (request, reply) => {
  const id = assertId((request.params as { id: string }).id);
  if (usesBlobStorage()) {
    const project = await loadProject(id);
    if (project.jobs.export.status !== "completed" || !project.jobs.export.file) {
      return reply.code(404).send({ error: "Export the edit before downloading." });
    }
    return reply.redirect(await signedReadUrl(project.jobs.export.file, 15 * 60 * 1000));
  }
  const filePath = path.join(projectDir(id), "export.mp4");
  if (!existsSync(filePath)) return reply.code(404).send({ error: "Export the edit before downloading." });
  const info = await stat(filePath);
  reply.header("Content-Type", "video/mp4");
  reply.header("Content-Length", info.size);
  reply.header("Content-Disposition", 'attachment; filename="cutback.mp4"');
  return reply.send(createReadStream(filePath));
});

app.get("/api/projects/:id/subtitles.srt", async (request, reply) => {
  const id = assertId((request.params as { id: string }).id);
  if (usesBlobStorage()) {
    const project = await loadProject(id);
    if (project.jobs.export.status !== "completed") {
      return reply.code(404).send({ error: "Export the project first to create edited-timeline subtitles." });
    }
    return reply.redirect(await signedReadUrl(projectBlobPath(id, "export/captions.srt"), 15 * 60 * 1000));
  }
  const filePath = path.join(projectDir(id), "captions.srt");
  if (!existsSync(filePath)) return reply.code(404).send({ error: "Export the project first to create edited-timeline subtitles." });
  reply.header("Content-Type", "application/x-subrip; charset=utf-8");
  reply.header("Content-Disposition", 'attachment; filename="cutback-captions.srt"');
  return reply.send(createReadStream(filePath));
});

app.post("/api/voice/token", async (_request, reply) => {
  const key = apiKey();
  if (!key) {
    return reply.code(400).send({ error: "Add ASSEMBLYAI_API_KEY before starting a voice session." });
  }
  const url = new URL("https://agents.assemblyai.com/v1/token");
  url.searchParams.set("expires_in_seconds", "300");
  url.searchParams.set("max_session_duration_seconds", "3600");
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    if (!response.ok) {
      let providerMessage = "";
      try {
        const payload = JSON.parse(text) as { error?: string; message?: string };
        providerMessage = payload.error || payload.message || "";
      } catch {
        providerMessage = "";
      }
      const message = response.status === 401
        ? "AssemblyAI rejected the API key. Check ASSEMBLYAI_API_KEY and restart the server."
        : response.status === 429
          ? "AssemblyAI voice sessions are rate-limited. Wait briefly and try again."
          : `AssemblyAI could not create a voice session${providerMessage ? `: ${providerMessage}` : "."}`;
      return reply.code(response.status).send({ error: message });
    }
    const payload = JSON.parse(text) as { token?: string; expires_in_seconds?: number };
    if (!payload.token) return reply.code(502).send({ error: "AssemblyAI returned no voice-session token." });
    return { token: payload.token, expiresInSeconds: payload.expires_in_seconds ?? 300 };
  } catch (error) {
    app.log.warn({ err: error }, "AssemblyAI voice token request could not connect");
    return reply.code(503).send({
      error: "Cannot reach AssemblyAI's voice service. Check your internet connection, VPN, DNS, or firewall access to agents.assemblyai.com, then try again.",
    });
  }
});

const webDist = path.join(repoRoot, "apps", "web", "dist");
if (!process.env.VERCEL && existsSync(path.join(webDist, "index.html"))) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api")) return reply.code(404).send({ error: "Not found." });
    return reply.sendFile("index.html");
  });
}

if (!process.env.VERCEL) {
  const port = Number(process.env.PORT || 8791);
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`Cutback server listening on ${port}. Data directory ${dataRoot()}`);
}

export default app;
