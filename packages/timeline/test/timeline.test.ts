import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTool,
  attachMedia,
  buildExportArgs,
  buildSrt,
  coverCrop,
  createProject,
  escapeFilterPath,
  mapSourceRange,
  present,
  resolveSegments,
  type Project,
  type Word,
} from "../src/index.js";

function word(id: string, sentenceId: string, text: string, startMs: number, endMs: number): Word {
  return { id, sentenceId, text, startMs, endMs, confidence: 0.99 };
}

function sample(): Project {
  const project = createProject("00000000-0000-4000-8000-000000000001", "Demo");
  attachMedia(project, {
    filename: "demo.mp4",
    storedName: "original.mp4",
    bytes: 1000,
    durationMs: 11_000,
    width: 1280,
    height: 720,
    hasAudio: true,
    mime: "video/mp4",
  });
  const sentences = [
    { id: "s01", text: "Ignore this intro.", startMs: 200, endMs: 1400, words: ["Ignore", "this", "intro."] },
    { id: "s02", text: "I tested this tool yesterday.", startMs: 2800, endMs: 4600, words: ["I", "tested", "this", "tool", "yesterday."] },
    { id: "s03", text: "The first cut should land on this sentence.", startMs: 6400, endMs: 8200, words: ["The", "first", "cut", "should", "land", "on", "this", "sentence."] },
    { id: "s04", text: "Keep the pause before this last sentence.", startMs: 9800, endMs: 10900, words: ["Keep", "the", "pause", "before", "this", "last", "sentence."] },
  ];
  const words: Word[] = [];
  for (const sentence of sentences) {
    const slice = (sentence.endMs - sentence.startMs) / sentence.words.length;
    sentence.words.forEach((text, index) => {
      const startMs = Math.round(sentence.startMs + slice * index);
      const endMs = Math.round(sentence.startMs + slice * (index + 1));
      words.push(word(`${sentence.id}w${index}`, sentence.id, text, startMs, endMs));
    });
  }
  project.transcript = {
    id: "fixture",
    model: null,
    text: sentences.map((sentence) => sentence.text).join(" "),
    words,
    sentences: sentences.map((sentence) => ({
      id: sentence.id,
      text: sentence.text,
      startMs: sentence.startMs,
      endMs: sentence.endMs,
      wordIds: words.filter((item) => item.sentenceId === sentence.id).map((item) => item.id),
    })),
  };
  project.transcriptSource = "demo-fixture";
  return project;
}

test("trim_before removes the intro and keeps later sentences", () => {
  const project = sample();
  const outcome = applyTool(project, "propose_cut", {
    action: "trim_before",
    quote: "I tested this tool yesterday",
  });
  assert.equal(outcome.isError, false);
  assert.equal(outcome.result.status, "applied");
  const view = present(outcome.project);
  assert.ok(view.removedWordIds.includes("s01w0"));
  assert.equal(view.removedWordIds.includes("s02w1"), false);
  assert.equal(view.segments[0].sourceStartMs, 2800);
  assert.ok(view.outputDurationMs < 11_000);
});

test("cuts at the middle and the end change different source ranges", () => {
  const project = sample();
  const middle = applyTool(project, "propose_cut", { action: "remove", sentence_id: "s03" });
  assert.equal(middle.result.status, "applied");
  const afterMiddle = present(middle.project);
  assert.ok(afterMiddle.removedWordIds.includes("s03w0"));
  assert.equal(afterMiddle.removedWordIds.includes("s04w0"), false);
  assert.equal(afterMiddle.segments.length, 2);

  const end = applyTool(middle.project, "propose_cut", { action: "trim_after", sentence_id: "s02" });
  assert.equal(end.result.status, "applied");
  const view = present(end.project);
  assert.ok(view.removedWordIds.includes("s04w0"));
  assert.equal(view.segments[view.segments.length - 1].sourceEndMs <= 4600, true);
});

