import type {
  CaptionCue,
  Clip,
  CropRect,
  EditState,
  Framing,
  KeepSpan,
  PauseMark,
  PausePolicy,
  ResolvedSegment,
  Sentence,
  Word,
} from "./types.js";
import { MIN_SPAN_MS } from "./types.js";
import { clipAt, splitRangeByClips } from "./clips.js";

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function evenFloor(n: number): number {
  return Math.floor(Math.max(0, n) / 2) * 2;
}

export function evenSize(n: number): number {
  return Math.max(2, evenFloor(n));
}

export function newId(prefix: string): string {
  const rand = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}_${rand.slice(0, 8)}`;
}

export function defaultEdit(durationMs: number): EditState {
  return {
    spans: [{ id: "span_all", sourceStartMs: 0, sourceEndMs: Math.max(0, durationMs) }],
    pause: { thresholdMs: 0, retainMs: 180, exceptions: [] },
    captions: {
      enabled: false,
      preset: "clean",
      fontFamily: "Arial",
      fontScale: 1,
      color: "#F4F1EA",
      highlightColor: "#FFD84D",
      wordHighlight: false,
      background: "rgba(12, 12, 12, 0.72)",
      position: "bottom",
      positionY: 0.86,
    },
    framing: { mode: "original", focus: 0.5, focusY: 0.5 },
    audio: { speechVolume: 1, musicVolume: 0.18, duckMusic: true, fadeMs: 180 },
    history: [],
  };
}

/** Keep span order. Merge only when the next span continues the previous one in source time. */
export function settleSpans(spans: KeepSpan[], durationMs: number): KeepSpan[] {
  const clipped = spans
    .map((span) => ({
      ...span,
      sourceStartMs: clamp(span.sourceStartMs, 0, durationMs),
      sourceEndMs: clamp(span.sourceEndMs, 0, durationMs),
    }))
    .filter((span) => span.sourceEndMs - span.sourceStartMs >= MIN_SPAN_MS);
  const merged: KeepSpan[] = [];
  for (const span of clipped) {
    const prev = merged[merged.length - 1];
    const continues =
      prev &&
      span.sourceStartMs <= prev.sourceEndMs + 1 &&
      span.sourceStartMs >= prev.sourceStartMs - 1;
    if (prev && continues) {
      prev.sourceEndMs = Math.max(prev.sourceEndMs, span.sourceEndMs);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

export function normalizeSpans(spans: KeepSpan[], durationMs: number): KeepSpan[] {
  const sorted = spans
    .map((span) => ({
      ...span,
      sourceStartMs: clamp(span.sourceStartMs, 0, durationMs),
      sourceEndMs: clamp(span.sourceEndMs, 0, durationMs),
    }))
    .filter((span) => span.sourceEndMs - span.sourceStartMs >= MIN_SPAN_MS)
    .sort((a, b) => a.sourceStartMs - b.sourceStartMs);

  const merged: KeepSpan[] = [];
  for (const span of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && span.sourceStartMs <= prev.sourceEndMs + 1) {
      prev.sourceEndMs = Math.max(prev.sourceEndMs, span.sourceEndMs);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

export function removeRange(
  spans: KeepSpan[],
  startMs: number,
  endMs: number,
  durationMs: number,
): { spans: KeepSpan[]; removedMs: number } {
  const start = clamp(Math.min(startMs, endMs), 0, durationMs);
  const end = clamp(Math.max(startMs, endMs), 0, durationMs);
  let removedMs = 0;
  const next: KeepSpan[] = [];
  for (const span of spans) {
    const s = span.sourceStartMs;
    const e = span.sourceEndMs;
    if (end <= s || start >= e) {
      next.push(span);
      continue;
    }
    removedMs += Math.min(e, end) - Math.max(s, start);
    if (start > s + 1) {
      next.push({ id: newId("span"), sourceStartMs: s, sourceEndMs: start });
    }
    if (end < e - 1) {
      next.push({ id: newId("span"), sourceStartMs: end, sourceEndMs: e });
    }
  }
  return { spans: settleSpans(next, durationMs), removedMs };
}

export function insertRange(
  spans: KeepSpan[],
  startMs: number,
  endMs: number,
  durationMs: number,
  placement?: { beforeSpanId?: string | null; afterSpanId?: string | null; index?: number | null },
): KeepSpan[] {
  const start = clamp(Math.min(startMs, endMs), 0, durationMs);
  const end = clamp(Math.max(startMs, endMs), 0, durationMs);
  if (end - start < MIN_SPAN_MS) return settleSpans(spans, durationMs);
  let expanded = false;
  const next = spans.map((span) => {
    if (span.sourceEndMs <= start + 1 || span.sourceStartMs >= end - 1) return span;
    expanded = true;
    return {
      ...span,
      sourceStartMs: Math.min(span.sourceStartMs, start),
      sourceEndMs: Math.max(span.sourceEndMs, end),
    };
  });
  if (!expanded) {
    const piece: KeepSpan = { id: newId("span"), sourceStartMs: start, sourceEndMs: end };
    const afterIndex = placement?.afterSpanId ? next.findIndex((span) => span.id === placement.afterSpanId) : -1;
    const beforeIndex = placement?.beforeSpanId ? next.findIndex((span) => span.id === placement.beforeSpanId) : -1;
    let index = afterIndex >= 0 ? afterIndex : beforeIndex >= 0 ? beforeIndex + 1 : -1;
    if (index < 0 && placement?.index !== undefined && placement.index !== null) {
      index = Math.max(0, Math.min(next.length, placement.index));
    }
    if (index < 0) {
      let previousIndex = -1;
      let previousEnd = -Infinity;
      let followingIndex = -1;
      let followingStart = Infinity;
      next.forEach((span, spanIndex) => {
        if (span.sourceEndMs <= start + 1 && span.sourceEndMs > previousEnd) {
          previousEnd = span.sourceEndMs;
          previousIndex = spanIndex;
        }
        if (span.sourceStartMs >= end - 1 && span.sourceStartMs < followingStart) {
          followingStart = span.sourceStartMs;
          followingIndex = spanIndex;
        }
      });
      index = previousIndex >= 0 ? previousIndex + 1 : followingIndex >= 0 ? followingIndex : next.length;
    }
    next.splice(index, 0, piece);
  }
  return settleSpans(next, durationMs);
}

export function moveRange(
  spans: KeepSpan[],
  startMs: number,
  endMs: number,
  place: "start" | "end" | "before" | "after",
  anchorMs: number | null,
  durationMs: number,
): { spans: KeepSpan[]; movedMs: number } {
  const start = clamp(Math.min(startMs, endMs), 0, durationMs);
  const end = clamp(Math.max(startMs, endMs), 0, durationMs);
  const extracted: KeepSpan[] = [];
  const rest: KeepSpan[] = [];
  let movedMs = 0;
  for (const span of settleSpans(spans, durationMs)) {
    const spanStart = span.sourceStartMs;
    const spanEnd = span.sourceEndMs;
    if (end <= spanStart || start >= spanEnd) {
      rest.push(span);
      continue;
    }
    const cutStart = Math.max(spanStart, start);
    const cutEnd = Math.min(spanEnd, end);
    movedMs += cutEnd - cutStart;
    if (cutStart > spanStart + 1) {
      rest.push({ id: newId("span"), sourceStartMs: spanStart, sourceEndMs: cutStart });
    }
    extracted.push({ id: newId("span"), sourceStartMs: cutStart, sourceEndMs: cutEnd });
    if (cutEnd < spanEnd - 1) {
      rest.push({ id: newId("span"), sourceStartMs: cutEnd, sourceEndMs: spanEnd });
    }
  }
  if (movedMs < MIN_SPAN_MS) return { spans: settleSpans(spans, durationMs), movedMs };
  if (place === "start") return { spans: settleSpans([...extracted, ...rest], durationMs), movedMs };
  if (place === "end") return { spans: settleSpans([...rest, ...extracted], durationMs), movedMs };
  const point = anchorMs ?? 0;
  const next: KeepSpan[] = [];
  let inserted = false;
  for (const span of rest) {
    const inside = point > span.sourceStartMs + 1 && point < span.sourceEndMs - 1;
    if (!inserted && inside) {
      next.push({ id: newId("span"), sourceStartMs: span.sourceStartMs, sourceEndMs: point });
      next.push(...extracted);
      next.push({ id: newId("span"), sourceStartMs: point, sourceEndMs: span.sourceEndMs });
      inserted = true;
      continue;
    }
    if (!inserted && span.sourceStartMs >= point - 1) {
      next.push(...extracted);
      inserted = true;
    }
    next.push(span);
  }
  if (!inserted) next.push(...extracted);
  return { spans: settleSpans(next, durationMs), movedMs };
}

interface Piece {
  sourceStartMs: number;
  sourceEndMs: number;
  kind: "speech" | "silence";
}

function silenceProtected(start: number, end: number, policy: PausePolicy): boolean {
  return policy.exceptions.some((item) => item.sourceEndMs > start && item.sourceStartMs < end);
}

export function resolveSegments(
  edit: EditState,
  words: Word[],
  durationMs: number,
  clips: Clip[] = [],
): ResolvedSegment[] {
  const spans = settleSpans(edit.spans, durationMs);
  const pieces: Piece[] = [];

  for (const span of spans) {
    const inside = words
      .map((word) => ({
        start: Math.max(word.startMs, span.sourceStartMs),
        end: Math.min(word.endMs, span.sourceEndMs),
      }))
      .filter((word) => word.end - word.start >= 1)
      .sort((a, b) => a.start - b.start);

    let cursor = span.sourceStartMs;
    for (const word of inside) {
      if (word.start > cursor + 1) {
        pieces.push({ sourceStartMs: cursor, sourceEndMs: word.start, kind: "silence" });
      }
      const speechStart = Math.max(word.start, cursor);
      if (word.end > speechStart) {
        pieces.push({ sourceStartMs: speechStart, sourceEndMs: word.end, kind: "speech" });
      }
      cursor = Math.max(cursor, word.end);
    }
    if (span.sourceEndMs > cursor + 1) {
      pieces.push({ sourceStartMs: cursor, sourceEndMs: span.sourceEndMs, kind: "silence" });
    }
  }

  const kept: Piece[] = [];
  for (const piece of pieces) {
    if (piece.kind === "speech") {
      kept.push(piece);
      continue;
    }
    // A clip that has not been transcribed yet has no words to anchor silence,
    // so leave its audio alone rather than shortening it away.
    const owning = clips.length > 0 ? clipAt(clips, piece.sourceStartMs) : null;
    if (owning && !owning.transcript) {
      kept.push(piece);
      continue;
    }
    const length = piece.sourceEndMs - piece.sourceStartMs;
    const active = edit.pause.thresholdMs > 0 && length >= edit.pause.thresholdMs;
    if (!active || silenceProtected(piece.sourceStartMs, piece.sourceEndMs, edit.pause)) {
      kept.push(piece);
      continue;
    }
    const retain = clamp(edit.pause.retainMs, 0, length);
    if (retain < MIN_SPAN_MS) continue;
    kept.push({
      sourceStartMs: piece.sourceStartMs,
      sourceEndMs: piece.sourceStartMs + retain,
      kind: "silence",
    });
  }

  const merged: Piece[] = [];
  for (const piece of kept) {
    const prev = merged[merged.length - 1];
    if (prev && Math.abs(prev.sourceEndMs - piece.sourceStartMs) <= 2) {
      prev.sourceEndMs = piece.sourceEndMs;
    } else if (piece.sourceEndMs - piece.sourceStartMs >= MIN_SPAN_MS) {
      merged.push({ ...piece });
    }
  }

  // A cut may straddle a clip boundary once there is more than one clip. Split
  // it so every segment maps to exactly one input file for export, then walk
  // the pieces in order to lay out output time.
  const piecesForExport = clips.length > 0
    ? merged.flatMap((piece) =>
        splitRangeByClips(clips, piece.sourceStartMs, piece.sourceEndMs).map((split) => ({
          sourceStartMs: split.sourceStartMs,
          sourceEndMs: split.sourceEndMs,
          clip: split.clip,
        })),
      )
    : merged.map((piece) => ({ ...piece, clip: null }));

  let output = 0;
  return piecesForExport.map((piece, index) => {
    const segment: ResolvedSegment = {
      id: `out_${index}_${Math.round(piece.sourceStartMs)}_${Math.round(piece.sourceEndMs)}`,
      sourceStartMs: piece.sourceStartMs,
      sourceEndMs: piece.sourceEndMs,
      outputStartMs: output,
      outputEndMs: output + (piece.sourceEndMs - piece.sourceStartMs),
      clipId: piece.clip?.id ?? "",
      clipStartMs: piece.clip ? piece.sourceStartMs - piece.clip.offsetMs : piece.sourceStartMs,
      clipEndMs: piece.clip ? piece.sourceEndMs - piece.clip.offsetMs : piece.sourceEndMs,
    };
    output = segment.outputEndMs;
    return segment;
  });
}

export function outputDuration(segments: ResolvedSegment[]): number {
  return segments.length === 0 ? 0 : segments[segments.length - 1].outputEndMs;
}

export function mapSourceRange(
  startMs: number,
  endMs: number,
  segments: ResolvedSegment[],
): { outputStartMs: number; outputEndMs: number } | null {
  for (const segment of segments) {
    const start = Math.max(startMs, segment.sourceStartMs);
    const end = Math.min(endMs, segment.sourceEndMs);
    if (end - start <= 0) continue;
    return {
      outputStartMs: segment.outputStartMs + (start - segment.sourceStartMs),
      outputEndMs: segment.outputStartMs + (end - segment.sourceStartMs),
    };
  }
  return null;
}

export function overlapMs(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

export function removedWordIds(words: Word[], spans: KeepSpan[]): string[] {
  return words
    .filter((word) => {
      const duration = Math.max(1, word.endMs - word.startMs);
      const kept = spans.reduce(
        (sum, span) => sum + overlapMs(word.startMs, word.endMs, span.sourceStartMs, span.sourceEndMs),
        0,
      );
      return kept < duration * 0.5;
    })
    .map((word) => word.id);
}

export function buildCues(words: Word[], segments: ResolvedSegment[]): CaptionCue[] {
  // Iterate the ordered output segments first. Source words are intentionally
  // not assumed to remain chronological after a reorder.
  const visible = segments
    .flatMap((segment) => words
      .filter((word) => overlapMs(word.startMs, word.endMs, segment.sourceStartMs, segment.sourceEndMs) > 0)
      .sort((a, b) => a.startMs - b.startMs)
      .map((word) => {
        const start = Math.max(word.startMs, segment.sourceStartMs);
        const end = Math.min(word.endMs, segment.sourceEndMs);
        if (end <= start) return null;
        return {
          ...word,
          outputStartMs: segment.outputStartMs + start - segment.sourceStartMs,
          outputEndMs: segment.outputStartMs + end - segment.sourceStartMs,
        };
      }))
    .filter((word): word is Word & { outputStartMs: number; outputEndMs: number } => word !== null);

  const groups: Array<typeof visible> = [];
  let current: typeof visible = [];
  const flush = () => {
    if (current.length) groups.push(current);
    current = [];
  };

  for (const word of visible) {
    const prev = current[current.length - 1];
    const text = current.map((item) => item.text).join(" ");
    const gap = prev ? word.outputStartMs - prev.outputEndMs : 0;
    const punct = prev ? /[.!?]$/.test(prev.text) : false;
    if (prev && (gap > 420 || punct || text.length + word.text.length + 1 > 42)) flush();
    current.push(word);
  }
  flush();

  return groups.map((group, index) => {
    const next = groups[index + 1];
    let end = group[group.length - 1].outputEndMs + 120;
    if (next) end = Math.min(end, next[0].outputStartMs);
    end = Math.max(end, group[0].outputStartMs + 280);
    return {
      id: `cue_${group[0].id}`,
      text: group.map((word) => word.text).join(" "),
      outputStartMs: group[0].outputStartMs,
      outputEndMs: end,
      sourceStartMs: group[0].startMs,
      sourceEndMs: group[group.length - 1].endMs,
      words: group.map((word) => ({
        id: word.id,
        text: word.text,
        outputStartMs: word.outputStartMs,
        outputEndMs: word.outputEndMs,
      })),
    };
  });
}

export function describePauses(
  sentences: Sentence[],
  words: Word[],
  edit: EditState,
  durationMs: number,
): PauseMark[] {
  const marks: PauseMark[] = [];
  const points = [0, ...sentences.flatMap((sentence) => [sentence.startMs, sentence.endMs]), durationMs];
  const unique = [...new Set(points)].sort((a, b) => a - b);
  for (let i = 0; i < unique.length - 1; i += 1) {
    const start = unique[i];
    const end = unique[i + 1];
    const speech = words.some((word) => overlapMs(word.startMs, word.endMs, start, end) > 20);
    if (speech || end - start < 120) continue;
    const inside = edit.spans.some(
      (span) => overlapMs(span.sourceStartMs, span.sourceEndMs, start, end) > end - start - 30,
    );
    if (!inside) continue;
    const following = sentences.find((sentence) => sentence.startMs >= end - 30);
    const length = end - start;
    const shortened =
      edit.pause.thresholdMs > 0 &&
      length >= edit.pause.thresholdMs &&
      !silenceProtected(start, end, edit.pause);
    marks.push({
      sourceStartMs: start,
      sourceEndMs: end,
      keptMs: shortened ? Math.min(edit.pause.retainMs, length) : length,
      shortened,
      beforeSentenceId: following?.id ?? null,
    });
  }
  return marks;
}

/** Cover-crop equivalent of CSS object-fit: cover and object-position. */
export function coverCrop(
  srcWidth: number,
  srcHeight: number,
  targetAspect: number,
  focusX: number,
  focusY = 0.5,
): CropRect {
  const width = Math.max(2, srcWidth);
  const height = Math.max(2, srcHeight);
  const focus = clamp(focusX, 0, 1);
  const yFocus = clamp(focusY, 0, 1);
  const srcAspect = width / height;
  let cropW: number;
  let cropH: number;
  if (srcAspect > targetAspect) {
    cropH = height;
    cropW = height * targetAspect;
  } else {
    cropW = width;
    cropH = width / targetAspect;
  }
  const evenW = Math.min(evenSize(cropW), evenFloor(width));
  const evenH = Math.min(evenSize(cropH), evenFloor(height));
  const maxX = Math.max(0, width - evenW);
  const maxY = Math.max(0, height - evenH);
  return {
    x: Math.min(maxX, evenFloor(maxX * focus)),
    y: Math.min(maxY, evenFloor(maxY * yFocus)),
    width: evenW,
    height: evenH,
    outWidth: targetAspect < 1 ? 1080 : evenW,
    outHeight: targetAspect < 1 ? 1920 : evenH,
  };
}

export function framingCrop(framing: Framing, width: number, height: number): CropRect | null {
  if (framing.mode === "original") return null;
  const target = framing.mode === "vertical" ? 9 / 16 : framing.mode === "square" ? 1 : 16 / 9;
  const crop = coverCrop(width, height, target, framing.focus, framing.focusY ?? 0.5);
  if (framing.mode === "vertical") return { ...crop, outWidth: 1080, outHeight: 1920 };
  if (framing.mode === "square") return { ...crop, outWidth: 1080, outHeight: 1080 };
  return { ...crop, outWidth: 1920, outHeight: 1080 };
}
