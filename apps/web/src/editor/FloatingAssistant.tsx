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
  /** Pointer is down on the launcher while push to talk is on. */
  const holding = useRef(false);
  /** Set once the creator has deliberately placed the assistant themselves. */
  const userPlaced = useRef(false);
  /** That press turned into a drag, so it was not a talk. */
  const moved = useRef(false);
  /** Audio is actually being sent right now. */
  const talking = useRef(false);
  const holdTimer = useRef<number | null>(null);
  const isError = state === "Permission error" || state === "Connection error";
  const active = state !== "Disconnected" && !isError;
  /** Collapsed to the five states a creator needs to tell apart. */
  const phase: "off" | "connecting" | "listening" | "processing" | "error" =
    isError
      ? "error"
      : state === "Disconnected"
        ? "off"
        : state === "Connecting"
          ? "connecting"
          : state === "Listening"
            ? "listening"
            : "processing";
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 700;
  /**
   * First-use placement. The mic belongs in the margin around the picture, not
   * on the picture and never over the playback controls. The preview area holds
   * every candidate and excludes the controls by construction, so any band that
   * fits is automatically safe. Preference order is right, left, below, above.
   */
  function defaultSpot(): Point {
    const size = 56;
    const margin = 12;
    if (isMobile) return { x: 8, y: window.innerHeight - 88 };
    const stage = document.querySelector<HTMLElement>(".video-stage");
    const canvas = document.querySelector<HTMLElement>(".preview-canvas-area");
    if (!stage || !canvas) {
      return { x: window.innerWidth - 80, y: window.innerHeight - 290 };
    }
    const s = stage.getBoundingClientRect();
    const c = canvas.getBoundingClientRect();
    const midX = s.left + s.width / 2;
    const midY = s.top + s.height / 2;
    const bands = [
      { ok: c.right - s.right >= size + margin, x: s.right + Math.max(margin, (c.right - s.right - size) / 2), y: midY - size / 2 },
      { ok: s.left - c.left >= size + margin, x: s.left - margin - size, y: midY - size / 2 },
      { ok: c.bottom - s.bottom >= size + margin, x: midX - size / 2, y: s.bottom + margin },
      { ok: s.top - c.top >= size + margin, x: midX - size / 2, y: s.top - margin - size },
    ].filter((band) => band.ok);
    const pick = bands[0] ?? { x: c.right - size - margin, y: c.bottom - size - margin };
    // Keep it inside the preview area, which is what guarantees it never lands
    // on the playback controls below.
    return {
      x: Math.max(c.left + 4, Math.min(pick.x, c.right - size - 4)),
      y: Math.max(c.top + 4, Math.min(pick.y, c.bottom - size - 4)),
    };
  }
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
    userPlaced.current = true;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(point));
    } catch {
      /* Storage can be disabled. */
    }
  }
  useLayoutEffect(() => {
    // A position the creator chose is kept; only the very first use gets the
    // computed default. This runs after layout so the preview has been measured.
    let initial: Point | null = null;
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
        initial = stored;
        userPlaced.current = true;
      }
    } catch {
      /* Fall through to the default spot. */
    }
    setPosition(clamp(initial ?? defaultSpot()));
    // defaultSpot reads layout, so it must not become a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // A spot the creator chose is kept and merely re-clamped. A spot we
        // chose is recomputed, so resizing the timeline cannot leave the mic
        // sitting on the playback controls.
        setPosition((previous) =>
          clamp(userPlaced.current && previous ? previous : defaultSpot()),
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
      else setPosition(clamp(defaultSpot()));
    } catch {
      /* Retain position. */
    }
  }
  /** Forget a chosen spot and go back to the computed default. */
  function resetPosition(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    userPlaced.current = false;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* Storage can be disabled. */
    }
    setPosition(clamp(defaultSpot()));
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
    // Also listen on the window: if the release lands outside the element, or
    // capture is lost, the drag still has to be committed rather than leaving
    // the assistant visually moved but unsaved.
    const settle = () => {
      window.removeEventListener("pointerup", settle);
      window.removeEventListener("pointercancel", settle);
      window.removeEventListener("blur", settle);
      finishDrag(false);
    };
    window.addEventListener("pointerup", settle);
    window.addEventListener("pointercancel", settle);
    window.addEventListener("blur", settle);
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
  /** Commit the current spot, whether the drag ended cleanly or not. */
  function finishDrag(cancelled: boolean) {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    if (current.moved && position) {
      suppressClick.current = true;
      setPosition(position);
      save(position);
    } else {
      suppressClick.current = cancelled;
    }
  }
  function up(event: PointerEvent<HTMLElement>) {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    finishDrag(false);
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
    onPointerCancel: () => finishDrag(true),
    // A drag released outside the window still gets committed, otherwise the
    // spot is lost and the launcher jumps back on the next load.
    onLostPointerCapture: () => finishDrag(false),
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
          className={`assistant-launcher phase-${phase} ${pushToTalk ? "ptt" : ""}`}
          {...dragEvents}
          // Push to talk shares this button with dragging, so a hold only counts
          // once the pointer has stayed put: a moved pointer is a drag.
          onPointerDown={(event) => {
            if (!pushToTalk) return;
            holding.current = true;
            moved.current = false;
            event.currentTarget.setPointerCapture?.(event.pointerId);
            // Short grace period: a tap or a drag must not blip the microphone,
            // only a deliberate press-and-hold should start sending audio.
            holdTimer.current = window.setTimeout(() => {
              if (holding.current && !moved.current) {
                talking.current = true;
                onHold(true);
              }
            }, 140);
          }}
          onPointerMove={() => {
            if (!holding.current) return;
            moved.current = true;
            if (holdTimer.current) window.clearTimeout(holdTimer.current);
          }}
          onPointerUp={() => {
            if (holdTimer.current) window.clearTimeout(holdTimer.current);
            if (talking.current) {
              talking.current = false;
              onHold(false);
            }
            holding.current = false;
          }}
          onPointerCancel={() => {
            if (holdTimer.current) window.clearTimeout(holdTimer.current);
            if (talking.current) {
              talking.current = false;
              onHold(false);
            }
            holding.current = false;
          }}
          onClick={() => {
            if (!suppressClick.current) setOpen(true);
            suppressClick.current = false;
          }}
          aria-label={
            active
              ? `Open conversation. Voice ${state.toLowerCase()}`
              : isError
                ? `Open conversation. ${detail ?? "Voice error"}`
                : "Ask Cutback. Open voice assistant"
          }
          aria-expanded={false}
          title={
            pushToTalk
              ? "Hold to talk · drag to move · Alt + arrow keys to reposition"
              : "Ask Cutback · drag to move · Alt + arrow keys to reposition"
          }
        >
          <Mic />
          {/* One dot per voice state, so off / connecting / listening /
              processing / error are told apart at a glance and not just by
              the tooltip. */}
          <span className={`assistant-status-dot phase-${phase}`} data-phase={phase} />
          <span className="assistant-launcher-label">
            {active ? state : isError ? detail ?? "Voice error" : "Ask Cutback"}
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
              <small>
                {active ? state : pushToTalk ? "Hold V to talk" : "Your voice editing assistant"}
              </small>
            </div>
            <button
              className={`assistant-ptt ${pushToTalk ? "on" : ""}`}
              onClick={onTogglePushToTalk}
              aria-pressed={pushToTalk}
              title="Push to talk: only send audio while V is held, so the agent never hears your video"
            >
              PTT
            </button>
            <button
              className="assistant-reset"
              onClick={resetPosition}
              title="Move the assistant back to its default spot"
            >
              Reset position
            </button>
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
