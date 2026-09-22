import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { present, type PlaybackContext, type PresentedProject, type Word } from "@cutback/timeline";
import { api, type Health } from "./api";
import { VoiceSession, type VoicePhase } from "./voice";

const PROJECT_KEY = "cutback.projectId";

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
  const [access, setAccess] = useState(sessionStorage.getItem("cutback.access") ?? "");
  const [unlocked, setUnlocked] = useState(false);
  const [project, setProject] = useState<PresentedProject | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [clock, setClock] = useState({ sourceMs: 0, outputMs: 0 });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("off");
  const [voiceDetail, setVoiceDetail] = useState<string | null>(null);
  const [line, setLine] = useState<{ who: "user" | "agent"; text: string } | null>(null);
  const [level, setLevel] = useState(0);
  const [ptt, setPtt] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [compareOriginal, setCompareOriginal] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
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
    void api.health().then(setHealth).catch(() => setNotice("The editing server is not running."));
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
    if (!unlocked) return;
    const existing = localStorage.getItem(PROJECT_KEY);
    if (!existing) return;
    void api.get(existing).then(setProject).catch(() => localStorage.removeItem(PROJECT_KEY));
  }, [unlocked]);

  useEffect(() => {
    if (!project) return;
    const running = project.jobs.transcription.status === "running" || project.jobs.export.status === "running";
    if (!running) return;
    const timer = window.setInterval(() => {
      void api.get(project.id).then(setProject).catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [project?.id, project?.jobs.transcription.status, project?.jobs.export.status]);

  const remember = (next: PresentedProject) => {
    localStorage.setItem(PROJECT_KEY, next.id);
    setProject(next);
    voiceRef.current?.refreshPrompt(next);
  };

  const ensureAudio = () => {
    if (!audioRef.current) audioRef.current = new AudioContext();
    const audio = audioRef.current;
    const video = videoRef.current as (HTMLVideoElement & { cutbackGraph?: boolean }) | null;
    if (video && !video.cutbackGraph) {
      const source = audio.createMediaElementSource(video);
      const gain = audio.createGain();
      source.connect(gain).connect(audio.destination);
      gainRef.current = gain;
      video.cutbackGraph = true;
    }
    void audio.resume();
    return audio;
  };

  const setDuck = (value: number) => {
    const audio = audioRef.current;
    const gain = gainRef.current;
    if (!audio || !gain) {
      if (videoRef.current) videoRef.current.volume = value;
      return;
    }
    gain.gain.setTargetAtTime(value, audio.currentTime, 0.04);
  };

  const snapshot = useCallback(() => {
    const video = videoRef.current;
    return {
      sourceTimeMs: video ? video.currentTime * 1000 : clockRef.current.sourceMs,
      outputTimeMs: clockRef.current.outputMs,
      selectedWordIds: selectedRef.current,
    };
  }, []);

  const postContext = useCallback(
    async (reason: PlaybackContext["reason"]) => {
      const current = projectRef.current;
      if (!current) return;
      await api.playback(current.id, { ...snapshot(), capturedAt: new Date().toISOString(), reason });
    },
    [snapshot],
  );

  const runTool = async (name: string, args: Record<string, unknown>) => {
    const current = projectRef.current;
    if (!current) return;
    setBusy(name);
    setNotice(null);
    try {
      if (name !== "undo_edit" && name !== "redo_edit" && name !== "read_project_context") {
        await postContext("selection");
      }
      const response = await api.tool(current.id, name, args, crypto.randomUUID());
      remember(response.project);
      if (typeof response.result.seek_output_ms === "number") seekOutput(response.result.seek_output_ms, response.project);
      if (response.isError) setNotice(String(response.result.error || response.result.message || "That edit did not apply."));
      else if (typeof response.result.summary === "string") setNotice(response.result.summary);
      else if (response.result.status === "needs_clarification") setNotice(String(response.result.message));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The edit failed.");
    } finally {
      setBusy(null);
    }
  };

  const seekOutput = (outputMs: number, source = projectRef.current) => {
    const video = videoRef.current;
    if (!video || !source) return;
    const segments = compareRef.current ? source.originalSegments : source.segments;
    const segment = segments.find((item) => outputMs >= item.outputStartMs && outputMs <= item.outputEndMs) ?? segments[0];
    if (!segment) return;
    video.currentTime = (segment.sourceStartMs + (outputMs - segment.outputStartMs)) / 1000;
  };

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const video = videoRef.current;
      const current = projectRef.current;
      if (video && current?.segments.length) {
        let sourceMs = video.currentTime * 1000;
        const segments = compareRef.current ? current.originalSegments : current.segments;
        const index = segments.findIndex((segment) => sourceMs >= segment.sourceStartMs && sourceMs < segment.sourceEndMs);
        if (index === -1) {
          const next = segments.find((segment) => segment.sourceEndMs > sourceMs + 30);
          const target = next ?? segments[segments.length - 1];
          const desired = next ? target.sourceStartMs : Math.max(target.sourceStartMs, target.sourceEndMs - 40);
          if (Math.abs(sourceMs - desired) > 60) {
            video.currentTime = desired / 1000;
            sourceMs = desired;
          }
        } else if (!video.paused && sourceMs >= segments[index].sourceEndMs - 25) {
          const next = segments[index + 1];
          if (next) video.currentTime = next.sourceStartMs / 1000;
          else video.pause();
        }
        const segment =
          segments.find((item) => sourceMs >= item.sourceStartMs && sourceMs <= item.sourceEndMs) ?? segments[0];
        const outputMs = segment.outputStartMs + Math.max(0, sourceMs - segment.sourceStartMs);
        setClock({ sourceMs, outputMs });
        setPlaying(!video.paused);
        const music = musicRef.current;
        if (music && current.music && !compareRef.current) {
          const speechActive = current.transcript?.words.some((word) => sourceMs >= word.startMs && sourceMs <= word.endMs) ?? false;
          const targetVolume = Math.max(0, Math.min(1, current.edit.audio.musicVolume * (current.edit.audio.duckMusic && speechActive ? 0.42 : 1)));
          const smoothing = Math.min(1, 16 / Math.max(50, current.edit.audio.fadeMs));
          music.volume += (targetVolume - music.volume) * smoothing;
          const target = outputMs / 1000;
          if (Math.abs(music.currentTime - target) > 0.3) music.currentTime = target % Math.max(1, music.duration || target + 1);
          if (!video.paused && music.paused) void music.play().catch(() => undefined);
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
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
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
      } else if ((event.key === "v" || event.key === "V") && ptt && voiceRef.current) {
        if (event.type === "keydown" && !event.repeat) voiceRef.current.setHeld(true);
      }
    };
    const up = (event: KeyboardEvent) => {
      if ((event.key === "v" || event.key === "V") && ptt) voiceRef.current?.setHeld(false);
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
      const created = !fresh && project ? project : await api.create(file.name.replace(/\.[^.]+$/, ""));
      const next = await api.upload(created.id, file);
      remember(next);
      setSelected([]);
      if (health?.assemblyai) {
        const transcribing = await api.transcribe(next.id);
        remember(transcribing);
      } else {
        setNotice("Video is in. Add ASSEMBLYAI_API_KEY on the server, then transcribe it.");
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
      setNotice("Demo loaded. The transcript is a measured fixture until you transcribe it with AssemblyAI.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Demo failed to load.");
    } finally {
      setBusy(null);
    }
  };

  const startVoice = async () => {
    if (!projectRef.current) return;
    if (!health?.assemblyai) {
      setNotice("Add ASSEMBLYAI_API_KEY on the server before starting the voice agent.");
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
      setVoiceDetail(error instanceof Error ? error.message : "Microphone or voice token failed.");
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
    return project.cues.find((cue) => clock.outputMs >= cue.outputStartMs && clock.outputMs <= cue.outputEndMs) ?? null;
  }, [project?.cues, project?.edit.captions.enabled, clock.outputMs, compareOriginal]);

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
        <p>This server asks for an access token before it will spend the AssemblyAI key.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            sessionStorage.setItem("cutback.access", access);
            setUnlocked(true);
          }}
        >
          <input value={access} onChange={(event) => setAccess(event.target.value)} placeholder="Access token" autoFocus />
          <button type="submit">Continue</button>
        </form>
      </main>
    );
  }

  const exportReady = project?.jobs.export.status === "completed" && project.jobs.export.revision === project.revision;
  const framing = project?.edit.framing;

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="mark">Cutback</span>
          <span className="title">{project?.title ?? "No video"}</span>
        </div>
        <div className="header-actions">
          <label className={busy ? "file-btn disabled" : "file-btn"}>
            Your video
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
          <button disabled={!project || busy !== null} onClick={() => void runTool("undo_edit", {})}>
            Undo
          </button>
          <button disabled={!project || busy !== null} onClick={() => void runTool("redo_edit", {})}>
            Redo
          </button>
          <button
            className="primary"
            disabled={!project?.media || busy !== null || project.jobs.export.status === "running"}
            onClick={() => void runTool("export_video", {})}
          >
            {project?.jobs.export.status === "running" ? `Export ${Math.round(project.jobs.export.progress * 100)}%` : "Export"}
          </button>
          {exportReady && project ? (
            <>
              <a className="download" href={`/api/projects/${project.id}/export`}>Download MP4</a>
              <a className="download" href={`/api/projects/${project.id}/subtitles.srt`} title="Plain SRT contains edited timing and text; MP4-only visual styling is not included.">Download SRT</a>
            </>
          ) : null}
        </div>
      </header>

      <div className="workspace">
        <section className="stage-wrap">
          {project?.media ? (
            <div className={`frame ${framing?.mode ?? "original"}`}>
              <video
                ref={videoRef}
                key={project.media.storedName + project.id}
                src={`/api/projects/${project.id}/media`}
                playsInline
                onPlay={() => ensureAudio()}
                style={
                  framing && framing.mode !== "original"
                    ? { objectFit: "cover", objectPosition: `${(framing.focus ?? 0.5) * 100}% 50%` }
                    : undefined
                }
              />
              {framing?.mode !== "original" ? <div className="safe-area" aria-label="Caption safe area" /> : null}
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
                    const active = clock.outputMs >= word.outputStartMs && clock.outputMs <= word.outputEndMs;
                    return <span key={word.id} style={active && project.edit.captions.wordHighlight ? { color: project.edit.captions.highlightColor } : undefined}>{word.text} </span>;
                  })}
                </p>
              ) : null}
              {project.music ? <audio ref={musicRef} src={`/api/projects/${project.id}/music`} loop preload="auto" /> : null}
              <button className="play" onClick={togglePlay}>
                {playing ? "Pause" : "Play"} <span>{formatTime(clock.outputMs)}</span>
              </button>
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
              <button type="button" onClick={() => void loadDemo()} disabled={busy !== null}>
                Load the demo
              </button>
            </div>
          )}
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
                disabled={project.jobs.transcription.status === "running" || !health.assemblyai}
                onClick={() => void api.transcribe(project.id).then(remember).catch((error: Error) => setNotice(error.message))}
              >
                {project.jobs.transcription.status === "error" ? "Retry transcription" : "Transcribe"}
              </button>
            </div>
          ) : null}
        </section>

        <aside className="transcript">
          <div className="aside-head">
            <h2>Transcript</h2>
            <span>{selected.length ? `${selected.length} selected` : "Click a word"}</span>
          </div>
          {project?.transcriptSource === "demo-fixture" ? (
            <p className="fixture">Demo fixture. Sentence timing is measured. Word timing inside a sentence is evenly split until AssemblyAI transcribes it.</p>
          ) : null}
          <div className="sentences">
            {project?.transcript?.sentences.map((sentence) => {
              const removed = sentence.wordIds.every((id) => project.removedWordIds.includes(id));
              return (
                <p key={sentence.id} className={removed ? "sentence gone" : "sentence"}>
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
                    const word = project.transcript?.words.find((item) => item.id === id);
                    if (!word) return null;
                    const isRemoved = project.removedWordIds.includes(id);
                    const marked = project.highlight?.ranges.some(
                      (range) => word.endMs > range.startMs && word.startMs < range.endMs,
                    );
                    const active = !isRemoved && clock.sourceMs >= word.startMs && clock.sourceMs < word.endMs;
                    return (
                      <button
                        key={id}
                        className={[
                          "word",
                          isRemoved ? "removed" : "",
                          selected.includes(id) ? "selected" : "",
                          marked ? (project.highlight?.pending ? "pending" : "marked") : "",
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
            {!project?.transcript ? <p className="empty">The transcript shows up here after transcription.</p> : null}
          </div>
          <div className="edit-actions">
            <button disabled={!project?.media} onClick={() => { setCompareOriginal((value) => !value); videoRef.current?.pause(); seekOutput(0); }}>
              {compareOriginal ? "Return to edit" : "Compare original"}
            </button>
            <button disabled={!selected.length || busy !== null} onClick={() => void runTool("propose_cut", { action: "remove", use: "selection" })}>
              Cut selection
            </button>
            <button disabled={!selected.length || busy !== null} onClick={() => void runTool("restore_section", { use: "selection" })}>
              Restore selection
            </button>
            <button
              disabled={!selected.length || busy !== null}
              onClick={() => void runTool("reorder_sections", { moving_use: "selection", place: "start" })}
            >
              Move to start
            </button>
            <button disabled={!project?.transcript || busy !== null} onClick={() => void runTool("propose_pause_shortening", { threshold_ms: 800, retain_ms: project?.edit.pause.retainMs || 180 })}>
              Shorten pauses
            </button>
            <button
              disabled={!project?.transcript || busy !== null}
              onClick={() => void runTool("set_caption_style", { enabled: !project?.edit.captions.enabled })}
            >
              {project?.edit.captions.enabled ? "Hide captions" : "Captions"}
            </button>
            <button
              disabled={!project?.media || busy !== null}
              onClick={() =>
                void runTool("set_aspect_ratio", { mode: project?.edit.framing.mode === "vertical" ? "original" : "vertical" })
              }
            >
              {project?.edit.framing.mode === "vertical" ? "Original frame" : "Vertical"}
            </button>
            <button disabled={!project?.transcript || busy !== null} onClick={() => void runTool("suggest_shorter_cut", { target_seconds: 30, focus: "main announcement" })}>
              Suggest 30s cut
            </button>
          </div>
          {project?.transcript ? (
            <section className="control-panel">
              <strong>Captions</strong>
              <div className="compact-row">
                {(["clean", "bold", "minimal"] as const).map((preset) => <button key={preset} className={project.edit.captions.preset === preset ? "on" : ""} onClick={() => void runTool("set_caption_style", { enabled: true, preset })}>{preset}</button>)}
              </div>
              <label>Size <input type="range" min="0.7" max="1.8" step="0.1" value={project.edit.captions.fontScale} onChange={(event) => void runTool("set_caption_style", { enabled: true, font_scale: Number(event.target.value) })} /></label>
              <label>Text <input type="color" value={project.edit.captions.color} onChange={(event) => void runTool("set_caption_style", { enabled: true, color: event.target.value })} /></label>
              <label>Highlight <input type="color" value={project.edit.captions.highlightColor} onChange={(event) => void runTool("set_caption_style", { enabled: true, word_highlight: true, highlight_color: event.target.value })} /></label>
              <label>Height <input type="range" min="0.08" max="0.92" step="0.02" value={project.edit.captions.positionY} onChange={(event) => void runTool("set_caption_style", { enabled: true, position_y: Number(event.target.value) })} /></label>
            </section>
          ) : null}
          {project?.media ? (
            <section className="control-panel">
              <strong>Frame</strong>
              <div className="compact-row">
                {(["original", "wide", "square", "vertical"] as const).map((mode) => <button key={mode} className={project.edit.framing.mode === mode ? "on" : ""} onClick={() => void runTool("set_aspect_ratio", { mode })}>{mode === "wide" ? "16:9" : mode === "square" ? "1:1" : mode === "vertical" ? "9:16" : "Original"}</button>)}
              </div>
            </section>
          ) : null}
          {project && project.edit.framing.mode !== "original" ? (
            <label className="focus">
              Crop position
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={project.edit.framing.focus}
                onChange={(event) => {
                  const focus = Number(event.target.value);
                  setProject(present({ ...project, edit: { ...project.edit, framing: { ...project.edit.framing, focus } } }));
                }}
                onPointerUp={(event) => {
                  const focus = Number((event.target as HTMLInputElement).value);
                  void runTool("set_aspect_ratio", { mode: project.edit.framing.mode, focus });
                }}
              />
            </label>
          ) : null}
          {project?.media ? (
            <section className="control-panel">
              <strong>Audio</strong>
              <label>Speech {Math.round(project.edit.audio.speechVolume * 100)}% <input type="range" min="0" max="2" step="0.05" value={project.edit.audio.speechVolume} onChange={(event) => void runTool("set_audio_mix", { speech_volume: Number(event.target.value) })} /></label>
              <label className="file-btn">{project.music ? `Music: ${project.music.filename}` : "Add background music"}<input hidden type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" onChange={(event) => { const file = event.target.files?.[0]; if (file) void api.uploadMusic(project.id, file).then(remember).catch((error: Error) => setNotice(error.message)); }} /></label>
              {project.music ? <><label>Music {Math.round(project.edit.audio.musicVolume * 100)}% <input type="range" min="0" max="1" step="0.02" value={project.edit.audio.musicVolume} onChange={(event) => void runTool("set_audio_mix", { music_volume: Number(event.target.value) })} /></label><button className={project.edit.audio.duckMusic ? "on" : ""} onClick={() => void runTool("set_audio_mix", { duck_music: !project.edit.audio.duckMusic })}>Lower under speech</button></> : null}
            </section>
          ) : null}
          {project?.proposals.filter((item) => item.kind === "shorter" && item.status === "pending").map((proposal) => (
            <section className="proposal" key={proposal.id}>
              <strong>{proposal.summary}</strong>
              <small>{proposal.explanation}</small>
              <ol>{proposal.sequence?.map((item) => <li key={item.sentenceId}>{item.text}</li>)}</ol>
              <div className="compact-row"><button onClick={() => { const first = proposal.sequence?.[0]; if (first) void runTool("preview_segment", { sentence_id: first.sentenceId }); }}>Preview</button><button onClick={() => void runTool("revise_shorter_cut", { proposal_id: proposal.id, keep_first_question: true })}>Keep first question</button><button onClick={() => void runTool("apply_edit", { proposal_id: proposal.id })}>Approve</button></div>
            </section>
          ))}
          {project?.edit.history.length ? <section className="history"><strong>Edit history</strong><ol>{[...project.edit.history].reverse().slice(0, 10).map((entry) => <li key={entry.id}>{entry.summary}</li>)}</ol></section> : null}
          {project?.edit.pause.thresholdMs ? (
            <label className="focus">
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
                      edit: { ...project.edit, pause: { ...project.edit.pause, retainMs } },
                    }),
                  );
                }}
                onPointerUp={(event) => {
                  const retainMs = Number((event.target as HTMLInputElement).value);
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
        <button className={voicePhase === "off" ? "mic" : "mic live"} onClick={() => (voicePhase === "off" ? void startVoice() : stopVoice())}>
          {voicePhase === "off" ? "Start mic" : "End mic"}
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
          <strong>{voicePhase !== "off" && level > 0.02 ? "Mic hears you" : phaseLabel(voicePhase)}</strong>
          <em>
            {voiceDetail ||
              (line ? `${line.who === "user" ? "You" : "Cutback"}: ${line.text}` : "The bar should jump while you talk.")}
          </em>
        </div>
      </section>

      <Timeline
        project={project}
        original={compareOriginal}
        outputMs={clock.outputMs}
        onSeek={(ms) => {
          ensureAudio();
          seekOutput(ms);
        }}
      />
      {notice ? <p className="notice">{notice}</p> : null}
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
  const segments = original ? (project?.originalSegments ?? []) : (project?.segments ?? []);
  const duration = segments.length ? segments[segments.length - 1].outputEndMs : 0;
  const playhead = duration > 0 ? (outputMs / duration) * 100 : 0;
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
      <div className="track">
        {segments.map((segment) => {
          const left = (segment.outputStartMs / duration) * 100;
          const width = ((segment.outputEndMs - segment.outputStartMs) / duration) * 100;
          return <i key={segment.id} style={{ left: `${left}%`, width: `${width}%` }} />;
        })}
        <b className="playhead" style={{ left: `${playhead}%` }} />
      </div>
      <div className="times">
        <span>{formatTime(outputMs)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </section>
  );
}
