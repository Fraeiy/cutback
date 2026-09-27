import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildExportArgs,
  buildAss,
  buildSrt,
  present,
  type Project,
} from "../../../packages/timeline/src/index.js";
import { materializeProjectFile } from "./cloud.js";
import { ffmpegBin, findFont, parseProgress, runProcess } from "./ffmpeg.js";
import { projectDir } from "./store.js";

export async function renderExport(project: Project, onProgress: (progress: number) => Promise<void>): Promise<number> {
  const clips = project.clips ?? [];
  if (clips.length === 0) throw new Error("Upload a video first.");
  const view = present(project);
  if (view.segments.length === 0) throw new Error("The timeline is empty.");
  const dir = projectDir(project.id);
  await mkdir(dir, { recursive: true });
  const exportClips = await Promise.all(
    clips.map(async (clip) => ({
      clipId: clip.id,
      path: await materializeProjectFile(project.id, clip.media.storedName),
      hasAudio: clip.media.hasAudio,
      width: clip.media.width,
      height: clip.media.height,
    })),
  );
  // Only the clips actually used by the timeline need to be fed to ffmpeg, but
  // segment clip ids index into this list so it must cover every clip present.
  const output = path.join(dir, "export.mp4");
  let subtitlePath: string | null = null;
  const font = findFont(project.edit.captions.fontFamily);
  await writeFile(path.join(dir, "captions.srt"), buildSrt(view.cues), "utf8");
  if (project.edit.captions.enabled) {
    if (!font) throw new Error("Captions are on, but no font was found to burn them into the export.");
    subtitlePath = path.join(dir, "captions.ass");
    // Give libass the real output geometry so positionY means the same thing in
    // the burned file as it does in the preview, at any aspect ratio.
    const outputSize = view.crop
      ? { width: view.crop.outWidth, height: view.crop.outHeight }
      : { width: clips[0].media.width, height: clips[0].media.height };
    await writeFile(subtitlePath, buildAss(view.cues, project.edit.captions, font.family, outputSize), "utf8");
  }
  const args = buildExportArgs({
    clips: exportClips,
    output,
    segments: view.segments,
    hasAudio: exportClips.some((clip) => clip.hasAudio),
    crop: view.crop,
    captions: project.edit.captions,
    srtPath: subtitlePath,
    fontsDir: font?.directory ?? null,
    fontName: font?.family ?? null,
    musicPath: project.music ? await materializeProjectFile(project.id, project.music.storedName) : null,
    audio: project.edit.audio,
    // Mixed sources must be levelled before concat; a lone clip needs no change.
    normalize: exportClips.length > 1,
  });
  let buffer = "";
  let lastWrite = 0;
  const result = await runProcess(ffmpegBin(), args, async (chunk) => {
    buffer += chunk;
    const progress = parseProgress(buffer, view.outputDurationMs);
    const now = Date.now();
    if (progress !== null && now - lastWrite > 400) {
      lastWrite = now;
      buffer = buffer.slice(-2000);
      await onProgress(progress);
    }
  });
  if (result.code !== 0) {
    const detail = result.stderr.split("\n").map((line) => line.trim()).filter(Boolean).slice(-6).join(" ");
    throw new Error(detail || "FFmpeg failed.");
  }
  const info = await stat(output);
  if (info.size < 1024) throw new Error("FFmpeg wrote an empty file.");
  return info.size;
}