test("start, middle, and end source times stay aligned with output times", () => {
  const project = sample();
  applyTool(project, "propose_cut", { action: "remove", sentence_id: "s02" });
  const view = present(project);
  const first = view.segments[0];
  const second = view.segments[1];
  assert.equal(first.outputStartMs, 0);
  assert.equal(second.outputStartMs, first.outputEndMs);
  assert.equal(first.sourceEndMs <= 2800, true);
  assert.ok(second.sourceStartMs >= 4600);
  const duration = view.segments.reduce((sum, segment) => sum + (segment.sourceEndMs - segment.sourceStartMs), 0);
  assert.equal(duration, view.outputDurationMs);
});

test("ambiguous quotes are highlighted and not removed", () => {
  const project = sample();
  const before = present(project).outputDurationMs;
  const outcome = applyTool(project, "propose_cut", { action: "remove", quote: "this" });
  assert.equal(outcome.result.status, "needs_clarification");
  assert.ok(Array.isArray(outcome.result.candidates));
  assert.ok((outcome.result.candidates as unknown[]).length >= 2);
  assert.equal(present(project).outputDurationMs, before);
  assert.equal(project.highlight?.pending, true);
  assert.ok((project.highlight?.ranges.length ?? 0) >= 2);
});

test("playback inside a sentence cuts that sentence only", () => {
  const project = sample();
  project.playback = {
    sourceTimeMs: 7000,
    outputTimeMs: 7000,
    selectedWordIds: [],
    capturedAt: "2026-09-22T00:00:00.000Z",
    reason: "speech-start",
  };
  const outcome = applyTool(project, "propose_cut", { action: "remove", use: "playback" });
  assert.equal(outcome.result.status, "applied");
  const view = present(project);
  assert.ok(view.removedWordIds.includes("s03w0"));
  assert.equal(view.removedWordIds.includes("s02w0"), false);
});

test("a pause between sentences asks instead of cutting an arbitrary range", () => {
  const project = sample();
  project.playback = {
    sourceTimeMs: 5500,
    outputTimeMs: 5500,
    selectedWordIds: [],
    capturedAt: "2026-09-22T00:00:00.000Z",
    reason: "speech-start",
  };
  const outcome = applyTool(project, "propose_cut", { action: "remove" });
  assert.equal(outcome.result.status, "needs_clarification");
  assert.equal(present(project).removedWordIds.length, 0);
});

test("selected words outrank a later playhead", () => {
  const project = sample();
  project.playback = {
    sourceTimeMs: 10_000,
    outputTimeMs: 10_000,
    selectedWordIds: ["s01w0", "s01w1", "s01w2"],
    capturedAt: "2026-09-22T00:00:00.000Z",
    reason: "speech-start",
  };
  const outcome = applyTool(project, "propose_cut", { action: "remove" });
  assert.equal(outcome.result.status, "applied");
  const removed = present(project).removedWordIds;
  assert.ok(removed.includes("s01w0"));
  assert.equal(removed.includes("s04w0"), false);
});

test("previous sentence correction undoes the last cut and removes the earlier one", () => {
  const project = sample();
  const first = applyTool(project, "propose_cut", { action: "remove", sentence_id: "s03" }, "call-1");
  assert.equal(first.result.status, "applied");
  const undo = applyTool(project, "undo_edit", {}, "call-2");
  assert.equal(undo.result.status, "applied");
  assert.equal(present(project).removedWordIds.length, 0);
  const corrected = applyTool(
    project,
    "propose_cut",
    { action: "remove", use: "last_target", sentence_offset: -1 },
    "call-3",
  );
  assert.equal(corrected.result.status, "applied");
  const removed = present(project).removedWordIds;
  assert.ok(removed.includes("s02w0"));
  assert.equal(removed.includes("s03w0"), false);
});

