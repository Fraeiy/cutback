import { useEffect, useMemo, useRef, useState } from "react"
import { demoServices } from "./editor/demoServices"
import {
  PROJECT_DURATION as duration,
  PROJECT_MEDIA as mediaImage,
  SAMPLE_TRANSCRIPT as sentences,
  TOOL_LABELS as toolLabels,
} from "./editor/fixtures"
import type {
  CaptionStyle,
  EditorCallbacks,
  ExportState,
  ProjectPhase,
  Tool,
  VoiceState,
} from "./editor/types"

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
  return `00:${Math.round(value).toString().padStart(2, "0")}`
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
  onExport,
  onUndo,
  onRedo,
  canRedo,
  onMore,
}: {
  onExport: () => void
  onUndo: () => void
  onRedo: () => void
  canRedo: boolean
  onMore: () => void
}) {
  const [title, setTitle] = useState("My AI tool review")
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
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <span className="saved">
          <i />
          Saved
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
        <b className="mobile-project">AI tool review</b>
      </div>
      <div className="header-actions">
        <button
          className="icon-btn desktop-only"
          onClick={onUndo}
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
  playing,
  muted,
  onPlay,
  onSeek,
  onMute,
  onFullscreen,
}: {
  currentTime: number
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
      <span className="time">{formatTime(currentTime)} / 00:48</span>
      <input
        aria-label="Playback position"
        type="range"
        min="0"
        max={duration}
        step=".1"
        value={currentTime}
        onChange={(event) => onSeek(Number(event.target.value))}
        style={
          {
            "--progress": `${(currentTime / duration) * 100}%`,
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
}: {
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
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const [muted, setMuted] = useState(false)
  const active =
    [...sentences]
      .reverse()
      .find((sentence) => currentTime >= sentence.start) || sentences[0]
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
              Original
            </button>
            <button
              className={mode === "edited" ? "active" : ""}
              onClick={() => onMode("edited")}
            >
              Edited
            </button>
          </div>
          <select
            aria-label="Aspect ratio"
            value={ratio}
            onChange={(event) => onRatio(event.target.value)}
          >
            <option>16:9</option>
            <option>Original</option>
            <option>1:1</option>
            <option>9:16</option>
          </select>
        </div>
      </div>
      <div
        ref={stageRef}
        className={`video-stage ratio-${ratio.replace(":", "-").toLowerCase()}`}
      >
        <img
          src={mediaImage}
          alt="Creator recording a video in a home studio"
        />
        {showGuides && <div className="safe-guides" />}
        {mode === "edited" && (
          <div
            className={`caption caption-${captionStyle} position-${captionPosition.toLowerCase()}`}
            style={
              { "--caption-size": `${captionSize}px` } as React.CSSProperties
            }
          >
            {active.text}
          </div>
        )}
      </div>
      <PlaybackControls
        currentTime={currentTime}
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
  state,
  onPreview,
  onApply,
  onDismiss,
}: {
  state: "pending" | "applying" | "applied" | "dismissed"
  onPreview: () => void
  onApply: () => void
  onDismiss: () => void
}) {
  if (state === "dismissed") return null
  return (
    <div className={`proposal ${state}`}>
      <span className="proposal-icon">
        <Icon name={state === "applied" ? "check" : "scissors"} />
      </span>
      <div>
        <b>
          {state === "applied" ? "Introduction trimmed" : "Trim introduction"}
        </b>
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
  onSeek,
}: {
  currentTime: number
  onSeek: (time: number) => void
}) {
  return (
    <div className="mobile-mini-timeline mobile-only">
      <div className="mini-ruler">
        {[0, 10, 20, 30, 40].map((tick) => (
          <span key={tick}>{formatTime(tick)}</span>
        ))}
      </div>
      <div className="mini-strip">
        {[0, 1, 2, 3, 4].map((frame) => (
          <img
            src={mediaImage}
            alt=""
            key={frame}
            style={{ objectPosition: `${18 + frame * 16}% 44%` }}
          />
        ))}
        <i style={{ left: `${(currentTime / duration) * 100}%` }} />
        <button
          aria-label="Seek compact timeline"
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect()
            onSeek(((event.clientX - bounds.left) / bounds.width) * duration)
          }}
        />
      </div>
      <div className="mini-waveform">
        {Array.from({ length: 54 }, (_, index) => (
          <i
            key={index}
            style={{ height: `${22 + ((index * 19) % 70)}%` }}
          />
        ))}
      </div>
    </div>
  )
}

