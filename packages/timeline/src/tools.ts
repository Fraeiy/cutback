import { cutBounds, resolveTarget, toResolvedRange, type TargetInput } from "./target.js";
import { defaultEdit, describePauses, insertRange, moveRange, newId, normalizeSpans, outputDuration, removeRange, resolveSegments } from "./resolve.js";
import { makeClip, projectSourceDurationMs, syncMirrors, withOffsets } from "./clips.js";
import { present } from "./present.js";
import type {
  CaptionStyle,
  Clip,
  Framing,
  HistoryEntry,
  MediaInfo,
  PauseException,
  PausePolicy,
  Project,
  Proposal,
  ResolvedRange,
  Sentence,
  Snapshot,
  ToolOutcome,
  Transcript,
} from "./types.js";

const MAX_UNDO = 50;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function touch(project: Project): void {
  project.updatedAt = new Date().toISOString();
}

function ensureEdit(project: Project): void {
  if (!Array.isArray(project.edit.history)) project.edit.history = [];
  if (!Array.isArray(project.clips)) project.clips = [];
  const defaults = defaultEdit(projectSourceDurationMs(project));
  project.edit.captions = { ...defaults.captions, ...project.edit.captions };
  project.edit.framing = { ...defaults.framing, ...project.edit.framing };
  project.edit.audio = { ...defaults.audio, ...project.edit.audio };
  if (project.music === undefined) project.music = null;
}

function record(project: Project, entry: Omit<HistoryEntry, "id">): void {
  ensureEdit(project);
  project.edit.history.push({ id: newId("edit"), ...entry });
  if (project.edit.history.length > 80) project.edit.history.shift();
}

function snapshot(project: Project): Snapshot {
  return { edit: clone(project.edit) };
}

function commit(project: Project): void {
  ensureEdit(project);
  project.undo.push(snapshot(project));
  if (project.undo.length > MAX_UNDO) project.undo.shift();
  project.redo = [];
  project.revision += 1;
  for (const proposal of project.proposals) {
    if (proposal.status === "pending") proposal.status = "rejected";
  }
  touch(project);
}

function remembered(project: Project, callId: string | undefined): ToolOutcome | null {
  if (!callId) return null;
  const prior = project.appliedCalls[callId];
  if (!prior) return null;
  return { project, result: { ...prior.result, duplicate: true }, isError: prior.isError, duplicate: true };
}

function finish(
  project: Project,
  callId: string | undefined,
  result: Record<string, unknown>,
  isError: boolean,
): ToolOutcome {
  if (callId) {
    project.appliedCalls[callId] = { at: new Date().toISOString(), isError, result };
    const ids = Object.keys(project.appliedCalls);
    if (ids.length > 200) delete project.appliedCalls[ids[0]];
  }
  return { project, result, isError, duplicate: false };
}

function requireReady(project: Project): string | null {
  if (!project.clips || project.clips.length === 0) return "Upload a video first.";
  if (!project.transcript || project.transcript.sentences.length === 0) return "Transcribe the video before editing.";
  return null;
}

function highlightFrom(
  ranges: Array<{ startMs: number; endMs: number; label: string }>,
  pending: boolean,
): Project["highlight"] {
  return { ranges, pending };
}

function publicContext(project: Project): Record<string, unknown> {
  const view = present(project);
  return {
    status: "ok",
    revision: project.revision,
    title: project.title,
    transcript_source: project.transcriptSource,
    duration_ms: projectSourceDurationMs(project),
    output_duration_ms: view.outputDurationMs,
    framing: project.edit.framing,
    captions: project.edit.captions,
    pause: {
      threshold_ms: project.edit.pause.thresholdMs,
      retain_ms: project.edit.pause.retainMs,
      exceptions: project.edit.pause.exceptions.map((item) => ({
        id: item.id,
        start_ms: item.sourceStartMs,
        end_ms: item.sourceEndMs,
        label: item.label,
      })),
    },
    playback: project.playback,
    last_target: project.lastTarget,
    highlight: project.highlight,
    sentences: (project.transcript?.sentences ?? []).map((sentence, index) => ({
      id: sentence.id,
      ordinal: index + 1,
      text: sentence.text,
      start_ms: sentence.startMs,
      end_ms: sentence.endMs,
      removed: sentence.wordIds.every((id) => view.removedWordIds.includes(id)),
    })),
    history: (project.edit.history ?? []).slice(-8).map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      summary: entry.summary,
      sentence_id: entry.sentenceId,
      action: entry.action,
    })),
    pauses: view.pauses.map((pause) => ({
      start_ms: pause.sourceStartMs,
      end_ms: pause.sourceEndMs,
      kept_ms: pause.keptMs,
      shortened: pause.shortened,
      before_sentence_id: pause.beforeSentenceId,
    })),
    pending_proposals: project.proposals
      .filter((proposal) => proposal.status === "pending")
      .map((proposal) => ({ id: proposal.id, summary: proposal.summary, ambiguous: proposal.ambiguous })),
    jobs: project.jobs,
  };
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function targetFromArgs(args: Record<string, unknown>): TargetInput {
  const use = asString(args.use);
  const action = asString(args.action);
  return {
    use: (use as TargetInput["use"]) ?? "auto",
    action: action === "trim_before" || action === "trim_after" || action === "remove" ? action : "remove",
    quote: asString(args.quote),
    sentenceId: asString(args.sentence_id),
    startMs: asNumber(args.start_ms),
    endMs: asNumber(args.end_ms),
    sentenceOffset: asNumber(args.sentence_offset),
  };
}

function storeProposal(project: Project, proposal: Proposal): void {
  project.proposals.push(proposal);
  if (project.proposals.length > 30) project.proposals.shift();
}

function applyCut(
  project: Project,
  cut: { startMs: number; endMs: number; label: string; sentenceId: string | null; action: ResolvedRange["action"] },
): { ok: true; summary: string } | { ok: false; message: string } {
  const duration = projectSourceDurationMs(project);
  const originalSpans = project.edit.spans;
  const removed = removeRange(project.edit.spans, cut.startMs, cut.endMs, duration);
  if (removed.removedMs < 40) {
    return { ok: false, message: "That section is already out of the edit." };
  }
  if (removed.spans.length === 0) {
    return { ok: false, message: "That would remove the entire video." };
  }
  commit(project);
  project.edit.spans = removed.spans;
  project.lastTarget = {
    startMs: cut.startMs,
    endMs: cut.endMs,
    sentenceId: cut.sentenceId,
    label: cut.label,
    action: cut.action,
  };
  project.highlight = highlightFrom(
    [{ startMs: cut.startMs, endMs: cut.endMs, label: cut.label }],
    false,
  );
  const seconds = (removed.removedMs / 1000).toFixed(1);
  const summary =
    cut.action === "trim_before"
      ? `The video now starts at “${cut.label}”. ${seconds}s before that is out.`
      : cut.action === "trim_after"
        ? `The video now ends after “${cut.label}”. ${seconds}s after that is out.`
        : `Removed “${cut.label}” (${seconds}s).`;
  const firstOverlapIndex = originalSpans.findIndex(
    (span) => cut.endMs > span.sourceStartMs && cut.startMs < span.sourceEndMs,
  );
  const overlap = firstOverlapIndex >= 0 ? originalSpans[firstOverlapIndex] : null;
  const restoreIndex = Math.max(
    0,
    Math.min(
      removed.spans.length,
      (firstOverlapIndex < 0 ? removed.spans.length : firstOverlapIndex) +
        (overlap && cut.startMs > overlap.sourceStartMs + 1 ? 1 : 0),
    ),
  );
  record(project, {
    kind: "cut",
    summary,
    sentenceId: cut.sentenceId,
    startMs: cut.startMs,
    endMs: cut.endMs,
    action: cut.action,
    restoreBeforeSpanId: removed.spans[restoreIndex - 1]?.id ?? null,
    restoreAfterSpanId: removed.spans[restoreIndex]?.id ?? null,
    restoreIndex,
  });
  return { ok: true, summary };
}