test("the same tool call does not apply a cut twice", () => {
  const project = sample();
  const first = applyTool(project, "propose_cut", { action: "remove", sentence_id: "s02" }, "same-call");
  const duration = present(project).outputDurationMs;
  const second = applyTool(project, "propose_cut", { action: "remove", sentence_id: "s04" }, "same-call");
  assert.equal(second.duplicate, true);
  assert.equal(second.result.status, "applied");
  assert.equal(present(project).outputDurationMs, duration);
  assert.equal(present(project).removedWordIds.includes("s04w0"), false);
  assert.equal(first.result.summary, second.result.summary);
});

test("applying one proposal twice does not remove the range twice", () => {
  const project = sample();
  const preview = applyTool(project, "propose_cut", { action: "remove", sentence_id: "s02", apply: false }, "preview");
  const proposalId = preview.result.proposal_id as string;
  const first = applyTool(project, "apply_edit", { proposal_id: proposalId }, "apply-1");
  const spans = project.edit.spans.map((span) => [span.sourceStartMs, span.sourceEndMs]);
  const second = applyTool(project, "apply_edit", { proposal_id: proposalId }, "apply-2");
  assert.equal(first.result.status, "applied");
  assert.equal(second.result.status, "applied");
  assert.equal(second.result.duplicate, true);
  assert.deepEqual(
    project.edit.spans.map((span) => [span.sourceStartMs, span.sourceEndMs]),
    spans,
  );
});

test("a stale proposal is rejected after another edit", () => {
  const project = sample();
  const preview = applyTool(project, "propose_cut", { action: "remove", sentence_id: "s04", apply: false });
  applyTool(project, "set_caption_style", { enabled: true });
  const outcome = applyTool(project, "apply_edit", { proposal_id: preview.result.proposal_id });
  assert.equal(outcome.isError, true);
  assert.equal(outcome.result.error, "stale_revision");
  assert.equal(present(project).removedWordIds.includes("s04w0"), false);
});

test("undo and redo restore the same spans", () => {
  const project = sample();
  const original = project.edit.spans.map((span) => span.sourceEndMs);
  applyTool(project, "propose_cut", { action: "remove", sentence_id: "s01" });
  applyTool(project, "undo_edit", {});
  assert.deepEqual(
    project.edit.spans.map((span) => span.sourceEndMs),
    original,
  );
  applyTool(project, "redo_edit", {});
  assert.ok(present(project).removedWordIds.includes("s01w0"));
  applyTool(project, "undo_edit", {});
  assert.equal(present(project).removedWordIds.length, 0);
});

test("long pauses shrink and a protected pause stays", () => {
  const project = sample();
  applyTool(project, "propose_pause_shortening", { threshold_ms: 800, retain_ms: 200 });
  const shortened = present(project);
  const beforeLast = shortened.pauses.find((pause) => pause.beforeSentenceId === "s04");
  assert.ok(beforeLast);
  assert.equal(beforeLast?.shortened, true);
  assert.equal(beforeLast?.keptMs, 200);
  const word = project.transcript!.words.find((item) => item.id === "s04w0")!;
  const mapped = mapSourceRange(word.startMs, word.endMs, shortened.segments);
  assert.ok(mapped);
  assert.ok(mapped.outputStartMs < word.startMs);

  applyTool(project, "propose_pause_shortening", { protect_pause: true, sentence_id: "s04", threshold_ms: 800, retain_ms: 200 });
  const kept = present(project).pauses.find((pause) => pause.beforeSentenceId === "s04");
  assert.equal(kept?.shortened, false);
  assert.equal(kept?.keptMs, 9800 - 8200);
});

test("keeping a little more silence raises the retained pause", () => {
  const project = sample();
  applyTool(project, "propose_pause_shortening", { threshold_ms: 800, retain_ms: 180 });
  applyTool(project, "propose_pause_shortening", { delta_retain_ms: 200 });
  assert.equal(project.edit.pause.retainMs, 380);
});

