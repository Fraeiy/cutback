import type { PlaybackContext, Project, ResolvedRange, Sentence, Word } from "./types.js";

export interface Candidate {
  sentenceId: string | null;
  text: string;
  startMs: number;
  endMs: number;
}

export interface TargetSuccess {
  ok: true;
  ambiguous: false;
  range: { startMs: number; endMs: number; sentenceId: string | null; label: string };
  candidates: Candidate[];
}

export interface TargetAmbiguous {
  ok: true;
  ambiguous: true;
  range: null;
  candidates: Candidate[];
  message: string;
}

export interface TargetFailure {
  ok: false;
  message: string;
  candidates: Candidate[];
}

export type TargetResult = TargetSuccess | TargetAmbiguous | TargetFailure;

export interface TargetInput {
  use?: "auto" | "quote" | "sentence" | "timestamps" | "playback" | "selection" | "last_target";
  action?: "remove" | "trim_before" | "trim_after";
  quote?: string;
  sentenceId?: string;
  startMs?: number;
  endMs?: number;
  sentenceOffset?: number;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sentenceById(project: Project, id: string): Sentence | undefined {
  return project.transcript?.sentences.find((sentence) => sentence.id === id);
}

function wordsOf(project: Project, sentence: Sentence): Word[] {
  const words = project.transcript?.words ?? [];
  return words.filter((word) => sentence.wordIds.includes(word.id));
}

function candidate(project: Project, sentence: Sentence): Candidate {
  return {
    sentenceId: sentence.id,
    text: sentence.text,
    startMs: sentence.startMs,
    endMs: sentence.endMs,
  };
}

function shiftSentence(project: Project, sentence: Sentence, offset: number): Sentence | null {
  const sentences = project.transcript?.sentences ?? [];
  const index = sentences.findIndex((item) => item.id === sentence.id);
  if (index < 0) return null;
  return sentences[index + offset] ?? null;
}

function quoteMatches(project: Project, quote: string): Array<{ startMs: number; endMs: number; sentence: Sentence; label: string }> {
  const needle = normalize(quote).split(" ").filter(Boolean);
  if (needle.length === 0) return [];
  const matches: Array<{ startMs: number; endMs: number; sentence: Sentence; label: string }> = [];
  for (const sentence of project.transcript?.sentences ?? []) {
    const words = wordsOf(project, sentence);
    const tokens = words.map((word) => normalize(word.text)).filter(Boolean);
    if (tokens.length === 0) continue;
    for (let i = 0; i <= tokens.length - needle.length; i += 1) {
      const window = tokens.slice(i, i + needle.length).join(" ");
      if (window === needle.join(" ")) {
        const slice = words.filter((word) => normalize(word.text).length > 0).slice(i, i + needle.length);
        matches.push({
          startMs: slice[0].startMs,
          endMs: slice[slice.length - 1].endMs,
          sentence,
          label: slice.map((word) => word.text).join(" "),
        });
      }
    }
  }
  return matches;
}

function fromPlayback(project: Project, playback: PlaybackContext): TargetResult {
  const sentences = project.transcript?.sentences ?? [];
  if (sentences.length === 0) {
    return { ok: false, message: "There is no transcript yet.", candidates: [] };
  }
  const time = playback.sourceTimeMs;
  const inside = sentences.filter((sentence) => time >= sentence.startMs && time <= sentence.endMs);
  if (inside.length === 1) {
    const sentence = inside[0];
    const index = sentences.findIndex((item) => item.id === sentence.id);
    const nearStart = time - sentence.startMs < 220;
    const nearEnd = sentence.endMs - time < 220;
    const prev = index > 0 ? sentences[index - 1] : null;
    const next = index < sentences.length - 1 ? sentences[index + 1] : null;
    const prevGap = prev ? sentence.startMs - prev.endMs : Infinity;
    const nextGap = next ? next.startMs - sentence.endMs : Infinity;
    if (nearStart && prev && prevGap < 500) {
      return {
        ok: true,
        ambiguous: true,
        range: null,
        candidates: [candidate(project, prev), candidate(project, sentence)],
        message: "The playhead is on the boundary of two sentences. Ask which one.",
      };
    }
    if (nearEnd && next && nextGap < 500) {
      return {
        ok: true,
        ambiguous: true,
        range: null,
        candidates: [candidate(project, sentence), candidate(project, next)],
        message: "The playhead is on the boundary of two sentences. Ask which one.",
      };
    }
    return {
      ok: true,
      ambiguous: false,
      range: {
        startMs: sentence.startMs,
        endMs: sentence.endMs,
        sentenceId: sentence.id,
        label: sentence.text,
      },
      candidates: [candidate(project, sentence)],
    };
  }

  const prev = [...sentences].reverse().find((sentence) => sentence.endMs <= time) ?? null;
  const next = sentences.find((sentence) => sentence.startMs >= time) ?? null;
  const options = [prev, next].filter((sentence): sentence is Sentence => sentence !== null);
  if (options.length === 0) {
    return { ok: false, message: "Nothing in the transcript is near the playhead.", candidates: [] };
  }
  if (options.length === 1 || (prev && next && time - prev.endMs < 220 && next.startMs - time > 700)) {
    const sentence = options[0];
    return {
      ok: true,
      ambiguous: false,
      range: {
        startMs: sentence.startMs,
        endMs: sentence.endMs,
        sentenceId: sentence.id,
        label: sentence.text,
      },
      candidates: [candidate(project, sentence)],
    };
  }
  return {
    ok: true,
    ambiguous: true,
    range: null,
    candidates: options.map((sentence) => candidate(project, sentence)),
    message: "The playhead is in a pause between sentences. Ask which sentence to use.",
  };
}

function fromSelection(project: Project, ids: string[]): TargetResult {
  const words = (project.transcript?.words ?? []).filter((word) => ids.includes(word.id));
  if (words.length === 0) {
    return { ok: false, message: "No transcript words are selected.", candidates: [] };
  }
  const ordered = [...words].sort((a, b) => a.startMs - b.startMs);
  const sentenceIds = [...new Set(ordered.map((word) => word.sentenceId))];
  const sentences = sentenceIds
    .map((id) => sentenceById(project, id))
    .filter((sentence): sentence is Sentence => Boolean(sentence));
  return {
    ok: true,
    ambiguous: false,
    range: {
      startMs: ordered[0].startMs,
      endMs: ordered[ordered.length - 1].endMs,
      sentenceId: sentenceIds.length === 1 ? sentenceIds[0] : null,
      label: ordered.map((word) => word.text).join(" "),
    },
    candidates: sentences.map((sentence) => candidate(project, sentence)),
  };
}

export function resolveTarget(project: Project, input: TargetInput): TargetResult {
  if (!project.transcript || project.transcript.sentences.length === 0) {
    return { ok: false, message: "Transcribe the video before cutting.", candidates: [] };
  }
  const duration = project.media?.durationMs ?? 0;
  const use = input.use ?? "auto";
  let result: TargetResult;

  const selected = project.playback?.selectedWordIds ?? [];
  const wantSelection = use === "selection" || (use === "auto" && selected.length > 0 && !input.quote && !input.sentenceId);
  const wantQuote = use === "quote" || (use === "auto" && Boolean(input.quote) && !wantSelection);
  const wantSentence = use === "sentence" || (use === "auto" && Boolean(input.sentenceId) && !wantSelection && !input.quote);
  const wantTime =
    use === "timestamps" ||
    (use === "auto" && input.startMs !== undefined && input.endMs !== undefined && !wantSelection && !input.quote && !input.sentenceId);
  const wantLast = use === "last_target" || (use === "auto" && input.sentenceOffset !== undefined && input.sentenceOffset !== 0 && !input.quote);

  if (wantSelection) {
    result = fromSelection(project, selected);
  } else if (wantQuote) {
    const matches = quoteMatches(project, input.quote ?? "");
    if (matches.length === 0) {
      result = {
        ok: false,
        message: `I could not find “${input.quote ?? ""}” in the transcript.`,
        candidates: [],
      };
    } else if (matches.length > 1) {
      result = {
        ok: true,
        ambiguous: true,
        range: null,
        candidates: matches.map((match) => ({
          sentenceId: match.sentence.id,
          text: match.label,
          startMs: match.startMs,
          endMs: match.endMs,
        })),
        message: `“${input.quote}” appears ${matches.length} times. Ask which one.`,
      };
    } else {
      const match = matches[0];
      result = {
        ok: true,
        ambiguous: false,
        range: {
          startMs: match.startMs,
          endMs: match.endMs,
          sentenceId: match.sentence.id,
          label: match.label,
        },
        candidates: [candidate(project, match.sentence)],
      };
    }
  } else if (wantSentence) {
    const sentence = sentenceById(project, input.sentenceId ?? "");
    result = sentence
      ? {
          ok: true,
          ambiguous: false,
          range: {
            startMs: sentence.startMs,
            endMs: sentence.endMs,
            sentenceId: sentence.id,
            label: sentence.text,
          },
          candidates: [candidate(project, sentence)],
        }
      : { ok: false, message: "That sentence id is not in this project.", candidates: [] };
  } else if (wantTime) {
    const startMs = input.startMs ?? 0;
    const endMs = input.endMs ?? startMs;
    if (endMs <= startMs || startMs < 0 || endMs > duration + 20) {
      result = { ok: false, message: "Those source timestamps are outside the video.", candidates: [] };
    } else {
      result = {
        ok: true,
        ambiguous: false,
        range: { startMs, endMs, sentenceId: null, label: `${Math.round(startMs)}–${Math.round(endMs)} ms` },
        candidates: [],
      };
    }
  } else if (wantLast && project.lastTarget?.sentenceId) {
    const sentence = sentenceById(project, project.lastTarget.sentenceId);
    result = sentence
      ? {
          ok: true,
          ambiguous: false,
          range: {
            startMs: sentence.startMs,
            endMs: sentence.endMs,
            sentenceId: sentence.id,
            label: sentence.text,
          },
          candidates: [candidate(project, sentence)],
        }
      : { ok: false, message: "The last target is no longer in the transcript.", candidates: [] };
  } else if (project.playback) {
    result = fromPlayback(project, project.playback);
  } else {
    result = {
      ok: false,
      message: "I do not have a playhead from the moment you started speaking. Scrub to the spot and say it again.",
      candidates: [],
    };
  }

  if (!result.ok || result.ambiguous || !result.range) return result;
  const offset = input.sentenceOffset ?? 0;
  if (offset !== 0) {
    if (!result.range.sentenceId) {
      return { ok: false, message: "I need a sentence before I can move to the previous or next one.", candidates: [] };
    }
    const sentence = sentenceById(project, result.range.sentenceId);
    const shifted = sentence ? shiftSentence(project, sentence, offset) : null;
    if (!shifted) {
      return {
        ok: false,
        message: offset < 0 ? "There is no previous sentence." : "There is no next sentence.",
        candidates: sentence ? [candidate(project, sentence)] : [],
      };
    }
    return {
      ok: true,
      ambiguous: false,
      range: {
        startMs: shifted.startMs,
        endMs: shifted.endMs,
        sentenceId: shifted.id,
        label: shifted.text,
      },
      candidates: [candidate(project, shifted)],
    };
  }
  return result;
}

export function cutBounds(
  action: "remove" | "trim_before" | "trim_after",
  range: { startMs: number; endMs: number },
  durationMs: number,
): { startMs: number; endMs: number } | null {
  if (action === "trim_before") {
    if (range.startMs <= 40) return null;
    return { startMs: 0, endMs: range.startMs };
  }
  if (action === "trim_after") {
    if (range.endMs >= durationMs - 40) return null;
    return { startMs: range.endMs, endMs: durationMs };
  }
  return { startMs: range.startMs, endMs: range.endMs };
}

export function toResolvedRange(
  action: "remove" | "trim_before" | "trim_after",
  range: { startMs: number; endMs: number; sentenceId: string | null; label: string },
): ResolvedRange {
  return { ...range, action };
}
