import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent, KeyboardEvent } from "react";
import type { VoiceState } from "./types";

type Point = { x: number; y: number };
const STORAGE_KEY = "cutback.assistant.position.v1";
function Mic() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <rect x="9" y="2" width="6" height="13" rx="3" />
      <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
    </svg>
  );
}
export function FloatingAssistant({
  state,
  level,
  detail,
  lines,
  onToggle,
  onStop,
}: {
  state: VoiceState;
  level: number;
  detail: string | null;
  lines: Array<{ who: "user" | "agent"; text: string }>;
  onToggle: () => void;
  onStop: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Point | null>(null);
  const root = useRef<HTMLElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const minimize = useRef<HTMLButtonElement>(null);
  const history = useRef<HTMLDivElement>(null);
  const hasOpened = useRef(false);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    start: Point;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const isError = state === "Permission error" || state === "Connection error";
  const active = state !== "Disconnected" && !isError;
  function clamp(point: Point): Point {
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0,
      top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth,
      height = viewport?.height ?? window.innerHeight;
    const bounds = root.current?.getBoundingClientRect();
    return {
      x: Math.max(
        left + 12,
        Math.min(point.x, left + width - (bounds?.width ?? 56) - 12),
      ),
      y: Math.max(
        top + 12,
        Math.min(point.y, top + height - (bounds?.height ?? 56) - 12),
      ),
    };
  }
  function save(point: Point) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(point));
    } catch {
      /* Storage can be disabled. */
    }
  }
  useLayoutEffect(() => {
    let initial = {
      x: window.innerWidth - 80,
      y: window.innerHeight - (window.innerWidth > 700 ? 290 : 88),
    };
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y))
        initial = stored;
    } catch {
      /* Use default position. */
    }
    setPosition(clamp(initial));
  }, []);
  useLayoutEffect(() => {
    function fit() {
      const viewport = window.visualViewport;
      if (open && window.innerWidth <= 700) {
        const height = viewport?.height ?? window.innerHeight;
        const top = viewport?.offsetTop ?? 0;
        const panelHeight = Math.min(430, height * 0.7);
        if (root.current) root.current.style.height = `${panelHeight}px`;
        setPosition({ x: 8, y: top + height - panelHeight - 8 });
      } else {
        if (root.current) root.current.style.height = "";
        setPosition((previous) =>
          clamp(
            previous ?? {
              x: window.innerWidth - 80,
              y: window.innerHeight - 100,
            },
          ),
        );
      }
    }
    fit();
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("scroll", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("scroll", fit);
    };
  }, [open]);
  useEffect(() => {
    if (open) {
      hasOpened.current = true;
      minimize.current?.focus();
    } else if (hasOpened.current) launcher.current?.focus();
  }, [open]);
  useEffect(() => {
    if (history.current)
      history.current.scrollTop = history.current.scrollHeight;
  }, [lines, open]);
  function collapse() {
    setOpen(false);
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y))
        setPosition(stored);
    } catch {
      /* Retain position. */
    }
  }
  function down(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || (open && window.innerWidth <= 700)) return;
    if (open && (event.target as HTMLElement).closest("button")) return;
    const bounds = root.current!.getBoundingClientRect();
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start: { x: bounds.x, y: bounds.y },
      moved: false,
    };
    suppressClick.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x,
      dy = event.clientY - current.y;
    if (Math.hypot(dx, dy) > 6) current.moved = true;
    if (current.moved)
      setPosition(clamp({ x: current.start.x + dx, y: current.start.y + dy }));
  }
  function up(event: PointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    suppressClick.current = current.moved;
    if (current.moved && position) {
      const next = clamp({
        ...position,
        x:
          !open && window.innerWidth <= 700
            ? position.x < window.innerWidth / 2
              ? 12
              : window.innerWidth - 68
            : position.x,
      });
      setPosition(next);
      save(next);
    }
    drag.current = null;
  }
  function keyMove(event: KeyboardEvent<HTMLElement>) {
    if (!position || !event.altKey || !event.key.startsWith("Arrow")) return;
    event.preventDefault();
    const next = clamp({
      x:
        position.x +
        (event.key === "ArrowRight" ? 20 : event.key === "ArrowLeft" ? -20 : 0),
      y:
        position.y +
        (event.key === "ArrowDown" ? 20 : event.key === "ArrowUp" ? -20 : 0),
    });
    setPosition(next);
    save(next);
  }
  const dragEvents = {
    onPointerDown: down,
    onPointerMove: move,
    onPointerUp: up,
    onPointerCancel: () => {
      drag.current = null;
      suppressClick.current = true;
    },
    onKeyDown: keyMove,
  };
  return (
    <section
      ref={root}
      className={`floating-assistant ${open ? "is-open" : "is-collapsed"} ${active ? "is-active" : ""} ${isError ? "has-error" : ""}`}
      style={{
        left: position?.x ?? 12,
        top: position?.y ?? 80,
        visibility: position ? "visible" : "hidden",
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          collapse();
        }
      }}
      aria-label="Cutback voice assistant"
    >
      {!open ? (
        <button
          ref={launcher}
          className="assistant-launcher"
          {...dragEvents}
          onClick={() => {
            if (!suppressClick.current) setOpen(true);
            suppressClick.current = false;
          }}
          aria-label={
            active
              ? `Open conversation. Voice ${state.toLowerCase()}`
              : "Ask Cutback. Open voice assistant"
          }
          aria-expanded={false}
          title="Ask Cutback · drag to move · Alt + arrow keys to reposition"
        >
          <Mic />
          <span className="assistant-status-dot" />
          <span className="assistant-launcher-label">
            {active ? state : isError ? "Voice error" : "Ask Cutback"}
          </span>
        </button>
      ) : (
        <>
          <header
            className="assistant-header"
            {...dragEvents}
            tabIndex={0}
            aria-label="Drag to move conversation. Alt plus arrow keys to reposition."
          >
            <span className="assistant-grip" aria-hidden="true">
              ⠿
            </span>
            <div>
              <b>Ask Cutback</b>
              <small>{active ? state : "Your voice editing assistant"}</small>
            </div>
            <button
              ref={minimize}
              className="icon-btn"
              onClick={collapse}
              aria-label="Minimise conversation"
            >
              −
            </button>
          </header>
          <div
            className="assistant-conversation"
            ref={history}
            role="log"
            aria-label="Voice conversation"
            aria-live="polite"
          >
            {lines.length ? (
              lines.map((line, index) => (
                <article
                  className={`assistant-message ${line.who}`}
                  key={index}
                >
                  <span>{line.who === "user" ? "You" : "Cutback"}</span>
                  <p>{line.text}</p>
                </article>
              ))
            ) : (
              <div className="assistant-empty">
                <span>
                  <Mic />
                </span>
                <h3>What would you like to change?</h3>
                <p>Start voice editing, then tell Cutback what you need.</p>
                <div>“Remove the long pauses”</div>
                <div>“Add captions to this video”</div>
                <small>
                  Opening this panel does not turn on your microphone.
                </small>
              </div>
            )}
          </div>
          {isError && (
            <p className="assistant-error" role="alert">
              {detail || state}
            </p>
          )}
          <footer className="assistant-footer">
            <div className="assistant-activity">
              <div className="assistant-wave" aria-hidden="true">
                {[0.4, 0.7, 1, 0.5, 0.8, 0.4, 0.9].map((weight, index) => (
                  <i
                    key={index}
                    style={{
                      height: active
                        ? Math.max(3, Math.min(24, level * 300 * weight))
                        : 3,
                    }}
                  />
                ))}
              </div>
              <span>{active ? `${state}…` : "Microphone off"}</span>
            </div>
            <button
              className={`assistant-connect ${active ? "recording" : ""}`}
              onClick={active ? onStop : onToggle}
            >
              <Mic />
              {active ? "Stop voice" : isError ? "Try again" : "Start voice"}
            </button>
          </footer>
        </>
      )}
    </section>
  );
}
