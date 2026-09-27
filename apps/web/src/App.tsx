import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { PresentedProject, Proposal, ResolvedSegment } from "@cutback/timeline"
import { api, type Health } from "./api"
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
    upload: (
      <>
        <path d="m12 16V4m-5 5 5-5 5 5" />
        <path d="M4 15v5h16v-5" />
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
      {paths[name] || paths.more}
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
        <span className="saved">
          <i />
          {saveStatus}
        </span>
        
      </div>
      <div className="mobile-only mobile-head">
        <button
          className="icon-btn"
          aria-label="Back"
          onClick={() => window.history.back()}
        >
          <Icon name="back" />
        </button>
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
  showGuides,
  mode,
  onPlay,
  onSeek,
  onRatio,
  onMode,
  onVideoReady,
  onVideoTimeUpdate,
  mediaSrc,
}: {
  project: PresentedProject | null
  currentTime: number
  playing: boolean
  ratio: string
  captionStyle: CaptionStyle
  captionSize: number
  captionPosition: string
  showGuides: boolean
  mode: "original" | "edited"
  onPlay: () => void
  onSeek: (value: number) => void
  onRatio: (ratio: string) => void
  onMode: (mode: "original" | "edited") => void
  onVideoReady: (video: HTMLVideoElement | null) => void
  onVideoTimeUpdate: (video: HTMLVideoElement) => void
  mediaSrc?: string | null
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !mediaSrc) return
    video.muted = muted
    if (playing) void video.play().catch(() => undefined)
    else video.pause()
  }, [mediaSrc, muted, playing])
  useEffect(() => {
    onVideoReady(videoRef.current)
    return () => onVideoReady(null)
  }, [onVideoReady])
  const activeCue = project?.cues.find(
    (cue) => currentTime * 1000 >= cue.outputStartMs && currentTime * 1000 <= cue.outputEndMs,
  )
  const framing = mode === "original" ? undefined : project?.edit.framing
  const canvasRatio = !framing || framing.mode === "original" ? (project?.media ? project.media.width / project.media.height : 16 / 9) : framing.mode === "wide" ? 16 / 9 : framing.mode === "square" ? 1 : 9 / 16
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
          <select
            aria-label="Frame aspect ratio"
            value={ratio}
            onChange={(event) => onRatio(event.target.value)}
          >
            <option value="16:9">Frame: 16:9</option>
            <option value="Original">Frame: Original</option>
            <option value="1:1">Frame: 1:1</option>
            <option value="9:16">Frame: 9:16</option>
          </select>
        </div>
      </div>
      <div className="preview-canvas-area">
      <div
        style={{ "--canvas-ratio": canvasRatio } as React.CSSProperties}
        ref={stageRef}
        className={`video-stage ratio-${ratio.replace(":", "-").toLowerCase()}`}
      >
        {mediaSrc ? (
          <video
            ref={videoRef}
            src={mediaSrc}
            muted={muted}
            playsInline
            onTimeUpdate={(event) => onVideoTimeUpdate(event.currentTarget)}
            onPlay={() => undefined}
            onPause={() => undefined}
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
            {activeCue.text}
          </div>
        )}
      </div>
      </div>
      <PlaybackControls
        currentTime={currentTime}
        duration={((mode === "original" ? project?.media?.durationMs : project?.outputDurationMs) ?? 0) / 1000}
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
              ? "Edit applied · 4.2 seconds removed"
              : "Remove 4.2 seconds"}
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
        <i style={{ left: `calc(112px + (100% - 112px) * ${duration > 0 ? Math.min(1, currentTime / duration) : 0})` }} />
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
  safe,
  textColor,
  highlightColor,
  onStyle,
  onSize,
  onPosition,
  onSafe,
  onTextColor,
  onHighlightColor,
}: {
  style: CaptionStyle
  size: number
  position: string
  safe: boolean
  textColor: string
  highlightColor: string
  onStyle: (style: CaptionStyle) => void
  onSize: (size: number) => void
  onPosition: (position: string) => void
  onSafe: (safe: boolean) => void
  onTextColor: (color: string) => void
  onHighlightColor: (color: string) => void
}) {
  return (
    <section className="inspector settings-panel">
      <div className="inspector-header">
        <h2>Captions</h2>
        <span>Preview</span>
      </div>
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
      <fieldset>
        <legend>Text colour</legend>
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
      </fieldset>
      <fieldset>
        <legend>Highlight</legend>
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
      </fieldset>
      <fieldset>
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
      <label className="toggle-row">
        <span>Keep within safe area</span>
        <input
          type="checkbox"
          checked={safe}
          onChange={(event) => onSafe(event.target.checked)}
        />
        <i />
      </label>
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
  thumbnail,
  mediaItems,
  onUpload,
}: {
  project: PresentedProject | null
  phase: ProjectPhase
  thumbnail: string | null
  mediaItems: Array<{ name: string; url: string }>
  onUpload: (files: File[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <section className="inspector settings-panel">
      <div className="inspector-header">
        <h2>Media</h2>
      </div>
      {project?.media || mediaItems.length ? (
        <div className="media-bin" aria-label="Project media">
          {(mediaItems.length
            ? mediaItems
            : [{ name: project?.media?.filename || "Video", url: "" }]
          ).map((item, index) => (
            <div className={`media-file ${index === 0 ? "active" : ""}`} key={`${item.name}-${index}`}>
              {item.url ? (
                <video src={item.url} muted preload="metadata" aria-hidden="true" />
              ) : (
                <img src={thumbnail || mediaImage} alt="" />
              )}
              <div>
                <b>{item.name}</b>
                {index === 0 && project?.media ? (
                  <>
                    <span>{project.media.width} × {project.media.height}</span>
                    <span>{formatTime(project.media.durationMs / 1000)}</span>
                  </>
                ) : (
                  <span>Media bin</span>
                )}
              </div>
            </div>
          ))}
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
              ? "Choose a video file to begin editing."
              : "Preparing transcript"}
          </p>
        </div>
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
        disabled={phase === "uploading" || phase === "transcribing"}
        onClick={() => inputRef.current?.click()}
      >
        <Icon name="upload" size={17} /> Select local video
      </button>
      <p className="helper">
        MP4, MOV, WEBM or MKV. Up to 2 minutes and 200 MB each.
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
  thumbnails,
  waveform,
  currentTime,
  zoom,
  onSeek,
  onZoom,
}: {
  project: PresentedProject | null
  thumbnails: string[]
  waveform: number[]
  currentTime: number
  zoom: number
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
                  {thumbnails.map((thumbnail, index) => (
                    <img key={index} src={thumbnail} alt="" />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="track caption-track">
            <label>
              <Icon name="captions" size={17} />
              Captions
            </label>
            <div className="caption-clips">
              {(project?.cues ?? []).map((cue) => (
                <span key={cue.id} title={cue.text}>{cue.text}</span>
              ))}
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
  onBegin,
  onClose,
}: {
  state: ExportState
  progress: number
  error: string | null
  downloadUrl: string | null
  onBegin: () => void
  onClose: () => void
}) {
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
            <p>Export your edited video as an MP4.</p>
            <label>
              Format
              <select>
                <option>MP4 · H.264</option>
                <option>WebM</option>
              </select>
            </label>
            <label>
              Quality
              <select>
                <option>1080p · Recommended</option>
                <option>720p</option>
              </select>
            </label>
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

export function EditorShell() {
  const [health, setHealth] = useState<Health | null>(null)
  const [project, setProject] = useState<PresentedProject | null>(null)
  const [title, setTitle] = useState("Untitled project")
  const [saveStatus, setSaveStatus] = useState("Loading…")
  const [activeTool, setActiveTool] = useState<Tool>("transcript")
  const [mobileTab, setMobileTab] = useState<"edit" | "captions" | "audio">("edit")
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [selectedSentenceId, setSelectedSentenceId] = useState<string | null>(null)
  const [proposalBusy, setProposalBusy] = useState(false)
  const [safe, setSafe] = useState(true)
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
  const [thumbnails, setThumbnails] = useState<string[]>([])
  const [mediaItems, setMediaItems] = useState<Array<{ name: string; url: string }>>([])
  const [waveform, setWaveform] = useState<number[]>([])

  const projectRef = useRef<PresentedProject | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const musicRef = useRef<HTMLAudioElement | null>(null)
  const voiceRef = useRef<VoiceSession | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const statusTimerRef = useRef<number | null>(null)
  const mediaUrlsRef = useRef<string[]>([])

  const setStatus = useCallback((message: string, restore = true) => {
    if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current)
    setSaveStatus(message)
    if (restore) {
      statusTimerRef.current = window.setTimeout(() => setSaveStatus("Saved"), 4200)
    }
  }, [])

  const remember = useCallback((next: PresentedProject) => {
    projectRef.current = next
    setProject(next)
    setTitle(next.title)
    localStorage.setItem(PROJECT_KEY, next.id)
    voiceRef.current?.refreshPrompt(next)
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
    const timer = window.setInterval(() => {
      void api.get(project.id).then(remember).catch(() => undefined)
    }, 850)
    return () => window.clearInterval(timer)
  }, [exportState, project?.id, project?.jobs.export.status, project?.jobs.transcription.status, remember])

  useEffect(() => {
    if (project?.jobs.transcription.status === "completed") setSaveStatus("Saved")
    if (project?.jobs.transcription.status === "error")
      setStatus(project.jobs.transcription.error || "Transcription failed.", false)
  }, [project?.jobs.transcription.error, project?.jobs.transcription.status, setStatus])

  const mediaSrc = project?.media ? "/api/projects/" + project.id + "/media?v=" + encodeURIComponent(project.updatedAt) : null
  const musicSrc = project?.music ? "/api/projects/" + project.id + "/music?v=" + encodeURIComponent(project.updatedAt) : null

  useEffect(() => {
    if (!project?.media || !mediaSrc) {
      setThumbnails([])
      setWaveform([])
      return
    }
    let alive = true
    void Promise.all([
      createThumbnails(mediaSrc, project.media.durationMs / 1000).catch(() => []),
      api.waveform(project.id).then((result) => result.peaks).catch(() => []),
    ]).then(([frames, peaks]) => {
      if (!alive) return
      setThumbnails(frames)
      setWaveform(peaks)
    })
    return () => {
      alive = false
    }
  }, [mediaSrc, project?.id, project?.media?.durationMs])

  useEffect(() => {
    const video = videoRef.current
    if (video && project) video.volume = Math.max(0, Math.min(1, project.edit.audio.speechVolume))
  }, [project?.edit.audio.speechVolume])

  useEffect(() => {
    return () => {
      voiceRef.current?.end()
      if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current)
      mediaUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  const phase: ProjectPhase = uploading
    ? "uploading"
    : !project?.media
      ? "empty"
      : project.jobs.transcription.status === "running"
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
  }, [])

  const seek = useCallback((seconds: number) => {
    const current = projectRef.current
    const video = videoRef.current
    if (!current || !video) return
    if (previewMode === "original") {
      const target = Math.max(0, Math.min(current.media?.durationMs ?? 0, seconds * 1000))
      video.currentTime = target / 1000
      setCurrentTime(target / 1000)
      return
    }
    const target = Math.max(0, Math.min(current.outputDurationMs, seconds * 1000))
    const segment =
      current.segments.find((item) => target >= item.outputStartMs && target <= item.outputEndMs) ??
      current.segments[current.segments.length - 1]
    if (!segment) return
    const sourceMs = segment.sourceStartMs + Math.max(0, target - segment.outputStartMs)
    video.currentTime = sourceMs / 1000
    setCurrentTime(target / 1000)
  }, [previewMode])

  const handleVideoTimeUpdate = useCallback((video: HTMLVideoElement) => {
    const current = projectRef.current
    if (!current) return
    const sourceMs = video.currentTime * 1000
    if (previewMode === "original") {
      setCurrentTime(video.currentTime)
      setPlaying(!video.paused)
      return
    }
    let segment = current.segments.find(
      (item) => sourceMs >= item.sourceStartMs && sourceMs <= item.sourceEndMs,
    )
    if (!segment && !video.paused) {
      const next = current.segments.find((item) => item.sourceStartMs > sourceMs)
      if (next) {
        video.currentTime = next.sourceStartMs / 1000
        segment = next
      } else {
        video.pause()
        setPlaying(false)
        return
      }
    }
    if (!segment) return
    const outputMs = segment.outputStartMs + Math.max(0, sourceMs - segment.sourceStartMs)
    setCurrentTime(outputMs / 1000)
    setPlaying(!video.paused)

    const music = musicRef.current
    if (music && current.music) {
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
      sourceTimeMs: (videoRef.current?.currentTime ?? 0) * 1000,
      outputTimeMs: currentTime * 1000,
      selectedWordIds,
      capturedAt: new Date().toISOString(),
      reason: "selection",
    })
  }, [currentTime, selectedWordIds])

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

  const upload = useCallback(async (file: File) => {
    setUploading(true)
    setStatus("Uploading…", false)
    voiceRef.current?.end()
    voiceRef.current = null
    setVoice("Disconnected")
    try {
      const current = projectRef.current ?? await api.create(file.name.replace(/\.[^.]+$/, ""))
      if (!projectRef.current) remember(current)
      const uploaded = await api.upload(current.id, file)
      remember(uploaded)
      setSelectedSentenceId(null)
      setCurrentTime(0)
      setPlaying(false)
      if (!health?.assemblyai) throw new Error("ASSEMBLYAI_API_KEY is missing on the server.")
      setStatus("Transcribing…", false)
      const transcribing = await api.transcribe(uploaded.id)
      remember(transcribing)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Upload failed.", false)
    } finally {
      setUploading(false)
    }
  }, [health?.assemblyai, remember, setStatus])

  const uploadFiles = useCallback((files: File[]) => {
    mediaUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    const items = files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) }))
    mediaUrlsRef.current = items.map((item) => item.url)
    setMediaItems(items)
    if (files[0]) void upload(files[0])
  }, [upload])

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
    await runTool("propose_cut", { action: "remove", use: "sentence_id", sentence_id: id, apply: false })
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
          sourceTimeMs: (videoRef.current?.currentTime ?? 0) * 1000,
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
    if (!current?.media) {
      setExportError("Upload a video before exporting.")
      setExportState("error")
      return
    }
    setExportError(null)
    setDownloadUrl(null)
    setExportState("processing")
    try {
      const response = await api.tool(current.id, "export_video", {}, crypto.randomUUID())
      remember(response.project)
      setDownloadUrl("/api/projects/" + current.id + "/export")
      setExportState("complete")
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Export failed.")
      setExportState("error")
    }
  }, [remember])

  const captionStyle: CaptionStyle =
    project?.edit.captions.preset === "bold"
      ? project.edit.captions.wordHighlight ? "highlight" : "bold"
      : "clean"
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
  const duration = ((previewMode === "original" ? project?.media?.durationMs : project?.outputDurationMs) ?? 0) / 1000

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
        safe={safe}
        textColor={textColor}
        highlightColor={highlightColor}
        onStyle={(value) =>
          void runTool("set_caption_style", {
            enabled: true,
            preset: value === "highlight" ? "bold" : value,
            word_highlight: value === "highlight",
          })
        }
        onSize={(value) => void runTool("set_caption_style", { enabled: true, font_scale: value / 32 })}
        onPosition={(value) =>
          void runTool("set_caption_style", {
            enabled: true,
            position: value === "Middle" ? "center" : value.toLowerCase(),
          })
        }
        onSafe={setSafe}
        onTextColor={(value) => void runTool("set_caption_style", { enabled: true, color: TEXT_COLORS[value] })}
        onHighlightColor={(value) =>
          void runTool("set_caption_style", { enabled: true, word_highlight: true, highlight_color: HIGHLIGHT_COLORS[value] })
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
        thumbnail={thumbnails[0] ?? null}
        mediaItems={mediaItems}
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
        thumbnails={thumbnails}
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
      <EditorHeader
        title={title}
        saveStatus={saveStatus}
        onTitle={setTitle}
        onExport={() => {
          setExportState("options")
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
            showGuides={guides}
            mode={previewMode}
            mediaSrc={mediaSrc}
            onVideoReady={handleVideoReady}
            onVideoTimeUpdate={handleVideoTimeUpdate}
            onPlay={() => {
              if (!project?.media) return
              setPlaying((value) => !value)
            }}
            onSeek={seek}
            onRatio={(value) => void runTool("set_aspect_ratio", { mode: modeFromRatio(value) })}
            onMode={(value) => {
              setPreviewMode(value)
              setPlaying(false)
              window.setTimeout(() => seek(0), 0)
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
            onToggle={voice === "Disconnected" || voice === "Permission error" || voice === "Connection error" ? startVoice : stopVoice}
            onStop={stopVoice}
          />
          {musicSrc && <audio ref={musicRef} className="visually-hidden" src={musicSrc} loop />}
        </div>
        <aside className="desktop-inspector desktop-only">{inspector}</aside>
      </div>
      <Timeline
        project={project}
        thumbnails={thumbnails}
        waveform={waveform}
        currentTime={currentTime}
        zoom={zoom}
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
          onBegin={beginExport}
          onClose={() => setExportOpen(false)}
        />
      )}
    </main>
  )
}

export default function App() {
  return <EditorShell />
}
