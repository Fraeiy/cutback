import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { VoiceState } from "./types";

function Mic({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="9" y="2" width="6" height="13" rx="3" />
      <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : undefined }}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function FloatingAssistant({
  state,
  level,
  detail,
  lines,
  pushToTalk,
  onTogglePushToTalk,
  onHold,
  onToggle,
  onStop,
}: {
  state: VoiceState;
  level: number;
  detail: string | null;
  lines: Array<{ who: "user" | "agent"; text: string }>;
  /** When on, audio only reaches the agent while the creator is holding. */
  pushToTalk: boolean;
  onTogglePushToTalk: () => void;
  onHold: (held: boolean) => void;
  onToggle: () => void;
  onStop: () => void;
}) {
  const [open, setOpen] = useState(false);
  const history = useRef<HTMLDivElement>(null);
  const holding = useRef(false);
  const talking = useRef(false);
  const holdTimer = useRef<number | null>(null);
  const isError = state === "Permission error" || state === "Connection error";
  const active = state !== "Disconnected" && !isError;
  const phase: "off" | "connecting" | "listening" | "processing" | "error" =
    isError ? "error"
      : state === "Disconnected" ? "off"
        : state === "Connecting" ? "connecting"
          : state === "Listening" ? "listening"
            : "processing";
  const latest = lines[lines.length - 1];
  const statusLine = active
    ? state
    : isError
      ? (detail ?? "Voice needs another try")
      : latest
        ? latest.text
        : "Tell Cutback what to change";

  useEffect(() => {
    if (history.current) history.current.scrollTop = history.current.scrollHeight;
  }, [lines, open]);

  function clearHold() {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
    if (talking.current) {
      talking.current = false;
      onHold(false);
    }
    holding.current = false;
  }

  function holdStart(event: PointerEvent<HTMLButtonElement>) {
    if (!pushToTalk || !active) return;
    holding.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    holdTimer.current = window.setTimeout(() => {
      if (holding.current) {
        talking.current = true;
        onHold(true);
      }
    }, 140);
  }

  return (
    <section className={`ask-dock phase-${phase} ${open ? "is-open" : ""} ${active ? "is-active" : ""}`} aria-label="Cutback voice">
      {open && (
        <div className="assistant-conversation" ref={history} role="log" aria-label="Voice conversation" aria-live="polite">
          {lines.length ? (
            lines.map((line, index) => (
              <article className={`assistant-message ${line.who}`} key={index}>
                <span>{line.who === "user" ? "You" : "Cutback"}</span>
                <p>{line.text}</p>
              </article>
            ))
          ) : (
            <div className="assistant-empty">
              <span><Mic /></span>
              <h3>Edit by talking</h3>
              <p>Start voice, then say what you want changed. The microphone stays off until you do.</p>
              <div>“Remove the long pauses”</div>
              <div>“Add captions to this video”</div>
            </div>
          )}
          {isError && <p className="assistant-error" role="alert">{detail || state}</p>}
        </div>
      )}
      <div className="ask-bar">
        <button
          type="button"
          className={`ask-mic phase-${phase}`}
          aria-label={pushToTalk && active ? "Hold to talk" : open ? "Hide voice conversation" : "Show voice conversation"}
          title={pushToTalk ? "Hold to talk" : "Show the conversation"}
          onPointerDown={holdStart}
          onPointerUp={clearHold}
          onPointerCancel={clearHold}
          onClick={() => {
            if (pushToTalk && active) return;
            setOpen((value) => !value);
          }}
        >
          <Mic />
          <i className={`assistant-status-dot phase-${phase}`} />
        </button>
        <button type="button" className="ask-status" onClick={() => setOpen((value) => !value)}>
          <b>{active ? state : isError ? "Voice error" : "Ask Cutback"}</b>
          <span>{statusLine}</span>
        </button>
        <button
          type="button"
          className={`assistant-ptt ${pushToTalk ? "on" : ""}`}
          onClick={onTogglePushToTalk}
          aria-pressed={pushToTalk}
          title="Hold to talk. Cutback only hears you while you hold the mic or the V key, so playback is not treated as a command."
        >
          Hold
        </button>
        <button
          type="button"
          className={`assistant-connect ${active ? "recording" : ""}`}
          onClick={active ? onStop : onToggle}
        >
          <Mic size={15} />
          {active ? "Stop" : isError ? "Try again" : "Start voice"}
        </button>
        <button
          type="button"
          className="icon-btn ask-toggle"
          aria-expanded={open}
          aria-label={open ? "Hide conversation" : "Show conversation"}
          onClick={() => setOpen((value) => !value)}
        >
          <Chevron open={open} />
        </button>
      </div>
    </section>
  );
}
