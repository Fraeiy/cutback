import { spawn } from "node:child_process";

const base = process.env.CUTBACK_URL || "http://127.0.0.1:8791";

async function health(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {
      /* server still booting */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Server did not answer /api/health.");
}

function probe(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], {
      windowsHide: true,
    });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.on("close", (code) => (code === 0 ? resolve(Number(out.trim())) : reject(new Error("ffprobe failed"))));
  });
}

async function main(): Promise<void> {
await health();
const created = await fetch(`${base}/api/projects/demo`, { method: "POST" });
if (!created.ok) throw new Error(await created.text());
const project = (await created.json()) as {
  id: string;
  outputDurationMs: number;
  transcript: { sentences: Array<{ id: string; text: string }> };
};
const before = project.outputDurationMs;
const cut = await fetch(`${base}/api/projects/${project.id}/tools/propose_cut`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    callId: "verify-cut",
    arguments: { action: "trim_before", quote: "I tested this tool yesterday" },
  }),
});
const cutBody = (await cut.json()) as { result: { status?: string; summary?: string; error?: string }; project: { outputDurationMs: number } };
if (cutBody.result.status !== "applied") throw new Error(JSON.stringify(cutBody.result));
if (!(cutBody.project.outputDurationMs < before)) throw new Error("Cut did not shorten the timeline.");
const again = await fetch(`${base}/api/projects/${project.id}/tools/propose_cut`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    callId: "verify-cut",
    arguments: { action: "remove", sentence_id: "s04" },
  }),
});
const againBody = (await again.json()) as { duplicate: boolean; project: { outputDurationMs: number } };
if (!againBody.duplicate || againBody.project.outputDurationMs !== cutBody.project.outputDurationMs) {
  throw new Error("Retried tool call changed the edit.");
}
const exported = await fetch(`${base}/api/projects/${project.id}/tools/export_video`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ callId: "verify-export", arguments: {} }),
});
const exportBody = (await exported.json()) as { result: { status?: string; error?: string } };
if (exportBody.result.status !== "completed") throw new Error(JSON.stringify(exportBody.result));
const file = await fetch(`${base}/api/projects/${project.id}/export`);
if (!file.ok) throw new Error("Download failed.");
const bytes = Buffer.from(await file.arrayBuffer());
const out = new URL("../data/verify-cutback.mp4", import.meta.url);
const { writeFile } = await import("node:fs/promises");
const { fileURLToPath } = await import("node:url");
const target = fileURLToPath(out);
await writeFile(target, bytes);
const duration = await probe(target);
const expected = cutBody.project.outputDurationMs / 1000;
if (Math.abs(duration - expected) > 0.35) {
  throw new Error(`Export duration ${duration}s does not match preview ${expected}s.`);
}
console.log(
  JSON.stringify({
    projectId: project.id,
    summary: cutBody.result.summary,
    previewSeconds: Number(expected.toFixed(2)),
    exportSeconds: Number(duration.toFixed(2)),
    bytes: bytes.length,
  }),
);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
