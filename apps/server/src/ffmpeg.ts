import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export function ffmpegBin(): string {
  return process.env.FFMPEG_PATH || "ffmpeg";
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

const FONT_CANDIDATES: Array<{ file: string; family: string }> = [
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
