export type Tool =
  | "media"
  | "transcript"
  | "captions"
  | "audio"
  | "history"
  | "framing"

export type CaptionStyle = "clean" | "bold" | "highlight"

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

export interface Sentence {
  id: number
  start: number
  text: string
}

export interface EditorCallbacks {
  onUpload?: (file: File) => void
  onSeek?: (time: number) => void
  onProposeEdit?: (sentenceId: number) => void
  onApplyEdit?: (sentenceId: number) => void
  onUndo?: () => void
  onRedo?: () => void
  onCaptionChange?: (style: CaptionStyle) => void
  onFramingChange?: (ratio: string) => void
  onAudioChange?: (volume: number) => void
  onVoiceConnect?: () => void
  onVoiceDisconnect?: () => void
  onExport?: (format: string) => void
}
