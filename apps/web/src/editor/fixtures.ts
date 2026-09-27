import type { Tool } from "./types"

export const PROJECT_MEDIA = "/assets/creator-studio.jpg"

export const TOOL_LABELS: { id: Tool; label: string; icon: string }[] = [
  { id: "media", label: "Media", icon: "folder" },
  { id: "transcript", label: "Transcript", icon: "document" },
  { id: "captions", label: "Captions", icon: "captions" },
  // Framing used to be reachable only from the mobile "more tools" sheet, which
  // left crop position and safe-area guides unreachable on a desktop browser.
  { id: "framing", label: "Framing", icon: "frame" },
  { id: "audio", label: "Audio", icon: "wave" },
  { id: "history", label: "History", icon: "history" },
]
