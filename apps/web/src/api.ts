import type { PlaybackContext, PresentedProject } from "@cutback/timeline";

export interface Health {
  ok: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
  assemblyai: boolean;
  accessTokenRequired: boolean;
  cloudStorage?: boolean;
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

function uploadMime(file: File, kind: "media" | "music"): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  const known: Record<string, string> = {
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", m4v: "video/x-m4v",
    mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", flac: "audio/flac",
  };
  return (ext && known[ext]) || (kind === "music" ? "audio/mpeg" : "video/mp4");
}

async function cloudUpload(id: string, file: File, kind: "media" | "music"): Promise<PresentedProject | null> {
  const contentType = uploadMime(file, kind);
  const prepared = await fetch(`/api/projects/${id}/uploads`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ filename: file.name, contentType, bytes: file.size, kind }),
  });
  if (prepared.status === 404) return null;
  const details = await parse<{ uploadUrl: string; pathname: string }>(prepared);
  const uploaded = await fetch(details.uploadUrl, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: file,
  });
  if (!uploaded.ok) throw new Error(`Cloud upload failed (${uploaded.status}).`);
  const attached = await fetch(`/api/projects/${id}/uploads/attach`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ pathname: details.pathname, filename: file.name, contentType, bytes: file.size, kind }),
  });
  return parse<PresentedProject>(attached);
}

export const api = {
  health: () => fetch("/api/health").then((response) => parse<Health>(response)),
  create: (title?: string) =>
    fetch("/api/projects", { method: "POST", headers: headers(true), body: JSON.stringify({ title }) }).then((response) =>
      parse<PresentedProject>(response),
    ),
  demo: () => fetch("/api/projects/demo", { method: "POST", headers: headers() }).then((response) => parse<PresentedProject>(response)),
  get: (id: string) => fetch(`/api/projects/${id}`, { headers: headers() }).then((response) => parse<PresentedProject>(response)),
  rename: (id: string, title: string) =>
    fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: headers(true),
      body: JSON.stringify({ title }),
    }).then((response) => parse<PresentedProject>(response)),
  waveform: (id: string) =>
    fetch(`/api/projects/${id}/waveform`, { headers: headers() }).then((response) => parse<{ peaks: number[] }>(response)),
  upload: async (id: string, file: File) => {
    const cloud = await cloudUpload(id, file, "media");
    if (cloud) return cloud;
    const body = new FormData();
    body.set("file", file);
    const response = await fetch(`/api/projects/${id}/media`, { method: "POST", headers: headers(), body });
    return parse<PresentedProject>(response);
  },
  uploadMusic: async (id: string, file: File) => {
    const cloud = await cloudUpload(id, file, "music");
    if (cloud) return cloud;
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
