export type Tool =
  | "media"
  | "transcript"
  | "captions"
  | "audio"
  | "history"
  | "framing"

export type CaptionStyle = "clean" | "highlight"

export type VoiceState =
  | "Disconnected"
  | "Connecting"
  | "Listening"
  | "Thinking"
  | "Speaking"
  | "Applying edit"
  | "Permission error"
  | "Connection error"

export type ProjectPhase = "empty" | "uploading" | "transcribing" | "ready"
export type ExportState = "options" | "processing" | "complete" | "error"
