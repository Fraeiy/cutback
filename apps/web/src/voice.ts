import { buildSystemPrompt, voiceSessionUpdate, type PresentedProject } from "@cutback/timeline";
import { api } from "./api";

export type VoicePhase = "off" | "connecting" | "listening" | "user" | "thinking" | "editing" | "speaking" | "error";

interface VoiceHandlers {
  onPhase: (phase: VoicePhase, detail?: string) => void;
  onLine: (who: "user" | "agent", text: string) => void;
  onLevel: (rms: number) => void;
  onProject: (project: PresentedProject) => void;
  onSeek: (outputMs: number) => void;
  snapshot: () => { sourceTimeMs: number; outputTimeMs: number; selectedWordIds: string[] };
  onUserSpeech: (active: boolean) => void;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

interface PendingTool {
  call_id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export class VoiceSession {
  private ws: WebSocket | null = null;
  private audio: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private micMonitor: GainNode | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private playbackAt = 0;
  private ready = false;
  private lastEvent: string | null = null;
  private pending: PendingTool[] = [];
  private seen = new Set<string>();
  private flushing = false;
  private sendAudio = true;
  private ptt = false;
  private held = false;
  private stopped = false;
  private ending = false;
  phase: VoicePhase = "off";

  constructor(
    private projectId: string,
    private handlers: VoiceHandlers,
    audio: AudioContext,
  ) {
    this.audio = audio;
  }

  async start(project: PresentedProject | null): Promise<void> {
    this.stopped = false;
    this.ending = false;
    this.setPhase("connecting");
    const { token } = await api.voiceToken();
    const audio = this.audio;
    if (!audio) throw new Error("Audio is not ready.");
    await audio.resume();
    const marked = audio as AudioContext & { cutbackWorklet?: boolean };
    if (!marked.cutbackWorklet) {
      await audio.audioWorklet.addModule("/pcm-processor.js?v=2");
      marked.cutbackWorklet = true;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
    });
    this.stream = stream;
    const source = audio.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(audio, "pcm-processor", {
      processorOptions: { inputSampleRate: audio.sampleRate, targetSampleRate: 24000 },
    });
    // The worklet only runs while it is pulled by the destination. Gain 0 keeps
    // the mic out of the speakers so the agent is not hearing itself.
    const monitor = audio.createGain();
    monitor.gain.value = 0;
    this.micMonitor = monitor;
    source.connect(worklet);
    worklet.connect(monitor);
    monitor.connect(audio.destination);
    worklet.port.onmessage = (event: MessageEvent<{ type: string; speaking?: boolean; rms?: number; buffer?: ArrayBuffer }>) => {
      const data = event.data;
      if (data.type === "level" && typeof data.rms === "number") this.handlers.onLevel(data.rms);
      if (data.type === "vad") {
        const speaking = Boolean(data.speaking);
        if (speaking && this.canSend()) this.captureContext();
        if (this.canSend()) this.handlers.onUserSpeech(speaking);
      }
      if (data.type === "audio" && data.buffer && this.ready && this.canSend() && this.ws?.readyState === WebSocket.OPEN) {
        const bytes = new Uint8Array(data.buffer);
        this.ws.send(JSON.stringify({ type: "input.audio", audio: bytesToBase64(bytes) }));
      }
    };

    const socket = new WebSocket(`wss://agents.assemblyai.com/v1/ws?token=${encodeURIComponent(token)}`);
    this.ws = socket;
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify(voiceSessionUpdate(buildSystemPrompt(project))));
    });
    socket.addEventListener("message", (event) => {
      this.onMessage(JSON.parse(String(event.data)) as Record<string, unknown>);
    });
    socket.addEventListener("close", () => {
      if (!this.stopped) this.setPhase("error", "Voice session closed.");
    });
    socket.addEventListener("error", () => this.setPhase("error", "Voice connection failed."));
  }

  private canSend(): boolean {
    if (!this.sendAudio) return false;
    if (this.ptt && !this.held) return false;
    return true;
  }

  private captureContext(): void {
    const snap = this.handlers.snapshot();
    void api.playback(this.projectId, {
      ...snap,
      capturedAt: new Date().toISOString(),
      reason: this.ptt ? "ptt" : "speech-start",
    }).catch(() => undefined);
  }

  setMic(enabled: boolean): void {
    this.sendAudio = enabled;
    if (!enabled) this.handlers.onUserSpeech(false);
  }

  setPushToTalk(enabled: boolean): void {
    this.ptt = enabled;
    if (!enabled) this.held = false;
  }

  setHeld(held: boolean): void {
    const next = held && this.ptt && this.sendAudio;
    if (next && !this.held) this.captureContext();
    this.held = next;
    if (this.ptt) this.handlers.onUserSpeech(next);
  }

  refreshPrompt(project: PresentedProject): void {
    if (!this.ready || this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "session.update", session: { system_prompt: buildSystemPrompt(project) } }));
  }

  end(): void {
    if (this.ending) return;
    this.ending = true;
    this.stopped = true;
    this.ready = false;
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "session.end" }));
    this.stopPlayback();
    this.micMonitor?.disconnect();
    this.micMonitor = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.ws?.close();
    this.ws = null;
    this.stream = null;
    this.setPhase("off");
  }

  private setPhase(phase: VoicePhase, detail?: string): void {
    this.phase = phase;
    this.handlers.onPhase(phase, detail);
  }

  private stopPlayback(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
    if (this.audio) this.playbackAt = this.audio.currentTime;
  }

  private onMessage(message: Record<string, unknown>): void {
    const type = String(message.type ?? "");
    if (type === "session.ready") {
      this.ready = true;
      this.setPhase("listening");
      return;
    }
    if (type === "session.error" || type === "error") {
      this.setPhase("error", String(message.message ?? "Voice session error."));
      return;
    }
    if (type === "session.ended") {
      this.end();
      return;
    }
    if (type === "input.speech.started") {
      this.lastEvent = type;
      this.captureContext();
      this.setPhase("user");
      return;
    }
    if (type === "transcript.user.delta" || type === "transcript.user") {
      const text = String(message.text ?? "");
      if (text) this.handlers.onLine("user", text);
      return;
    }
    if (type === "reply.started") {
      this.lastEvent = type;
      this.setPhase("thinking");
      return;
    }
    if (type === "transcript.agent.delta") {
      return;
    }
    if (type === "transcript.agent") {
      this.handlers.onLine("agent", String(message.text ?? ""));
      return;
    }
    if (type === "reply.audio" && this.audio && typeof message.data === "string") {
      this.playPcm(message.data);
      if (this.phase !== "editing") this.setPhase("speaking");
      return;
    }
    if (type === "tool.call") {
      const callId = String(message.call_id ?? "");
      if (!callId || this.seen.has(callId) || this.pending.some((item) => item.call_id === callId)) return;
      const raw = message.arguments ?? message.args ?? {};
      let args: Record<string, unknown>;
      try {
        args = typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : (raw as Record<string, unknown>);
      } catch {
        args = {};
      }
      this.pending.push({ call_id: callId, name: String(message.name ?? ""), arguments: args });
      void this.flush();
      return;
    }
    if (type === "reply.done") {
      this.lastEvent = type;
      if (message.status === "interrupted") {
        this.pending = [];
        this.stopPlayback();
        this.setPhase(this.sendAudio ? "listening" : "off");
        return;
      }
      void this.flush();
      return;
    }
  }

  private async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.pending.length && this.ws?.readyState === WebSocket.OPEN) {
        const call = this.pending[0];
        this.setPhase("editing");
        let response: {
          isError: boolean;
          result: Record<string, unknown>;
          project: PresentedProject | null;
        };
        try {
          response = await api.tool(this.projectId, call.name, call.arguments, call.call_id);
        } catch (error) {
          response = {
            isError: true,
            result: { status: "error", error: error instanceof Error ? error.message : "Tool failed." },
            project: null,
          };
        }
        if (response.project) {
          this.handlers.onProject(response.project);
          this.refreshPrompt(response.project);
        }
        const seek = response.result.seek_output_ms;
        if (typeof seek === "number") this.handlers.onSeek(seek);
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(
            JSON.stringify({
              type: "tool.result",
              call_id: call.call_id,
              result: JSON.stringify(response.result),
              is_error: response.isError,
            }),
          );
        }
        this.seen.add(call.call_id);
        this.pending.shift();
      }
    } finally {
      this.flushing = false;
      if (this.phase === "editing" && this.ready) {
        this.setPhase(this.lastEvent === "reply.done" ? (this.sendAudio ? "listening" : "off") : "thinking");
      }
    }
  }

  private playPcm(data: string): void {
    const audio = this.audio;
    if (!audio) return;
    const binary = atob(data);
    const pcm = new Int16Array(binary.length / 2);
    for (let i = 0; i < pcm.length; i += 1) {
      pcm[i] = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
    }
    const floats = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i += 1) floats[i] = pcm[i] / 32768;
    const buffer = audio.createBuffer(1, floats.length, 24000);
    buffer.getChannelData(0).set(floats);
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(audio.destination);
    const start = Math.max(this.playbackAt, audio.currentTime + 0.02);
    source.start(start);
    this.playbackAt = start + buffer.duration;
    this.sources.push(source);
    source.onended = () => {
      this.sources = this.sources.filter((item) => item !== source);
      if (this.sources.length === 0 && this.phase === "speaking") this.setPhase("listening");
    };
  }
}
