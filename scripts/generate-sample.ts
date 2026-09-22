import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const samples = path.join(root, "samples");

const lines = [
  { id: "s01", text: "Ignore this intro.", gapAfter: 0.35 },
  { id: "s02", text: "I tested this tool yesterday.", gapAfter: 1.45 },
  { id: "s03", text: "The first cut should land on this sentence.", gapAfter: 1.85 },
  { id: "s04", text: "Keep the pause before this last sentence.", gapAfter: 0.3 },
];

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr.slice(-800) || `${bin} failed`));
      else resolve();
    });
  });
}

function probe(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], {
      windowsHide: true,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(err));
      else resolve(Math.round(Number(out.trim()) * 1000));
    });
  });
}

function speak(text: string, file: string): Promise<void> {
  const script = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = -1
$synth.SetOutputToWaveFile(${JSON.stringify(file)})
$synth.Speak(${JSON.stringify(text)})
$synth.Dispose()
`;
  return run("powershell", ["-NoProfile", "-Command", script]);
}

async function main(): Promise<void> {
await mkdir(samples, { recursive: true });
const work = path.join(samples, ".build");
await mkdir(work, { recursive: true });

const pieces: Array<{ file: string; ms: number; line?: (typeof lines)[number] }> = [];
for (const [index, line] of lines.entries()) {
  const raw = path.join(work, `${line.id}.raw.wav`);
  const wav = path.join(work, `${line.id}.wav`);
  await speak(line.text, raw);
  await run("ffmpeg", ["-y", "-i", raw, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
  pieces.push({ file: wav, ms: await probe(wav), line });
  if (line.gapAfter > 0 && index < lines.length - 1) {
    const gap = path.join(work, `${line.id}.gap.wav`);
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", String(line.gapAfter), "-c:a", "pcm_s16le", gap]);
    pieces.push({ file: gap, ms: await probe(gap) });
  } else if (index === lines.length - 1 && line.gapAfter > 0) {
    const gap = path.join(work, `${line.id}.tail.wav`);
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", String(line.gapAfter), "-c:a", "pcm_s16le", gap]);
    pieces.push({ file: gap, ms: await probe(gap) });
  }
}

const list = path.join(work, "list.txt");
await writeFile(list, pieces.map((piece) => `file '${piece.file.replace(/\\/g, "/")}'`).join("\n"), "utf8");
const audio = path.join(work, "audio.wav");
await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", audio]);

let cursor = 0;
const sentences = [];
const words = [];
const draws: string[] = [];
const font = "C\\\\:/Windows/Fonts/arial.ttf";
for (const piece of pieces) {
  if (piece.line) {
    const tokens = piece.line.text.split(/\s+/);
    const slice = piece.ms / tokens.length;
    const wordIds: string[] = [];
    tokens.forEach((token, index) => {
      const id = `${piece.line!.id}w${index}`;
      wordIds.push(id);
      words.push({
        id,
        sentenceId: piece.line!.id,
        text: token,
        startMs: Math.round(cursor + slice * index),
        endMs: Math.round(cursor + slice * (index + 1)),
        confidence: 0.4,
      });
    });
    sentences.push({
      id: piece.line.id,
      text: piece.line.text,
      startMs: cursor,
      endMs: cursor + piece.ms,
      wordIds,
    });
    const start = (cursor / 1000).toFixed(3);
    const end = ((cursor + piece.ms) / 1000).toFixed(3);
    const safe = piece.line.text.replace(/:/g, "\\:").replace(/'/g, "");
    draws.push(
      `drawtext=fontfile=${font}:text='${safe}':fontsize=46:fontcolor=0xF4F1EA:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,${start},${end})'`,
    );
  }
  cursor += piece.ms;
}

const video = path.join(samples, "demo.mp4");
await run("ffmpeg", [
  "-y",
  "-f", "lavfi", "-i", `color=c=0x141618:s=1280x720:r=30:d=${(cursor / 1000 + 0.2).toFixed(3)}`,
  "-i", audio,
  "-filter_complex",
  `[0:v]${draws.join(",")}[v]`,
  "-map", "[v]",
  "-map", "1:a",
  "-shortest",
  "-c:v", "libx264",
  "-pix_fmt", "yuv420p",
  "-c:a", "aac",
  "-movflags", "+faststart",
  video,
]);

const transcript = {
  id: "demo-fixture",
  model: null,
  text: lines.map((line) => line.text).join(" "),
  words,
  sentences,
};
await writeFile(path.join(samples, "demo.transcript.json"), JSON.stringify(transcript, null, 2), "utf8");
await writeFile(
  path.join(samples, "README.md"),
  [
    "# Demo sample",
    "",
    "demo.mp4 was generated in this repository with Windows Speech and FFmpeg.",
    "We made it for the Cutback demo and you can use it.",
    "",
    "demo.transcript.json is a fixture. Sentence start and end times match the generated audio.",
    "Word times inside a sentence are split evenly. They are not AssemblyAI timestamps.",
    "Run Transcribe in the app to replace the fixture with a real transcript.",
    "",
  ].join("\n"),
  "utf8",
);
console.log(`Wrote ${video} (${cursor} ms)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
