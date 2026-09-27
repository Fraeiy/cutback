import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { PresentedProject, Proposal, ResolvedSegment } from "@cutback/timeline"
import { api, saveToken, type Health } from "./api"
import { VoiceSession, type VoicePhase } from "./voice"
import { FloatingAssistant } from "./editor/FloatingAssistant"
import {
  PROJECT_MEDIA as mediaImage,
  TOOL_LABELS as toolLabels,
} from "./editor/fixtures"
import type {
  CaptionStyle,
  ExportState,
  ProjectPhase,
  Tool,
  VoiceState,
} from "./editor/types"

const PROJECT_KEY = "cutback.projectId"

const TEXT_COLORS: Record<string, string> = {
  white: "#FFFFFF",
  slate: "#9CA3AF",
  black: "#353A3F",
  cream: "#EEE3D2",
  pink: "#F093BD",
  blue: "#82BDF2",
}

const HIGHLIGHT_COLORS: Record<string, string> = {
  mint: "#B6F2C8",
  yellow: "#F3CE62",
  orange: "#EE9A42",
  rose: "#EA7B9E",
  violet: "#A98BE7",
  blue: "#82BDF2",
}

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    play: <path d="m8 5 10 7-10 7V5Z" />,
    pause: (
      <>
        <path d="M8 5v14M16 5v14" />
      </>
    ),
    volume: (
      <>
        <path d="M5 10v4h4l5 4V6l-5 4H5Z" />
        <path d="M17 9a4 4 0 0 1 0 6" />
      </>
    ),
    expand: (
      <>
        <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
      </>
    ),
    folder: <path d="M3 7h7l2-2h9v14H3V7Z" />,
    document: (
      <>
        <path d="M6 3h9l4 4v14H6V3Z" />
        <path d="M14 3v5h5M9 12h6M9 16h6" />
      </>
    ),
    captions: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M10 10a3 3 0 1 0 0 4M18 10a3 3 0 1 0 0 4" />
      </>
    ),
    wave: <path d="M4 12v2m4-7v10m4-14v18m4-14v10m4-7v4" />,
    history: (
      <>
        <path d="M4 7v5h5" />
        <path d="M5.5 17a8 8 0 1 0-.8-9" />
      </>
    ),
    undo: (
      <>
        <path d="m9 7-5 5 5 5" />
        <path d="M5 12h8a6 6 0 0 1 6 6" />
      </>
    ),
    redo: (
      <>
        <path d="m15 7 5 5-5 5" />
        <path d="M19 12h-8a6 6 0 0 0-6 6" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="6" />
        <path d="m16 16 5 5" />
      </>
    ),
    scissors: (
      <>
        <circle cx="6" cy="7" r="2" />
        <circle cx="6" cy="17" r="2" />
        <path d="m8 8 11 8M8 16 19 8" />
      </>
    ),
    mic: (
      <>
        <rect x="9" y="3" width="6" height="12" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </>
    ),
    // Reserved for the voice assistant, which draws its own mic glyph.
    upload: (
      <>
        <path d="m12 16V4m-5 5 5-5 5 5" />
        <path d="M4 15v5h16v-5" />
      </>
    ),
    frame: (
      <>
        <path d="M4 8V5h3M20 8V5h-3M4 16v3h3M20 16v3h-3" />
        <rect x="8" y="8" width="8" height="8" rx="1" />
      </>
    ),
    more: (
      <>
        <circle cx="5" cy="12" r="1" fill="currentColor" />
        <circle cx="12" cy="12" r="1" fill="currentColor" />
        <circle cx="19" cy="12" r="1" fill="currentColor" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    back: <path d="m15 18-6-6 6-6" />,
    crop: (
      <>
        <path d="M7 3v14a2 2 0 0 0 2 2h12M3 7h14a2 2 0 0 1 2 2v12" />
      </>
    ),
    music: (
      <>
        <path d="M9 18V6l10-2v12" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="16" cy="16" r="3" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    alert: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v6M12 17h.01" />
      </>
    ),
  }
  return (
    <svg
      aria-hidden="true"
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* An unknown name used to render the "more" glyph, so a typo in a tool
          label showed up as three dots instead of failing. */}
      {paths[name] ?? (() => {
        if (import.meta.env.DEV) console.error(`Unknown icon name: ${String(name)}`)
        return null
      })()}
    </svg>
  )
}

function formatTime(value: number) {
  const seconds = Math.max(0, Math.round(value))
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`
}

function ratioFromProject(project: PresentedProject | null): string {
  const mode = project?.edit.framing.mode
  return mode === "wide" ? "16:9" : mode === "square" ? "1:1" : mode === "vertical" ? "9:16" : "Original"
}

function ratioLabel(ratio: string): string {
  return ratio === "Original" ? "Original frame" : `${ratio} frame`
}

function modeFromRatio(ratio: string): "original" | "wide" | "square" | "vertical" {
  return ratio === "16:9" ? "wide" : ratio === "1:1" ? "square" : ratio === "9:16" ? "vertical" : "original"
}

function sourceToOutput(segments: ResolvedSegment[], sourceMs: number): number | null {
  const segment = segments.find((item) => sourceMs >= item.sourceStartMs && sourceMs <= item.sourceEndMs)
  return segment ? segment.outputStartMs + sourceMs - segment.sourceStartMs : null
}

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <i />
        <i />
      </span>
      <strong>cutback</strong>
    </div>
  )
}

export function EditorHeader({
  title,
  saveStatus,
  statusTone,
  onExport,
  onTitle,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onMore,
}: {
  title: string
  saveStatus: string
  /** Drives the indicator colour: settled, working, or failed. */
  statusTone: "ok" | "busy" | "error"
  onExport: () => void
  onTitle: (title: string) => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  onMore: () => void
}) {
  return (
    <header className="editor-header">
      <div className="desktop-only header-left">
        <Brand />
        <span className="header-divider" />
        <label className="breadcrumb">
          Projects&nbsp; / &nbsp;
          <input
            aria-label="Project title"
            value={title}
            onChange={(event) => onTitle(event.target.value)}
          />
        </label>
        <span className={`saved tone-${statusTone}`} role="status" aria-live="polite">
          <i />
          {saveStatus}
        </span>
      </div>
      {/* Every status message used to live in the desktop-only header, so a
          phone showed no feedback at all for uploads, transcription failures or
          export errors. This is the mobile equivalent. */}
      <div className="mobile-only mobile-status" role="status" aria-live="polite">
        {saveStatus}
      </div>
      <div className="mobile-only mobile-head">
        <Brand />
        <b className="mobile-project">{title}</b>
      </div>
      <div className="header-actions">
        <button
          className="icon-btn desktop-only"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="Undo"
        >
          <Icon name="undo" />
        </button>
        <button
          className="icon-btn desktop-only"
          onClick={onRedo}
          disabled={!canRedo}
          aria-label="Redo"
        >
          <Icon name="redo" />
        </button>
        <button
          className="icon-btn mobile-only"
          onClick={onMore}
          aria-label="More tools"
        >
          <Icon name="more" />
        </button>
        <button className="primary export-button" onClick={onExport}>
          Export
        </button>
      </div>
    </header>
  )
}

export function ToolNavigation({
  active,
  onChange,
}: {
  active: Tool
  onChange: (tool: Tool) => void
}) {
  return (
    <nav className="tool-navigation" aria-label="Editor tools">
      {toolLabels.map((tool) => (
        <button
          key={tool.id}
          className={active === tool.id ? "active" : ""}
          onClick={() => onChange(tool.id)}
        >
          <Icon name={tool.icon} size={21} />
          <span>{tool.label}</span>
        </button>
      ))}
    </nav>
  )
}

export function PlaybackControls({
  currentTime,
  duration,
  playing,
  muted,
  onPlay,
  onSeek,
  onMute,
  onFullscreen,
}: {
  currentTime: number
  duration: number
  playing: boolean
  muted: boolean
  onPlay: () => void
  onSeek: (value: number) => void
  onMute: () => void
  onFullscreen: () => void
}) {
  return (
    <div className="playback">
      <button
        className="play-button"
        onClick={onPlay}
        aria-label={playing ? "Pause" : "Play"}
      >
        <Icon name={playing ? "pause" : "play"} size={22} />
      </button>
      <span className="time">{formatTime(currentTime)} / {formatTime(duration)}</span>
      <input
        aria-label="Playback position"
        type="range"
        min="0"
        max={Math.max(duration, 0.1)}
        step=".1"
        value={currentTime}
        onChange={(event) => onSeek(Number(event.target.value))}
        style={
          {
            "--progress": `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
          } as React.CSSProperties
        }
      />
      <button
        className={`icon-btn ${muted ? "muted" : ""}`}
        onClick={onMute}
        aria-label={muted ? "Unmute preview" : "Mute preview"}
      >
        <Icon name="volume" />
      </button>
      <button
        className="icon-btn"
        onClick={onFullscreen}
        aria-label="Enter fullscreen preview"
      >
        <Icon name="expand" />
      </button>
    </div>
  )
}

