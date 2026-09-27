import type { Clip, MediaInfo, Project, Transcript, Word } from "./types.js";

/**
 * Clips are stored in timeline order and always have contiguous offsets, so a
 * source time on the flattened timeline resolves to exactly one clip. Every
 * helper here is pure; mutating helpers live in tools.ts.
 */

/** Recompute contiguous offsets from clip durations. Tolerates gaps. */
export function withOffsets(clips: Clip[]): Clip[] {
  let offsetMs = 0;
  return clips.map((clip) => {
    const next: Clip = { ...clip, offsetMs };
    offsetMs += Math.max(0, clip.media.durationMs);
    return next;
  });
}

/** Total length of the flattened source timeline. */
export function sourceDurationMs(clips: Clip[]): number {
  if (clips.length === 0) return 0;
  const last = clips[clips.length - 1];
  return last.offsetMs + last.media.durationMs;
}

/** Find the clip covering a source time. Clips are contiguous and ordered. */
export function clipAt(clips: Clip[], sourceMs: number): Clip | null {
  for (const clip of clips) {
    if (sourceMs < clip.offsetMs) return null;
    if (sourceMs < clip.offsetMs + clip.media.durationMs) return clip;
  }
  // A time exactly at the end of the last clip still belongs to that clip.
  return clips.length > 0 ? clips[clips.length - 1] : null;
}

export function findClip(clips: Clip[], clipId: string | null | undefined): Clip | null {
  if (!clipId) return null;
  return clips.find((clip) => clip.id === clipId) ?? null;
}

/**
 * Break a source range into per-clip pieces so no piece crosses a clip
 * boundary. Export needs this: each piece maps to exactly one input file.
 */
export function splitRangeByClips(
  clips: Clip[],
  startMs: number,
  endMs: number,
): Array<{ clip: Clip; sourceStartMs: number; sourceEndMs: number }> {
  if (endMs <= startMs) return [];
  const pieces: Array<{ clip: Clip; sourceStartMs: number; sourceEndMs: number }> = [];
  for (const clip of clips) {
    const clipStart = clip.offsetMs;
    const clipEnd = clip.offsetMs + clip.media.durationMs;
    const start = Math.max(startMs, clipStart);
    const end = Math.min(endMs, clipEnd);
    if (end - start > 0) pieces.push({ clip, sourceStartMs: start, sourceEndMs: end });
  }
  return pieces;
}

/**
 * Flatten every clip's transcript onto the source timeline. Word and sentence
 * ids are namespaced per clip so two clips transcribed separately cannot
 * collide on `s01w0`.
 */
export function combineTranscripts(clips: Clip[]): Transcript | null {
  // With a single clip there is nothing to collide with, so ids are left alone.
  // That keeps every id a single-clip project has ever stored valid, including
  // the sentence ids persisted in edit history.
  if (clips.length === 1) return clips[0].transcript ? { ...clips[0].transcript } : null;
  if (clips.length === 0) return null;

  const words: Word[] = [];
  const sentences: Transcript["sentences"] = [];
  const texts: string[] = [];
  let any = false;

  clips.forEach((clip, clipIndex) => {
    const transcript = clip.transcript;
    if (!transcript) return;
    any = true;
    const prefix = `c${clipIndex + 1}_`;
    const localSentences = new Map<string, string[]>();
    for (const word of transcript.words) {
      const id = `${prefix}${word.id}`;
      words.push({
        ...word,
        id,
        sentenceId: `${prefix}${word.sentenceId}`,
        startMs: word.startMs + clip.offsetMs,
        endMs: word.endMs + clip.offsetMs,
      });
      const bucket = localSentences.get(word.sentenceId) ?? [];
      bucket.push(word.id);
      localSentences.set(word.sentenceId, bucket);
    }
    for (const sentence of transcript.sentences) {
      sentences.push({
        ...sentence,
        id: `${prefix}${sentence.id}`,
        startMs: sentence.startMs + clip.offsetMs,
        endMs: sentence.endMs + clip.offsetMs,
        wordIds: (localSentences.get(sentence.id) ?? sentence.wordIds).map((id) => `${prefix}${id}`),
      });
    }
    if (transcript.text.trim()) texts.push(transcript.text.trim());
  });

  if (!any) return null;
  return { id: "combined", model: null, text: texts.join(" "), words, sentences };
}

/**
 * Keep the legacy single-clip mirrors in step with `clips`. Existing code reads
 * `project.media` and `project.transcript`, so they must never drift.
 */
export function syncMirrors(project: Project): Project {
  const clips = withOffsets(project.clips ?? []);
  project.clips = clips;
  project.media = clips.length > 0 ? clips[0].media : null;
  project.transcript = combineTranscripts(clips);
  const sources = new Set(clips.map((clip) => clip.transcriptSource).filter(Boolean));
  project.transcriptSource = sources.size === 1 ? [...sources][0]! : null;
  return project;
}

/** Build a clip from probed media. */
export function makeClip(
  media: MediaInfo,
  id: string,
  transcript: Transcript | null = null,
  transcriptSource: Clip["transcriptSource"] = null,
): Clip {
  return { id, media, offsetMs: 0, transcript, transcriptSource };
}

/** Total duration of the flattened timeline, from a project's clips. */
export function projectSourceDurationMs(project: Project): number {
  return sourceDurationMs(project.clips ?? []);
}