export function TranscriptPanel({
  currentTime,
  removed,
  proposalState,
  onSeek,
  onPropose,
  onPreview,
  onApply,
  onDismiss,
  onUndo,
  onRedo,
}: {
  currentTime: number
  removed: boolean
  proposalState: "pending" | "applying" | "applied" | "dismissed"
  onSeek: (time: number) => void
  onPropose: (id: number) => void
  onPreview: () => void
  onApply: () => void
  onDismiss: () => void
  onUndo: () => void
  onRedo: () => void
}) {
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState("")
  const active = [...sentences]
    .reverse()
    .find((sentence) => currentTime >= sentence.start)?.id
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
      <MobileTimeline currentTime={currentTime} onSeek={onSeek} />
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
            className={`${active === sentence.id ? "active" : ""} ${
              sentence.id === 0 && !removed ? "proposed-remove" : ""
            } ${sentence.id === 0 && removed ? "removed" : ""}`}
            onClick={() => onSeek(sentence.start)}
            onDoubleClick={() => onPropose(sentence.id)}
          >
            <time>{formatTime(sentence.start)}</time>
            <span>{sentence.text}</span>
            {sentence.id === 0 && !removed && <em>(remove)</em>}
          </button>
        ))}
      </div>
      <button
        className="selection-action"
        onClick={() => onPropose(active ?? 0)}
      >
        <Icon name="scissors" size={16} /> Propose removing selected sentence
      </button>
      <EditProposal
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
  onStyle,
  onSize,
  onPosition,
  onSafe,
}: {
  style: CaptionStyle
  size: number
  position: string
  safe: boolean
  onStyle: (style: CaptionStyle) => void
  onSize: (size: number) => void
  onPosition: (position: string) => void
  onSafe: (safe: boolean) => void
}) {
  const [textColor, setTextColor] = useState("white")
  const [highlightColor, setHighlightColor] = useState("mint")
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
                onClick={() => setTextColor(color)}
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
                onClick={() => setHighlightColor(color)}
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
  onVolume,
  onMusic,
}: {
  volume: number
  music: boolean
  onVolume: (volume: number) => void
  onMusic: (music: boolean) => void
}) {
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
      {!music ? (
        <div className="empty-card">
          <span className="round-icon">
            <Icon name="music" />
          </span>
          <b>No background music</b>
          <p>Add a track to give your short more energy.</p>
          <button className="secondary" onClick={() => onMusic(true)}>
            Add music
          </button>
        </div>
      ) : (
        <div className="music-card">
          <span className="round-icon">
            <Icon name="music" />
          </span>
          <div>
            <b>Soft Focus</b>
            <span>Background music · 00:48</span>
          </div>
          <button
            className="icon-btn"
            onClick={() => onMusic(false)}
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
            <input type="range" defaultValue="18" />
            <output>18%</output>
          </label>
          <label className="toggle-row">
            <span>Duck music under speech</span>
            <input type="checkbox" defaultChecked />
            <i />
          </label>
        </>
      )}
    </section>
  )
}