export function VideoPreview({
  project,
  currentTime,
  playing,
  ratio,
  captionStyle,
  captionSize,
  captionPosition,
  captionPositionY,
  wordHighlight,
  highlightColor,
  showGuides,
  mode,
  onPlay,
  onSeek,
  onRatio,
  onMode,
  onVideoReady,
  onVideoTimeUpdate,
  onPlaybackBlocked,
  onAttachReady,
  mediaSrc,
  activeClipId,
}: {
  project: PresentedProject | null
  currentTime: number
  playing: boolean
  ratio: string
  captionStyle: CaptionStyle
  captionSize: number
  captionPosition: string
  /** Normalised 0-1 vertical anchor, matching what the export burns in. */
  captionPositionY: number
  /** Karaoke-style per-word highlight, matching the burned export. */
  wordHighlight: boolean
  /** Hex colour applied to the word currently being spoken. */
  highlightColor: string
  showGuides: boolean
  mode: "original" | "edited"
  onPlay: () => void
  onSeek: (value: number) => void
  onRatio: (ratio: string) => void
  onMode: (mode: "original" | "edited") => void
  onVideoReady: (video: HTMLVideoElement | null) => void
  onVideoTimeUpdate: (video: HTMLVideoElement) => void
  onPlaybackBlocked: () => void
  onAttachReady: () => void
  mediaSrc?: string | null
  activeClipId: string | null
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    const frame = stageRef.current
    if (!frame) return
    const MAX = 4.5
    const onMove = (event: PointerEvent) => {
      const rect = frame.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      const px = (event.clientX - rect.left) / rect.width - 0.5
      const py = (event.clientY - rect.top) / rect.height - 0.5
      frame.style.setProperty("--tilt-x", `${(-py * MAX).toFixed(2)}deg`)
      frame.style.setProperty("--tilt-y", `${(px * MAX).toFixed(2)}deg`)
      frame.style.setProperty("--gloss-x", `${((px + 0.5) * 100).toFixed(1)}%`)
      frame.style.setProperty("--gloss-y", `${((py + 0.5) * 100).toFixed(1)}%`)
    }
    const onLeave = () => {
      frame.style.setProperty("--tilt-x", "0deg")
      frame.style.setProperty("--tilt-y", "0deg")
    }
    frame.addEventListener("pointermove", onMove)
    frame.addEventListener("pointerleave", onLeave)
    return () => {
      frame.removeEventListener("pointermove", onMove)
      frame.removeEventListener("pointerleave", onLeave)
    }
  }, [])

  // Hand the element up through a stable ref callback. An effect keyed on
  // onVideoReady ran once on mount, when the clip had not loaded yet and the
  // markup was still an <img>, so the editor's ref stayed null for the whole
  // session and seek() bailed out every time.
  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element
    onVideoReady(element)
  }, [onVideoReady])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = muted
  }, [mediaSrc, muted, onAttachReady])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !mediaSrc) return
    if (playing) void video.play().catch(() => onPlaybackBlocked())
    else video.pause()
  }, [mediaSrc, playing, onPlaybackBlocked])
  const activeCue = project?.cues.find(
    (cue) => currentTime * 1000 >= cue.outputStartMs && currentTime * 1000 <= cue.outputEndMs,
  )
  const framing = mode === "original" ? undefined : project?.edit.framing
  // The frame matches whichever clip is loaded, so clips of different shapes
  // letterbox correctly instead of stretching.
  const loadedClip = project?.clips?.find((clip) => clip.id === activeClipId) ?? project?.clips?.[0]
  const canvasRatio = !framing || framing.mode === "original"
    ? (loadedClip ? loadedClip.media.width / loadedClip.media.height : 16 / 9)
    : framing.mode === "wide" ? 16 / 9 : framing.mode === "square" ? 1 : 9 / 16
  return (
    <section className="preview-panel">
      <div className="preview-toolbar desktop-only">
        <span>Preview</span>
        <div className="toolbar-right">
          <div className="segmented mini">
            <button
              className={mode === "original" ? "active" : ""}
              onClick={() => onMode("original")}
            >
              Before
            </button>
            <button
              className={mode === "edited" ? "active" : ""}
              onClick={() => onMode("edited")}
            >
              After
            </button>
          </div>
          {/* The frame-ratio control used to sit here as a second, duplicate
              dropdown. Aspect ratio now lives only in the Framing panel, so
              there is one place to set it rather than two that disagree. */}
          <span className="toolbar-frame">{ratioLabel(ratio)}</span>
        </div>
      </div>
      <div className="preview-canvas-area">
      {/* --canvas-ratio must live on the stage: the container-query sizing rule
          reads it here, and custom properties only inherit downward, so putting
          it on the frame below left the stage with an invalid width and height
          and the preview collapsed. */}
      <div className="video-stage" style={{ "--canvas-ratio": canvasRatio } as React.CSSProperties}>
        {/* The frame is sized to the clip's own aspect ratio so the video fills
            it exactly. Overlays are positioned inside the frame, which keeps
            captions and guides on the picture rather than in the letterbox. */}
        <div
          style={{ "--caption-y": captionPositionY } as React.CSSProperties}
          ref={stageRef}
          className={`video-frame ratio-${ratio.replace(":", "-").toLowerCase()}`}
        >
          {mediaSrc ? (
            <video
              ref={attachVideo}
              src={mediaSrc}
              muted={muted}
              playsInline
              preload="auto"
              onTimeUpdate={(event) => onVideoTimeUpdate(event.currentTarget)}
              onLoadedMetadata={onAttachReady}
              onCanPlay={onAttachReady}
              style={{
                objectFit: framing?.mode && framing.mode !== "original" ? "cover" : "contain",
                objectPosition: `${(framing?.focus ?? 0.5) * 100}% ${(framing?.focusY ?? 0.5) * 100}%`,
              }}
              aria-label="Uploaded video preview"
            />
          ) : (
            <img
              src={mediaImage}
              alt="Creator recording a video in a home studio"
            />
          )}
          {showGuides && <div className="safe-guides" />}
          {mode === "edited" && project?.edit.captions.enabled && activeCue && (
            <div
              className={`caption caption-${captionStyle} position-${captionPosition.toLowerCase()}`}
              style={
                { "--caption-size": `${captionSize}px` } as React.CSSProperties
              }
            >
              {/* With word highlight on, the spoken word gets the highlight
                  colour, matching how the export burns the same cue in. */}
              {wordHighlight && activeCue.words.length > 0
                ? activeCue.words.map((word) => {
                    const spoken = currentTime * 1000 >= word.outputStartMs && currentTime * 1000 <= word.outputEndMs;
                    return (
                      <span
                        key={word.id}
                        className={spoken ? "word spoken" : "word"}
                        style={spoken ? { background: highlightColor, color: "#102016" } : undefined}
                      >
                        {word.text}
                      </span>
                    );
                  })
                : activeCue.text}
            </div>
          )}
        </div>
      </div>
      </div>
      <PlaybackControls
        currentTime={currentTime}
        duration={((mode === "original" ? project?.sourceDurationMs : project?.outputDurationMs) ?? 0) / 1000}
        playing={playing}
        muted={muted}
        onPlay={onPlay}
        onSeek={onSeek}
        onMute={() => setMuted((value) => !value)}
        onFullscreen={() => stageRef.current?.requestFullscreen?.()}
      />
    </section>
  )
}

