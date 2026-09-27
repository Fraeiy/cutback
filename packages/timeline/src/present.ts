import { projectSourceDurationMs, sourceDurationMs } from "./clips.js";
import { buildCues, describePauses, framingCrop, outputDuration, removedWordIds, resolveSegments } from "./resolve.js";
import type { PresentedProject, Project } from "./types.js";

export function present(project: Project): PresentedProject {
  const clips = project.clips ?? [];
  const durationMs = projectSourceDurationMs(project);
  const words = project.transcript?.words ?? [];
  const sentences = project.transcript?.sentences ?? [];
  const segments = resolveSegments(project.edit, words, durationMs, clips);
  // Cues are timeline data even when the visual caption layer is hidden; this
  // keeps SRT export available without coupling it to preview styling.
  const cues = buildCues(words, segments);
  const primary = clips[0]?.media ?? null;
  return {
    ...project,
    segments,
    cues,
    pauses: describePauses(sentences, words, project.edit, durationMs),
    outputDurationMs: outputDuration(segments),
    removedWordIds: removedWordIds(words, project.edit.spans),
    crop: primary ? framingCrop(project.edit.framing, primary.width, primary.height) : null,
    // The unedited timeline is every clip laid end to end, in order.
    originalSegments: clips.length
      ? clips.map((clip, index) => ({
          id: `original_${index}_${clip.id}`,
          sourceStartMs: clip.offsetMs,
          sourceEndMs: clip.offsetMs + clip.media.durationMs,
          outputStartMs: clip.offsetMs,
          outputEndMs: clip.offsetMs + clip.media.durationMs,
          clipId: clip.id,
          clipStartMs: 0,
          clipEndMs: clip.media.durationMs,
        }))
      : durationMs
        ? [{
            id: "original",
            sourceStartMs: 0,
            sourceEndMs: durationMs,
            outputStartMs: 0,
            outputEndMs: durationMs,
            clipId: "",
            clipStartMs: 0,
            clipEndMs: durationMs,
          }]
        : [],
    sourceDurationMs: sourceDurationMs(clips),
  };
}
