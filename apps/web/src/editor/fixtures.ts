import type { Sentence, Tool } from "./types"

export const PROJECT_DURATION = 48
export const PROJECT_MEDIA = "/assets/creator-studio.jpg"

export const SAMPLE_TRANSCRIPT: Sentence[] = [
  {
    id: 0,
    start: 0,
    text: "Before we get started, let me give you some background.",
  },
  { id: 1, start: 12, text: "I tested this tool yesterday." },
  { id: 2, start: 16, text: "Here is what surprised me." },
  { id: 3, start: 24, text: "It handled the boring work for me." },
  { id: 4, start: 32, text: "Let me show you how it works." },
  { id: 5, start: 40, text: "This is the part I would change." },
]

export const TOOL_LABELS: { id: Tool; label: string; icon: string }[] = [
  { id: "media", label: "Media", icon: "folder" },
  { id: "transcript", label: "Transcript", icon: "document" },
  { id: "captions", label: "Captions", icon: "captions" },
  { id: "audio", label: "Audio", icon: "wave" },
  { id: "history", label: "History", icon: "history" },
]
