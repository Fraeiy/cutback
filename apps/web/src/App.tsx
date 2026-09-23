import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import {
  present,
  type PlaybackContext,
  type PresentedProject,
  type Word,
} from "@cutback/timeline";
import { api, type Health } from "./api";
import { VoiceSession, type VoicePhase } from "./voice";
import type { ReactNode } from "react";

const PROJECT_KEY = "cutback.projectId";

type EditorTool = "Media" | "Transcript" | "Captions" | "Audio" | "History";
type IconName =
  | EditorTool
  | "play"
  | "pause"
  | "undo"
  | "redo"
  | "mic"
  | "stop"
  | "more"
  | "back"
  | "fullscreen"
  | "download";

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    Media: (
      <>
        <path d="M3 7h18v13H3z" />
        <path d="m3 12 4-4 4 4 3-3 7 7" />
      </>
    ),
    Transcript: (
      <>
        <path d="M6 3h9l4 4v14H6z" />
        <path d="M9 12h7M9 16h7M15 3v5h5" />
      </>
    ),
    Captions: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M10 10a2 2 0 1 0 0 4M18 10a2 2 0 1 0 0 4" />
      </>
    ),
    Audio: <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />,
    History: (
      <>
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 3v5h5M12 7v6l4 2" />
      </>
    ),
    play: <path d="m8 5 11 7-11 7z" />,
    pause: (
      <>
        <path d="M9 5v14M15 5v14" />
      </>
    ),
    undo: (
      <>
        <path d="m9 7-5 5 5 5" />
        <path d="M4 12h10a6 6 0 0 1 6 6" />
      </>
    ),
    redo: (
      <>
        <path d="m15 7 5 5-5 5" />
        <path d="M20 12H10a6 6 0 0 0-6 6" />
      </>
    ),
    mic: (
      <>
        <rect x="9" y="3" width="6" height="12" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </>
    ),
    stop: <rect x="7" y="7" width="10" height="10" rx="1" />,
    more: (
      <>
        <circle cx="12" cy="5" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="12" cy="19" r="1" />
      </>
    ),
    back: <path d="m15 18-6-6 6-6" />,
    fullscreen: (
      <>
        <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5" />
        <path d="M5 21h14" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

const editorTools: Array<{ id: EditorTool; label: string }> = [
  { id: "Media", label: "Media" },
  { id: "Transcript", label: "Transcript" },
  { id: "Captions", label: "Captions" },
  { id: "Audio", label: "Audio" },
  { id: "History", label: "History" },
];

function formatTime(ms: number): string {
  const clamped = Math.max(0, ms);
  const minutes = Math.floor(clamped / 60000);
  const seconds = Math.floor((clamped % 60000) / 1000);
  const frames = Math.floor((clamped % 1000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${frames}`;
}

function phaseLabel(phase: VoicePhase): string {
  switch (phase) {
    case "connecting":
      return "Connecting";
    case "listening":
      return "Listening";
    case "user":
      return "Hearing you";
    case "thinking":
      return "Thinking";
    case "editing":
      return "Editing";
    case "speaking":
      return "Speaking";
    case "error":
      return "Voice error";
    default:
      return "Mic off";
  }
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [access, setAccess] = useState(
    sessionStorage.getItem("cutback.access") ?? "",
  );
  const [unlocked, setUnlocked] = useState(false);
  const [project, setProject] = useState<PresentedProject | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [clock, setClock] = useState({ sourceMs: 0, outputMs: 0 });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("off");
  const [voiceDetail, setVoiceDetail] = useState<string | null>(null);
  const [line, setLine] = useState<{
    who: "user" | "agent";
    text: string;
  } | null>(null);
  const [level, setLevel] = useState(0);
  const [ptt, setPtt] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [compareOriginal, setCompareOriginal] = useState(false);
  const [activeTool, setActiveTool] = useState<EditorTool>("Transcript");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const voiceRef = useRef<VoiceSession | null>(null);
  const projectRef = useRef<PresentedProject | null>(null);
  const selectedRef = useRef<string[]>([]);
  const clockRef = useRef(clock);
  const wasPlaying = useRef(false);
  const compareRef = useRef(false);
  projectRef.current = project;
  selectedRef.current = selected;
  clockRef.current = clock;
  compareRef.current = compareOriginal;

  useEffect(() => {
    void api
      .health()
      .then(setHealth)
      .catch(() => setNotice("The editing server is not running."));
  }, []);

  useEffect(() => {
    if (!health) return;
    if (!health.accessTokenRequired) {
      setUnlocked(true);
      return;
    }
    if (access) setUnlocked(true);
  }, [health, access]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!unlocked) return;
    const existing = localStorage.getItem(PROJECT_KEY);
    if (!existing) return;
    void api
      .get(existing)
      .then(setProject)
      .catch(() => localStorage.removeItem(PROJECT_KEY));
  }, [unlocked]);

  useEffect(() => {
    if (!project) return;
    const running =
      project.jobs.transcription.status === "running" ||
      project.jobs.export.status === "running";
    if (!running) return;
    const timer = window.setInterval(() => {
      void api
        .get(project.id)
        .then(setProject)
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [
    project?.id,
    project?.jobs.transcription.status,
    project?.jobs.export.status,
  ]);

  const remember = (next: PresentedProject) => {
    localStorage.setItem(PROJECT_KEY, next.id);
    setProject(next);
    voiceRef.current?.refreshPrompt(next);
  };

  const ensureAudio = () => {
    if (!audioRef.current) audioRef.current = new AudioContext();
    const audio = audioRef.current;
    void audio.resume();
    return audio;
  };

  const setDuck = (value: number) => {
    if (videoRef.current)
      videoRef.current.volume = Math.max(0, Math.min(1, value));
  };

  const snapshot = useCallback(() => {
    const video = videoRef.current;
    return {
      sourceTimeMs: video
        ? video.currentTime * 1000
        : clockRef.current.sourceMs,
      outputTimeMs: clockRef.current.outputMs,
      selectedWordIds: selectedRef.current,
    };
  }, []);

  const postContext = useCallback(
    async (reason: PlaybackContext["reason"]) => {
      const current = projectRef.current;
      if (!current) return;
      await api.playback(current.id, {
        ...snapshot(),
        capturedAt: new Date().toISOString(),
        reason,
      });
    },
    [snapshot],
  );

  const runTool = async (name: string, args: Record<string, unknown>) => {
    const current = projectRef.current;
    if (!current) return;
    setBusy(name);
    setNotice(null);
    try {
      if (
        name !== "undo_edit" &&
        name !== "redo_edit" &&
        name !== "read_project_context"
      ) {
        await postContext("selection");
      }
      const response = await api.tool(
        current.id,
        name,
        args,
        crypto.randomUUID(),
      );
      remember(response.project);
      if (typeof response.result.seek_output_ms === "number")
        seekOutput(response.result.seek_output_ms, response.project);
      if (response.isError)
        setNotice(
          String(
            response.result.error ||
              response.result.message ||
              "That edit did not apply.",
          ),
        );
      else if (typeof response.result.summary === "string")
        setNotice(response.result.summary);
      else if (response.result.status === "needs_clarification")
        setNotice(String(response.result.message));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The edit failed.");
    } finally {
      setBusy(null);
    }
  };

  const seekOutput = (outputMs: number, source = projectRef.current) => {
    const video = videoRef.current;
    if (!video || !source) return;
    const segments = compareRef.current
      ? source.originalSegments
      : source.segments;
    const segment =
      segments.find(
        (item) =>
          outputMs >= item.outputStartMs && outputMs <= item.outputEndMs,
      ) ?? segments[0];
    if (!segment) return;
    video.currentTime =
      (segment.sourceStartMs + (outputMs - segment.outputStartMs)) / 1000;
  };

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const video = videoRef.current;
      const current = projectRef.current;
      if (video && current?.segments.length) {
        let sourceMs = video.currentTime * 1000;
        const segments = compareRef.current
          ? current.originalSegments
          : current.segments;
        const index = segments.findIndex(
          (segment) =>
            sourceMs >= segment.sourceStartMs && sourceMs < segment.sourceEndMs,
        );
        if (index === -1) {
          const next = segments.find(
            (segment) => segment.sourceEndMs > sourceMs + 30,
          );
          const target = next ?? segments[segments.length - 1];
          const desired = next
            ? target.sourceStartMs
            : Math.max(target.sourceStartMs, target.sourceEndMs - 40);
          if (Math.abs(sourceMs - desired) > 60) {
            video.currentTime = desired / 1000;
            sourceMs = desired;
          }
        } else if (
          !video.paused &&
          sourceMs >= segments[index].sourceEndMs - 25
        ) {
          const next = segments[index + 1];
          if (next) video.currentTime = next.sourceStartMs / 1000;
          else video.pause();
        }
        const segment =
          segments.find(
            (item) =>
              sourceMs >= item.sourceStartMs && sourceMs <= item.sourceEndMs,
          ) ?? segments[0];
        const outputMs =
          segment.outputStartMs + Math.max(0, sourceMs - segment.sourceStartMs);
        setClock({ sourceMs, outputMs });
        setPlaying(!video.paused);
        const music = musicRef.current;
        if (music && current.music && !compareRef.current) {
          const speechActive =
            current.transcript?.words.some(
              (word) => sourceMs >= word.startMs && sourceMs <= word.endMs,
            ) ?? false;
          const targetVolume = Math.max(
            0,
            Math.min(
              1,
              current.edit.audio.musicVolume *
                (current.edit.audio.duckMusic && speechActive ? 0.42 : 1),
            ),
          );
          const smoothing = Math.min(
            1,
            16 / Math.max(50, current.edit.audio.fadeMs),
          );
          music.volume += (targetVolume - music.volume) * smoothing;
          const target = outputMs / 1000;
          if (Math.abs(music.currentTime - target) > 0.3)
            music.currentTime =
              target % Math.max(1, music.duration || target + 1);
          if (!video.paused && music.paused)
            void music.play().catch(() => undefined);
          if (video.paused && !music.paused) music.pause();
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      )
        return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void runTool(event.shiftKey ? "redo_edit" : "undo_edit", {});
      } else if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedRef.current.length) {
          event.preventDefault();
          void runTool("propose_cut", { action: "remove", use: "selection" });
        }
      } else if (event.key === " " && !ptt) {
        event.preventDefault();
        togglePlay();
      } else if (
        (event.key === "v" || event.key === "V") &&
        ptt &&
        voiceRef.current
      ) {
        if (event.type === "keydown" && !event.repeat)
          voiceRef.current.setHeld(true);
      }
    };
    const up = (event: KeyboardEvent) => {
      if ((event.key === "v" || event.key === "V") && ptt)
        voiceRef.current?.setHeld(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", up);
    };
  }, [ptt, project?.id]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    ensureAudio();
    if (video.paused) void video.play();
    else video.pause();
  };

  const onUpload = async (file: File, fresh = false) => {
    voiceRef.current?.end();
    voiceRef.current = null;
    setVoicePhase("off");
    setLine(null);
    setBusy("upload");
    setNotice(null);
    try {
      const created =
        !fresh && project
          ? project
          : await api.create(file.name.replace(/\.[^.]+$/, ""));
      const next = await api.upload(created.id, file);
      remember(next);
      setSelected([]);
      if (health?.assemblyai) {
        const transcribing = await api.transcribe(next.id);
        remember(transcribing);
      } else {
        setNotice(
          "Video is in. Add ASSEMBLYAI_API_KEY on the server, then transcribe it.",
        );
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(null);
    }
  };

  const loadDemo = async () => {
    setBusy("demo");
    setNotice(null);
    try {
      const next = await api.demo();
      remember(next);
      setSelected([]);
      setNotice(
        "Demo loaded. The transcript is a measured fixture until you transcribe it with AssemblyAI.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Demo failed to load.",
      );
    } finally {
      setBusy(null);
    }
  };

  const startVoice = async () => {
    if (!projectRef.current) return;
    if (!health?.assemblyai) {
      setNotice(
        "Add ASSEMBLYAI_API_KEY on the server before starting the voice agent.",
      );
      return;
    }
    const audio = ensureAudio();
    voiceRef.current?.end();
    const session = new VoiceSession(
      projectRef.current.id,
      {
        onPhase: (phase, detail) => {
          setVoicePhase(phase);
          setVoiceDetail(detail ?? null);
        },
        onLine: (who, text) => setLine({ who, text }),
        onLevel: setLevel,
        onProject: (next) => {
          setProject(next);
          projectRef.current = next;
        },
        onSeek: (outputMs) => seekOutput(outputMs),
        snapshot,
        onUserSpeech: (active) => {
          const video = videoRef.current;
          if (!video) return;
          if (active) {
            wasPlaying.current = !video.paused;
            video.pause();
          } else if (wasPlaying.current) {
            void video.play().catch(() => undefined);
          }
        },
      },
      audio,
    );
    voiceRef.current = session;
    setDuck(ptt ? 1 : 0.22);
    try {
      await session.start(projectRef.current);
    } catch (error) {
      setVoicePhase("error");
      setVoiceDetail(
        error instanceof Error
          ? error.message
          : "Microphone or voice token failed.",
      );
    }
  };

  const stopVoice = () => {
    voiceRef.current?.end();
    voiceRef.current = null;
    setDuck(1);
    setVoicePhase("off");
  };

  useEffect(() => {
    const end = () => {
      if (voiceRef.current) voiceRef.current.end();
    };
    window.addEventListener("pagehide", end);
    return () => window.removeEventListener("pagehide", end);
  }, []);

  useEffect(() => {
    if (voicePhase === "off") setDuck(1);
    else setDuck(ptt ? 1 : 0.22);
  }, [ptt, voicePhase]);

  const activeCue = useMemo(() => {
    if (!project?.edit.captions.enabled || compareOriginal) return null;
    return (
      project.cues.find(
        (cue) =>
          clock.outputMs >= cue.outputStartMs &&
          clock.outputMs <= cue.outputEndMs,
      ) ?? null
    );
  }, [
    project?.cues,
    project?.edit.captions.enabled,
    clock.outputMs,
    compareOriginal,
  ]);

  const onWordClick = (word: Word, event: MouseEvent) => {
    const words = project?.transcript?.words ?? [];
    if (event.shiftKey && selected.length) {
      const ids = words.map((item) => item.id);
      const start = ids.indexOf(selected[0]);
      const end = ids.indexOf(word.id);
      const [from, to] = start < end ? [start, end] : [end, start];
      setSelected(ids.slice(from, to + 1));
    } else {
      setSelected([word.id]);
    }
    const video = videoRef.current;
    if (video && project && !project.removedWordIds.includes(word.id)) {
      ensureAudio();
      video.currentTime = word.startMs / 1000;
    }
  };

  if (!health) {
    return (
      <main className="gate">
        <p className="mark">Cutback</p>
        <p>{notice || "Connecting to the editor."}</p>
      </main>
    );
  }

  if (!unlocked) {
    return (
      <main className="gate">
        <p className="mark">Cutback</p>
        <p>
          This server asks for an access token before it will spend the
          AssemblyAI key.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            sessionStorage.setItem("cutback.access", access);
            setUnlocked(true);
          }}
        >
          <input
            value={access}
            onChange={(event) => setAccess(event.target.value)}
            placeholder="Access token"
            autoFocus
          />
          <button type="submit">Continue</button>
        </form>
      </main>
    );
  }

  const exportReady =
    project?.jobs.export.status === "completed" &&
    project.jobs.export.revision === project.revision;
  const framing = project?.edit.framing;

  return (
    <div className="app">
      <header className="editor-header">
        <div className="brand">
          <span className="logo-mark" aria-hidden="true">
            <i />
            <i />
          </span>
          <strong className="wordmark">cutback</strong>
          <span className="breadcrumb">
            <span>Projects / </span>
            {project?.title ?? "Untitled project"}
          </span>
          <span className="saved">
            <i />
            {project ? "Saved" : "New project"}
          </span>
        </div>
        <div className="header-actions">
          <label className={busy ? "file-btn disabled" : "file-btn"}>
            <span className="desktop-label">Upload</span>
            <span className="mobile-label">+</span>
            <input
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv,.m4v"
              hidden
              disabled={busy !== null}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void onUpload(file, true);
              }}
            />
          </label>
          <button
            className="icon-button desktop-action"
            aria-label="Undo"
            disabled={!project || busy !== null}
            onClick={() => void runTool("undo_edit", {})}
          >
            <Icon name="undo" />
          </button>
          <button
            className="icon-button desktop-action"
            aria-label="Redo"
            disabled={!project || busy !== null}
            onClick={() => void runTool("redo_edit", {})}
          >
            <Icon name="redo" />
          </button>
          <button
            className="primary export-button"
            disabled={
              !project?.media ||
              busy !== null ||
              project.jobs.export.status === "running"
            }
            onClick={() => setExportOpen(true)}
          >
            Export
          </button>
          <button
            className="icon-button mobile-action"
            aria-label="More tools"
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            <Icon name="more" />
          </button>
        </div>
      </header>

      <nav className="tool-nav" aria-label="Editor tools">
        {editorTools.map((tool) => (
          <button
            key={tool.id}
            className={activeTool === tool.id ? "active" : ""}
            onClick={() => setActiveTool(tool.id)}
          >
            <Icon name={tool.id} size={23} />
            <span>{tool.label}</span>
          </button>
        ))}
      </nav>

      {mobileMenuOpen ? (
        <div className="mobile-tool-menu">
          <button
            onClick={() => {
              setActiveTool("Media");
              setMobileMenuOpen(false);
            }}
          >
            Media & framing
          </button>
          <button
            onClick={() => {
              setActiveTool("History");
              setMobileMenuOpen(false);
            }}
          >
            History
          </button>
          <button onClick={() => void runTool("undo_edit", {})}>Undo</button>
          <button onClick={() => void runTool("redo_edit", {})}>Redo</button>
        </div>
      ) : null}

      <div className="workspace">
        <section className="stage-wrap">
          <div className="preview-top">
            <span>Preview</span>
            <div>
              <button
                className={!compareOriginal ? "on" : ""}
                onClick={() => {
                  setCompareOriginal(false);
                  seekOutput(0);
                }}
              >
                Edited
              </button>
              <button
                className={compareOriginal ? "on" : ""}
                onClick={() => {
                  setCompareOriginal(true);
                  seekOutput(0);
                }}
              >
                Original
              </button>
              <select
                aria-label="Aspect ratio"
                value={framing?.mode ?? "original"}
                disabled={!project?.media}
                onChange={(event) =>
                  void runTool("set_aspect_ratio", { mode: event.target.value })
                }
              >
                <option value="original">Original</option>
                <option value="wide">16:9</option>
                <option value="square">1:1</option>
                <option value="vertical">9:16</option>
              </select>
            </div>
          </div>
          {project?.media ? (
            <div className={`frame ${framing?.mode ?? "original"}`}>
              <video
                ref={videoRef}
                key={project.media.storedName + project.id}
                src={`/api/projects/${project.id}/media`}
                playsInline
                preload="metadata"
                onPlay={() => ensureAudio()}
                style={
                  framing && framing.mode !== "original"
                    ? {
                        objectFit: "cover",
                        objectPosition: `${(framing.focus ?? 0.5) * 100}% 50%`,
                      }
                    : undefined
                }
              />
              {framing?.mode !== "original" ? (
                <div className="safe-area" aria-label="Caption safe area" />
              ) : null}
              {activeCue ? (
                <p
                  className="caption"
                  style={{
                    top: `${project.edit.captions.positionY * 100}%`,
                    color: project.edit.captions.color,
                    fontSize: `${project.edit.captions.fontScale}em`,
                    fontFamily: project.edit.captions.fontFamily,
                    background: project.edit.captions.background,
                  }}
                >
                  {activeCue.words.map((word) => {
                    const active =
                      clock.outputMs >= word.outputStartMs &&
                      clock.outputMs <= word.outputEndMs;
                    return (
                      <span
                        key={word.id}
                        style={
                          active && project.edit.captions.wordHighlight
                            ? { color: project.edit.captions.highlightColor }
                            : undefined
                        }
                      >
                        {word.text}{" "}
                      </span>
                    );
                  })}
                </p>
              ) : null}
              {project.music ? (
                <audio
                  ref={musicRef}
                  src={`/api/projects/${project.id}/music`}
                  loop
                  preload="auto"
                />
              ) : null}
            </div>
          ) : (
            <div
              className="drop"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files?.[0];
                if (file) void onUpload(file);
              }}
            >
              <label>
                <input
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm,video/x-matroska"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void onUpload(file);
                  }}
                />
                <span className="mark">Drop a short video</span>
                <span>MP4, MOV, WEBM, or MKV. Up to 2 minutes and 200 MB.</span>
              </label>
              <button
                type="button"
                onClick={() => void loadDemo()}
                disabled={busy !== null}
              >
                Load the demo
              </button>
            </div>
          )}
          <div className="playback-controls">
            <button
              className="transport"
              disabled={!project?.media}
              onClick={togglePlay}
              aria-label={playing ? "Pause" : "Play"}
            >
              <Icon name={playing ? "pause" : "play"} />
            </button>
            <input
              aria-label="Playback position"
              type="range"
              min={0}
              max={Math.max(
                1,
                compareOriginal
                  ? (project?.media?.durationMs ?? 0)
                  : (project?.outputDurationMs ?? 0),
              )}
              value={clock.outputMs}
              disabled={!project?.media}
              onChange={(event) => seekOutput(Number(event.target.value))}
            />
            <span>
              {formatTime(clock.outputMs)} /{" "}
              {formatTime(
                compareOriginal
                  ? (project?.media?.durationMs ?? 0)
                  : (project?.outputDurationMs ?? 0),
              )}
            </span>
            <button
              className="transport"
              disabled={!project?.media}
              aria-label="Fullscreen preview"
              onClick={() =>
                void videoRef.current?.parentElement?.requestFullscreen?.()
              }
            >
              <Icon name="fullscreen" />
            </button>
          </div>
          <div className="mobile-tabs" role="tablist">
            {(["Transcript", "Captions", "Audio"] as EditorTool[]).map(
              (tool) => (
                <button
                  role="tab"
                  aria-selected={activeTool === tool}
                  key={tool}
                  className={activeTool === tool ? "active" : ""}
                  onClick={() => setActiveTool(tool)}
                >
                  {tool === "Transcript" ? "Edit" : tool}
                </button>
              ),
            )}
          </div>
          {activeTool === "Transcript" ? (
            <div className="mobile-timeline">
              <Timeline
                project={project}
                original={compareOriginal}
                outputMs={clock.outputMs}
                onSeek={(ms) => {
                  ensureAudio();
                  seekOutput(ms);
                }}
              />
            </div>
          ) : null}
          {project?.media && !project.transcript ? (
            <div className="status-row">
              <span>
                {project.jobs.transcription.status === "running"
                  ? "Transcribing with AssemblyAI"
                  : project.jobs.transcription.status === "error"
                    ? project.jobs.transcription.error
                    : "Ready to transcribe"}
              </span>
              <button
                disabled={
                  project.jobs.transcription.status === "running" ||
                  !health.assemblyai
                }
                onClick={() =>
                  void api
                    .transcribe(project.id)
                    .then(remember)
                    .catch((error: Error) => setNotice(error.message))
                }
              >
                {project.jobs.transcription.status === "error"
                  ? "Retry transcription"
                  : "Transcribe"}
              </button>
            </div>
          ) : null}
        </section>

        <aside
          className={`transcript inspector tool-${activeTool.toLowerCase()}`}
        >
          <div className="aside-head tool-heading">
            <div>
              <h2>{activeTool}</h2>
              <small>
                {activeTool === "Transcript"
                  ? "Select words to edit"
                  : activeTool === "Captions"
                    ? "Style text on your video"
                    : activeTool === "Audio"
                      ? "Balance speech and music"
                      : activeTool === "Media"
                        ? "Source and framing"
                        : "Applied project edits"}
              </small>
            </div>
            {activeTool === "Transcript" ? (
              <span>
                {selected.length
                  ? `${selected.length} selected`
                  : "Click a word"}
              </span>
            ) : null}
          </div>
          {project?.transcriptSource === "demo-fixture" ? (
            <p className="fixture transcript-section">
              Demo fixture. Sentence timing is measured. Word timing inside a
              sentence is evenly split until AssemblyAI transcribes it.
            </p>
          ) : null}
          <div className="sentences transcript-section">
            {project?.transcript?.sentences.map((sentence) => {
              const removed = sentence.wordIds.every((id) =>
                project.removedWordIds.includes(id),
              );
              return (
                <p
                  key={sentence.id}
                  className={removed ? "sentence gone" : "sentence"}
                >
                  <button
                    className="sid"
                    onClick={() => {
                      setSelected(sentence.wordIds);
                      const video = videoRef.current;
                      if (video && !removed) {
                        ensureAudio();
                        video.currentTime = sentence.startMs / 1000;
                      }
                    }}
                  >
                    {sentence.id}
                  </button>
                  {sentence.wordIds.map((id) => {
                    const word = project.transcript?.words.find(
                      (item) => item.id === id,
                    );
                    if (!word) return null;
                    const isRemoved = project.removedWordIds.includes(id);
                    const marked = project.highlight?.ranges.some(
                      (range) =>
                        word.endMs > range.startMs &&
                        word.startMs < range.endMs,
                    );
                    const active =
                      !isRemoved &&
                      clock.sourceMs >= word.startMs &&
                      clock.sourceMs < word.endMs;
                    return (
                      <button
                        key={id}
                        className={[
                          "word",
                          isRemoved ? "removed" : "",
                          selected.includes(id) ? "selected" : "",
                          marked
                            ? project.highlight?.pending
                              ? "pending"
                              : "marked"
                            : "",
                          active ? "active" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={(event) => onWordClick(word, event)}
                      >
                        {word.text}
                      </button>
                    );
                  })}
                </p>
              );
            })}
            {!project?.transcript ? (
              <p className="empty">
                The transcript shows up here after transcription.
              </p>
            ) : null}
          </div>
          <div className="edit-actions transcript-section">
            <button
              disabled={!project?.media}
              onClick={() => {
                setCompareOriginal((value) => !value);
                videoRef.current?.pause();
                seekOutput(0);
              }}
            >
              {compareOriginal ? "Return to edit" : "Compare original"}
            </button>
            <button
              disabled={!selected.length || busy !== null}
              onClick={() =>
                void runTool("propose_cut", {
                  action: "remove",
                  use: "selection",
                })
              }
            >
              Cut selection
            </button>
            <button
              disabled={!selected.length || busy !== null}
              onClick={() =>
                void runTool("restore_section", { use: "selection" })
              }
            >
              Restore selection
            </button>
            <button
              disabled={!selected.length || busy !== null}
              onClick={() =>
                void runTool("reorder_sections", {
                  moving_use: "selection",
                  place: "start",
                })
              }
            >
              Move to start
            </button>
            <button
              disabled={!project?.transcript || busy !== null}
              onClick={() =>
                void runTool("propose_pause_shortening", {
                  threshold_ms: 800,
                  retain_ms: project?.edit.pause.retainMs || 180,
                })
              }
            >
              Shorten pauses
            </button>
            <button
              disabled={!project?.transcript || busy !== null}
              onClick={() =>
                void runTool("set_caption_style", {
                  enabled: !project?.edit.captions.enabled,
                })
              }
            >
              {project?.edit.captions.enabled ? "Hide captions" : "Captions"}
            </button>
            <button
              disabled={!project?.media || busy !== null}
              onClick={() =>
                void runTool("set_aspect_ratio", {
                  mode:
                    project?.edit.framing.mode === "vertical"
                      ? "original"
                      : "vertical",
                })
              }
            >
              {project?.edit.framing.mode === "vertical"
                ? "Original frame"
                : "Vertical"}
            </button>
            <button
              disabled={!project?.transcript || busy !== null}
              onClick={() =>
                void runTool("suggest_shorter_cut", {
                  target_seconds: 30,
                  focus: "main announcement",
                })
              }
            >
              Suggest 30s cut
            </button>
          </div>
          {project?.transcript ? (
            <section className="control-panel caption-section">
              <strong>Caption style</strong>
              <div className="compact-row">
                {(["clean", "bold", "minimal"] as const).map((preset) => (
                  <button
                    key={preset}
                    className={`preset-card ${project.edit.captions.preset === preset ? "on" : ""}`}
                    onClick={() =>
                      void runTool("set_caption_style", {
                        enabled: true,
                        preset,
                      })
                    }
                  >
                    <b>Your words</b>
                    <span>{preset === "minimal" ? "Minimal" : preset}</span>
                  </button>
                ))}
              </div>
              <button
                className={project.edit.captions.enabled ? "on" : ""}
                onClick={() =>
                  void runTool("set_caption_style", {
                    enabled: !project.edit.captions.enabled,
                  })
                }
              >
                {project.edit.captions.enabled
                  ? "Captions on"
                  : "Turn captions on"}
              </button>
              <label>
                Size{" "}
                <input
                  type="range"
                  min="0.7"
                  max="1.8"
                  step="0.1"
                  value={project.edit.captions.fontScale}
                  onChange={(event) =>
                    void runTool("set_caption_style", {
                      enabled: true,
                      font_scale: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                Text{" "}
                <input
                  type="color"
                  value={project.edit.captions.color}
                  onChange={(event) =>
                    void runTool("set_caption_style", {
                      enabled: true,
                      color: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                Highlight{" "}
                <input
                  type="color"
                  value={project.edit.captions.highlightColor}
                  onChange={(event) =>
                    void runTool("set_caption_style", {
                      enabled: true,
                      word_highlight: true,
                      highlight_color: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                Position{" "}
                <span className="positions">
                  {(["top", "center", "bottom"] as const).map((position) => (
                    <button
                      key={position}
                      className={
                        project.edit.captions.position === position ? "on" : ""
                      }
                      onClick={() =>
                        void runTool("set_caption_style", {
                          enabled: true,
                          position,
                        })
                      }
                    >
                      {position === "center" ? "Middle" : position}
                    </button>
                  ))}
                </span>
              </label>
              <label>
                Fine height{" "}
                <input
                  type="range"
                  min="0.08"
                  max="0.92"
                  step="0.02"
                  value={project.edit.captions.positionY}
                  onChange={(event) =>
                    void runTool("set_caption_style", {
                      enabled: true,
                      position_y: Number(event.target.value),
                    })
                  }
                />
              </label>
            </section>
          ) : null}
          {project?.media ? (
            <section className="control-panel media-section media-card">
              <strong>{project.media.filename}</strong>
              <small>
                {project.media.width} × {project.media.height} ·{" "}
                {formatTime(project.media.durationMs)} ·{" "}
                {project.media.hasAudio ? "Audio detected" : "No audio track"}
              </small>
              <strong>Frame</strong>
              <div className="compact-row">
                {(["original", "wide", "square", "vertical"] as const).map(
                  (mode) => (
                    <button
                      key={mode}
                      className={project.edit.framing.mode === mode ? "on" : ""}
                      onClick={() => void runTool("set_aspect_ratio", { mode })}
                    >
                      {mode === "wide"
                        ? "16:9"
                        : mode === "square"
                          ? "1:1"
                          : mode === "vertical"
                            ? "9:16"
                            : "Original"}
                    </button>
                  ),
                )}
              </div>
            </section>
          ) : null}
          {project && project.edit.framing.mode !== "original" ? (
            <label className="focus media-section">
              Crop position
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={project.edit.framing.focus}
                onChange={(event) => {
                  const focus = Number(event.target.value);
                  setProject(
                    present({
                      ...project,
                      edit: {
                        ...project.edit,
                        framing: { ...project.edit.framing, focus },
                      },
                    }),
                  );
                }}
                onPointerUp={(event) => {
                  const focus = Number(
                    (event.target as HTMLInputElement).value,
                  );
                  void runTool("set_aspect_ratio", {
                    mode: project.edit.framing.mode,
                    focus,
                  });
                }}
              />
            </label>
          ) : null}
          {project?.media ? (
            <section className="control-panel audio-section">
              <strong>Audio</strong>
              <label>
                Speech {Math.round(project.edit.audio.speechVolume * 100)}%{" "}
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.05"
                  value={project.edit.audio.speechVolume}
                  onChange={(event) =>
                    void runTool("set_audio_mix", {
                      speech_volume: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label className="file-btn">
                {project.music
                  ? `Music: ${project.music.filename}`
                  : "Add background music"}
                <input
                  hidden
                  type="file"
                  accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file)
                      void api
                        .uploadMusic(project.id, file)
                        .then(remember)
                        .catch((error: Error) => setNotice(error.message));
                  }}
                />
              </label>
              {project.music ? (
                <>
                  <label>
                    Music {Math.round(project.edit.audio.musicVolume * 100)}%{" "}
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.02"
                      value={project.edit.audio.musicVolume}
                      onChange={(event) =>
                        void runTool("set_audio_mix", {
                          music_volume: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <button
                    className={project.edit.audio.duckMusic ? "on" : ""}
                    onClick={() =>
                      void runTool("set_audio_mix", {
                        duck_music: !project.edit.audio.duckMusic,
                      })
                    }
                  >
                    Lower under speech
                  </button>
                </>
              ) : null}
            </section>
          ) : null}
          {project?.proposals
            .filter(
              (item) => item.kind === "shorter" && item.status === "pending",
            )
            .map((proposal) => (
              <section
                className="proposal transcript-section"
                key={proposal.id}
              >
                <strong>{proposal.summary}</strong>
                <small>{proposal.explanation}</small>
                <ol>
                  {proposal.sequence?.map((item) => (
                    <li key={item.sentenceId}>{item.text}</li>
                  ))}
                </ol>
                <div className="compact-row">
                  <button
                    onClick={() => {
                      const first = proposal.sequence?.[0];
                      if (first)
                        void runTool("preview_segment", {
                          sentence_id: first.sentenceId,
                        });
                    }}
                  >
                    Preview
                  </button>
                  <button
                    onClick={() =>
                      void runTool("revise_shorter_cut", {
                        proposal_id: proposal.id,
                        keep_first_question: true,
                      })
                    }
                  >
                    Keep first question
                  </button>
                  <button
                    onClick={() =>
                      void runTool("apply_edit", { proposal_id: proposal.id })
                    }
                  >
                    Approve
                  </button>
                </div>
              </section>
            ))}
          {project?.edit.history.length ? (
            <section className="history history-section">
              <strong>Edit history</strong>
              <ol>
                {[...project.edit.history]
                  .reverse()
                  .slice(0, 20)
                  .map((entry) => (
                    <li key={entry.id}>{entry.summary}</li>
                  ))}
              </ol>
            </section>
          ) : (
            <p className="empty history-section">No edits applied yet.</p>
          )}
          {project?.edit.pause.thresholdMs ? (
            <label className="focus transcript-section">
              Kept silence {project.edit.pause.retainMs} ms
              <input
                type="range"
                min={0}
                max={Math.max(200, project.edit.pause.thresholdMs)}
                step={20}
                value={project.edit.pause.retainMs}
                onChange={(event) => {
                  const retainMs = Number(event.target.value);
                  setProject(
                    present({
                      ...project,
                      edit: {
                        ...project.edit,
                        pause: { ...project.edit.pause, retainMs },
                      },
                    }),
                  );
                }}
                onPointerUp={(event) => {
                  const retainMs = Number(
                    (event.target as HTMLInputElement).value,
                  );
                  void runTool("propose_pause_shortening", {
                    threshold_ms: project.edit.pause.thresholdMs,
                    retain_ms: retainMs,
                  });
                }}
              />
            </label>
          ) : null}
        </aside>
      </div>

      <section className="voicebar">
        <button
          className={voicePhase === "off" ? "mic" : "mic live"}
          aria-label={
            voicePhase === "off" ? "Start microphone" : "Disconnect microphone"
          }
          onClick={() =>
            voicePhase === "off" ? void startVoice() : stopVoice()
          }
        >
          <Icon name={voicePhase === "off" ? "mic" : "stop"} size={24} />
          <span>{voicePhase === "off" ? "Start mic" : "Stop"}</span>
        </button>
        <button
          className={ptt ? "toggle on" : "toggle"}
          onPointerDown={() => {
            if (!ptt || voicePhase === "off") return;
            voiceRef.current?.setHeld(true);
          }}
          onPointerUp={() => voiceRef.current?.setHeld(false)}
          onPointerLeave={() => voiceRef.current?.setHeld(false)}
          onClick={() => {
            const next = !ptt;
            setPtt(next);
            voiceRef.current?.setPushToTalk(next);
            voiceRef.current?.setHeld(false);
          }}
        >
          {ptt ? "Hold V to talk" : "Open mic"}
        </button>
        <div className="meter" aria-hidden>
          <span style={{ width: `${Math.min(100, level * 420)}%` }} />
        </div>
        <div className="voice-copy">
          <strong>
            {voicePhase !== "off" && level > 0.02
              ? "Mic hears you"
              : phaseLabel(voicePhase)}
          </strong>
          <em>
            {voiceDetail ||
              (line
                ? `${line.who === "user" ? "You" : "Cutback"}: ${line.text}`
                : "The bar should jump while you talk.")}
          </em>
        </div>
      </section>

      <div className="desktop-timeline">
        <Timeline
          project={project}
          original={compareOriginal}
          outputMs={clock.outputMs}
          onSeek={(ms) => {
            ensureAudio();
            seekOutput(ms);
          }}
        />
      </div>
      {notice ? <p className="notice">{notice}</p> : null}
      {exportOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setExportOpen(false)}
        >
          <section
            className="export-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label="Close export"
              onClick={() => setExportOpen(false)}
            >
              ×
            </button>
            <h2 id="export-title">
              {exportReady
                ? "Your video is ready"
                : project?.jobs.export.status === "running"
                  ? "Exporting video"
                  : project?.jobs.export.status === "error"
                    ? "Export failed"
                    : "Export video"}
            </h2>
            {project?.jobs.export.status === "running" ? (
              <>
                <p>
                  Rendering the edited timeline, framing, captions and audio.
                </p>
                <progress max={1} value={project.jobs.export.progress} />
                <strong>
                  {Math.round(project.jobs.export.progress * 100)}%
                </strong>
              </>
            ) : exportReady && project ? (
              <>
                <p>
                  {project.title} · {formatTime(project.outputDurationMs)}
                </p>
                <a
                  className="download primary"
                  href={`/api/projects/${project.id}/export`}
                >
                  <Icon name="download" /> Download MP4
                </a>
                <a
                  className="download secondary"
                  href={`/api/projects/${project.id}/subtitles.srt`}
                >
                  <Icon name="download" /> Download SRT
                </a>
                <small>
                  SRT follows the edited timeline. Visual caption styling is
                  embedded only in the MP4.
                </small>
              </>
            ) : (
              <>
                <p>
                  {project?.jobs.export.error ||
                    "Exports an MP4 from the same timeline used by this preview."}
                </p>
                <div className="format-row">
                  <button className="on">
                    MP4 <small>Video + styled captions</small>
                  </button>
                  <button disabled>
                    SRT <small>Available after export</small>
                  </button>
                </div>
                <button
                  className="primary export-submit"
                  disabled={!project?.media || busy !== null}
                  onClick={() => void runTool("export_video", {})}
                >
                  {project?.jobs.export.status === "error"
                    ? "Retry export"
                    : "Export MP4"}
                </button>
              </>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

function Timeline({
  project,
  original,
  outputMs,
  onSeek,
}: {
  project: PresentedProject | null;
  original: boolean;
  outputMs: number;
  onSeek: (ms: number) => void;
}) {
  const segments = original
    ? (project?.originalSegments ?? [])
    : (project?.segments ?? []);
  const duration = segments.length
    ? segments[segments.length - 1].outputEndMs
    : 0;
  const playhead = duration > 0 ? (outputMs / duration) * 100 : 0;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <section
      className="timeline"
      onClick={(event) => {
        if (!duration) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const ratio = (event.clientX - rect.left) / rect.width;
        onSeek(Math.max(0, Math.min(duration, ratio * duration)));
      }}
    >
      <div className="timeline-toolbar">
        <strong>Timeline</strong>
        <span>{formatTime(duration)} duration</span>
        <span>{project?.edit.history.length ?? 0} edits</span>
      </div>
      <div className="ruler">
        {ticks.map((tick) => (
          <span key={tick}>{formatTime(duration * tick)}</span>
        ))}
      </div>
      <div className="timeline-row video-row">
        <b>Video</b>
        <div className="track">
          {segments.map((segment, index) => {
            const left = (segment.outputStartMs / duration) * 100;
            const width =
              ((segment.outputEndMs - segment.outputStartMs) / duration) * 100;
            return (
              <i
                key={segment.id}
                style={{ left: `${left}%`, width: `${width}%` }}
              >
                <span>{index + 1}</span>
              </i>
            );
          })}
          <em className="playhead" style={{ left: `${playhead}%` }} />
        </div>
      </div>
      <div className="timeline-row caption-row">
        <b>CC&nbsp; Captions</b>
        <div className="caption-blocks">
          {project?.cues.map((cue) => (
            <i
              key={cue.id}
              title={cue.text}
              style={{
                left: `${(cue.outputStartMs / Math.max(1, duration)) * 100}%`,
                width: `${((cue.outputEndMs - cue.outputStartMs) / Math.max(1, duration)) * 100}%`,
              }}
            >
              {cue.text}
            </i>
          ))}
        </div>
      </div>
      <div className="timeline-row speech-row">
        <b>Audio</b>
        <div className="speech-activity">
          {project?.cues
            .flatMap((cue) => cue.words)
            .map((word) => (
              <i
                key={word.id}
                style={{
                  left: `${(word.outputStartMs / Math.max(1, duration)) * 100}%`,
                  width: `${Math.max(0.18, ((word.outputEndMs - word.outputStartMs) / Math.max(1, duration)) * 100)}%`,
                }}
              />
            ))}
        </div>
      </div>
    </section>
  );
}
