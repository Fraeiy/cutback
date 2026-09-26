import type { Tool } from "./types"

export const PROJECT_MEDIA = "/assets/creator-studio.jpg"

export const TOOL_LABELS: { id: Tool; label: string; icon: string }[] = [
  { id: "media", label: "Media", icon: "folder" },
  { id: "transcript", label: "Transcript", icon: "document" },
  { id: "captions", label: "Captions", icon: "captions" },
  { id: "audio", label: "Audio", icon: "wave" },
  { id: "history", label: "History", icon: "history" },
]