function applyPause(project: Project, pause: PausePolicy, label: string): string {
  commit(project);
  project.edit.pause = pause;
  project.highlight = null;
  record(project, { kind: "pause", summary: label, sentenceId: null, startMs: null, endMs: null, action: null });
  return label;
}

export function createProject(id: string, title = "Untitled"): Project {
  const now = new Date().toISOString();
  return {
    id,
    version: 2,
    title,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    clips: [],
    media: null,
    transcript: null,
    transcriptSource: null,
    edit: defaultEdit(0),
    music: null,
    undo: [],
    redo: [],
    proposals: [],
    appliedCalls: {},
    playback: null,
    lastTarget: null,
    highlight: null,
    jobs: {
      transcription: { status: "idle", error: null, progress: 0, updatedAt: null, transcriptId: null },
      export: { status: "idle", error: null, progress: 0, updatedAt: null, file: null, bytes: null, revision: null },
    },
  };
}

/**
 * Append a clip to the end of the timeline. Unlike the old `attachMedia` this
 * does not discard the existing edit, so adding a second clip keeps the cuts
 * already made on the first one.
 */
export function attachClip(
  project: Project,
  media: MediaInfo,
  clipId?: string,
  transcript?: Transcript | null,
  transcriptSource?: Clip["transcriptSource"],
): Project {
  const existing = project.clips ?? [];
  const clipId2 = clipId ?? newId("clip");
  project.clips = withOffsets([...existing, makeClip(media, clipId2, transcript ?? null, transcriptSource ?? null)]);
  // Read the offset back off the stored clip: the one just built starts at 0
  // until withOffsets lays the list out.
  const clip = project.clips[project.clips.length - 1];
  const wasEmpty = existing.length === 0;
  // A fresh project needs its default span to cover the new length. Once there
  // are clips, keep the edit and just make sure the new material is reachable.
  if (wasEmpty) {
    project.edit = defaultEdit(projectSourceDurationMs(project));
    project.undo = [];
    project.redo = [];
    project.proposals = [];
    project.lastTarget = null;
    project.highlight = null;
  } else {
    const total = projectSourceDurationMs(project);
    const start = clip.offsetMs;
    const untouched = project.edit.spans.every(
      (span) => span.sourceEndMs <= start + 1 || span.sourceStartMs >= total - 1,
    );
    if (untouched) {
      project.edit.spans = normalizeSpans(
        [...project.edit.spans, { id: newId("span"), sourceStartMs: start, sourceEndMs: total }],
        total,
      );
    }
  }
  syncMirrors(project);
  project.revision += 1;
  touch(project);
  return project;
}

/** Drop a clip and close the gap it leaves in the source timeline. */
export function removeClip(project: Project, clipId: string): Project {
  const clips = project.clips ?? [];
  const target = clips.find((clip) => clip.id === clipId);
  if (!target) return project;
  const start = target.offsetMs;
  const end = target.offsetMs + target.media.durationMs;
  const kept = clips.filter((clip) => clip.id !== clipId);
  const shift = (value: number) => (value <= start ? value : Math.max(start, value - (end - start)));
  project.clips = withOffsets(kept);
  // Closes below the removed clip are untouched; anything after it slides left.
  project.edit.spans = normalizeSpans(
    project.edit.spans
      .filter((span) => !(span.sourceStartMs >= start && span.sourceEndMs <= end))
      .map((span) => ({ ...span, sourceStartMs: shift(span.sourceStartMs), sourceEndMs: shift(span.sourceEndMs) })),
    projectSourceDurationMs(project),
  );
  syncMirrors(project);
  project.revision += 1;
  touch(project);
  return project;
}

/** Legacy single-clip entry point. Replaces the whole clip list. */
export function attachMedia(
  project: Project,
  media: NonNullable<Project["media"]>,
  transcript?: Transcript | null,
  transcriptSource?: Clip["transcriptSource"],
): Project {
  project.clips = [];
  return attachClip(project, media, undefined, transcript, transcriptSource);
}

/** Store a finished transcript against one clip and rebuild the combined view. */
export function setClipTranscript(
  project: Project,
  clipId: string,
  transcript: Transcript | null,
  source: Clip["transcriptSource"],
): Project {
  const clip = (project.clips ?? []).find((item) => item.id === clipId);
  if (!clip) return project;
  clip.transcript = transcript;
  clip.transcriptSource = source;
  syncMirrors(project);
  touch(project);
  return project;
}

export function setPlayback(project: Project, playback: Project["playback"]): Project {
  project.playback = playback;
  touch(project);
  return project;
}

