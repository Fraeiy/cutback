import type { AudioSettings, CaptionCue, CaptionStyle, CropRect, ResolvedSegment } from "./types.js";

export interface ExportClip {
  clipId: string;
  /** Absolute path to this clip's source file. */
  path: string;
  hasAudio: boolean;
  width: number;
  height: number;
}

export interface ExportPlanInput {
  /** One entry per clip on the timeline, in clip order. */
  clips: ExportClip[];
  output: string;
  segments: ResolvedSegment[];
  /** Every clip carries audio. False only when no clip does. */
  hasAudio: boolean;
  crop: CropRect | null;
  captions: CaptionStyle;
  srtPath: string | null;
  fontsDir: string | null;
  fontName: string | null;
  musicPath?: string | null;
  audio?: AudioSettings;
  /** Normalise every clip to the first clip's geometry before concat. */
  normalize?: boolean;
  frameRate?: number;
  /** Container and codecs. Omitted exports stay MP4 so older callers are unchanged. */
  format?: "mp4" | "webm";
  /** Caps the short side. Smaller sources are not enlarged. */
  quality?: 1080 | 720;
}

function ms(value: number): string {
  return (value / 1000).toFixed(3);
}

export type ExportFormat = "mp4" | "webm";
export type ExportQuality = 1080 | 720;

/** Read the export dialog, or a voice tool call, into the two settings the renderer understands. */
export function readExportOptions(args: Record<string, unknown> | undefined): { format: ExportFormat; quality: ExportQuality } {
  const format = args?.format === "webm" ? "webm" : "mp4";
  const raw = typeof args?.quality === "number" ? String(args.quality) : String(args?.quality ?? "1080");
  return { format, quality: raw.startsWith("720") ? 720 : 1080 };
}