test("captions move earlier after a cut removes the intro", () => {
  const project = sample();
  applyTool(project, "set_caption_style", { enabled: true });
  const before = present(project).cues.find((cue) => cue.text.includes("yesterday"));
  applyTool(project, "propose_cut", { action: "trim_before", quote: "I tested this tool yesterday" });
  const after = present(project).cues.find((cue) => cue.text.includes("yesterday"));
  assert.ok(before && after);
  assert.ok(after.outputStartMs < before.outputStartMs);
  assert.equal(after.sourceStartMs, before.sourceStartMs);
  const removedCue = present(project).cues.find((cue) => cue.text.includes("Ignore"));
  assert.equal(removedCue, undefined);
});

test("vertical crop matches a 9:16 cover window", () => {
  const centered = coverCrop(1920, 1080, 9 / 16, 0.5, 0.5);
  assert.equal(centered.height, 1080);
  assert.equal(centered.width, 606);
  assert.equal(centered.x, 656);
  assert.equal(centered.outWidth, 1080);
  assert.equal(centered.outHeight, 1920);
  const left = coverCrop(1920, 1080, 9 / 16, 0, 0.5);
  assert.equal(left.x, 0);
  const right = coverCrop(1920, 1080, 9 / 16, 1, 0.5);
  assert.equal(right.x, 1920 - right.width);
  const portrait = coverCrop(1080, 1920, 9 / 16, 0.5, 0.5);
  assert.equal(portrait.width, 1080);
  assert.equal(portrait.x, 0);
});

test("export arguments are an array and share the resolved segments", () => {
  const project = sample();
  applyTool(project, "propose_cut", { action: "remove", sentence_id: "s02" });
  applyTool(project, "set_caption_style", { enabled: true });
  applyTool(project, "set_aspect_ratio", { mode: "vertical", focus: 0.25 });
  const view = present(project);
  const weird = "C:\\videos\\it's a file.mp4";
  const args = buildExportArgs({
    input: weird,
    output: "C:\\out\\export.mp4",
    segments: view.segments,
    hasAudio: true,
    crop: view.crop,
    captions: project.edit.captions,
    srtPath: "C:\\out\\captions.srt",
    fontsDir: "C:\\Windows\\Fonts",
    fontName: "Arial",
  });
  assert.ok(Array.isArray(args));
  assert.equal(args.includes(weird), true);
  assert.equal(args.some((arg) => arg.includes("&&")), false);
  const filter = args[args.indexOf("-filter_complex") + 1];
  assert.ok(filter.includes(`trim=start=${(view.segments[0].sourceStartMs / 1000).toFixed(3)}`));
  assert.ok(filter.includes("crop="));
  assert.ok(filter.includes("subtitles="));
  assert.equal(filter.includes("C:/out/captions.srt") || filter.includes("C\\:/out/captions.srt"), true);
  assert.equal(escapeFilterPath("C:\\a\\b.srt").includes("\\:"), true);
  const srt = buildSrt(view.cues);
  assert.match(srt, /-->/);
  assert.equal(srt.includes("yesterday"), false);
  assert.equal(srt.includes("intro"), true);
});

test("a batch runs steps in order, reports a later failure, and does not retry finished steps", () => {
  const project = sample();
  const outcome = applyTool(
    project,
    "apply_instruction_batch",
    {
      instructions: [
        { tool: "propose_cut", arguments: { action: "remove", sentence_id: "s01" } },
        { tool: "propose_cut", arguments: { action: "remove", quote: "this" } },
        { tool: "set_caption_style", arguments: { enabled: true } },
      ],
    },
    "batch-partial",
  );
  assert.equal(outcome.result.status, "partial");
  assert.equal(outcome.isError, false);
  assert.ok(present(project).removedWordIds.includes("s01w0"));
  assert.equal(project.edit.captions.enabled, false);
  const again = applyTool(
    project,
    "apply_instruction_batch",
    {
      instructions: [
        { tool: "propose_cut", arguments: { action: "remove", sentence_id: "s04" } },
        { tool: "set_caption_style", arguments: { enabled: true } },
      ],
    },
    "batch-partial",
  );
  assert.equal(again.duplicate, true);
  assert.equal(present(project).removedWordIds.includes("s04w0"), false);
  assert.equal(project.edit.captions.enabled, false);
});

