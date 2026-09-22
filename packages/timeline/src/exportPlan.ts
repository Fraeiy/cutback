import type { AudioSettings, CaptionCue, CaptionStyle, CropRect, ResolvedSegment } from "./types.js";

export interface ExportPlanInput {
  input: string;
  output: string;
  segments: ResolvedSegment[];
  hasAudio: boolean;
  crop: CropRect | null;
  captions: CaptionStyle;
  srtPath: string | null;
  fontsDir: string | null;
  fontName: string | null;
  musicPath?: string | null;
  audio?: AudioSettings;
}

function ms(value: number): string {
  return (value / 1000).toFixed(3);
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
export function buildAss(cues: CaptionCue[], style: CaptionStyle, fontName: string): string {
  // Anchor all captions from the top so the normalized preview position maps
  // directly to the same vertical location in libass.
  const alignment = 8;
  const marginV = Math.round(style.positionY * 1080);
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${fontName},${Math.round(48 * style.fontScale)},${hexToAss(style.color)},${hexToAss(style.highlightColor)},&H00000000,&H99000000,${style.preset === "bold" ? -1 : 0},0,0,0,100,100,0,0,3,1,0,${alignment},60,60,${marginV},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
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
  input.segments.forEach((segment, index) => {
    const start = ms(segment.sourceStartMs);
    const end = ms(segment.sourceEndMs);
    chains.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${index}]`);
    videoLabels.push(`[v${index}]`);
    if (input.hasAudio) {
      chains.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,aresample=48000,volume=${input.audio?.speechVolume ?? 1}[a${index}]`);
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
  } else {
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
  chains.push(`${video}${tails.join(",")}[vout]`);
  if (input.hasAudio && input.musicPath) {
    const duration = ms(input.segments[input.segments.length - 1].outputEndMs);
    const musicVolume = input.audio?.musicVolume ?? 0.18;
    const fade = ((input.audio?.fadeMs ?? 180) / 1000).toFixed(3);
    chains.push(`[1:a]atrim=duration=${duration},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${fade},afade=t=out:st=${Math.max(0, Number(duration) - Number(fade)).toFixed(3)}:d=${fade},volume=${musicVolume}[music]`);
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
  const filter = buildFilterGraph(input);
  const args = [
    "-y",
    "-i",
    input.input,
    ...(input.musicPath ? ["-stream_loop", "-1", "-i", input.musicPath] : []),
    "-filter_complex",
    filter,
    "-map",
    "[vout]",
  ];
  if (input.hasAudio) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "160k");
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-progress",
    "pipe:1",
    "-nostats",
    input.output,
  );
  return args;
}
