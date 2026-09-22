import type { PlaybackContext, PresentedProject } from "@cutback/timeline";

export interface Health {
  ok: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
  assemblyai: boolean;
  accessTokenRequired: boolean;
  maxDurationMs: number;
  maxUploadBytes: number;
}

export interface ToolResponse {
  ok: boolean;
  isError: boolean;
  duplicate: boolean;
  result: Record<string, unknown>;
  project: PresentedProject;
  error?: string;
}

function token(): string {
  return sessionStorage.getItem("cutback.access") ?? "";
}

function headers(json = false): Headers {
  const value = new Headers();
  const access = token();
  if (access) value.set("x-cutback-token", access);
  if (json) value.set("content-type", "application/json");
  return value;
}

async function parse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

export const api = {
  health: () => fetch("/api/health").then((response) => parse<Health>(response)),
  create: (title?: string) =>
    fetch("/api/projects", { method: "POST", headers: headers(true), body: JSON.stringify({ title }) }).then((response) =>
      parse<PresentedProject>(response),
    ),
  demo: () => fetch("/api/projects/demo", { method: "POST", headers: headers() }).then((response) => parse<PresentedProject>(response)),
  get: (id: string) => fetch(`/api/projects/${id}`, { headers: headers() }).then((response) => parse<PresentedProject>(response)),
  upload: async (id: string, file: File) => {
    const body = new FormData();
    body.set("file", file);
    const response = await fetch(`/api/projects/${id}/media`, { method: "POST", headers: headers(), body });
    return parse<PresentedProject>(response);
  },
  uploadMusic: async (id: string, file: File) => {
    const body = new FormData();
    body.set("file", file);
    const response = await fetch(`/api/projects/${id}/music`, { method: "POST", headers: headers(), body });
    return parse<PresentedProject>(response);
  },
  transcribe: (id: string) =>
    fetch(`/api/projects/${id}/transcribe`, { method: "POST", headers: headers() }).then((response) =>
      parse<PresentedProject>(response),
    ),
  playback: (id: string, playback: PlaybackContext) =>
    fetch(`/api/projects/${id}/playback`, {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify(playback),
    }).then((response) => parse<{ ok: boolean }>(response)),
  tool: (id: string, name: string, args: Record<string, unknown>, callId?: string) =>
    fetch(`/api/projects/${id}/tools/${name}`, {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify({ callId, arguments: args }),
    }).then((response) => parse<ToolResponse>(response)),
  voiceToken: () =>
    fetch("/api/voice/token", { method: "POST", headers: headers() }).then((response) =>
      parse<{ token: string; expiresInSeconds: number }>(response),
    ),
};