/** Fit a frame to 1080p or 720p by its short side, keeping the shape and never enlarging. */
export function fitExportSize(width: number, height: number, quality: ExportQuality): { width: number; height: number } {
  const short = Math.min(width, height);
  if (short <= 0) return { width: 2, height: 2 };
  const scale = Math.min(1, quality / short);
  const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/** Escape a filesystem path for an FFmpeg filtergraph option. */
export function escapeFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export function srtTimestamp(timeMs: number): string {
  const clamped = Math.max(0, timeMs);
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1000);
  const millis = Math.floor(clamped % 1000);
  const pad = (n: number, size = 2) => String(n).padStart(size, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

export function buildSrt(cues: Array<{ outputStartMs: number; outputEndMs: number; text: string }>): string {
  return cues
    .map((cue, index) => {
      const text = cue.text.replace(/\r?\n/g, " ").trim();
      return `${index + 1}\n${srtTimestamp(cue.outputStartMs)} --> ${srtTimestamp(cue.outputEndMs)}\n${text}\n`;
    })
    .join("\n");
}

function assTimestamp(timeMs: number): string {
  const cs = Math.max(0, Math.round(timeMs / 10));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

function assEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/[{}]/g, "").replace(/\r?\n/g, " ");
}

/** Styled subtitle file used by preview-equivalent MP4 rendering. */
export function buildAss(
  cues: CaptionCue[],
  style: CaptionStyle,
  fontName: string,
  output?: { width: number; height: number },
): string {
  // Anchor all captions from the top so the normalized preview position maps
  // directly to the same vertical location in libass. PlayRes has to be the
  // real output size: libass scales script space onto the video, so a hardcoded
  // 1080 put a vertical 1920-tall export's captions near the middle instead of
  // near the bottom.
  const playResX = Math.max(2, Math.round(output?.width ?? 1920));
  const playResY = Math.max(2, Math.round(output?.height ?? 1080));
  const alignment = 8;
  const marginV = Math.round(style.positionY * playResY);
  const fontSize = Math.max(8, Math.round((playResY / 1080) * 48 * style.fontScale));
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${playResX}\nPlayResY: ${playResY}\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${fontName},${fontSize},${hexToAss(style.color)},${hexToAss(style.highlightColor)},&H00000000,&H99000000,${style.preset === "bold" ? -1 : 0},0,0,0,100,100,0,0,3,1,0,${alignment},60,60,${marginV},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const lines: string[] = [];
  for (const cue of cues) {
    if (!style.wordHighlight || cue.words.length === 0) {
      lines.push(`Dialogue: 0,${assTimestamp(cue.outputStartMs)},${assTimestamp(cue.outputEndMs)},Default,,0,0,0,,${assEscape(cue.text)}`);
      continue;
    }
    cue.words.forEach((active) => {
      const text = cue.words.map((word) => word.id === active.id
        ? `{\\c${hexToAss(style.highlightColor)}}${assEscape(word.text)}{\\c${hexToAss(style.color)}}`
        : assEscape(word.text)).join(" ");
      lines.push(`Dialogue: 0,${assTimestamp(active.outputStartMs)},${assTimestamp(active.outputEndMs)},Default,,0,0,0,,${text}`);
    });
  }
  return header + lines.join("\n") + "\n";
}

function hexToAss(color: string): string {
  const match = /^#([0-9a-fA-F]{6})$/.exec(color);
  if (!match) return "&H00FFFFFF";
  const hex = match[1];
  const rr = hex.slice(0, 2);
  const gg = hex.slice(2, 4);
  const bb = hex.slice(4, 6);
  return `&H00${bb}${gg}${rr}`.toUpperCase();
}

export function buildFilterGraph(input: ExportPlanInput): string {
  const chains: string[] = [];
  const videoLabels: string[] = [];
  const audioLabels: string[] = [];
  // Segments read from whichever clip they were cut from. With a single clip this
  // is always input 0, which keeps the one-clip graph byte-identical to before.
  const indexByClipId = new Map(input.clips.map((clip, index) => [clip.clipId, index]));
  const audioByClipId = new Map(input.clips.map((clip, index) => [clip.clipId, clip.hasAudio]));
  // Concat requires matching geometry, so mixed-resolution sources are levelled
  // to the first clip before joining.
  const reference = input.clips[0];
  const level = (index: number): string[] => {
    if (!input.normalize || !reference) return [];
    const clip = input.clips[index];
    if (!clip) return [];
    return [
      `scale=${reference.width}:${reference.height}:force_original_aspect_ratio=decrease:flags=lanczos`,
      `pad=${reference.width}:${reference.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
      "setsar=1",
      `fps=${input.frameRate ?? 30}`,
      "format=yuv420p",
    ];
  };

  input.segments.forEach((segment, index) => {
    const clipIndex = indexByClipId.get(segment.clipId) ?? 0;
    const start = ms(segment.clipStartMs);
    const end = ms(segment.clipEndMs);
    chains.push(
      `[${clipIndex}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS${level(clipIndex).length ? `,${level(clipIndex).join(",")}` : ""}[v${index}]`,
    );
    videoLabels.push(`[v${index}]`);
    // A clip with no audio is padded with silence so the concat keeps audio in
    // step with video across the whole timeline.
    if (input.hasAudio) {
      if (audioByClipId.get(segment.clipId) === false) {
        chains.push(
          `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${(segment.clipEndMs - segment.clipStartMs) / 1000},asetpts=PTS-STARTPTS[a${index}]`,
        );
      } else {
        chains.push(`[${clipIndex}:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${input.audio?.speechVolume ?? 1}[a${index}]`);
      }
      audioLabels.push(`[a${index}]`);
    }
  });

  if (input.hasAudio) {
    const pairs = input.segments.map((_, index) => `[v${index}][a${index}]`).join("");
    chains.push(`${pairs}concat=n=${input.segments.length}:v=1:a=1[vc][ac]`);
  } else {
    chains.push(`${videoLabels.join("")}concat=n=${input.segments.length}:v=1:a=0[vc]`);
  }

  let video = "[vc]";
  const tails: string[] = [];
  if (input.crop) {
    const crop = input.crop;
    tails.push(
      `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`,
      `scale=${crop.outWidth}:${crop.outHeight}:flags=lanczos`,
      "setsar=1",
    );
  } else if (!input.normalize) {
    tails.push("setsar=1");
  }
  if (input.captions.enabled && input.srtPath && input.fontName) {
    const isAss = /\.ass$/i.test(input.srtPath);
    const alignment = input.captions.position === "center" ? 5 : 2;
    const fontSize = Math.round(18 * input.captions.fontScale);
    const margin = input.captions.position === "center" ? 0 : 36;
    const style = [
      `FontName=${input.fontName}`,
      `FontSize=${fontSize}`,
      `PrimaryColour=${hexToAss(input.captions.color)}`,
      "OutlineColour=&H00000000",
      "BorderStyle=3",
      "Outline=1",
      "Shadow=0",
      `Alignment=${alignment}`,
      `MarginV=${margin}`,
    ].join(",");
    const fonts = input.fontsDir ? `:fontsdir='${escapeFilterPath(input.fontsDir)}'` : "";
    tails.push(isAss
      ? `subtitles='${escapeFilterPath(input.srtPath)}'${fonts}`
      : `subtitles='${escapeFilterPath(input.srtPath)}'${fonts}:force_style='${style.replace(/,/g, "\\,")}'`);
  }
  // Scale after captions so the burned text stays in the same place on the picture.
  if (input.quality) {
    const base = input.crop
      ? { width: input.crop.outWidth, height: input.crop.outHeight }
      : input.clips[0]
        ? { width: input.clips[0].width, height: input.clips[0].height }
        : null;
    if (base) {
      const fitted = fitExportSize(base.width, base.height, input.quality);
      if (fitted.width !== base.width || fitted.height !== base.height) {
        tails.push(`scale=${fitted.width}:${fitted.height}:flags=lanczos`, "setsar=1");
      }
    }
  }
  // With nothing to apply after the concat, a null filter still gives [vout] a
  // label to bind to.
  chains.push(tails.length > 0 ? `${video}${tails.join(",")}[vout]` : `${video}null[vout]`);
  if (input.hasAudio && input.musicPath) {
    // Music is always the input after every clip.
    const musicIndex = input.clips.length;
    const duration = ms(input.segments[input.segments.length - 1].outputEndMs);
    const musicVolume = input.audio?.musicVolume ?? 0.18;
    const fade = ((input.audio?.fadeMs ?? 180) / 1000).toFixed(3);
    chains.push(`[${musicIndex}:a]atrim=duration=${duration},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${fade},afade=t=out:st=${Math.max(0, Number(duration) - Number(fade)).toFixed(3)}:d=${fade},volume=${musicVolume}[music]`);
    if (input.audio?.duckMusic !== false) {
      chains.push("[music][ac]sidechaincompress=threshold=0.03:ratio=8:attack=40:release=220[ducked]");
      chains.push("[ac][ducked]amix=inputs=2:duration=first:normalize=0,aresample=48000[aout]");
    } else {
      chains.push("[ac][music]amix=inputs=2:duration=first:normalize=0,aresample=48000[aout]");
    }
  } else if (input.hasAudio) chains.push("[ac]aresample=48000[aout]");
  return chains.join(";");
}

export function buildExportArgs(input: ExportPlanInput): string[] {
  if (input.segments.length === 0) throw new Error("Cannot export an empty timeline.");
  if (input.clips.length === 0) throw new Error("Upload a video first.");
  const filter = buildFilterGraph(input);
  const args = [
    "-y",
    ...input.clips.flatMap((clip) => ["-i", clip.path]),
    ...(input.musicPath ? ["-stream_loop", "-1", "-i", input.musicPath] : []),
    "-filter_complex",
    filter,
    "-map",
    "[vout]",
  ];
  const webm = input.format === "webm";
  if (input.hasAudio) {
    args.push("-map", "[aout]", "-c:a", webm ? "libopus" : "aac", "-b:a", webm ? "128k" : "160k");
  }
  if (webm) {
    args.push("-c:v", "libvpx-vp9", "-deadline", "good", "-cpu-used", "6", "-row-mt", "1", "-crf", "33", "-b:v", "0", "-pix_fmt", "yuv420p");
  } else {
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart");
  }
  args.push("-progress", "pipe:1", "-nostats", input.output);
  return args;
}