export function applyTool(
  project: Project,
  name: string,
  args: Record<string, unknown>,
  callId?: string,
): ToolOutcome {
  ensureEdit(project);
  const prior = remembered(project, callId);
  if (prior) return prior;

  try {
    switch (name) {
      case "read_project_context":
        return finish(project, callId, publicContext(project), false);
      case "find_transcript_segment":
        return findSegment(project, args, callId, false);
      case "propose_cut":
        return proposeCut(project, args, callId);
      case "propose_pause_shortening":
        return proposePause(project, args, callId);
      case "restore_section":
        return restoreSection(project, args, callId);
      case "correct_previous_section":
        return correctPrevious(project, args, callId);
      case "reorder_sections":
        return reorderSections(project, args, callId);
      case "suggest_shorter_cut":
        return suggestShorterCut(project, args, callId);
      case "revise_shorter_cut":
        return reviseShorterCut(project, args, callId);
      case "apply_instruction_batch":
        return applyBatch(project, args, callId);
      case "apply_edit":
        return applyEdit(project, args, callId);
      case "dismiss_proposal":
        return dismissProposal(project, args, callId);
      case "undo_edit":
        return undoEdit(project, callId);
      case "redo_edit":
        return redoEdit(project, callId);
      case "set_caption_style":
        return setCaptions(project, args, callId);
      case "set_aspect_ratio":
        return setAspect(project, args, callId);
      case "set_audio_mix":
        return setAudioMix(project, args, callId);
      case "remove_music":
        return removeMusic(project, callId);
      case "preview_segment":
        return previewSegment(project, args, callId);
      case "export_video":
        return requestExport(project, callId);
      default:
        return finish(project, callId, { status: "error", error: `Unknown tool ${name}.` }, true);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool failed.";
    return finish(project, callId, { status: "error", error: message }, true);
  }
}

function findSegment(
  project: Project,
  args: Record<string, unknown>,
  callId: string | undefined,
  highlightPending: boolean,
): ToolOutcome {
  const blocked = requireReady(project);
  if (blocked) return finish(project, callId, { status: "error", error: blocked }, true);
  const found = resolveTarget(project, targetFromArgs(args));
  if (!found.ok) {
    project.highlight = null;
    return finish(project, callId, { status: "error", error: found.message, candidates: [] }, true);
  }
  if (found.ambiguous) {
    project.highlight = highlightFrom(
      found.candidates.map((item) => ({ startMs: item.startMs, endMs: item.endMs, label: item.text })),
      true,
    );
    return finish(
      project,
      callId,
      {
        status: "needs_clarification",
        message: found.message,
        candidates: found.candidates,
      },
      false,
    );
  }
  project.highlight = highlightFrom(
    [{ startMs: found.range.startMs, endMs: found.range.endMs, label: found.range.label }],
    highlightPending,
  );
  return finish(
    project,
    callId,
    {
      status: "found",
      sentence_id: found.range.sentenceId,
      label: found.range.label,
      start_ms: found.range.startMs,
      end_ms: found.range.endMs,
      candidates: found.candidates,
    },
    false,
  );
}

function proposeCut(project: Project, args: Record<string, unknown>, callId: string | undefined): ToolOutcome {
  const blocked = requireReady(project);
  if (blocked) return finish(project, callId, { status: "error", error: blocked }, true);
  const input = targetFromArgs(args);
  const action = input.action ?? "remove";
  const found = resolveTarget(project, input);
  if (!found.ok) {
    return finish(project, callId, { status: "error", error: found.message, candidates: found.candidates }, true);
  }
  if (found.ambiguous) {
    const proposal: Proposal = {
      id: newId("prop"),
      baseRevision: project.revision,
      status: "pending",
      kind: "cut",
      summary: found.message,
      op: null,
      ambiguous: true,
    };
    storeProposal(project, proposal);
    project.highlight = highlightFrom(
      found.candidates.map((item) => ({ startMs: item.startMs, endMs: item.endMs, label: item.text })),
      true,
    );
    return finish(
      project,
      callId,
      {
        status: "needs_clarification",
        proposal_id: proposal.id,
        message: found.message,
        candidates: found.candidates,
      },
      false,
    );
  }

  const duration = projectSourceDurationMs(project);
  const bounds = cutBounds(action, found.range, duration);
  if (!bounds) {
    return finish(
      project,
      callId,
      { status: "error", error: "That cut would not change the video.", label: found.range.label },
      true,
    );
  }
  const proposal: Proposal = {
    id: newId("prop"),
    baseRevision: project.revision,
    status: "pending",
    kind: "cut",
    summary: `${action} “${found.range.label}”`,
    ambiguous: false,
    op: {
      type: "cut",
      action,
      startMs: bounds.startMs,
      endMs: bounds.endMs,
      label: found.range.label,
      sentenceId: found.range.sentenceId,
    },
  };
  storeProposal(project, proposal);
  project.highlight = highlightFrom(
    [{ startMs: bounds.startMs, endMs: bounds.endMs, label: found.range.label }],
    true,
  );

  const shouldApply = args.apply !== false;
  if (!shouldApply) {
    return finish(
      project,
      callId,
      {
        status: "ready",
        proposal_id: proposal.id,
        summary: proposal.summary,
        start_ms: bounds.startMs,
        end_ms: bounds.endMs,
        label: found.range.label,
        message: "Preview only. Call apply_edit to commit it.",
      },
      false,
    );
  }

  const applied = applyCut(project, {
    startMs: bounds.startMs,
    endMs: bounds.endMs,
    label: found.range.label,
    sentenceId: found.range.sentenceId,
    action,
  });
  if (!applied.ok) {
    proposal.status = "rejected";
    return finish(project, callId, { status: "error", error: applied.message, proposal_id: proposal.id }, true);
  }
  proposal.status = "applied";
  proposal.baseRevision = project.revision;
  return finish(
    project,
    callId,
    {
      status: "applied",
      proposal_id: proposal.id,
      summary: applied.summary,
      revision: project.revision,
      output_duration_ms: present(project).outputDurationMs,
    },
    false,
  );
}

function gapBefore(project: Project, sentenceId: string): { startMs: number; endMs: number } | null {
  const sentences = project.transcript?.sentences ?? [];
  const index = sentences.findIndex((sentence) => sentence.id === sentenceId);
  if (index <= 0) return null;
  const start = sentences[index - 1].endMs;
  const end = sentences[index].startMs;
  if (end - start < 80) return null;
  return { startMs: start, endMs: end };
}

function proposePause(project: Project, args: Record<string, unknown>, callId: string | undefined): ToolOutcome {
  const blocked = requireReady(project);
  if (blocked) return finish(project, callId, { status: "error", error: blocked }, true);
  const next: PausePolicy = clone(project.edit.pause);
  const enable = args.enable !== false;
  if (args.clear_protections === true) next.exceptions = [];
  if (asNumber(args.threshold_ms) !== undefined) next.thresholdMs = Math.round(asNumber(args.threshold_ms)!);
  if (asNumber(args.retain_ms) !== undefined) next.retainMs = Math.round(asNumber(args.retain_ms)!);
  if (asNumber(args.delta_retain_ms) !== undefined) next.retainMs += Math.round(asNumber(args.delta_retain_ms)!);
  next.thresholdMs = Math.max(0, Math.min(8000, next.thresholdMs));
  next.retainMs = Math.max(0, Math.min(next.thresholdMs || 2000, next.retainMs));
  if (enable && next.thresholdMs === 0 && args.protect_pause !== true) {
    next.thresholdMs = Math.round(asNumber(args.threshold_ms) ?? 800);
    if (asNumber(args.retain_ms) === undefined && asNumber(args.delta_retain_ms) === undefined) {
      next.retainMs = 180;
    }
  }
  if (args.enable === false) next.thresholdMs = 0;

  let label = `Pauses longer than ${next.thresholdMs}ms keep ${next.retainMs}ms.`;
  if (args.protect_pause === true) {
    const protectedGap = resolveProtectedPause(project, args);
    if (!protectedGap.ok) {
      return finish(project, callId, { status: "error", error: protectedGap.message, candidates: protectedGap.candidates }, true);
    }
    if (protectedGap.ambiguous) {
      project.highlight = highlightFrom(
        protectedGap.candidates.map((item) => ({ startMs: item.startMs, endMs: item.endMs, label: item.text })),
        true,
      );
      return finish(
        project,
        callId,
        { status: "needs_clarification", message: protectedGap.message, candidates: protectedGap.candidates },
        false,
      );
    }
    const gap = protectedGap.gap;
    const exception: PauseException = {
      id: newId("pause"),
      sourceStartMs: gap.startMs,
      sourceEndMs: gap.endMs,
      label: gap.label,
    };
    next.exceptions = next.exceptions.filter(
      (item) => Math.abs(item.sourceStartMs - gap.startMs) > 40 || Math.abs(item.sourceEndMs - gap.endMs) > 40,
    );
    next.exceptions.push(exception);
    if (next.thresholdMs === 0) next.thresholdMs = 800;
    label = gap.summary;
    project.highlight = highlightFrom([{ startMs: gap.startMs, endMs: gap.endMs, label: exception.label }], true);
  }

  const proposal: Proposal = {
    id: newId("prop"),
    baseRevision: project.revision,
    status: "pending",
    kind: "pause",
    summary: label,
    ambiguous: false,
    op: { type: "pause", pause: next, label },
  };
  storeProposal(project, proposal);
  if (args.apply === false) {
    return finish(project, callId, { status: "ready", proposal_id: proposal.id, summary: label }, false);
  }
  const summary = applyPause(project, next, label);
  proposal.status = "applied";
  return finish(
    project,
    callId,
    {
      status: "applied",
      proposal_id: proposal.id,
      summary,
      revision: project.revision,
      output_duration_ms: present(project).outputDurationMs,
    },
    false,
  );
}

function applyEdit(project: Project, args: Record<string, unknown>, callId: string | undefined): ToolOutcome {
  const proposalId = asString(args.proposal_id);
  const proposal = project.proposals.find((item) => item.id === proposalId);
  if (!proposal) return finish(project, callId, { status: "error", error: "That proposal does not exist." }, true);
  if (proposal.status === "applied") {
    return finish(
      project,
      callId,
      { status: "applied", duplicate: true, proposal_id: proposal.id, summary: proposal.summary, revision: project.revision },
      false,
    );
  }
  if (proposal.ambiguous || !proposal.op) {
    return finish(
      project,
      callId,
      { status: "needs_clarification", error: proposal.summary, proposal_id: proposal.id },
      true,
    );
  }
  if (proposal.baseRevision !== project.revision) {
    return finish(
      project,
      callId,
      { status: "error", error: "stale_revision", message: "The edit changed. Read the project and propose it again." },
      true,
    );
  }
  if (proposal.op.type === "cut") {
    const applied = applyCut(project, proposal.op);
    if (!applied.ok) {
      proposal.status = "rejected";
      return finish(project, callId, { status: "error", error: applied.message }, true);
    }
    proposal.status = "applied";
    proposal.summary = applied.summary;
    return finish(
      project,
      callId,
      { status: "applied", proposal_id: proposal.id, summary: applied.summary, revision: project.revision },
      false,
    );
  }
  if (proposal.op.type === "timeline") {
    commit(project);
    project.edit.spans = clone(proposal.op.spans);
    project.highlight = null;
    record(project, {
      kind: "cut",
      summary: proposal.op.label,
      sentenceId: null,
      startMs: null,
      endMs: null,
      action: null,
    });
    proposal.status = "applied";
    return finish(project, callId, {
      status: "applied",
      proposal_id: proposal.id,
      summary: proposal.op.label,
      revision: project.revision,
      output_duration_ms: present(project).outputDurationMs,
    }, false);
  }
  const summary = applyPause(project, proposal.op.pause, proposal.op.label);
  proposal.status = "applied";
  return finish(
    project,
    callId,
    { status: "applied", proposal_id: proposal.id, summary, revision: project.revision },
    false,
  );
}

function dismissProposal(project: Project, args: Record<string, unknown>, callId: string | undefined): ToolOutcome {
  const proposalId = asString(args.proposal_id);
  const proposal = project.proposals.find((item) => item.id === proposalId);
  if (!proposal) return finish(project, callId, { status: "error", error: "That proposal does not exist." }, true);
  proposal.status = "rejected";
  project.highlight = null;
  touch(project);
  return finish(project, callId, { status: "dismissed", proposal_id: proposal.id, summary: "Proposal dismissed." }, false);
}

function removeMusic(project: Project, callId: string | undefined): ToolOutcome {
  if (!project.music) return finish(project, callId, { status: "error", error: "There is no background music to remove." }, true);
  project.music = null;
  project.revision += 1;
  touch(project);
  return finish(project, callId, { status: "applied", summary: "Background music removed.", revision: project.revision }, false);
}

function undoEdit(project: Project, callId: string | undefined): ToolOutcome {
  const prev = project.undo.pop();
  if (!prev) return finish(project, callId, { status: "error", error: "Nothing to undo." }, true);
  project.redo.push(snapshot(project));
  project.edit = prev.edit;
  project.highlight = null;
  project.revision += 1;
  touch(project);
  return finish(
    project,
    callId,
    { status: "applied", summary: "Undid the last edit.", revision: project.revision, output_duration_ms: present(project).outputDurationMs },
    false,
  );
}

function redoEdit(project: Project, callId: string | undefined): ToolOutcome {
  const next = project.redo.pop();
  if (!next) return finish(project, callId, { status: "error", error: "Nothing to redo." }, true);
  project.undo.push(snapshot(project));
  project.edit = next.edit;
  project.highlight = null;
  project.revision += 1;
  touch(project);
  return finish(
    project,
    callId,
    { status: "applied", summary: "Redid the edit.", revision: project.revision, output_duration_ms: present(project).outputDurationMs },
    false,
  );
}

function setCaptions(project: Project, args: Record<string, unknown>, callId: string | undefined): ToolOutcome {
  const blocked = requireReady(project);
  if (blocked) return finish(project, callId, { status: "error", error: blocked }, true);
  const captions: CaptionStyle = { ...project.edit.captions };
  if (typeof args.enabled === "boolean") captions.enabled = args.enabled;
  if (args.enabled === "true") captions.enabled = true;
  if (args.enabled === "false") captions.enabled = false;
  const scale = asNumber(args.font_scale);
  if (scale !== undefined) captions.fontScale = Math.max(0.7, Math.min(1.8, scale));
  const deltaScale = asNumber(args.delta_font_scale);
  if (deltaScale !== undefined) captions.fontScale = Math.max(0.7, Math.min(1.8, captions.fontScale + deltaScale));
  const position = asString(args.position);
  if (position === "bottom" || position === "center" || position === "top") {
    captions.position = position;
    captions.positionY = position === "top" ? 0.16 : position === "center" ? 0.5 : 0.86;
  }
  const positionY = asNumber(args.position_y);
  if (positionY !== undefined) captions.positionY = Math.max(0.08, Math.min(0.92, positionY));
  const deltaY = asNumber(args.delta_position_y);
  if (deltaY !== undefined) captions.positionY = Math.max(0.08, Math.min(0.92, captions.positionY + deltaY));
  const color = asString(args.color);
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) captions.color = color;
  const highlight = asString(args.highlight_color);
  if (highlight && /^#[0-9a-fA-F]{6}$/.test(highlight)) captions.highlightColor = highlight;
  if (typeof args.word_highlight === "boolean") captions.wordHighlight = args.word_highlight;
  const preset = asString(args.preset);
  if (preset === "clean" || preset === "bold" || preset === "minimal") {
    captions.preset = preset;
    if (preset === "bold") Object.assign(captions, { fontScale: 1.3, wordHighlight: true, background: "rgba(0, 0, 0, 0.82)" });
    if (preset === "minimal") Object.assign(captions, { fontScale: 0.9, wordHighlight: false, background: "rgba(0, 0, 0, 0.35)" });
    if (preset === "clean") Object.assign(captions, { fontScale: 1, background: "rgba(12, 12, 12, 0.72)" });
  }
  const font = asString(args.font_family);
  if (font === "Arial" || font === "Liberation Sans" || font === "DejaVu Sans") captions.fontFamily = font;
  commit(project);
  project.edit.captions = captions;
  const summary = captions.enabled ? "Captions are on." : "Captions are off.";
  record(project, { kind: "captions", summary, sentenceId: null, startMs: null, endMs: null, action: null });
  return finish(project, callId, { status: "applied", summary, captions, revision: project.revision }, false);
}

function setAspect(project: Project, args: Record<string, unknown>, callId: string | undefined): ToolOutcome {
  if (!project.clips || project.clips.length === 0) return finish(project, callId, { status: "error", error: "Upload a video first." }, true);
  const framing: Framing = { ...project.edit.framing };
  const mode = asString(args.mode);
  if (mode === "vertical" || mode === "9:16" || mode === "portrait") framing.mode = "vertical";
  if (mode === "wide" || mode === "16:9") framing.mode = "wide";
  if (mode === "square" || mode === "1:1") framing.mode = "square";
  if (mode === "original" || mode === "landscape" || mode === "source") framing.mode = "original";
  const focus = asNumber(args.focus);
  if (focus !== undefined) framing.focus = Math.max(0, Math.min(1, focus));
  const focusY = asNumber(args.focus_y);
  if (focusY !== undefined) framing.focusY = Math.max(0, Math.min(1, focusY));
  const nudge = asString(args.nudge);
  if (nudge === "left") framing.focus = Math.max(0, framing.focus - 0.15);
  if (nudge === "right") framing.focus = Math.min(1, framing.focus + 0.15);
  if (nudge === "center") framing.focus = 0.5;
  commit(project);
  project.edit.framing = framing;
  const summary = framing.mode === "original" ? "Framing is back to the original." : `Framing is now ${framing.mode === "vertical" ? "9:16" : framing.mode === "square" ? "1:1" : "16:9"}.`;
  record(project, { kind: "framing", summary, sentenceId: null, startMs: null, endMs: null, action: null });
  return finish(
    project,
    callId,
    { status: "applied", summary, framing, revision: project.revision },
    false,
  );
}

function previewSegment(project: Project, args: Record<string, unknown>, callId: string | undefined): ToolOutcome {
  const blocked = requireReady(project);
  if (blocked) return finish(project, callId, { status: "error", error: blocked }, true);
  const found = resolveTarget(project, targetFromArgs(args));
  if (!found.ok) return finish(project, callId, { status: "error", error: found.message }, true);
  if (found.ambiguous) {
    project.highlight = highlightFrom(
      found.candidates.map((item) => ({ startMs: item.startMs, endMs: item.endMs, label: item.text })),
      true,
    );
    return finish(project, callId, { status: "needs_clarification", message: found.message, candidates: found.candidates }, false);
  }
  const view = present(project);
  const mapped = view.segments
    .map((segment) => {
      const start = Math.max(segment.sourceStartMs, found.range.startMs);
      const end = Math.min(segment.sourceEndMs, found.range.endMs);
      if (end - start <= 0) return null;
      return segment.outputStartMs + (start - segment.sourceStartMs);
    })
    .find((value) => value !== null);
  if (mapped === undefined) {
    return finish(project, callId, { status: "error", error: "That part has already been cut." }, true);
  }
  project.highlight = highlightFrom(
    [{ startMs: found.range.startMs, endMs: found.range.endMs, label: found.range.label }],
    false,
  );
  project.lastTarget = toResolvedRange("remove", found.range);
  return finish(
    project,
    callId,
    {
      status: "ok",
      summary: `Playing “${found.range.label}”.`,
      seek_output_ms: mapped,
      label: found.range.label,
    },
    false,
  );
}

function requestExport(project: Project, callId: string | undefined): ToolOutcome {
  if (!project.clips || project.clips.length === 0) return finish(project, callId, { status: "error", error: "Upload a video first." }, true);
  const view = present(project);
  if (view.segments.length === 0) {
    return finish(project, callId, { status: "error", error: "The timeline is empty." }, true);
  }
  if (project.jobs.export.status === "running") {
    return finish(project, callId, { status: "error", error: "An export is already running." }, true);
  }
  return finish(
    project,
    callId,
    {
      status: "export_requested",
      revision: project.revision,
      output_duration_ms: view.outputDurationMs,
      message: "Export has been requested. Wait for the server to finish before telling the creator it is ready.",
    },
    false,
  );
}

function widenToSentence(
  project: Project,
  range: { startMs: number; endMs: number; sentenceId: string | null; label: string },
): { startMs: number; endMs: number; sentenceId: string | null; label: string } {
  const sentence = range.sentenceId ? project.transcript?.sentences.find((item) => item.id === range.sentenceId) : undefined;
  if (!sentence) return range;
  return { startMs: sentence.startMs, endMs: sentence.endMs, sentenceId: sentence.id, label: sentence.text };
}

function sentenceByOrdinal(project: Project, ordinal: string | number | undefined): Sentence | undefined {
  const sentences = project.transcript?.sentences ?? [];
  if (ordinal === "last") return sentences[sentences.length - 1];
  if (ordinal === "first") return sentences[0];
  const value = typeof ordinal === "number" ? ordinal : Number(ordinal);
  if (!Number.isInteger(value) || value < 1) return undefined;
  return sentences[value - 1];
}

function ordinalArg(args: Record<string, unknown>, key: string): string | number | undefined {
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === "last" || value === "first") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function pausesOf(project: Project) {
  const duration = projectSourceDurationMs(project);
  return describePauses(project.transcript?.sentences ?? [], project.transcript?.words ?? [], project.edit, duration);
}

function resolveProtectedPause(
  project: Project,
  args: Record<string, unknown>,
):
  | { ok: true; ambiguous: false; gap: { startMs: number; endMs: number; label: string; summary: string } }
  | { ok: true; ambiguous: true; message: string; candidates: Array<{ startMs: number; endMs: number; text: string }> }
  | { ok: false; message: string; candidates: Array<{ startMs: number; endMs: number; text: string }> } {
  const named = Boolean(asString(args.quote) || asString(args.sentence_id) || ordinalArg(args, "sentence_ordinal") !== undefined);
  if (!named && project.playback) {
    const time = project.playback.sourceTimeMs;
    const pauses = pausesOf(project).filter((pause) => pause.sourceEndMs - pause.sourceStartMs >= 80);
    const inside = pauses.find((pause) => time >= pause.sourceStartMs && time <= pause.sourceEndMs);
    if (inside) {
      return {
        ok: true,
        ambiguous: false,
        gap: {
          startMs: inside.sourceStartMs,
          endMs: inside.sourceEndMs,
          label: "That pause",
          summary: "Keeping that pause.",
        },
      };
    }
    const sentence = (project.transcript?.sentences ?? []).find((item) => time >= item.startMs && time <= item.endMs);
    if (sentence) {
      const before = gapBefore(project, sentence.id);
      const afterIndex = (project.transcript?.sentences ?? []).findIndex((item) => item.id === sentence.id);
      const next = (project.transcript?.sentences ?? [])[afterIndex + 1];
      const after = next && next.startMs - sentence.endMs >= 80 ? { startMs: sentence.endMs, endMs: next.startMs } : null;
      const options = [
        before ? { startMs: before.startMs, endMs: before.endMs, text: `Pause before “${sentence.text}”` } : null,
        after ? { startMs: after.startMs, endMs: after.endMs, text: `Pause after “${sentence.text}”` } : null,
      ].filter((item): item is { startMs: number; endMs: number; text: string } => item !== null);
      if (options.length > 1) {
        return { ok: true, ambiguous: true, message: "Which pause should stay, the one before that sentence or the one after?", candidates: options };
      }
      if (options.length === 1) {
        return {
          ok: true,
          ambiguous: false,
          gap: { ...options[0], label: options[0].text, summary: `Keeping the ${options[0].text.toLowerCase()}.` },
        };
      }
    }
  }
  const ordinal = ordinalArg(args, "sentence_ordinal");
  const sentence = ordinal !== undefined ? sentenceByOrdinal(project, ordinal) : undefined;
  const found = sentence
    ? {
        ok: true as const,
        ambiguous: false as const,
        range: { sentenceId: sentence.id, label: sentence.text, startMs: sentence.startMs, endMs: sentence.endMs },
      }
    : resolveTarget(project, { ...targetFromArgs(args), use: asString(args.quote) ? "quote" : targetFromArgs(args).use });
  if (!found.ok) return { ok: false, message: found.message, candidates: [] };
  if (found.ambiguous) {
    return {
      ok: true,
      ambiguous: true,
      message: found.message,
      candidates: found.candidates.map((item) => ({ startMs: item.startMs, endMs: item.endMs, text: item.text })),
    };
  }
  if (!found.range.sentenceId) return { ok: false, message: "I need a sentence in order to protect the pause before it.", candidates: [] };
  const gap = gapBefore(project, found.range.sentenceId);
  if (!gap) return { ok: false, message: "There is no pause before that sentence.", candidates: [] };
  return {
    ok: true,
    ambiguous: false,
    gap: {
      startMs: gap.startMs,
      endMs: gap.endMs,
      label: `Pause before ${found.range.label}`,
      summary: `Keeping the pause before “${found.range.label}”.`,
    },
  };
}

function locateSentence(
  project: Project,
  args: Record<string, unknown>,
  prefix: "moving" | "anchor" | "",
): ReturnType<typeof resolveTarget> {
  const ordinalKey = prefix ? `${prefix}_ordinal` : "sentence_ordinal";
  const quoteKey = prefix ? `${prefix}_quote` : "quote";
  const idKey = prefix ? `${prefix}_sentence_id` : "sentence_id";
  const useKey = prefix ? `${prefix}_use` : "use";
  const ordinal = ordinalArg(args, ordinalKey) ?? (prefix ? undefined : ordinalArg(args, "ordinal"));
  if (ordinal !== undefined) {
    const sentence = sentenceByOrdinal(project, ordinal);
    if (!sentence) {
      return { ok: false, message: `There is no ${ordinal === "last" ? "last" : ordinal === "first" ? "first" : `sentence ${ordinal}`}.`, candidates: [] };
    }
    return {
      ok: true,
      ambiguous: false,
      range: { startMs: sentence.startMs, endMs: sentence.endMs, sentenceId: sentence.id, label: sentence.text },
      candidates: [{ sentenceId: sentence.id, text: sentence.text, startMs: sentence.startMs, endMs: sentence.endMs }],
    };
  }
  return resolveTarget(project, {
    use: (asString(args[useKey]) as TargetInput["use"]) ?? (asString(args[quoteKey]) ? "quote" : "auto"),
    quote: asString(args[quoteKey]) ?? (prefix ? undefined : asString(args.quote)),
    sentenceId: asString(args[idKey]) ?? (prefix ? undefined : asString(args.sentence_id)),
    sentenceOffset: prefix ? undefined : asNumber(args.sentence_offset),
  });
}

function restoreSection(project: Project, args: Record<string, unknown>, callId: string | undefined): ToolOutcome {
  const blocked = requireReady(project);
  if (blocked) return finish(project, callId, { status: "error", error: blocked }, true);
  const found = locateSentence(project, args, "");
  if (!found.ok) return finish(project, callId, { status: "error", error: found.message, candidates: found.candidates }, true);
  if (found.ambiguous) {
    project.highlight = highlightFrom(
      found.candidates.map((item) => ({ startMs: item.startMs, endMs: item.endMs, label: item.text })),
      true,
    );
    return finish(project, callId, { status: "needs_clarification", message: found.message, candidates: found.candidates }, false);
  }
  const view = present(project);
  const removed =
    found.range.sentenceId !== null &&
    (project.transcript?.sentences.find((sentence) => sentence.id === found.range.sentenceId)?.wordIds.every((id) => view.removedWordIds.includes(id)) ??
      false);
  const covered = project.edit.spans.some(
    (span) => span.sourceStartMs <= found.range.startMs + 20 && span.sourceEndMs >= found.range.endMs - 20,
  );
  if (!removed && covered) {
    return finish(project, callId, { status: "error", error: `“${found.range.label}” is already in the edit.` }, true);
  }
  const duration = projectSourceDurationMs(project);
  const matchingCut = [...project.edit.history].reverse().find(
    (entry) =>
      entry.kind === "cut" &&
      entry.action === "remove" &&
      (found.range.sentenceId
        ? entry.sentenceId === found.range.sentenceId
        : entry.startMs === found.range.startMs && entry.endMs === found.range.endMs),
  );
  commit(project);
  project.edit.spans = insertRange(
    project.edit.spans,
    found.range.startMs,
    found.range.endMs,
    duration,
    matchingCut
      ? {
          beforeSpanId: matchingCut.restoreBeforeSpanId,
          afterSpanId: matchingCut.restoreAfterSpanId,
          index: matchingCut.restoreIndex,
        }
      : undefined,
  );
  project.lastTarget = { ...found.range, action: "remove" };
  project.highlight = highlightFrom([{ startMs: found.range.startMs, endMs: found.range.endMs, label: found.range.label }], false);
  const summary = `Restored “${found.range.label}”. Other edits stayed.`;
  record(project, {
    kind: "restore",
    summary,
    sentenceId: found.range.sentenceId,
    startMs: found.range.startMs,
    endMs: found.range.endMs,
    action: null,
  });
  return finish(project, callId, { status: "applied", summary, revision: project.revision, output_duration_ms: present(project).outputDurationMs }, false);
}

function correctPrevious(project: Project, args: Record<string, unknown>, callId: string | undefined): ToolOutcome {
  const blocked = requireReady(project);
  if (blocked) return finish(project, callId, { status: "error", error: blocked }, true);
  const last = [...project.edit.history].reverse().find((entry) => entry.kind === "cut" && entry.startMs !== null && entry.endMs !== null);
  if (!last || last.startMs === null || last.endMs === null) {
    return finish(project, callId, { status: "error", error: "There is no cut to correct." }, true);
  }
  if (!last.sentenceId) {
    return finish(
      project,
      callId,
      { status: "needs_clarification", message: "The last cut was not a sentence. Which section should replace it?" },
      false,
    );
  }
  const sentences = project.transcript?.sentences ?? [];
  const index = sentences.findIndex((sentence) => sentence.id === last.sentenceId);
  const offset = asNumber(args.sentence_offset) ?? -1;
  const replacement = sentences[index + offset];
  if (!replacement) {
    return finish(project, callId, { status: "error", error: offset < 0 ? "There is no previous section." : "There is no next section." }, true);
  }
  const duration = projectSourceDurationMs(project);
  const restored = insertRange(project.edit.spans, last.startMs, last.endMs, duration, {
    beforeSpanId: last.restoreBeforeSpanId,
    afterSpanId: last.restoreAfterSpanId,
    index: last.restoreIndex,
  });
  const removed = removeRange(restored, replacement.startMs, replacement.endMs, duration);
  if (removed.spans.length === 0) {
    return finish(project, callId, { status: "error", error: "That correction would remove the entire video." }, true);
  }
  if (removed.removedMs < 40) {
    return finish(project, callId, { status: "error", error: "The previous section is already out of the edit." }, true);
  }
  commit(project);
  project.edit.spans = removed.spans;
  project.lastTarget = {
    startMs: replacement.startMs,
    endMs: replacement.endMs,
    sentenceId: replacement.id,
    label: replacement.text,
    action: "remove",
  };
  project.highlight = highlightFrom(
    [{ startMs: replacement.startMs, endMs: replacement.endMs, label: replacement.text }],
    false,
  );
  const summary = `Put the last cut back and removed “${replacement.text}” instead. Other edits stayed.`;
  record(project, {
    kind: "cut",
    summary,
    sentenceId: replacement.id,
    startMs: replacement.startMs,
    endMs: replacement.endMs,
    action: "remove",
  });
  return finish(project, callId, { status: "applied", summary, revision: project.revision, output_duration_ms: present(project).outputDurationMs }, false);
}

function reorderSections(project: Project, args: Record<string, unknown>, callId: string | undefined): ToolOutcome {
  const blocked = requireReady(project);
  if (blocked) return finish(project, callId, { status: "error", error: blocked }, true);
  const placeRaw = asString(args.place) ?? "start";
  const place = placeRaw === "before" || placeRaw === "after" || placeRaw === "end" || placeRaw === "start" ? placeRaw : null;
  if (!place) return finish(project, callId, { status: "error", error: "Place must be start, end, before, or after." }, true);
  const movingFound = locateSentence(project, args, "moving");
  if (!movingFound.ok) return finish(project, callId, { status: "error", error: movingFound.message, candidates: movingFound.candidates }, true);
  if (movingFound.ambiguous) {
    project.highlight = highlightFrom(
      movingFound.candidates.map((item) => ({ startMs: item.startMs, endMs: item.endMs, label: item.text })),
      true,
    );
    return finish(project, callId, { status: "needs_clarification", message: movingFound.message, candidates: movingFound.candidates }, false);
  }
  const movingRange = widenToSentence(project, movingFound.range);
  let anchorMs: number | null = null;
  if (place === "before" || place === "after") {
    const anchor = locateSentence(project, args, "anchor");
    if (!anchor.ok) return finish(project, callId, { status: "error", error: anchor.message, candidates: anchor.candidates }, true);
    if (anchor.ambiguous) {
      project.highlight = highlightFrom(
        anchor.candidates.map((item) => ({ startMs: item.startMs, endMs: item.endMs, label: item.text })),
        true,
      );
      return finish(project, callId, { status: "needs_clarification", message: anchor.message, candidates: anchor.candidates }, false);
    }
    const anchorRange = widenToSentence(project, anchor.range);
    if (anchorRange.sentenceId && anchorRange.sentenceId === movingRange.sentenceId) {
      return finish(project, callId, { status: "error", error: "That section cannot move relative to itself." }, true);
    }
    anchorMs = place === "before" ? anchorRange.startMs : anchorRange.endMs;
  }
  const duration = projectSourceDurationMs(project);
  const moved = moveRange(project.edit.spans, movingRange.startMs, movingRange.endMs, place, anchorMs, duration);
  if (moved.movedMs < 40) {
    return finish(project, callId, { status: "error", error: `“${movingRange.label}” is not in the edit, so it cannot move.` }, true);
  }
  commit(project);
  project.edit.spans = moved.spans;
  project.lastTarget = { ...movingRange, action: "remove" };
  project.highlight = highlightFrom([{ startMs: movingRange.startMs, endMs: movingRange.endMs, label: movingRange.label }], false);
  const summary =
    place === "start"
      ? `Moved “${movingRange.label}” to the beginning.`
      : place === "end"
        ? `Moved “${movingRange.label}” to the end.`
        : `Moved “${movingRange.label}” ${place} the other section.`;
  record(project, {
    kind: "reorder",
    summary,
    sentenceId: movingRange.sentenceId,
    startMs: movingRange.startMs,
    endMs: movingRange.endMs,
    action: null,
  });
  return finish(project, callId, { status: "applied", summary, revision: project.revision, output_duration_ms: present(project).outputDurationMs }, false);
}

function sentenceSpan(sentence: Sentence) {
  return { id: newId("span"), sourceStartMs: sentence.startMs, sourceEndMs: sentence.endMs };
}

function shorterProposalResult(proposal: Proposal): Record<string, unknown> {
  return {
    status: "ready",
    proposal_id: proposal.id,
    summary: proposal.summary,
    proposed_duration_ms: proposal.durationMs,
    sequence: proposal.sequence?.map((item, index) => ({
      order: index + 1,
      sentence_id: item.sentenceId,
      text: item.text,
      source_start_ms: item.sourceStartMs,
      source_end_ms: item.sourceEndMs,
    })),
    explanation: proposal.explanation,
    message: "Preview or revise this proposal, then call apply_edit to approve it.",
  };
}

function suggestShorterCut(project: Project, args: Record<string, unknown>, callId: string | undefined): ToolOutcome {
  const blocked = requireReady(project);
  if (blocked) return finish(project, callId, { status: "error", error: blocked }, true);
  const view = present(project);
  const requestedMs = asNumber(args.target_duration_ms);
  const requestedSeconds = asNumber(args.target_seconds);
  const requested = requestedMs ?? (requestedSeconds !== undefined
    ? requestedSeconds * 1000
    : Math.max(8_000, Math.round(view.outputDurationMs * 0.65)));
  const targetMs = Math.max(2_000, Math.min(view.outputDurationMs, requested));
  const focus = (asString(args.focus) ?? "main announcement").toLowerCase();
  const focusTokens = focus.split(/\W+/).filter((token) => token.length > 2);
  const currentIds = new Set(project.transcript!.words.filter((word) => !view.removedWordIds.includes(word.id)).map((word) => word.sentenceId));
  const sentences = project.transcript!.sentences.filter((sentence) => currentIds.has(sentence.id));
  const required = new Set<string>();
  const explicit = args.keep_sentence_ids;
  if (Array.isArray(explicit)) for (const id of explicit) if (typeof id === "string") required.add(id);
  if (args.keep_first_question === true) {
    const question = sentences.find((sentence) => sentence.text.includes("?"));
    if (question) required.add(question.id);
  }
  const scored = sentences.map((sentence, index) => {
    const text = sentence.text.toLowerCase();
    let score = focusTokens.reduce((sum, token) => sum + (text.includes(token) ? 12 : 0), 0);
    if (/announce|launch|today|new|important|result|point/.test(text)) score += 6;
    if (required.has(sentence.id)) score += 1000;
    score += Math.max(0, 4 - index * 0.15);
    return { sentence, score };
  });
  const chosen = new Set<string>();
  let used = 0;
  for (const { sentence } of scored.filter((item) => required.has(item.sentence.id))) {
    chosen.add(sentence.id);
    used += sentence.endMs - sentence.startMs;
  }
  for (const { sentence } of [...scored].sort((a, b) => b.score - a.score)) {
    if (chosen.has(sentence.id)) continue;
    const length = sentence.endMs - sentence.startMs;
    if (used + length <= targetMs || chosen.size === 0) {
      chosen.add(sentence.id);
      used += length;
    }
  }
  const sequence = sentences.filter((sentence) => chosen.has(sentence.id));
  const spans = sequence.map(sentenceSpan);
  const candidate = clone(project.edit);
  candidate.spans = spans;
  const calculated = resolveSegments(candidate, project.transcript!.words, projectSourceDurationMs(project), project.clips);
  const durationMs = calculated.length ? calculated[calculated.length - 1].outputEndMs : 0;
  const impossible = [...required].some((id) => !chosen.has(id)) || durationMs > targetMs + 750;
  const explanation = impossible
    ? `The requested material needs about ${(durationMs / 1000).toFixed(1)}s, so ${Math.round(targetMs / 1000)}s would remove required context.`
    : `Keeps ${sequence.length} transcript sections most related to “${focus}”; duration is calculated from their source timings.`;
  const proposal: Proposal = {
    id: newId("prop"),
    baseRevision: project.revision,
    status: "pending",
    kind: "shorter",
    summary: `Proposed a ${(durationMs / 1000).toFixed(1)}s cut focused on ${focus}.`,
    op: { type: "timeline", spans, label: `Applied the approved ${(durationMs / 1000).toFixed(1)}s shorter cut.` },
    ambiguous: false,
    sequence: sequence.map((sentence) => ({ sentenceId: sentence.id, text: sentence.text, sourceStartMs: sentence.startMs, sourceEndMs: sentence.endMs })),
    durationMs,
    explanation,
  };
  storeProposal(project, proposal);
  return finish(project, callId, shorterProposalResult(proposal), false);
}

function reviseShorterCut(project: Project, args: Record<string, unknown>, callId: string | undefined): ToolOutcome {
  const id = asString(args.proposal_id);
  const proposal = project.proposals.find((item) => item.id === id && item.kind === "shorter" && item.status === "pending");
  if (!proposal || proposal.op?.type !== "timeline") {
    return finish(project, callId, { status: "error", error: "That shorter-cut proposal is not available." }, true);
  }
  if (proposal.baseRevision !== project.revision) {
    return finish(project, callId, { status: "error", error: "stale_revision" }, true);
  }
  let keep = asString(args.keep_sentence_id)
    ? project.transcript?.sentences.find((sentence) => sentence.id === asString(args.keep_sentence_id))
    : sentenceByOrdinal(project, ordinalArg(args, "keep_sentence_ordinal"));
  if (args.keep_first_question === true) keep = project.transcript?.sentences.find((sentence) => sentence.text.includes("?"));
  if (!keep) return finish(project, callId, { status: "needs_clarification", message: "Which sentence should the proposal keep?" }, false);
  const existing = proposal.sequence ?? [];
  if (!existing.some((item) => item.sentenceId === keep!.id)) {
    const entry = { sentenceId: keep.id, text: keep.text, sourceStartMs: keep.startMs, sourceEndMs: keep.endMs };
    const beforeId = asString(args.before_sentence_id);
    const at = beforeId ? existing.findIndex((item) => item.sentenceId === beforeId) : 0;
    existing.splice(at < 0 ? 0 : at, 0, entry);
  }
  proposal.sequence = existing;
  proposal.op.spans = existing.map((item) => ({ id: newId("span"), sourceStartMs: item.sourceStartMs, sourceEndMs: item.sourceEndMs }));
  const candidate = clone(project.edit);
  candidate.spans = proposal.op.spans;
  proposal.durationMs = outputDuration(resolveSegments(candidate, project.transcript!.words, projectSourceDurationMs(project), project.clips));
  proposal.summary = `Revised proposal to keep “${keep.text}”; duration is ${(proposal.durationMs / 1000).toFixed(1)}s.`;
  proposal.explanation = "The requested sentence was added without changing the current edit.";
  return finish(project, callId, shorterProposalResult(proposal), false);
}

function setAudioMix(project: Project, args: Record<string, unknown>, callId: string | undefined): ToolOutcome {
  if (!project.clips || project.clips.length === 0) return finish(project, callId, { status: "error", error: "Upload a video first." }, true);
  const audio = { ...project.edit.audio };
  const speech = asNumber(args.speech_volume);
  const music = asNumber(args.music_volume);
  const fade = asNumber(args.fade_ms);
  if (speech !== undefined) audio.speechVolume = Math.max(0, Math.min(2, speech));
  if (music !== undefined) audio.musicVolume = Math.max(0, Math.min(1, music));
  if (fade !== undefined) audio.fadeMs = Math.max(50, Math.min(2000, Math.round(fade)));
  if (typeof args.duck_music === "boolean") audio.duckMusic = args.duck_music;
  commit(project);
  project.edit.audio = audio;
  const summary = project.music
    ? `Speech volume ${Math.round(audio.speechVolume * 100)}%, music ${Math.round(audio.musicVolume * 100)}%${audio.duckMusic ? " with speech ducking" : ""}.`
    : `Speech volume ${Math.round(audio.speechVolume * 100)}%.`;
  record(project, { kind: "audio", summary, sentenceId: null, startMs: null, endMs: null, action: null });
  return finish(project, callId, { status: "applied", summary, audio, revision: project.revision }, false);
}

const BATCH_TOOLS = new Set([
  "propose_cut",
  "propose_pause_shortening",
  "restore_section",
  "correct_previous_section",
  "reorder_sections",
  "suggest_shorter_cut",
  "revise_shorter_cut",
  "set_caption_style",
  "set_aspect_ratio",
  "set_audio_mix",
  "undo_edit",
  "redo_edit",
  "preview_segment",
  "export_video",
]);

function applyBatch(project: Project, args: Record<string, unknown>, callId: string | undefined): ToolOutcome {
  const raw = args.instructions;
  if (!Array.isArray(raw) || raw.length === 0) {
    return finish(project, callId, { status: "error", error: "Give instructions as an ordered list." }, true);
  }
  if (raw.length > 8) {
    return finish(project, callId, { status: "error", error: "Ask for at most 8 changes at once." }, true);
  }
  const completed: Array<{ index: number; tool: string; summary: string; status: string }> = [];
  let exportRequested = false;
  for (let index = 0; index < raw.length; index += 1) {
    const step = raw[index];
    if (!step || typeof step !== "object") {
      return finishBatch(project, callId, completed, { index, tool: "unknown", error: "That step was empty.", status: "error" }, false);
    }
    const recordStep = step as Record<string, unknown>;
    const tool = asString(recordStep.tool) ?? asString(recordStep.name) ?? "";
    let stepArgs = recordStep.arguments ?? recordStep.args ?? {};
    if (typeof stepArgs === "string") {
      try {
        stepArgs = JSON.parse(stepArgs) as Record<string, unknown>;
      } catch {
        stepArgs = {};
      }
    }
    if (!BATCH_TOOLS.has(tool)) {
      return finishBatch(project, callId, completed, { index, tool, error: `Unknown step ${tool || "blank"}.`, status: "error" }, false);
    }
    if (tool === "export_video" && index !== raw.length - 1) {
      return finishBatch(
        project,
        callId,
        completed,
        { index, tool, error: "Export has to be the last step.", status: "error" },
        false,
      );
    }
    const stepId = callId ? `${callId}#${index}` : undefined;
    const outcome = applyTool(project, tool, stepArgs as Record<string, unknown>, stepId);
    const status = String(outcome.result.status ?? (outcome.isError ? "error" : "applied"));
    if (outcome.isError || status === "needs_clarification" || status === "error") {
      return finishBatch(
        project,
        callId,
        completed,
        {
          index,
          tool,
          error: String(outcome.result.error || outcome.result.message || "That step did not apply."),
          status,
          candidates: outcome.result.candidates,
        },
        exportRequested,
      );
    }
    if (status === "export_requested") exportRequested = true;
    completed.push({
      index,
      tool,
      summary: String(outcome.result.summary ?? status),
      status,
    });
  }
  const summary = completed.map((step) => step.summary).join(" Then ");
  return finish(
    project,
    callId,
    { status: "applied", completed, failed: null, summary, export_requested: exportRequested, revision: project.revision },
    false,
  );
}

function finishBatch(
  project: Project,
  callId: string | undefined,
  completed: Array<{ index: number; tool: string; summary: string; status: string }>,
  failed: { index: number; tool: string; error: string; status: string; candidates?: unknown },
  exportRequested: boolean,
): ToolOutcome {
  const done = completed.map((step) => step.summary).join(" Then ");
  const summary = completed.length
    ? `Finished: ${done}. Stopped on step ${failed.index + 1} (${failed.tool}): ${failed.error}`
    : failed.error;
  return finish(
    project,
    callId,
    {
      status: completed.length ? "partial" : failed.status,
      completed,
      failed,
      summary,
      candidates: failed.candidates,
      export_requested: exportRequested,
      revision: project.revision,
    },
    completed.length === 0 && failed.status !== "needs_clarification",
  );
}

export function spansSignature(spans: Project["edit"]["spans"]): string {
  return normalizeSpans(spans, Number.MAX_SAFE_INTEGER)
    .map((span) => `${Math.round(span.sourceStartMs)}-${Math.round(span.sourceEndMs)}`)
    .join("|");
}