test("a batch applies a cut, captions, and reorder without dropping earlier steps", () => {
  const project = sample();
  const outcome = applyTool(project, "apply_instruction_batch", {
    instructions: [
      { tool: "propose_cut", arguments: { action: "remove", sentence_id: "s01" } },
      { tool: "set_caption_style", arguments: { enabled: true } },
      { tool: "reorder_sections", arguments: { moving_ordinal: "last", place: "start" } },
    ],
  });
  assert.equal(outcome.result.status, "applied");
  assert.equal(project.edit.captions.enabled, true);
  assert.ok(present(project).removedWordIds.includes("s01w0"));
  const firstWord = project.transcript!.words.find((item) => item.id === "s04w0")!;
  const mapped = mapSourceRange(firstWord.startMs, firstWord.endMs, present(project).segments);
  assert.ok(mapped);
  assert.ok(mapped.outputStartMs < 400);
});

test("restore puts one sentence back and leaves the other cut and the captions", () => {
  const project = sample();
  applyTool(project, "propose_cut", { action: "remove", sentence_id: "s02" });
  applyTool(project, "propose_cut", { action: "remove", sentence_id: "s04" });
  applyTool(project, "set_caption_style", { enabled: true });
  const outcome = applyTool(project, "restore_section", { sentence_ordinal: 2 });
  assert.equal(outcome.result.status, "applied");
  const removed = present(project).removedWordIds;
  assert.equal(removed.includes("s02w0"), false);
  assert.ok(removed.includes("s04w0"));
  assert.equal(project.edit.captions.enabled, true);
});

test("correcting the previous section keeps captions and an earlier cut", () => {
  const project = sample();
  applyTool(project, "set_caption_style", { enabled: true });
  applyTool(project, "propose_cut", { action: "remove", sentence_id: "s04" });
  applyTool(project, "propose_cut", { action: "remove", sentence_id: "s03" });
  const outcome = applyTool(project, "correct_previous_section", {});
  assert.equal(outcome.result.status, "applied");
  const removed = present(project).removedWordIds;
  assert.ok(removed.includes("s04w0"));
  assert.ok(removed.includes("s02w0"));
  assert.equal(removed.includes("s03w0"), false);
  assert.equal(project.edit.captions.enabled, true);
  applyTool(project, "undo_edit", {});
  assert.ok(present(project).removedWordIds.includes("s03w0"));
  assert.equal(present(project).removedWordIds.includes("s02w0"), false);
  assert.equal(project.edit.captions.enabled, true);
});

test("keep that pause protects the silence under the playhead", () => {
  const project = sample();
  project.playback = {
    sourceTimeMs: 5500,
    outputTimeMs: 5500,
    selectedWordIds: [],
    capturedAt: "2026-09-22T00:00:00.000Z",
    reason: "speech-start",
  };
  applyTool(project, "propose_pause_shortening", { threshold_ms: 800, retain_ms: 120 });
  const outcome = applyTool(project, "propose_pause_shortening", { protect_pause: true, use: "playback" });
  assert.equal(outcome.result.status, "applied");
  const pause = present(project).pauses.find((item) => item.beforeSentenceId === "s03");
  assert.equal(pause?.shortened, false);
  assert.equal(pause?.keptMs, 6400 - 4600);
});

