export const MAX_DURATION_MS = 120_000;
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
export const MIN_SPAN_MS = 40;

export interface Word {
  id: string;
  sentenceId: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
}

export interface Sentence {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  wordIds: string[];
}

export interface Transcript {
  id: string;
  model: string | null;
  text: string;
  words: Word[];
  sentences: Sentence[];
}

export interface MediaInfo {
  filename: string;
  storedName: string;
  bytes: number;
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
  mime: string;
}

/**
 * One source video on the timeline. Clips are laid end to end on a single
 * flattened source timeline: a clip's `offsetMs` is where it starts in that
 * timeline, so a source time anywhere in the project maps to exactly one clip.
 */
export interface Clip {
  id: string;
  media: MediaInfo;
  /** Start of this clip on the flattened source timeline. */
  offsetMs: number;
  transcript: Transcript | null;
  /** demo-fixture timings are measured for sentences. Word times inside a sentence are evenly split until AssemblyAI runs. */
  transcriptSource: "assemblyai" | "demo-fixture" | null;
}

export interface KeepSpan {
  id: string;
  sourceStartMs: number;
  sourceEndMs: number;
}

export interface PauseException {
  id: string;
  sourceStartMs: number;
  sourceEndMs: number;
  label: string;
}

export interface PausePolicy {
  /** Pauses at least this long are shortened. 0 disables shortening. */
  thresholdMs: number;
  /** Silence kept when a pause is shortened. */
  retainMs: number;
  exceptions: PauseException[];
}

export interface CaptionStyle {
  enabled: boolean;
  preset: "clean" | "bold" | "minimal";
  fontFamily: "Arial" | "Liberation Sans" | "DejaVu Sans";
  fontScale: number;
  color: string;
  highlightColor: string;
  wordHighlight: boolean;
  background: string;
  position: "bottom" | "center" | "top";
  /** 0 is top, 1 is bottom. Used for small vertical adjustments. */
  positionY: number;
}

export interface Framing {
  mode: "original" | "wide" | "square" | "vertical";
  /** 0 shows the left of a 9:16 cover crop, 1 shows the right, 0.5 is centered. */
  focus: number;
  focusY: number;
}

export interface MusicTrack {
  filename: string;
  storedName: string;
  bytes: number;
  mime: string;
}

export interface AudioSettings {
  speechVolume: number;
  musicVolume: number;
  duckMusic: boolean;
  fadeMs: number;
}

export interface HistoryEntry {
  id: string;
  kind: "cut" | "restore" | "reorder" | "pause" | "captions" | "framing" | "audio";
  summary: string;
  sentenceId: string | null;
  startMs: number | null;
  endMs: number | null;
  action: "remove" | "trim_before" | "trim_after" | null;
  /** Stable timeline neighbors captured when a range was removed. */
  restoreBeforeSpanId?: string | null;
  restoreAfterSpanId?: string | null;
  restoreIndex?: number | null;
}

export interface EditState {
  spans: KeepSpan[];
  pause: PausePolicy;
  captions: CaptionStyle;
  framing: Framing;
  audio: AudioSettings;
  /** Applied changes in order. Targeted corrections use this instead of wiping the whole edit. */
  history: HistoryEntry[];
}

export interface ResolvedSegment {
  id: string;
  sourceStartMs: number;
  sourceEndMs: number;
  outputStartMs: number;
  outputEndMs: number;
  /** Which clip this segment was cut from. Segments never span two clips. */
  clipId: string;
  /** The same range expressed in the clip's own local time. */
  clipStartMs: number;
  clipEndMs: number;
}

export interface CaptionCue {
  id: string;
  text: string;
  outputStartMs: number;
  outputEndMs: number;
  sourceStartMs: number;
  sourceEndMs: number;
  words: Array<{
    id: string;
    text: string;
    outputStartMs: number;
    outputEndMs: number;
  }>;
}

export interface PauseMark {
  sourceStartMs: number;
  sourceEndMs: number;
  keptMs: number;
  shortened: boolean;
  beforeSentenceId: string | null;
}

export interface PlaybackContext {
  sourceTimeMs: number;
  outputTimeMs: number;
  selectedWordIds: string[];
  capturedAt: string;
  reason: "speech-start" | "ptt" | "selection";
}

export interface ResolvedRange {
  startMs: number;
  endMs: number;
  sentenceId: string | null;
  label: string;
  action: "remove" | "trim_before" | "trim_after";
}

export interface HighlightRange {
  startMs: number;
  endMs: number;
  label: string;
}

export interface Highlight {
  ranges: HighlightRange[];
  pending: boolean;
}

export interface Snapshot {
  edit: EditState;
}

export type JobStatus = "idle" | "running" | "completed" | "error";

export interface JobState {
  status: JobStatus;
  error: string | null;
  progress: number;
  updatedAt: string | null;
}

export interface Proposal {
  id: string;
  baseRevision: number;
  status: "pending" | "applied" | "rejected";
  kind: "cut" | "pause" | "shorter";
  summary: string;
  op: Operation | null;
  ambiguous: boolean;
  sequence?: Array<{ sentenceId: string; text: string; sourceStartMs: number; sourceEndMs: number }>;
  durationMs?: number;
  explanation?: string;
}

export type Operation =
  | {
      type: "cut";
      action: "remove" | "trim_before" | "trim_after";
      startMs: number;
      endMs: number;
      label: string;
      sentenceId: string | null;
    }
  | { type: "pause"; pause: PausePolicy; label: string }
  | { type: "timeline"; spans: KeepSpan[]; label: string };

export interface StoredCall {
  at: string;
  isError: boolean;
  result: Record<string, unknown>;
}

export interface Project {
  id: string;
  version: 2;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  /** Source clips in timeline order. This is the source of truth for media. */
  clips: Clip[];
  /** First clip's media, or null. Kept so single-clip call sites stay simple. */
  media: MediaInfo | null;
  /** Every clip's transcript flattened onto the source timeline. Derived from `clips`. */
  transcript: Transcript | null;
  /** demo-fixture timings are measured for sentences. Word times inside a sentence are evenly split until AssemblyAI runs. */
  transcriptSource: "assemblyai" | "demo-fixture" | null;
  edit: EditState;
  music: MusicTrack | null;
  undo: Snapshot[];
  redo: Snapshot[];
  proposals: Proposal[];
  appliedCalls: Record<string, StoredCall>;
  playback: PlaybackContext | null;
  lastTarget: ResolvedRange | null;
  highlight: Highlight | null;
  jobs: {
    transcription: JobState & { transcriptId: string | null };
    export: JobState & { file: string | null; bytes: number | null; revision: number | null };
  };
}

export interface PresentedProject extends Project {
  segments: ResolvedSegment[];
  cues: CaptionCue[];
  pauses: PauseMark[];
  outputDurationMs: number;
  /** Length of the flattened source timeline, across every clip. */
  sourceDurationMs: number;
  removedWordIds: string[];
  crop: CropRect | null;
  originalSegments: ResolvedSegment[];
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
  outWidth: number;
  outHeight: number;
}

export interface ToolOutcome {
  project: Project;
  result: Record<string, unknown>;
  isError: boolean;
  duplicate: boolean;
}
