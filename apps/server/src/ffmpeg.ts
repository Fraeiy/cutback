import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ffmpegStatic = require("ffmpeg-static") as string | null;

export function ffmpegBin(): string {
  return process.env.FFMPEG_PATH || (process.env.VERCEL ? ffmpegStatic || "ffmpeg" : "ffmpeg");
}

export function ffprobeBin(): string {
  return process.env.FFPROBE_PATH || "ffprobe";
}

export function runProcess(
  bin: string,
  args: string[],
  onStdout?: (chunk: string) => void,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let writes = Promise.resolve();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (!onStdout) return;
      writes = writes.then(() => onStdout(chunk)).catch(() => undefined);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      void writes.then(() => resolve({ code: code ?? 1, stdout, stderr }));
    });
  });
}

export interface Probe {
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export async function probeMedia(filePath: string): Promise<Probe> {
  if (process.env.VERCEL) {
    const result = await runProcess(ffmpegBin(), ["-hide_banner", "-i", filePath]);
    const duration = /Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(result.stderr);
    const video = /Video:[^\r\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(result.stderr);
    if (!duration || !video) throw new Error("Could not read the video duration and dimensions.");
    const durationSec = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
    return {
      durationMs: Math.round(durationSec * 1000),
      width: Number(video[1]),
      height: Number(video[2]),
      hasAudio: /Audio:[^\r\n]+/.test(result.stderr),
    };
  }
  const result = await runProcess(ffprobeBin(), [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "ffprobe failed");
  }
  const parsed = JSON.parse(result.stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>;
  };
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  if (!video?.width || !video.height) throw new Error("The file has no video stream.");
  const durationSec = Number(parsed.format?.duration ?? video.duration ?? 0);
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error("Could not read the video duration.");
  return {
    durationMs: Math.round(durationSec * 1000),
    width: video.width,
    height: video.height,
    hasAudio: Boolean(parsed.streams?.some((stream) => stream.codec_type === "audio")),
  };
}

export function parseProgress(chunk: string, durationMs: number): number | null {
  const match = /out_time_ms=(\d+)/.exec(chunk) ?? /out_time_us=(\d+)/.exec(chunk);
  if (!match || durationMs <= 0) return null;
  const microseconds = Number(match[1]);
  return Math.max(0, Math.min(1, microseconds / 1000 / durationMs));
}

export interface FontChoice {
  file: string;
  family: string;
  directory: string;
}

// Bundled with the deployment so captioned exports render on hosts without
// system fonts (Vercel functions ship none). The `new URL(..., import.meta.url)`
// form lets @vercel/nft trace it, and vercel.json's includeFiles adds it too.
const bundledSans = fileURLToPath(new URL("../../../../assets/fonts/DejaVuSans.ttf", import.meta.url));

const FONT_CANDIDATES: Array<{ file: string; family: string }> = [
  { file: bundledSans, family: "DejaVu Sans" },
  { file: path.join(process.cwd(), "assets", "fonts", "DejaVuSans.ttf"), family: "DejaVu Sans" },
  { file: "C:/Windows/Fonts/arial.ttf", family: "Arial" },
  { file: "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", family: "Liberation Sans" },
  { file: "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", family: "DejaVu Sans" },
];

export function findFont(preferred?: string): FontChoice | null {
  const ordered = preferred
    ? [...FONT_CANDIDATES.filter((item) => item.family === preferred), ...FONT_CANDIDATES.filter((item) => item.family !== preferred)]
    : FONT_CANDIDATES;
  for (const candidate of ordered) {
    if (!existsSync(candidate.file)) continue;
    const normalized = candidate.file.replace(/\\/g, "/");
    const directory = normalized.slice(0, normalized.lastIndexOf("/"));
    return { file: candidate.file, family: candidate.family, directory };
  }
  return null;
}