test("moving one sentence before another changes output order only", () => {
  const project = sample();
  applyTool(project, "set_aspect_ratio", { mode: "vertical", focus: 0.25 });
  const outcome = applyTool(project, "reorder_sections", {
    moving_quote: "first cut should land",
    place: "before",
    anchor_quote: "I tested this tool yesterday",
  });
  assert.equal(outcome.result.status, "applied");
  assert.equal(project.edit.framing.mode, "vertical");
  const view = present(project);
  const moved = project.transcript!.words.find((item) => item.sentenceId === "s03")!;
  const anchor = project.transcript!.words.find((item) => item.sentenceId === "s02")!;
  const movedOut = mapSourceRange(moved.startMs, moved.endMs, view.segments);
  const anchorOut = mapSourceRange(anchor.startMs, anchor.endMs, view.segments);
  assert.ok(movedOut && anchorOut);
  assert.ok(movedOut.outputStartMs < anchorOut.outputStartMs);
  const intro = project.transcript!.words.find((item) => item.sentenceId === "s01")!;
  const introOut = mapSourceRange(intro.startMs, intro.endMs, view.segments);
  assert.ok(introOut);
  assert.ok(introOut.outputStartMs < movedOut.outputStartMs);
});

test("an ambiguous reorder asks and leaves the timeline alone", () => {
  const project = sample();
  const before = present(project).segments.map((segment) => segment.sourceStartMs);
  const outcome = applyTool(project, "reorder_sections", { moving_quote: "this", place: "start" });
  assert.equal(outcome.result.status, "needs_clarification");
  assert.deepEqual(
    present(project).segments.map((segment) => segment.sourceStartMs),
    before,
  );
});

test("resolveTimeline without pause policy keeps a single span continuous", () => {
  const project = sample();
  const segments = resolveSegments(project.edit, project.transcript!.words, 11_000);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].sourceStartMs, 0);
  assert.equal(segments[0].sourceEndMs, 11_000);
});

test("captions follow a final sentence moved to the beginning", () => {
  const project = sample();
  applyTool(project, "set_caption_style", { enabled: true, word_highlight: true });
  const moved = applyTool(project, "reorder_sections", { moving_ordinal: "last", place: "start" });
  assert.equal(moved.result.status, "applied");
  const view = present(project);
  assert.ok(view.segments[0].sourceStartMs >= 9800);
  assert.equal(view.cues[0].words[0].text, "Keep");
  assert.ok(view.cues[0].outputStartMs < 100);
});

test("a shorter cut can be revised and approved without changing the edit early", () => {
  const project = sample();
  const before = project.edit.spans.map((span) => ({ ...span }));
  const suggested = applyTool(project, "suggest_shorter_cut", { target_seconds: 4, focus: "first cut" }, "short-1");
  assert.equal(suggested.result.status, "ready");
  assert.deepEqual(project.edit.spans, before);
  const proposalId = String(suggested.result.proposal_id);
  const revised = applyTool(project, "revise_shorter_cut", { proposal_id: proposalId, keep_sentence_ordinal: 1 }, "short-2");
  assert.equal(revised.result.status, "ready");
  assert.ok((revised.result.sequence as Array<{ sentence_id: string }>).some((item) => item.sentence_id === "s01"));
  assert.deepEqual(project.edit.spans, before);
  const approved = applyTool(project, "apply_edit", { proposal_id: proposalId }, "short-3");
  assert.equal(approved.result.status, "applied");
  assert.ok(project.edit.spans.length >= 1);
  const retried = applyTool(project, "apply_edit", { proposal_id: proposalId }, "short-4");
  assert.equal(retried.result.duplicate, true);
});

test("caption, framing and audio controls remain globally undoable", () => {
  const project = sample();
  applyTool(project, "set_caption_style", { enabled: true, preset: "bold", highlight_color: "#FFFF00" });
  applyTool(project, "set_aspect_ratio", { mode: "square", focus: 0.2 });
  applyTool(project, "set_audio_mix", { speech_volume: 0.8, music_volume: 0.25, duck_music: true });
  assert.equal(project.edit.audio.speechVolume, 0.8);
  applyTool(project, "undo_edit", {});
  assert.equal(project.edit.audio.speechVolume, 1);
  assert.equal(project.edit.framing.mode, "square");
  applyTool(project, "redo_edit", {});
  assert.equal(project.edit.audio.speechVolume, 0.8);
});