function MediaPanel({
  phase,
  onUpload,
}: {
  phase: ProjectPhase
  onUpload: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <section className="inspector settings-panel">
      <div className="inspector-header">
        <h2>Media</h2>
      </div>
      {phase === "ready" ? (
        <div className="media-file">
          <img src={mediaImage} alt="" />
          <div>
            <b>ai-tool-review.mp4</b>
            <span>1920 × 1080 · 48 seconds</span>
          </div>
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
        onChange={(event) =>
          event.target.files?.[0] && onUpload(event.target.files[0])
        }
      />
      <button
        className="secondary full"
        onClick={() => inputRef.current?.click()}
      >
        <Icon name="upload" size={17} /> Select local video
      </button>
      <p className="helper">
        Uploads in this prototype stay in your browser. The sample editor does
        not render media.
      </p>
    </section>
  )
}

export function FramingControls({
  ratio,
  onRatio,
  guides,
  onGuides,
}: {
  ratio: string
  onRatio: (ratio: string) => void
  guides: boolean
  onGuides: (value: boolean) => void
}) {
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
        <input type="range" defaultValue="50" />
        <output>Center</output>
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
  removed,
  onUndo,
  onRedo,
}: {
  removed: boolean
  onUndo: () => void
  onRedo: () => void
}) {
  return (
    <section className="inspector settings-panel">
      <div className="inspector-header">
        <div>
          <h2>History</h2>
          <span>{removed ? "3" : "2"} edits in this version</span>
        </div>
      </div>
      <div className="history-actions">
        <button onClick={onUndo}>
          <Icon name="undo" />
          Undo
        </button>
        <button onClick={onRedo}>
          <Icon name="redo" />
          Redo
        </button>
      </div>
      <div className="history-list">
        {removed && (
          <article className="current">
            <i />
            <div>
              <b>Trimmed introduction</b>
              <span>Just now · current</span>
            </div>
          </article>
        )}
        <article>
          <i />
          <div>
            <b>Caption highlight applied</b>
            <span>2 minutes ago</span>
          </div>
        </article>
        <article>
          <i />
          <div>
            <b>Project created</b>
            <span>5 minutes ago</span>
          </div>
        </article>
      </div>
    </section>
  )
}

export function Timeline({
  currentTime,
  zoom,
  onSeek,
  onZoom,
}: {
  currentTime: number
  zoom: number
  onSeek: (time: number) => void
  onZoom: (zoom: number) => void
}) {
  const ticks = [0, 10, 20, 30, 40]
  const [snapping, setSnapping] = useState(true)
  const [splitAt, setSplitAt] = useState<number | null>(null)
  return (
    <section className="timeline">
      <div className="timeline-toolbar">
        <b>
          <Icon name="document" size={17} />
          Timeline
        </b>
        <button
          className="desktop-only"
          onClick={() => setSnapping((value) => !value)}
          aria-pressed={snapping}
        >
          Snapping <i className={`tiny-toggle ${snapping ? "on" : ""}`} />
        </button>
        <button
          className="desktop-only"
          onClick={() => setSplitAt(currentTime)}
        >
          <Icon name="scissors" size={16} />{" "}
          {splitAt === null ? "Split" : `Split at ${formatTime(splitAt)}`}
        </button>
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
          48s duration&nbsp;&nbsp;|&nbsp;&nbsp;3 edits
        </span>
      </div>
      <div className="timeline-scroll">
        <div
          className="timeline-content"
          style={{ "--timeline-zoom": zoom } as React.CSSProperties}
        >
          <div className="ruler">
            {ticks.map((tick) => (
              <span key={tick} style={{ left: `${(tick / duration) * 100}%` }}>
                {formatTime(tick)}
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
            style={{ left: `${(currentTime / duration) * 100}%` }}
          >
            <span>{formatTime(currentTime)}</span>
          </div>
          {splitAt !== null && (
            <i
              className="split-marker"
              style={{ left: `${(splitAt / duration) * 100}%` }}
            />
          )}
          <div className="track video-track">
            <label>
              <Icon name="document" size={17} />
              Video
            </label>
            <div className="clip selected">
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <img
                  key={n}
                  src={mediaImage}
                  alt=""
                  style={{ objectPosition: `${20 + n * 12}% 42%` }}
                />
              ))}
            </div>
          </div>
          <div className="track caption-track">
            <label>
              <Icon name="captions" size={17} />
              Captions
            </label>
            <div className="caption-clips">
              {sentences.slice(1, 5).map((sentence) => (
                <span key={sentence.id}>{sentence.text}</span>
              ))}
            </div>
          </div>
          <div className="track audio-track">
            <label>
              <Icon name="wave" size={17} />
              Audio
            </label>
            <div className="waveform">
              {Array.from({ length: 120 }, (_, n) => (
                <i key={n} style={{ height: `${20 + ((n * 17) % 65)}%` }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export function VoiceDock({
  state,
  onState,
}: {
  state: VoiceState
  onState: (state: VoiceState) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isError = state === "Permission error" || state === "Connection error"
  const active = state !== "Disconnected" && !isError
  const toggle = () => {
    if (active || isError) onState("Disconnected")
    else {
      onState("Connecting")
      demoServices.after(700, () => onState("Listening"))
    }
  }
  const instruction = isError
    ? state === "Permission error"
      ? "Microphone access was declined."
      : "Voice service could not connect."
    : active
      ? "Keep the example, shorten the intro."
      : "Tap to simulate voice editing"
  return (
    <section
      className={`voice-dock ${active ? "active" : ""} ${isError ? "voice-error" : ""}`}
    >
      {expanded && (
        <div className="voice-history">
          <b>Recent conversation</b>
          <p><span>You</span> Keep the example, shorten the intro.</p>
          <p><span>Cutback</span> I prepared a 4.2 second trim for review.</p>
        </div>
      )}
      <button
        className="mic-button"
        onClick={toggle}
        aria-label={active ? "Disconnect voice" : "Connect voice"}
      >
        <Icon name="mic" size={28} />
      </button>
      <div className="voice-wave">
        {[4, 8, 13, 20, 11, 17, 7, 14, 5].map((height, index) => (
          <i key={index} style={{ height }} />
        ))}
      </div>
      <button
        className="voice-copy"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <b>
          {isError
            ? state
            : state === "Disconnected"
            ? "Tell Cutback what to change"
            : `${state}…`}{" "}
          <span>Voice</span>
        </b>
        <p>{instruction}</p>
      </button>
      {active && (
        <button className="stop-button" onClick={() => onState("Disconnected")}>
          <i /> <span className="desktop-only">Stop</span>
        </button>
      )}
    </section>
  )
}

export function ExportDialog({
  state,
  onState,
  onClose,
}: {
  state: ExportState
  onState: (state: ExportState) => void
  onClose: () => void
}) {
  const begin = () => {
    onState("processing")
    demoServices.after(1600, () => onState("complete"))
  }
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
            <button className="primary full" onClick={begin}>
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
              <i />
            </div>
            <button className="secondary" onClick={() => onState("error")}>
              Show error example
            </button>
          </div>
        )}
        {state === "complete" && (
          <div className="center-state">
            <span className="modal-icon success">
              <Icon name="check" />
            </span>
            <h2 id="export-title">Export complete</h2>
            <p>
              No file was produced. Connect the real renderer through the typed
              onExport callback.
            </p>
            <button className="primary full" onClick={onClose}>
              Done
            </button>
          </div>
        )}
        {state === "error" && (
          <div className="center-state">
            <span className="modal-icon error">
              <Icon name="alert" />
            </span>
            <h2 id="export-title">Export could not finish</h2>
            <p>Export failed. Your edits are safe.</p>
            <button className="primary full" onClick={begin}>
              Retry export
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

function DemoMenu({
  phase,
  voice,
  onPhase,
  onVoice,
  onClose,
}: {
  phase: ProjectPhase
  voice: VoiceState
  onPhase: (phase: ProjectPhase) => void
  onVoice: (voice: VoiceState) => void
  onClose: () => void
}) {
  return (
    <div className="demo-menu">
      <div className="demo-menu-head">
        <b>Demo states</b>
        <button className="icon-btn" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <label>
        Project
        <select
          value={phase}
          onChange={(event) => onPhase(event.target.value as ProjectPhase)}
        >
          <option value="ready">Ready</option>
          <option value="empty">Empty</option>
          <option value="uploading">Uploading</option>
          <option value="transcribing">Transcribing</option>
        </select>
      </label>
      <label>
        Voice
        <select
          value={voice}
          onChange={(event) => onVoice(event.target.value as VoiceState)}
        >
          {[
            "Disconnected",
            "Connecting",
            "Listening",
            "Thinking",
            "Speaking",
            "Applying edit",
            "Permission error",
            "Connection error",
          ].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <p>
        Prototype controls only. No microphone or backend connection is used.
      </p>
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
          ["Demo states", "transcript", "more"],
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

export function EditorShell({ callbacks = {} }: { callbacks?: EditorCallbacks }) {
  const [activeTool, setActiveTool] = useState<Tool>("transcript")
  const [mobileTab, setMobileTab] = useState<"edit" | "captions" | "audio">(
    "edit",
  )
  const [currentTime, setCurrentTime] = useState(12)
  const [playing, setPlaying] = useState(false)
  const [removed, setRemoved] = useState(false)
  const [redoAvailable, setRedoAvailable] = useState(false)
  const [proposalState, setProposalState] =
    useState<"pending" | "applying" | "applied" | "dismissed">("pending")
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>("highlight")
  const [captionSize, setCaptionSize] = useState(32)
  const [captionPosition, setCaptionPosition] = useState("Bottom")
  const [safe, setSafe] = useState(true)
  const [ratio, setRatio] = useState("16:9")
  const [guides, setGuides] = useState(false)
  const [volume, setVolume] = useState(84)
  const [music, setMusic] = useState(false)
  const [voice, setVoice] = useState<VoiceState>("Listening")
  const [zoom, setZoom] = useState(1)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportState, setExportState] = useState<ExportState>("options")
  const [moreOpen, setMoreOpen] = useState(false)
  const [demoOpen, setDemoOpen] = useState(false)
  const [phase, setPhase] = useState<ProjectPhase>("ready")
  const [previewMode, setPreviewMode] = useState<"original" | "edited">("edited")

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(
      () =>
        setCurrentTime((time) =>
          time >= duration ? 0 : Math.min(duration, time + 0.1),
        ),
      100,
    )
    return () => window.clearInterval(timer)
  }, [playing])

  const seek = (time: number) => {
    setCurrentTime(time)
    callbacks.onSeek?.(time)
  }
  const apply = () => {
    setProposalState("applying")
    setVoice("Applying edit")
    demoServices.after(900, () => {
      setRemoved(true)
      setProposalState("applied")
      setVoice("Listening")
      setRedoAvailable(false)
      callbacks.onApplyEdit?.(0)
    })
  }
  const undo = () => {
    if (removed) {
      setRemoved(false)
      setProposalState("pending")
      setRedoAvailable(true)
    }
    callbacks.onUndo?.()
  }
  const redo = () => {
    if (redoAvailable) {
      setRemoved(true)
      setProposalState("applied")
      setRedoAvailable(false)
    }
    callbacks.onRedo?.()
  }
  const changeTool = (tool: Tool) => {
    setActiveTool(tool)
    if (tool === "transcript") setMobileTab("edit")
    if (tool === "captions") setMobileTab("captions")
    if (tool === "audio") setMobileTab("audio")
  }
  const upload = (file: File) => {
    callbacks.onUpload?.(file)
    setPhase("uploading")
    demoServices.after(900, () => setPhase("transcribing"))
    demoServices.after(1900, () => setPhase("ready"))
  }

  const inspector = useMemo(() => {
    if (activeTool === "captions")
      return (
        <CaptionInspector
          style={captionStyle}
          size={captionSize}
          position={captionPosition}
          safe={safe}
          onStyle={(value) => {
            setCaptionStyle(value)
            callbacks.onCaptionChange?.(value)
          }}
          onSize={setCaptionSize}
          onPosition={setCaptionPosition}
          onSafe={setSafe}
        />
      )
    if (activeTool === "audio")
      return (
        <AudioInspector
          volume={volume}
          music={music}
          onVolume={(value) => {
            setVolume(value)
            callbacks.onAudioChange?.(value)
          }}
          onMusic={setMusic}
        />
      )
    if (activeTool === "media")
      return <MediaPanel phase={phase} onUpload={upload} />
    if (activeTool === "framing")
      return (
        <FramingControls
          ratio={ratio}
          onRatio={(value) => {
            setRatio(value)
            callbacks.onFramingChange?.(value)
          }}
          guides={guides}
          onGuides={setGuides}
        />
      )
    if (activeTool === "history")
      return <HistoryPanel removed={removed} onUndo={undo} onRedo={redo} />
    return (
      <TranscriptPanel
        currentTime={currentTime}
        removed={removed}
        proposalState={proposalState}
        onSeek={seek}
        onPropose={(id) => {
          setProposalState("pending")
          callbacks.onProposeEdit?.(id)
        }}
        onPreview={() => {
          seek(0)
          setPlaying(true)
        }}
        onApply={apply}
        onDismiss={() => setProposalState("dismissed")}
        onUndo={undo}
        onRedo={redo}
      />
    )
  }, [
    activeTool,
    captionStyle,
    captionSize,
    captionPosition,
    safe,
    volume,
    music,
    phase,
    ratio,
    guides,
    removed,
    redoAvailable,
    currentTime,
    proposalState,
  ])

  return (
    <main className="app-shell">
      <EditorHeader
        onExport={() => {
          setExportState("options")
          setExportOpen(true)
        }}
        onUndo={undo}
        onRedo={redo}
        canRedo={redoAvailable}
        onMore={() => setMoreOpen(true)}
      />
      <ToolNavigation active={activeTool} onChange={changeTool} />
      <div className="workspace">
        <div className="preview-column">
          <VideoPreview
            currentTime={currentTime}
            playing={playing}
            ratio={ratio}
            captionStyle={captionStyle}
            captionSize={captionSize}
            captionPosition={captionPosition}
            showGuides={guides}
            mode={previewMode}
            onPlay={() => setPlaying((value) => !value)}
            onSeek={seek}
            onRatio={(value) => {
              setRatio(value)
              callbacks.onFramingChange?.(value)
            }}
            onMode={setPreviewMode}
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
          <VoiceDock
            state={voice}
            onState={(value) => {
              setVoice(value)
              value === "Disconnected"
                ? callbacks.onVoiceDisconnect?.()
                : callbacks.onVoiceConnect?.()
            }}
          />
        </div>
        <aside className="desktop-inspector desktop-only">{inspector}</aside>
      </div>
      <Timeline
        currentTime={currentTime}
        zoom={zoom}
        onSeek={seek}
        onZoom={setZoom}
      />
      <button
        className="demo-trigger desktop-only"
        onClick={() => setDemoOpen((value) => !value)}
      >
        Demo states
      </button>
      {demoOpen && (
        <DemoMenu
          phase={phase}
          voice={voice}
          onPhase={setPhase}
          onVoice={setVoice}
          onClose={() => setDemoOpen(false)}
        />
      )}
      {moreOpen && (
        <MoreSheet
          onTool={(tool) => {
            if (tool === "transcript") setDemoOpen(true)
            else changeTool(tool)
          }}
          onClose={() => setMoreOpen(false)}
        />
      )}
      {exportOpen && (
        <ExportDialog
          state={exportState}
          onState={(state) => {
            setExportState(state)
            if (state === "processing") callbacks.onExport?.("mp4")
          }}
          onClose={() => setExportOpen(false)}
        />
      )}
    </main>
  )
}

export default function App() {
  return <EditorShell />
}