export function EditProposal({
  proposal,
  state,
  onPreview,
  onApply,
  onDismiss,
}: {
  proposal: Proposal | null
  state: "pending" | "applying" | "applied" | "dismissed"
  onPreview: () => void
  onApply: () => void
  onDismiss: () => void
}) {
  if (!proposal || state === "dismissed") return null
  // Derived from the proposal rather than a fixed number, so a 0.4s cut does
  // not claim to be 4.2s in front of a judge.
  const op = proposal.op
  const removedMs = op && op.type === "cut" ? Math.max(0, op.endMs - op.startMs) : null
  const removedLabel = removedMs === null ? "this section" : `${(removedMs / 1000).toFixed(1)}s`
  return (
    <div className={`proposal ${state}`}>
      <span className="proposal-icon">
        <Icon name={state === "applied" ? "check" : "scissors"} />
      </span>
      <div>
        <b>{proposal.summary}</b>
        <span>
          {state === "applying"
            ? "Applying edit…"
            : state === "applied"
              ? `Edit applied · removed ${removedLabel}`
              : `Remove ${removedLabel}`}
        </span>
      </div>
      {state === "pending" && (
        <div className="proposal-actions">
          <button onClick={onPreview}>Preview</button>
          <button className="primary" onClick={onApply}>
            Apply
          </button>
          <button className="dismiss desktop-only" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}

function MobileTimeline({
  currentTime,
  duration,
  thumbnails,
  waveform,
  onSeek,
}: {
  currentTime: number
  duration: number
  thumbnails: string[]
  waveform: number[]
  onSeek: (time: number) => void
}) {
  return (
    <div className="mobile-mini-timeline mobile-only">
      <div className="mini-ruler">
        {[0, .25, .5, .75, 1].map((ratio) => (
          <span key={ratio}>{formatTime(duration * ratio)}</span>
        ))}
      </div>
      <div className="mini-strip">
        {thumbnails.map((thumbnail, frame) => (
          <img
            src={thumbnail}
            alt=""
            key={frame}
            style={{ objectPosition: `${18 + frame * 16}% 44%` }}
          />
        ))}
        {/* The tap handler below maps across the full button width, so the
            playhead must too. The 112px track-label gutter belongs to the
            desktop timeline and put this marker a third of a phone screen off. */}
        <i style={{ left: `${(duration > 0 ? Math.min(1, currentTime / duration) : 0) * 100}%` }} />
        <button
          aria-label="Seek compact timeline"
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect()
            onSeek(((event.clientX - bounds.left) / bounds.width) * duration)
          }}
        />
      </div>
      <div className="mini-waveform">
        {(waveform.length ? waveform.slice(0, 54) : Array.from({ length: 54 }, () => 0.18)).map((peak, index) => (
          <i
            key={index}
            style={{ height: `${Math.max(12, peak * 100)}%` }}
          />
        ))}
      </div>
    </div>
  )
}

export function TranscriptPanel({
  project,
  activeSentenceId,
  selectedSentenceId,
  currentTime,
  duration,
  thumbnails,
  waveform,
  proposalState,
  proposal,
  onSeek,
  onSelect,
  onPropose,
  onPreview,
  onApply,
  onDismiss,
  onUndo,
  onRedo,
}: {
  project: PresentedProject | null
  activeSentenceId: string | null
  selectedSentenceId: string | null
  currentTime: number
  duration: number
  thumbnails: string[]
  waveform: number[]
  proposalState: "pending" | "applying" | "applied" | "dismissed"
  proposal: Proposal | null
  onSeek: (time: number) => void
  onSelect: (id: string) => void
  onPropose: (id: string) => void
  onPreview: () => void
  onApply: () => void
  onDismiss: () => void
  onUndo: () => void
  onRedo: () => void
}) {
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState("")
  const sentences = project?.transcript?.sentences ?? []
  const visibleSentences = query
    ? sentences.filter((sentence) =>
        sentence.text.toLowerCase().includes(query.toLowerCase()),
      )
    : sentences
  return (
    <section className="inspector transcript-panel">
      <div className="inspector-header">
        <div>
          <h2>Transcript</h2>
          <span className="desktop-only">Select a sentence to edit</span>
        </div>
        <div>
          <button
            className="icon-btn"
            aria-label="Search transcript"
            aria-pressed={searching}
            onClick={() => setSearching((value) => !value)}
          >
            <Icon name="search" />
          </button>
        </div>
      </div>
      {searching && (
        <div className="transcript-search">
          <Icon name="search" size={16} />
          <input
            autoFocus
            aria-label="Search transcript text"
            placeholder="Search transcript"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            className="icon-btn"
            aria-label="Close transcript search"
            onClick={() => {
              setQuery("")
              setSearching(false)
            }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      <MobileTimeline currentTime={currentTime} duration={duration} thumbnails={thumbnails} waveform={waveform} onSeek={onSeek} />
      <div className="mobile-only transcript-undo">
        <button onClick={onUndo}>
          <Icon name="undo" />
          Undo
        </button>
        <button onClick={onRedo}>
          <Icon name="redo" />
          Redo
        </button>
      </div>
      <div className="transcript-list">
        {visibleSentences.map((sentence) => (
          <button
            key={sentence.id}
            className={`${activeSentenceId === sentence.id || selectedSentenceId === sentence.id ? "active" : ""} ${
              proposal?.op?.type === "cut" && proposal.op.sentenceId === sentence.id ? "proposed-remove" : ""
            } ${sentence.wordIds.every((id) => project?.removedWordIds.includes(id)) ? "removed" : ""}`}
            onClick={() => onSelect(sentence.id)}
            onDoubleClick={() => onPropose(sentence.id)}
          >
            <time>{formatTime(sentence.startMs / 1000)}</time>
            <span>{sentence.text}</span>
            {proposal?.op?.type === "cut" && proposal.op.sentenceId === sentence.id && <em>(remove)</em>}
          </button>
        ))}
      </div>
      <button
        className="selection-action"
        disabled={!selectedSentenceId}
        onClick={() => selectedSentenceId && onPropose(selectedSentenceId)}
      >
        <Icon name="scissors" size={16} /> Propose removing selected sentence
      </button>
      <EditProposal
        proposal={proposal}
        state={proposalState}
        onPreview={onPreview}
        onApply={onApply}
        onDismiss={onDismiss}
      />
    </section>
  )
}

function Preset({
  name,
  active,
  onClick,
}: {
  name: CaptionStyle
  active: boolean
  onClick: () => void
}) {
  return (
    <button className={`preset ${active ? "active" : ""}`} onClick={onClick}>
      <span className={`sample-${name}`}>Your words</span>
      <b>{name[0].toUpperCase() + name.slice(1)}</b>
    </button>
  )
}

export function CaptionInspector({
  style,
  size,
  position,
  enabled,
  textColor,
  highlightColor,
  onEnabled,
  onStyle,
  onSize,
  onPosition,
  onTextColor,
  onHighlightColor,
}: {
  style: CaptionStyle
  size: number
  position: string
  enabled: boolean
  textColor: string
  highlightColor: string
  onEnabled: (enabled: boolean) => void
  onStyle: (style: CaptionStyle) => void
  onSize: (size: number) => void
  onPosition: (position: string) => void
  onTextColor: (color: string) => void
  onHighlightColor: (color: string) => void
}) {
  return (
    <section className="inspector settings-panel">
      <div className="inspector-header">
        <h2>Captions</h2>
        <label className="toggle-row compact">
          <span>Show captions</span>
          <input
            type="checkbox"
            checked={enabled}
            aria-label="Show captions"
            onChange={(event) => onEnabled(event.target.checked)}
          />
          <i />
        </label>
      </div>
      {enabled ? (
        <>
      <fieldset>
        <legend>Caption style</legend>
        <div className="preset-grid">
          {(["clean", "bold", "highlight"] as CaptionStyle[]).map((name) => (
            <Preset
              key={name}
              name={name}
              active={style === name}
              onClick={() => onStyle(name)}
            />
          ))}
        </div>
      </fieldset>
      <label className="range-row">
        <span>Size</span>
        <input
          type="range"
          min="22"
          max="42"
          value={size}
          onChange={(event) => onSize(Number(event.target.value))}
        />
        <output>{size}</output>
      </label>
      {/* One fieldset for both colour rows: two legends and two blocks of
          vertical margin were the main reason this panel needed to scroll. */}
      <fieldset>
        <legend>Colours</legend>
        <div className="colour-row">
          <span>Text</span>
          <div className="swatches">
            {["white", "slate", "black", "cream", "pink", "blue"].map(
              (color) => (
                <button
                  key={color}
                  className={`swatch ${color} ${textColor === color ? "selected" : ""}`}
                  aria-label={`${color} text`}
                  aria-pressed={textColor === color}
                  onClick={() => onTextColor(color)}
                />
              ),
            )}
          </div>
        </div>
        <div className="colour-row">
          <span>Highlight</span>
          <div className="swatches">
            {["mint", "yellow", "orange", "rose", "violet", "blue"].map(
              (color) => (
                <button
                  key={color}
                  className={`swatch ${color} ${highlightColor === color ? "selected" : ""}`}
                  aria-label={`${color} highlight`}
                  aria-pressed={highlightColor === color}
                  onClick={() => onHighlightColor(color)}
                />
              ),
            )}
          </div>
        </div>
      </fieldset>
      <fieldset className="tight">
        <legend>Position</legend>
        <div className="segmented three">
          {["Top", "Middle", "Bottom"].map((item) => (
            <button
              key={item}
              className={position === item ? "active" : ""}
              onClick={() => onPosition(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </fieldset>
        </>
      ) : (
        <p className="inspector-empty">Captions are hidden in the preview and the exported MP4.</p>
      )}
    </section>
  )
}

export function AudioInspector({
  volume,
  music,
  musicVolume,
  duckMusic,
  onVolume,
  onMusicFile,
  onRemoveMusic,
  onMusicVolume,
  onDuckMusic,
}: {
  volume: number
  music: string | null
  musicVolume: number
  duckMusic: boolean
  onVolume: (volume: number) => void
  onMusicFile: (file: File) => void
  onRemoveMusic: () => void
  onMusicVolume: (volume: number) => void
  onDuckMusic: (enabled: boolean) => void
}) {
  const musicInput = useRef<HTMLInputElement>(null)
  return (
    <section className="inspector settings-panel">
      <div className="inspector-header">
        <div>
          <h2>Audio</h2>
          <span>Balance speech and music</span>
        </div>
      </div>
      <label className="range-row">
        <span>Speech volume</span>
        <input
          type="range"
          min="0"
          max="100"
          value={volume}
          onChange={(event) => onVolume(Number(event.target.value))}
        />
        <output>{volume}%</output>
      </label>
      <input
        ref={musicInput}
        className="visually-hidden"
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
        onChange={(event) => event.target.files?.[0] && onMusicFile(event.target.files[0])}
      />
      {!music ? (
        <div className="empty-card">
          <span className="round-icon">
            <Icon name="music" />
          </span>
          <b>No background music</b>
          <p>Add a track to give your short more energy.</p>
          <button className="secondary" onClick={() => musicInput.current?.click()}>
            Add music
          </button>
        </div>
      ) : (
        <div className="music-card">
          <span className="round-icon">
            <Icon name="music" />
          </span>
          <div>
            <b>{music}</b>
            <span>Background music</span>
          </div>
          <button
            className="icon-btn"
            onClick={onRemoveMusic}
            aria-label="Remove music"
          >
            <Icon name="close" />
          </button>
        </div>
      )}
      {music && (
        <>
          <label className="range-row">
            <span>Music volume</span>
            <input
              type="range"
              min="0"
              max="100"
              value={musicVolume}
              onChange={(event) => onMusicVolume(Number(event.target.value))}
            />
            <output>{musicVolume}%</output>
          </label>
          <label className="toggle-row">
            <span>Duck music under speech</span>
            <input
              type="checkbox"
              checked={duckMusic}
              onChange={(event) => onDuckMusic(event.target.checked)}
            />
            <i />
          </label>
        </>
      )}
    </section>
  )
}

function MediaPanel({
  project,
  phase,
  activeClipId,
  clipFrames,
  onSelectClip,
  onRemoveClip,
  onTranscribe,
  onLoadDemo,
  onUpload,
}: {
  project: PresentedProject | null
  phase: ProjectPhase
  activeClipId: string | null
  clipFrames: Record<string, string[]>
  onSelectClip: (clipId: string) => void
  onRemoveClip: (clipId: string) => void
  onTranscribe: (clipId: string) => void
  onLoadDemo: () => void
  onUpload: (files: File[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const clips = project?.clips ?? []
  const busy = phase === "uploading" || phase === "transcribing"
  return (
    <section className="inspector settings-panel">
      <div className="inspector-header">
        <h2>Media</h2>
        {clips.length > 0 && <span>{clips.length} {clips.length === 1 ? "clip" : "clips"}</span>}
      </div>
      {clips.length > 0 ? (
        <div className="media-bin" aria-label="Project clips">
          {clips.map((clip, index) => {
            const transcribed = Boolean(clip.transcript)
            return (
              <div
                className={`media-file ${activeClipId === clip.id ? "active" : ""}`}
                key={clip.id}
              >
                <button
                  className="media-pick"
                  aria-label={`Select clip ${index + 1}, ${clip.media.filename}`}
                  aria-pressed={activeClipId === clip.id}
                  onClick={() => onSelectClip(clip.id)}
                >
                  <img src={clipFrames[clip.id]?.[0] ?? mediaImage} alt="" />
                  <span className="media-index">{index + 1}</span>
                </button>
                <div>
                  <b title={clip.media.filename}>{clip.media.filename}</b>
                  <span>{clip.media.width} × {clip.media.height} · {formatTime(clip.media.durationMs / 1000)}</span>
                  {transcribed ? (
                    <span className="clip-state ok">Transcribed</span>
                  ) : (
                    <button
                      className="clip-state action"
                      disabled={busy}
                      onClick={() => onTranscribe(clip.id)}
                    >
                      {phase === "transcribing" ? "Transcribing…" : "Transcribe this clip"}
                    </button>
                  )}
                </div>
                <button
                  className="media-remove"
                  aria-label={`Remove clip ${index + 1}`}
                  disabled={clips.length === 1}
                  title={clips.length === 1 ? "A project needs at least one clip" : "Remove clip"}
                  onClick={() => onRemoveClip(clip.id)}
                >
                  <Icon name="close" size={15} />
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="empty-card">
          <span className="round-icon">
            <Icon name="upload" />
          </span>
          <b>
            {phase === "empty"
              ? "Add your first clip"
              : phase === "uploading"
                ? "Uploading clip…"
                : "Creating transcript…"}
          </b>
          <p>
            {phase === "empty"
              ? "Choose one or more videos to begin editing."
              : "Preparing transcript"}
          </p>
        </div>
      )}
      {/* The demo fixture ships with a prepared transcript, so it is the only
          way to try the voice tools without paying for a transcription first.
          The endpoint existed but nothing could reach it. */}
      {clips.length === 0 && (
        <button
          className="ghost full demo-load"
          disabled={busy}
          onClick={onLoadDemo}
        >
          <Icon name="play" size={15} />
          Load the demo project
        </button>
      )}
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept="video/*"
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          if (files.length) onUpload(files)
          event.currentTarget.value = ""
        }}
      />
      <button
        className="secondary full"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        <Icon name="upload" size={17} />
        {clips.length > 0 ? "Add more clips" : "Select local video"}
      </button>
      <p className="helper">
        MP4, MOV, WEBM or MKV. Select several at once to build a sequence. 200 MB each, 2 minutes in total.
      </p>
    </section>
  )
}

export function FramingControls({
  ratio,
  onRatio,
  focus,
  onFocus,
  guides,
  onGuides,
}: {
  ratio: string
  onRatio: (ratio: string) => void
  focus: number
  onFocus: (focus: number) => void
  guides: boolean
  onGuides: (value: boolean) => void
}) {
  const [draftFocus, setDraftFocus] = useState(focus)
  useEffect(() => setDraftFocus(focus), [focus])
  return (
    <section className="inspector settings-panel">
      <div className="inspector-header">
        <h2>Framing</h2>
      </div>
      <fieldset>
        <legend>Aspect ratio</legend>
        <div className="ratio-grid">
          {["Original", "16:9", "1:1", "9:16"].map((item) => (
            <button
              className={ratio === item ? "active" : ""}
              onClick={() => onRatio(item)}
              key={item}
            >
              <span
                className={`ratio-shape shape-${item.replace(":", "-").toLowerCase()}`}
              />
              <b>{item}</b>
            </button>
          ))}
        </div>
      </fieldset>
      <label className="range-row">
        <span>Crop position</span>
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round(draftFocus * 100)}
          onChange={(event) => setDraftFocus(Number(event.target.value) / 100)}
          onPointerUp={() => onFocus(draftFocus)}
          onKeyUp={() => onFocus(draftFocus)}
        />
        <output>{draftFocus < .35 ? "Left" : draftFocus > .65 ? "Right" : "Center"}</output>
      </label>
      <label className="toggle-row">
        <span>Show safe-area guides</span>
        <input
          type="checkbox"
          checked={guides}
          onChange={(event) => onGuides(event.target.checked)}
        />
        <i />
      </label>
    </section>
  )
}

export function HistoryPanel({
  project,
  onUndo,
  onRedo,
}: {
  project: PresentedProject | null
  onUndo: () => void
  onRedo: () => void
}) {
  return (
    <section className="inspector settings-panel">
      <div className="inspector-header">
        <div>
          <h2>History</h2>
          <span>{project?.edit.history.length ?? 0} edits in this version</span>
        </div>
      </div>
      <div className="history-actions">
        <button onClick={onUndo} disabled={!project?.undo.length}>
          <Icon name="undo" />
          Undo
        </button>
        <button onClick={onRedo} disabled={!project?.redo.length}>
          <Icon name="redo" />
          Redo
        </button>
      </div>
      <div className="history-list">
        {[...(project?.edit.history ?? [])].reverse().map((entry, index) => (
          <article className={index === 0 ? "current" : ""} key={entry.id}>
            <i />
            <div>
              <b>{entry.summary}</b>
              <span>{index === 0 ? "Current" : entry.kind}</span>
            </div>
          </article>
        ))}
        {!project?.edit.history.length && (
          <article className="current">
            <i />
            <div>
              <b>Project created</b>
              <span>Current</span>
            </div>
          </article>
        )}
      </div>
    </section>
  )
}

export function Timeline({
  project,
  clipFrames,
  waveform,
  currentTime,
  zoom,
  captionsOn,
  onSeek,
  onZoom,
}: {
  project: PresentedProject | null
  /** Generated frames per clip id, so each segment shows its own footage. */
  clipFrames: Record<string, string[]>
  waveform: number[]
  currentTime: number
  zoom: number
  captionsOn: boolean
  onSeek: (time: number) => void
  onZoom: (zoom: number) => void
}) {
  const duration = (project?.outputDurationMs ?? 0) / 1000
  const ticks = [0, .25, .5, .75, 1]
  return (
    <section className="timeline">
      <div className="timeline-toolbar">
        <b>
          <Icon name="document" size={17} />
          Timeline
        </b>
        <label>
          <span className="desktop-only">Zoom</span>
          <input
            aria-label="Timeline zoom"
            type="range"
            min="1"
            max="2.5"
            step=".1"
            value={zoom}
            onChange={(event) => onZoom(Number(event.target.value))}
          />
        </label>
        <span className="timeline-meta">
          {formatTime(duration)} duration&nbsp;&nbsp;|&nbsp;&nbsp;{project?.edit.history.length ?? 0} edits
        </span>
      </div>
      <div className="timeline-scroll">
        <div
          className="timeline-content"
          style={{ "--timeline-zoom": zoom } as React.CSSProperties}
        >
          <div className="ruler">
            {ticks.map((tick) => (
              <span key={tick} style={{ left: `${tick * 100}%` }}>
                {formatTime(duration * tick)}
              </span>
            ))}
          </div>
          <button
            className="timeline-seek"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              onSeek(((event.clientX - rect.left) / rect.width) * duration)
            }}
            aria-label="Seek timeline"
          />
          <div
            className="playhead"
            style={{ left: `calc(112px + (100% - 112px) * ${duration > 0 ? Math.min(1, currentTime / duration) : 0})` }}
          >
            <span>{formatTime(currentTime)}</span>
          </div>
          <div className="track video-track">
            <label>
              <Icon name="document" size={17} />
              Video
            </label>
            <div className="clip-lane">
              {(project?.segments ?? []).map((segment) => (
                <div
                  className="clip selected"
                  key={segment.id}
                  style={{
                    left: `${duration > 0 ? (segment.outputStartMs / 1000 / duration) * 100 : 0}%`,
                    width: `${duration > 0 ? ((segment.outputEndMs - segment.outputStartMs) / 1000 / duration) * 100 : 0}%`,
                  }}
                >
                  {((clipFrames[segment.clipId] ?? [])).map((thumbnail, index) => (
                    <img key={index} src={thumbnail} alt="" />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className={`track caption-track ${captionsOn ? "" : "muted"}`}>
            <label>
              <Icon name="captions" size={17} />
              Captions
            </label>
            <div className="caption-clips">
              {captionsOn
                ? (project?.cues ?? []).map((cue) => (
                    <span key={cue.id} title={cue.text}>{cue.text}</span>
                  ))
                : <span className="track-off">Captions off</span>}
            </div>
          </div>
          <div className="track audio-track">
            <label>
              <Icon name="wave" size={17} />
              Audio
            </label>
            <div className="waveform">
              {(waveform.length ? waveform : Array.from({ length: 120 }, () => 0.18)).map((peak, n) => (
                <i key={n} style={{ height: `${Math.max(12, peak * 100)}%` }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export function ExportDialog({
  state,
  progress,
  error,
  downloadUrl,
  captionsOn,
  onBegin,
  onClose,
}: {
  state: ExportState
  progress: number
  error: string | null
  downloadUrl: string | null
  captionsOn: boolean
  onBegin: () => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  // Move focus into the dialog when it opens so keyboard users are not left
  // tabbing around the editor behind it.
  useEffect(() => {
    const first = dialogRef.current?.querySelector<HTMLElement>("button, a[href], input, select")
    first?.focus()
  }, [])
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        ref={dialogRef}
        // aria-modal alone is a claim, not a behaviour: without this, Tab walked
        // through the whole editor behind the dialog.
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onClose()
            return
          }
          if (event.key !== "Tab") return
          const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input, select, [tabindex]:not([tabindex="-1"])',
          )
          if (!focusable || focusable.length === 0) return
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          }
        }}
      >
        <button
          className="modal-close icon-btn"
          onClick={onClose}
          aria-label="Close export"
        >
          <Icon name="close" />
        </button>
        {state === "options" && (
          <>
            <span className="modal-icon">
              <Icon name="upload" />
            </span>
            <h2 id="export-title">Export your video</h2>
            <p>
              Export your edited video as an MP4.
              {captionsOn
                ? " Captions are burned in."
                : " Captions are off, so none are burned in."}
            </p>
            <button className="primary full" onClick={onBegin}>
              Export MP4
            </button>
          </>
        )}
        {state === "processing" && (
          <div className="center-state">
            <span className="spinner" />
            <h2 id="export-title">Rendering your video</h2>
            <p>Applying captions and edits…</p>
            <div className="progress">
              <i style={{ width: `${Math.max(2, progress * 100)}%` }} />
            </div>
            <span>{Math.round(progress * 100)}%</span>
          </div>
        )}
        {state === "complete" && (
          <div className="center-state">
            <span className="modal-icon success">
              <Icon name="check" />
            </span>
            <h2 id="export-title">Export complete</h2>
            <p>
              Your edited MP4 is ready to download.
            </p>
            <a className="primary full" href={downloadUrl || "#"} download="cutback.mp4">
              Download MP4
            </a>
          </div>
        )}
        {state === "error" && (
          <div className="center-state">
            <span className="modal-icon error">
              <Icon name="alert" />
            </span>
            <h2 id="export-title">Export could not finish</h2>
            <p>{error || "Export failed. Your edits are safe."}</p>
            <button className="primary full" onClick={onBegin}>
              Retry export
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

function MoreSheet({
  onTool,
  onClose,
}: {
  onTool: (tool: Tool) => void
  onClose: () => void
}) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="more-sheet" onClick={(event) => event.stopPropagation()}>
        <i className="sheet-handle" />
        <h2>More tools</h2>
        {[
          ["Media", "media", "folder"],
          ["Framing", "framing", "crop"],
          ["History", "history", "history"],
        ].map(([label, tool, icon]) => (
          <button
            key={label}
            onClick={() => {
              onTool(tool as Tool)
              onClose()
            }}
          >
            <Icon name={icon} />
            <span>{label}</span>
            <Icon name="back" />
          </button>
        ))}
      </div>
    </div>
  )
}

function mapVoiceState(phase: VoicePhase, detail?: string): VoiceState {
  if (phase === "connecting") return "Connecting"
  if (phase === "listening" || phase === "user") return "Listening"
  if (phase === "thinking") return "Thinking"
  if (phase === "editing") return "Applying edit"
  if (phase === "speaking") return "Speaking"
  if (phase === "error")
    return detail?.toLowerCase().includes("permission") ? "Permission error" : "Connection error"
  return "Disconnected"
}

function waitForMedia(video: HTMLVideoElement, event: "loadeddata" | "seeked") {
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      cleanup()
      resolve()
    }
    const failed = () => {
      cleanup()
      reject(new Error("Could not read preview frames."))
    }
    const cleanup = () => {
      video.removeEventListener(event, done)
      video.removeEventListener("error", failed)
    }
    video.addEventListener(event, done, { once: true })
    video.addEventListener("error", failed, { once: true })
  })
}

async function createThumbnails(src: string, durationSeconds: number): Promise<string[]> {
  if (!src || durationSeconds <= 0) return []
  const video = document.createElement("video")
  video.crossOrigin = "anonymous"
  video.muted = true
  video.preload = "auto"
  video.src = src
  await waitForMedia(video, "loadeddata")
  const canvas = document.createElement("canvas")
  canvas.width = 240
  canvas.height = 135
  const context = canvas.getContext("2d")
  if (!context) return []
  const frames: string[] = []
  for (let index = 0; index < 6; index += 1) {
    video.currentTime = Math.min(durationSeconds - 0.05, Math.max(0, durationSeconds * ((index + .5) / 6)))
    await waitForMedia(video, "seeked")
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    frames.push(canvas.toDataURL("image/jpeg", .72))
  }
  video.removeAttribute("src")
  video.load()
  return frames
}

/**
 * The server rejects every API call without x-cutback-token once
 * CUTBACK_ACCESS_TOKEN is set, and nothing in the client could ever supply one,
 * so such a deployment was unusable with no way to recover.
 */
function AccessTokenGate({ onSave }: { onSave: (token: string) => void }) {
  const [value, setValue] = useState("")
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="token-title">
        <h2 id="token-title">This server needs an access token</h2>
        <p>
          The server is running with <code>CUTBACK_ACCESS_TOKEN</code> set, so requests
          must send <code>x-cutback-token</code>. Paste the value to continue.
        </p>
        <label className="token-field">
          Access token
          <input
            type="password"
            value={value}
            autoFocus
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && value.trim()) onSave(value.trim())
            }}
          />
        </label>
        <button className="primary full" disabled={!value.trim()} onClick={() => onSave(value.trim())}>
          Continue
        </button>
      </section>
    </div>
  )
}

export function EditorShell() {
  const [health, setHealth] = useState<Health | null>(null)
  const [project, setProject] = useState<PresentedProject | null>(null)
  const [title, setTitle] = useState("Untitled project")
  const [statusTone, setStatusTone] = useState<"ok" | "busy" | "error">("ok")
  const [saveStatus, setSaveStatus] = useState("Loading…")
  const [activeTool, setActiveTool] = useState<Tool>("transcript")
  const [mobileTab, setMobileTab] = useState<"edit" | "captions" | "audio">("edit")
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [selectedSentenceId, setSelectedSentenceId] = useState<string | null>(null)
  const [proposalBusy, setProposalBusy] = useState(false)
  const [guides, setGuides] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportState, setExportState] = useState<ExportState>("options")
  const [exportError, setExportError] = useState<string | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [previewMode, setPreviewMode] = useState<"original" | "edited">("edited")
  const [uploading, setUploading] = useState(false)
  const [voice, setVoice] = useState<VoiceState>("Disconnected")
  const [voiceDetail, setVoiceDetail] = useState<string | null>(null)
  const [voiceLevel, setVoiceLevel] = useState(0)
  const [voiceLines, setVoiceLines] = useState<Array<{ who: "user" | "agent"; text: string }>>([])
  const [clipFrames, setClipFrames] = useState<Record<string, string[]>>({})
  const [activeClipId, setActiveClipId] = useState<string | null>(null)
  const [waveform, setWaveform] = useState<number[]>([])
  const [needsToken, setNeedsToken] = useState(false)
  const [pushToTalk, setPushToTalk] = useState(false)

  const projectRef = useRef<PresentedProject | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const musicRef = useRef<HTMLAudioElement | null>(null)
  const voiceRef = useRef<VoiceSession | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const statusTimerRef = useRef<number | null>(null)
  /** Clip-local time to apply once a newly loaded clip is ready. */
  const pendingSeekRef = useRef<number | null>(null)
  /** The output segment the preview is currently inside, for playback stepping. */
  const segmentRef = useRef<string | null>(null)
  /** Whether playback should resume after a clip switch. */
  const pendingPlayRef = useRef(false)

  // The tone lets the header indicator show whether the app is settled, working
  // or broken, instead of always reading "Saved" regardless of what happened.
  const setStatus = useCallback((message: string, restore = true, tone?: "ok" | "busy" | "error") => {
    if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current)
    setSaveStatus(message)
    setStatusTone(tone ?? (restore ? "ok" : "error"))
    if (restore) {
      statusTimerRef.current = window.setTimeout(() => {
        setSaveStatus("Saved")
        setStatusTone("ok")
      }, 4200)
    }
  }, [])

  const remember = useCallback((next: PresentedProject) => {
    // Rebuilding the system prompt re-sends every sentence over the socket, so
    // only do it when the project actually changed. The poll runs every 850ms
    // and was re-sending a full transcript about once a second.
    const previous = projectRef.current
    projectRef.current = next
    setProject(next)
    setTitle(next.title)
    localStorage.setItem(PROJECT_KEY, next.id)
    if (!previous || previous.revision !== next.revision || previous.transcript !== next.transcript) {
      voiceRef.current?.refreshPrompt(next)
    }
  }, [])

  useEffect(() => {
    let alive = true
    const existing = localStorage.getItem(PROJECT_KEY)
    void Promise.all([
      api.health(),
      existing ? api.get(existing).catch(() => null) : Promise.resolve(null),
    ])
      .then(([nextHealth, restored]) => {
        if (!alive) return
        setHealth(nextHealth)
        // The server tells us up front whether it is gated, so we can ask for
        // the token instead of failing every request with a bare 401.
        if (nextHealth.accessTokenRequired && !api.hasToken()) setNeedsToken(true)
        if (restored) remember(restored)
        else if (existing) localStorage.removeItem(PROJECT_KEY)
        setSaveStatus("Saved")
      })
      .catch((error: Error) => {
        if (alive) setStatus(error.message || "Backend unavailable", false)
      })
    return () => {
      alive = false
    }
  }, [remember, setStatus])

  useEffect(() => {
    projectRef.current = project
  }, [project])

  useEffect(() => {
    if (!project?.id || title.trim() === project.title || !title.trim()) return
    setSaveStatus("Saving…")
    const timer = window.setTimeout(() => {
      void api.rename(project.id, title.trim())
        .then((next) => {
          remember(next)
          setStatus("Saved")
        })
        .catch((error: Error) => setStatus(error.message, false))
    }, 650)
    return () => window.clearTimeout(timer)
  }, [project?.id, project?.title, remember, setStatus, title])

  useEffect(() => {
    const shouldPoll =
      project?.jobs.transcription.status === "running" ||
      project?.jobs.export.status === "running" ||
      exportState === "processing"
    if (!project?.id || !shouldPoll) return
    let failures = 0
    const timer = window.setInterval(() => {
      void api.get(project.id)
        .then((next) => {
          failures = 0
          remember(next)
        })
        .catch((error: Error) => {
          // Swallowing this left the export spinner running forever whenever the
          // server went away mid-render, with nothing to tell the creator.
          failures += 1
          if (failures === 3) {
            setExportState("error")
            setExportError(`Lost contact with the server: ${error.message}`)
            setStatus("Lost contact with the server.", false)
          }
        })
    }, 850)
    return () => window.clearInterval(timer)
  }, [exportState, project?.id, project?.jobs.export.status, project?.jobs.transcription.status, remember, setStatus])

  // Reflect real background work in the header indicator, so "Saved" never sits
  // there while a transcription or a render is still going.
  useEffect(() => {
    const transcribing = project?.jobs.transcription.status === "running"
    const exporting = project?.jobs.export.status === "running" || exportState === "processing"
    if (exporting) setStatus("Exporting…", true, "busy")
    else if (transcribing) setStatus("Transcribing…", true, "busy")
  }, [
    project?.jobs.transcription.status,
    project?.jobs.export.status,
    project?.jobs.export.progress,
    exportState,
    setStatus,
  ])

  useEffect(() => {
    if (project?.jobs.transcription.status === "completed") {
      setSaveStatus("Saved")
      setStatusTone("ok")
    }
    if (project?.jobs.transcription.status === "error")
      setStatus(project.jobs.transcription.error || "Transcription failed.", false, "error")
  }, [project?.jobs.transcription.error, project?.jobs.transcription.status, setStatus])

  // The preview can only play one file at a time, so it follows whichever clip
  // the playhead currently sits in. Thumbnails and waveform are gathered per
  // clip and laid end to end to match the flattened timeline.
  const clips = project?.clips ?? []
  const activeClip = clips.find((clip) => clip.id === activeClipId) ?? clips[0] ?? null
  // Cache-bust on the clip's own identity, not the project's updatedAt. Every
  // tool call and every playback ping touches updatedAt, so keying on it made
  // each caption tweak re-download the video, reset the playhead to zero, and
  // regenerate every thumbnail with a fresh ffmpeg waveform pass.
  const mediaVersion = activeClip ? `${activeClip.media.storedName}-${activeClip.media.bytes}` : "";
  const mediaSrc = activeClip
    ? `/api/projects/${project!.id}/media?clip=${encodeURIComponent(activeClip.id)}&v=${encodeURIComponent(mediaVersion)}`
    : null
  const musicSrc = project?.music ? "/api/projects/" + project.id + "/music?v=" + encodeURIComponent(project.updatedAt) : null
  // Flat view of every clip's frames, for the strips that span the whole timeline.
  const allFrames = useMemo(() => Object.values(clipFrames).flat(), [clipFrames])

  useEffect(() => {
    if (!project) {
      setClipFrames({})
      setWaveform([])
      return
    }
    let alive = true
    void Promise.all(
      clips.map(async (clip) => {
        const src = `/api/projects/${project.id}/media?clip=${encodeURIComponent(clip.id)}&v=${encodeURIComponent(`${clip.media.storedName}-${clip.media.bytes}`)}`
        const [frames, wave] = await Promise.all([
          createThumbnails(src, clip.media.durationMs / 1000).catch(() => []),
          api.waveform(project.id, clip.id).then((result) => result.peaks).catch(() => []),
        ])
        return { clip, frames, wave }
      }),
    ).then((parts) => {
      if (!alive) return
      // Frames stay keyed by clip so the media bin and each timeline segment can
      // show their own footage instead of every clip's frames everywhere.
      setClipFrames(Object.fromEntries(parts.map((part) => [part.clip.id, part.frames])))
      // Each clip reports a fixed 120 peaks, so repeat it by its time share.
      setWaveform(
        parts.flatMap((part) => {
          const share = part.clip.media.durationMs;
          if (share <= 0) return [];
          const repeats = Math.max(1, Math.round(120 * share / (project.sourceDurationMs || share)));
          return Array.from({ length: repeats }, () => part.wave).flat();
        }),
      )
    })
    return () => {
      alive = false
    }
    // Keyed on the clips themselves, so an edit does not re-run six video seeks
    // and an ffmpeg loudness pass per clip.
  }, [project?.id, clips.map((clip) => `${clip.id}:${clip.media.bytes}`).join("|")])

  useEffect(() => {
    const video = videoRef.current
    if (video && project) video.volume = Math.max(0, Math.min(1, project.edit.audio.speechVolume))
  }, [project?.edit.audio.speechVolume])

  useEffect(() => {
    return () => {
      voiceRef.current?.end()
      if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current)
    }
  }, [])

  // Push to talk: with it on, the agent only hears audio while the creator is
  // actually holding, so it cannot pick up the video as an instruction.
  useEffect(() => {
    voiceRef.current?.setPushToTalk(pushToTalk)
  }, [pushToTalk])

  useEffect(() => {
    if (!pushToTalk) return
    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null
      return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable))
    }
    const down = (event: KeyboardEvent) => {
      if (event.key !== "v" && event.key !== "V") return
      if (event.repeat || isTyping(event.target)) return
      event.preventDefault()
      voiceRef.current?.setHeld(true)
    }
    const up = (event: KeyboardEvent) => {
      if (event.key !== "v" && event.key !== "V") return
      voiceRef.current?.setHeld(false)
    }
    // Losing focus mid-hold would otherwise leave the microphone open.
    const blur = () => voiceRef.current?.setHeld(false)
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    window.addEventListener("blur", blur)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
      window.removeEventListener("blur", blur)
    }
  }, [pushToTalk])

  const phase: ProjectPhase = uploading
    ? "uploading"
    : clips.length === 0
      ? "empty"
      : project?.jobs.transcription.status === "running"
        ? "transcribing"
        : "ready"

  const selectedWordIds = useMemo(
    () => project?.transcript?.sentences.find((sentence) => sentence.id === selectedSentenceId)?.wordIds ?? [],
    [project?.transcript?.sentences, selectedSentenceId],
  )

  const activeSourceMs = useMemo(() => {
    const current = project
    if (!current) return 0
    if (previewMode === "original") return currentTime * 1000
    const segment = current.segments.find(
      (item) => currentTime * 1000 >= item.outputStartMs && currentTime * 1000 <= item.outputEndMs,
    )
    return segment ? segment.sourceStartMs + currentTime * 1000 - segment.outputStartMs : 0
  }, [currentTime, previewMode, project])

  const activeSentenceId =
    project?.transcript?.sentences.find(
      (sentence) => activeSourceMs >= sentence.startMs && activeSourceMs <= sentence.endMs,
    )?.id ?? null

  const handleVideoReady = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video
    // A clip switch reloads the element, so replay the seek it interrupted.
    // Defined below, so this only records the element here.
  }, [])

  const seek = useCallback((seconds: number, mode?: "original" | "edited") => {
    const current = projectRef.current
    const video = videoRef.current
    if (!current || !video) return
    // An explicit mode wins, so switching Before/After does not run the seek with
    // the mode that was active a moment ago.
    const which = mode ?? previewMode
    // Reattach the playback anchor to wherever we are jumping to.
    segmentRef.current = null
    const clips = current.clips ?? []
    if (which === "original") {
      // "Before" is the unedited source, which is every clip end to end, so a
      // global source time still has to resolve to the clip holding it.
      const sourceMs = Math.max(0, Math.min(current.sourceDurationMs, seconds * 1000))
      const clip = clips.find((item) => sourceMs >= item.offsetMs && sourceMs < item.offsetMs + item.media.durationMs)
        ?? clips[clips.length - 1]
      if (!clip) return
      const localMs = Math.max(0, Math.min(clip.media.durationMs, sourceMs - clip.offsetMs))
      if (clip.id !== activeClipId) {
        pendingSeekRef.current = localMs
        setActiveClipId(clip.id)
        setCurrentTime(sourceMs / 1000)
        return
      }
      video.currentTime = localMs / 1000
      setCurrentTime(sourceMs / 1000)
      return
    }
    const target = Math.max(0, Math.min(current.outputDurationMs, seconds * 1000))
    const segment =
      current.segments.find((item) => target >= item.outputStartMs && target <= item.outputEndMs) ??
      current.segments[current.segments.length - 1]
    if (!segment) return
    // The playhead may sit in a different clip than the one loaded. Switch first,
    // then apply the position once that clip's metadata arrives.
    if (segment.clipId && segment.clipId !== activeClipId) {
      pendingSeekRef.current = segment.clipStartMs + Math.max(0, target - segment.outputStartMs)
      pendingPlayRef.current = playing
      segmentRef.current = segment.id
      setActiveClipId(segment.clipId)
      setCurrentTime(target / 1000)
      return
    }
    const localMs = segment.clipId
      ? segment.clipStartMs + Math.max(0, target - segment.outputStartMs)
      : segment.sourceStartMs + Math.max(0, target - segment.outputStartMs)
    video.currentTime = localMs / 1000
    segmentRef.current = segment.id
    setCurrentTime(target / 1000)
  }, [previewMode, activeClipId, playing])

  /** Map the loaded clip's local time back onto the output timeline. */
  const localToOutputMs = useCallback((localMs: number, clipId: string | null) => {
    const current = projectRef.current
    if (!current) return null
    if (previewMode === "original") {
      const clip = (current.clips ?? []).find((item) => item.id === clipId)
      return clip ? clip.offsetMs + localMs : null
    }
    const segment = current.segments.find(
      (item) => (!clipId || item.clipId === clipId || !item.clipId) &&
        localMs >= item.clipStartMs && localMs <= item.clipEndMs,
    )
    if (!segment) return null
    return segment.outputStartMs + Math.max(0, localMs - segment.clipStartMs)
  }, [previewMode])

  const selectClip = useCallback((clipId: string) => {
    const current = projectRef.current
    if (!current) return
    setActiveClipId(clipId)
    const clip = (current.clips ?? []).find((item) => item.id === clipId)
    if (!clip) return
    // Park the playhead at the head of the chosen clip.
    if (previewMode === "original") {
      seek(clip.offsetMs / 1000, "original")
      return
    }
    // In edited mode the playhead is an output time, so a clip's source offset
    // is the wrong thing to seek to. A clip that has been cut away entirely has
    // no output position at all, so fall back to the start of the timeline.
    const segment = current.segments.find((item) => item.clipId === clipId)
    seek((segment ? segment.outputStartMs : 0) / 1000, "edited")
  }, [previewMode, seek])

  const handleVideoTimeUpdate = useCallback((video: HTMLVideoElement) => {
    const current = projectRef.current
    if (!current) return
    const localMs = video.currentTime * 1000
    if (previewMode === "original") {
      const clips = current.clips ?? []
      const clip = clips.find((item) => item.id === activeClipId) ?? clips[0]
      if (!clip) return
      // Roll into the next clip when this one runs out during playback.
      if (!video.paused && localMs >= clip.media.durationMs - 40) {
        const index = clips.indexOf(clip);
        const next = clips[index + 1]
        if (next) {
          pendingSeekRef.current = 0
          pendingPlayRef.current = true
          setActiveClipId(next.id)
          setCurrentTime(next.offsetMs / 1000)
          return
        }
        video.pause()
        setPlaying(false)
      }
      setCurrentTime((clip.offsetMs + localMs) / 1000)
      setPlaying(!video.paused)
      return
    }
    // Output order is the source of truth. Anchoring on the clip's own time and
    // looking for "the next segment after this one in the file" broke as soon as
    // a section was reordered, and it handed over to the last segment rather
    // than the next one when there was a cut between them.
    const segments = current.segments;
    if (segments.length === 0) {
      video.pause()
      setPlaying(false)
      return
    }
    let index = segmentRef.current ? segments.findIndex((item) => item.id === segmentRef.current) : -1
    if (index < 0) {
      // No anchor, so reattach from where the element actually is.
      index = segments.findIndex(
        (item) => (!item.clipId || item.clipId === activeClipId) &&
          localMs >= item.clipStartMs && localMs <= item.clipEndMs,
      )
      if (index < 0) {
        index = segments.findIndex(
          (item) => (!item.clipId || item.clipId === activeClipId) && item.clipStartMs > localMs,
        )
      }
      if (index < 0) {
        video.pause()
        setPlaying(false)
        return
      }
    }
    // Step forward or backward through the sequence, never by source position.
    while (index < segments.length - 1 && localMs > segments[index].clipEndMs + 60) index += 1
    while (index > 0 && localMs < segments[index].clipStartMs - 60) index -= 1
    const segment = segments[index]
    segmentRef.current = segment.id

    if (segment.clipId && segment.clipId !== activeClipId) {
      // A different clip takes over: load it, land on the right frame, carry on.
      pendingSeekRef.current = segment.clipStartMs
      pendingPlayRef.current = !video.paused
      setActiveClipId(segment.clipId)
      setCurrentTime(segment.outputStartMs / 1000)
      return
    }
    if (localMs < segment.clipStartMs - 40 || localMs > segment.clipEndMs + 40) {
      video.currentTime = segment.clipStartMs / 1000
    }
    const outputMs = segment.outputStartMs + Math.max(0, localMs - segment.clipStartMs)
    setCurrentTime(outputMs / 1000)
    setPlaying(!video.paused)

    const music = musicRef.current
    if (music && current.music) {
      // Duck while a word is actually being spoken. The old test asked whether
      // the segment contained any word at all, which is almost always true, so
      // the music stayed ducked for whole segments and the preview audibly
      // disagreed with the sidechaincompress in the export.
      const sourceMs = segment.sourceStartMs + Math.max(0, localMs - segment.clipStartMs)
      const speechActive = current.transcript?.words.some(
        (word) => sourceMs >= word.startMs && sourceMs <= word.endMs,
      ) ?? false
      music.volume = Math.max(
        0,
        Math.min(1, current.edit.audio.musicVolume * (current.edit.audio.duckMusic && speechActive ? .42 : 1)),
      )
      if (Math.abs(music.currentTime - outputMs / 1000) > .35)
        music.currentTime = (outputMs / 1000) % Math.max(1, music.duration || outputMs / 1000 + 1)
      if (!video.paused && music.paused) void music.play().catch(() => undefined)
      if (video.paused && !music.paused) music.pause()
    }
  }, [previewMode])

  const postContext = useCallback(async () => {
    const current = projectRef.current
    if (!current) return
    await api.playback(current.id, {
      // Must be a source time: the target resolver compares this against
      // sentence source bounds. The output time of the edited timeline is a
      // different value once anything has been cut, and feeding that here made
      // "remove that" land on the wrong sentence.
      sourceTimeMs: activeSourceMs,
      outputTimeMs: currentTime * 1000,
      selectedWordIds,
      capturedAt: new Date().toISOString(),
      reason: "selection",
    })
  }, [currentTime, selectedWordIds, activeClipId, localToOutputMs, activeSourceMs])

  const runTool = useCallback(async (name: string, args: Record<string, unknown>) => {
    const current = projectRef.current
    if (!current) return null
    setStatus("Saving…", false)
    try {
      if (!["undo_edit", "redo_edit", "read_project_context", "dismiss_proposal"].includes(name))
        await postContext()
      const response = await api.tool(current.id, name, args, crypto.randomUUID())
      remember(response.project)
      const target = response.result.seek_output_ms
      if (typeof target === "number") seek(target / 1000)
      const message =
        typeof response.result.summary === "string"
          ? response.result.summary
          : typeof response.result.message === "string"
            ? response.result.message
            : "Saved"
      setStatus(message)
      return response
    } catch (error) {
      const message = error instanceof Error ? error.message : "The edit failed."
      setStatus(message, false)
      return null
    }
  }, [postContext, remember, seek, setStatus])

  const upload = useCallback(async (files: File[]) => {
    if (files.length === 0) return
    setUploading(true)
    setStatus(files.length > 1 ? `Uploading ${files.length} clips…` : "Uploading…", false)
    voiceRef.current?.end()
    voiceRef.current = null
    setVoice("Disconnected")
    try {
      const first = files[0]
      const current = projectRef.current ?? await api.create(first.name.replace(/\.[^.]+$/, ""))
      if (!projectRef.current) remember(current)
      // Every selected file becomes a clip, appended in the order chosen.
      let latest = current
      for (const [index, file] of files.entries()) {
        setStatus(files.length > 1 ? `Uploading clip ${index + 1} of ${files.length}…` : "Uploading…", false)
        latest = await api.upload(latest.id, file)
        remember(latest)
      }
      setSelectedSentenceId(null)
      setCurrentTime(0)
      setPlaying(false)
      // No client-side pre-flight check on the API key. `health` loads in a
      // background effect, so testing it here reported a missing key whenever
      // it had not resolved yet, and the upload had already succeeded by then.
      // The server returns a clear message when the key really is absent.
      setStatus(files.length > 1 ? "Transcribing clips…" : "Transcribing…", false)
      const transcribing = await api.transcribe(latest.id)
      remember(transcribing)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Upload failed.", false)
    } finally {
      setUploading(false)
    }
  }, [remember, setStatus])

  const uploadFiles = useCallback((files: File[]) => {
    void upload(files)
  }, [upload])

  /**
   * Transcription is the gateway to every edit, so a clip that has no words is
   * stuck until someone asks for it again. This is the only way back once an
   * upload or an earlier transcription did not finish.
   */
  const loadDemo = useCallback(async () => {
    setStatus("Loading the demo…", false, "busy")
    try {
      const next = await api.demo()
      remember(next)
      setActiveClipId(next.clips[0]?.id ?? null)
      setSelectedSentenceId(null)
      setCurrentTime(0)
      setPlaying(false)
      setStatus("Demo loaded. Try: “remove the long pauses”.")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load the demo.", false, "error")
    }
  }, [remember, setStatus])

  const transcribe = useCallback(async (clipId?: string) => {
    const current = projectRef.current
    if (!current) return
    setStatus("Transcribing…", false)
    try {
      const next = await api.transcribe(current.id, clipId)
      remember(next)
      setStatus("Transcription started.", false)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Transcription failed.", false)
    }
  }, [remember, setStatus])

  const removeClip = useCallback(async (clipId: string) => {
    const current = projectRef.current
    if (!current) return
    setStatus("Removing clip…", false)
    try {
      const next = await api.removeClip(current.id, clipId)
      remember(next)
      setActiveClipId((active) => (active === clipId ? next.clips[0]?.id ?? null : active))
      setStatus("Clip removed.", false)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not remove that clip.", false)
    }
  }, [remember, setStatus])

  const selectSentence = useCallback((id: string) => {
    const current = projectRef.current
    const sentence = current?.transcript?.sentences.find((item) => item.id === id)
    if (!current || !sentence) return
    setSelectedSentenceId(id)
    const mapped = sourceToOutput(current.segments, sentence.startMs)
    if (mapped === null) {
      setPreviewMode("original")
      window.setTimeout(() => seek(sentence.startMs / 1000), 0)
    } else {
      seek(mapped / 1000)
    }
  }, [seek])

  const pendingProposal =
    [...(project?.proposals ?? [])].reverse().find((item) => item.status === "pending") ?? null

  const proposeSentence = useCallback(async (id: string) => {
    setProposalBusy(true)
    // "sentence", not "sentence_id": the resolver matches on the former and
    // silently falls back to the playhead for anything it does not recognise.
    await runTool("propose_cut", { action: "remove", use: "sentence", sentence_id: id })
    setProposalBusy(false)
  }, [runTool])

  const previewProposal = useCallback(async () => {
    if (!pendingProposal) return
    const args =
      pendingProposal.op?.type === "cut"
        ? { start_ms: pendingProposal.op.startMs, end_ms: pendingProposal.op.endMs }
        : pendingProposal.sequence?.[0]
          ? { sentence_id: pendingProposal.sequence[0].sentenceId }
          : {}
    const response = await runTool("preview_segment", args)
    if (response) setPlaying(true)
  }, [pendingProposal, runTool])

  const applyProposal = useCallback(async () => {
    if (!pendingProposal) return
    setProposalBusy(true)
    await runTool("apply_edit", { proposal_id: pendingProposal.id })
    setProposalBusy(false)
  }, [pendingProposal, runTool])

  const dismissProposal = useCallback(async () => {
    if (!pendingProposal) return
    await runTool("dismiss_proposal", { proposal_id: pendingProposal.id })
  }, [pendingProposal, runTool])

  const ensureAudioContext = () => {
    if (!audioContextRef.current) audioContextRef.current = new AudioContext()
    void audioContextRef.current.resume()
    return audioContextRef.current
  }

  const stopVoice = useCallback(() => {
    voiceRef.current?.end()
    voiceRef.current = null
    setVoice("Disconnected")
    setVoiceDetail(null)
    setVoiceLevel(0)
  }, [])

  const startVoice = useCallback(async () => {
    const current = projectRef.current
    if (!current?.transcript) {
      setStatus("Upload and transcribe a video before starting voice.", false)
      return
    }
    if (voiceRef.current) {
      stopVoice()
      return
    }
    const session = new VoiceSession(
      current.id,
      {
        onPhase: (phase, detail) => {
          setVoice(mapVoiceState(phase, detail))
          setVoiceDetail(detail ?? null)
        },
        onLine: (who, text) => {
          setVoiceLines((lines) => [...lines.filter((line) => !(line.who === who && line.text === text)), { who, text }].slice(-12))
        },
        onLevel: setVoiceLevel,
        onProject: remember,
        onSeek: (outputMs) => seek(outputMs / 1000),
        snapshot: () => ({
          // The video element reports time within its own file, so add the
          // clip's offset to get a position on the combined timeline. Without
          // this, "remove that" on a second clip pointed at the wrong place.
          sourceTimeMs: activeSourceMs,
          outputTimeMs: currentTime * 1000,
          selectedWordIds,
        }),
        onUserSpeech: (active) => {
          if (active) {
            videoRef.current?.pause()
            setPlaying(false)
          }
        },
      },
      ensureAudioContext(),
    )
    voiceRef.current = session
    try {
      await session.start(current)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Voice connection failed."
      setVoice(message.toLowerCase().includes("permission") ? "Permission error" : "Connection error")
      setVoiceDetail(message)
      session.end()
      voiceRef.current = null
    }
  }, [currentTime, remember, seek, selectedWordIds, setStatus, stopVoice])

  const beginExport = useCallback(async () => {
    const current = projectRef.current
    if (!current || current.clips.length === 0) {
      setExportError("Upload a video before exporting.")
      setExportState("error")
      return
    }
    setExportError(null)
    setDownloadUrl(null)
    setExportState("processing")
    // The render is one long request, so it needs its own deadline. Without one
    // a dropped connection left the dialog spinning indefinitely.
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 10 * 60 * 1000)
    try {
      const response = await api.tool(current.id, "export_video", {}, crypto.randomUUID(), controller.signal)
      remember(response.project)
      setDownloadUrl("/api/projects/" + current.id + "/export")
      setExportState("complete")
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError"
        ? "The export took too long and was stopped. Try again with fewer clips."
        : error instanceof Error
          ? error.message
          : "Export failed."
      setExportError(message)
      setExportState("error")
    } finally {
      window.clearTimeout(timer)
    }
  }, [remember])

  // Stable identities: these are dependencies of the effects inside
  // VideoPreview, and inline arrows made them re-run on every render.
  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    // Called straight from the click, so the browser sees a user gesture.
    // Playing from an effect instead is what Chrome blocks for unmuted video.
    if (video.paused) {
      setPlaying(true)
      void video.play().catch(() => {
        setPlaying(false)
        setStatus("Playback was blocked. Press play again.", false)
      })
    } else {
      video.pause()
      setPlaying(false)
    }
  }, [setStatus])

  const reportPlaybackBlocked = useCallback(() => {
    setPlaying(false)
    setStatus("Playback was blocked. Press play again.", false)
  }, [setStatus])

  const applyPendingSeek = useCallback(() => {
    const video = videoRef.current
    const target = pendingSeekRef.current
    if (!video || target === null) return
    pendingSeekRef.current = null
    video.currentTime = target / 1000
    if (pendingPlayRef.current) {
      pendingPlayRef.current = false
      void video.play().catch(reportPlaybackBlocked)
    }
  }, [reportPlaybackBlocked])

  const captionsOn = project?.edit.captions.enabled ?? false
  const captionPositionY = project?.edit.captions.positionY ?? 0.86
  // Highlight wins when word highlighting is on, otherwise the weight decides.
  const captionStyle: CaptionStyle =
    project?.edit.captions.wordHighlight
      ? "highlight"
      : project?.edit.captions.preset === "bold"
        ? "bold"
        : "clean"
  const wordHighlight = project?.edit.captions.wordHighlight ?? false
  /** Hex value, for painting the spoken word in the preview. */
  const highlightHex = project?.edit.captions.highlightColor ?? "#FFD84D"
  const captionSize = Math.round((project?.edit.captions.fontScale ?? 1) * 32)
  const captionPosition =
    project?.edit.captions.position === "top"
      ? "Top"
      : project?.edit.captions.position === "center"
        ? "Middle"
        : "Bottom"
  const textColor =
    Object.entries(TEXT_COLORS).find(([, value]) => value.toLowerCase() === (project?.edit.captions.color.toLowerCase() ?? ""))?.[0] ?? "white"
  const highlightColor =
    Object.entries(HIGHLIGHT_COLORS).find(([, value]) => value.toLowerCase() === (project?.edit.captions.highlightColor.toLowerCase() ?? ""))?.[0] ?? "mint"
  const ratio = ratioFromProject(project)
  const duration = ((previewMode === "original" ? project?.sourceDurationMs : project?.outputDurationMs) ?? 0) / 1000

  const changeTool = (tool: Tool) => {
    setActiveTool(tool)
    if (tool === "transcript") setMobileTab("edit")
    if (tool === "captions") setMobileTab("captions")
    if (tool === "audio") setMobileTab("audio")
  }

  let inspector: React.ReactNode
  if (activeTool === "captions") {
    inspector = (
      <CaptionInspector
        style={captionStyle}
        size={captionSize}
        position={captionPosition}
        enabled={captionsOn}
        textColor={textColor}
        highlightColor={highlightColor}
        onEnabled={(value) => void runTool("set_caption_style", { enabled: value })}
        onStyle={(value) =>
          void runTool("set_caption_style", {
            // Clean and Bold are looks; Highlight is the karaoke look.
            preset: value === "clean" ? "clean" : "bold",
            word_highlight: value === "highlight",
            font_scale: value === "highlight" ? 1.15 : undefined,
          })
        }
        onSize={(value) => void runTool("set_caption_style", { font_scale: value / 32 })}
        onPosition={(value) =>
          void runTool("set_caption_style", {
            position: value === "Middle" ? "center" : value.toLowerCase(),
          })
        }
        onTextColor={(value) => void runTool("set_caption_style", { color: TEXT_COLORS[value] })}
        onHighlightColor={(value) =>
          void runTool("set_caption_style", { word_highlight: true, highlight_color: HIGHLIGHT_COLORS[value] })
        }
      />
    )
  } else if (activeTool === "audio") {
    inspector = (
      <AudioInspector
        volume={Math.round((project?.edit.audio.speechVolume ?? 1) * 100)}
        music={project?.music?.filename ?? null}
        musicVolume={Math.round((project?.edit.audio.musicVolume ?? .18) * 100)}
        duckMusic={project?.edit.audio.duckMusic ?? true}
        onVolume={(value) => void runTool("set_audio_mix", { speech_volume: value / 100 })}
        onMusicFile={(file) => {
          const current = projectRef.current
          if (!current) return
          setStatus("Uploading music…", false)
          void api.uploadMusic(current.id, file).then(remember).then(() => setStatus("Saved")).catch((error: Error) => setStatus(error.message, false))
        }}
        onRemoveMusic={() => void runTool("remove_music", {})}
        onMusicVolume={(value) => void runTool("set_audio_mix", { music_volume: value / 100 })}
        onDuckMusic={(enabled) => void runTool("set_audio_mix", { duck_music: enabled })}
      />
    )
  } else if (activeTool === "media") {
    inspector = (
      <MediaPanel
        project={project}
        phase={phase}
        activeClipId={activeClip?.id ?? null}
        clipFrames={clipFrames}
        onSelectClip={selectClip}
        onRemoveClip={(clipId) => void removeClip(clipId)}
        onTranscribe={(clipId) => void transcribe(clipId)}
        onLoadDemo={() => void loadDemo()}
        onUpload={uploadFiles}
      />
    )
  } else if (activeTool === "framing") {
    inspector = (
      <FramingControls
        ratio={ratio}
        onRatio={(value) => void runTool("set_aspect_ratio", { mode: modeFromRatio(value) })}
        focus={project?.edit.framing.focus ?? .5}
        onFocus={(focus) => void runTool("set_aspect_ratio", { mode: projectRef.current?.edit.framing.mode, focus })}
        guides={guides}
        onGuides={setGuides}
      />
    )
  } else if (activeTool === "history") {
    inspector = <HistoryPanel project={project} onUndo={() => void runTool("undo_edit", {})} onRedo={() => void runTool("redo_edit", {})} />
  } else {
    inspector = (
      <TranscriptPanel
        project={project}
        activeSentenceId={activeSentenceId}
        selectedSentenceId={selectedSentenceId}
        currentTime={currentTime}
        duration={duration}
        thumbnails={allFrames}
        waveform={waveform}
        proposalState={proposalBusy ? "applying" : "pending"}
        proposal={pendingProposal}
        onSeek={seek}
        onSelect={selectSentence}
        onPropose={proposeSentence}
        onPreview={previewProposal}
        onApply={applyProposal}
        onDismiss={dismissProposal}
        onUndo={() => void runTool("undo_edit", {})}
        onRedo={() => void runTool("redo_edit", {})}
      />
    )
  }

  return (
    <main className="app-shell">
      {/* Surface a broken environment up front. Without ffmpeg an export fails
          and without an API key transcription fails, and both used to surface
          only as a failed request several steps into a demo. */}
      {health && (!health.ffmpeg || !health.assemblyai) && (
        <div className="env-notice" role="status">
          {[
            !health.assemblyai ? "Transcription and voice are unavailable: the server has no ASSEMBLYAI_API_KEY." : null,
            !health.ffmpeg ? "Export is unavailable: ffmpeg was not found on the server." : null,
          ].filter(Boolean).join(" ")}
        </div>
      )}
      <EditorHeader
        title={title}
        saveStatus={saveStatus}
        statusTone={statusTone}
        onTitle={setTitle}
        onExport={() => {
          // Reopening after a finished render should offer the download again,
          // not throw the creator back to the start of the flow.
          if (exportState !== "complete" || !downloadUrl) setExportState("options")
          setExportOpen(true)
        }}
        onUndo={() => void runTool("undo_edit", {})}
        onRedo={() => void runTool("redo_edit", {})}
        canUndo={Boolean(project?.undo.length)}
        canRedo={Boolean(project?.redo.length)}
        onMore={() => setMoreOpen(true)}
      />
      <ToolNavigation active={activeTool} onChange={changeTool} />
      <div className="workspace">
        <div className="preview-column">
          <VideoPreview
            project={project}
            currentTime={currentTime}
            playing={playing}
            ratio={ratio}
            captionStyle={captionStyle}
            captionSize={captionSize}
            captionPosition={captionPosition}
            captionPositionY={captionPositionY}
            wordHighlight={wordHighlight}
            highlightColor={highlightHex}
            showGuides={guides}
            mode={previewMode}
            mediaSrc={mediaSrc}
            activeClipId={activeClip?.id ?? null}
            onVideoReady={handleVideoReady}
            onVideoTimeUpdate={handleVideoTimeUpdate}
            onPlay={togglePlay}
            onSeek={seek}
            onPlaybackBlocked={reportPlaybackBlocked}
            onAttachReady={applyPendingSeek}
            onRatio={(value) => void runTool("set_aspect_ratio", { mode: modeFromRatio(value) })}
            onMode={(value) => {
              setPreviewMode(value)
              setPlaying(false)
              // Pass the mode explicitly: seek still closes over the previous
              // one at this point, so Before was seeking with edited maths.
              window.setTimeout(() => seek(0, value), 0)
            }}
          />
          <div className="mobile-tabs mobile-only" role="tablist">
            {(["edit", "captions", "audio"] as const).map((tab) => (
              <button
                role="tab"
                aria-selected={mobileTab === tab}
                className={mobileTab === tab ? "active" : ""}
                key={tab}
                onClick={() => {
                  setMobileTab(tab)
                  changeTool(tab === "edit" ? "transcript" : tab)
                }}
              >
                {tab[0].toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          <div className="mobile-tool-panel mobile-only">{inspector}</div>
          <FloatingAssistant
            state={voice}
            level={voiceLevel}
            detail={voiceDetail}
            lines={voiceLines}
            pushToTalk={pushToTalk}
            onTogglePushToTalk={() => setPushToTalk((value) => !value)}
            onHold={(held) => voiceRef.current?.setHeld(held)}
            onToggle={voice === "Disconnected" || voice === "Permission error" || voice === "Connection error" ? startVoice : stopVoice}
            onStop={stopVoice}
          />
          {musicSrc && <audio ref={musicRef} className="visually-hidden" src={musicSrc} loop />}
        </div>
        <aside className="desktop-inspector desktop-only">{inspector}</aside>
      </div>
      <Timeline
        project={project}
        clipFrames={clipFrames}
        waveform={waveform}
        currentTime={currentTime}
        zoom={zoom}
        captionsOn={captionsOn}
        onSeek={seek}
        onZoom={setZoom}
      />
      {moreOpen && (
        <MoreSheet
          onTool={changeTool}
          onClose={() => setMoreOpen(false)}
        />
      )}
      {exportOpen && (
        <ExportDialog
          state={exportState}
          progress={project?.jobs.export.progress ?? 0}
          error={exportError || project?.jobs.export.error || null}
          downloadUrl={downloadUrl}
          captionsOn={captionsOn}
          onBegin={beginExport}
          onClose={() => setExportOpen(false)}
        />
      )}
      {needsToken && (
        <AccessTokenGate
          onSave={(value) => {
            saveToken(value)
            // Reload so the bootstrap re-runs and every request carries the token.
            window.location.reload()
          }}
        />
      )}
    </main>
  )
}

export default function App() {
  return <EditorShell />
}
