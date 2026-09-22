import { buildCues, describePauses, framingCrop, outputDuration, removedWordIds, resolveSegments } from "./resolve.js";
import type { PresentedProject, Project } from "./types.js";

export function present(project: Project): PresentedProject {
  const durationMs = project.media?.durationMs ?? 0;
  const words = project.transcript?.words ?? [];
  const sentences = project.transcript?.sentences ?? [];
  const segments = resolveSegments(project.edit, words, durationMs);
  // Cues are timeline data even when the visual caption layer is hidden; this
  // keeps SRT export available without coupling it to preview styling.
  const cues = buildCues(words, segments);
  return {
    ...project,
    segments,
    cues,
    pauses: describePauses(sentences, words, project.edit, durationMs),
    outputDurationMs: outputDuration(segments),
    removedWordIds: removedWordIds(words, project.edit.spans),
    crop: project.media ? framingCrop(project.edit.framing, project.media.width, project.media.height) : null,
    originalSegments: durationMs
      ? [{ id: "original", sourceStartMs: 0, sourceEndMs: durationMs, outputStartMs: 0, outputEndMs: durationMs }]
      : [],
  };
}
