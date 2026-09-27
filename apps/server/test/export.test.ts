import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildExportArgs, type ResolvedSegment } from "../../../packages/timeline/src/index.js";
import { ffmpegBin, findFont, probeMedia, runProcess } from "../src/ffmpeg.js";

function runBinary(bin: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr.slice(-600)));
      else resolve(Buffer.concat(chunks));
    });
  });
}

function magnitude(samples: Float32Array, frequency: number, rate: number): number {
  let real = 0;
  let imag = 0;
  const omega = (2 * Math.PI * frequency) / rate;
  for (let i = 0; i < samples.length; i += 1) {
    real += samples[i] * Math.cos(omega * i);
    imag -= samples[i] * Math.sin(omega * i);
  }
  return Math.sqrt(real * real + imag * imag) / samples.length;
}

test("exported mp4 drops the middle and keeps start and end in sync", { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cutback-"));
  try {
    const input = path.join(dir, "in.mp4");
    const output = path.join(dir, "out.mp4");
    const made = await runProcess(ffmpegBin(), [
      "-y",
      "-f", "lavfi", "-i", "color=c=red:s=320x240:d=2:r=25",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
      "-f", "lavfi", "-i", "color=c=green:s=320x240:d=2:r=25",
      "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=2",
      "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=2:r=25",
      "-f", "lavfi", "-i", "sine=frequency=1320:sample_rate=48000:duration=2",
      "-filter_complex", "[0:v][1:a][2:v][3:a][4:v][5:a]concat=n=3:v=1:a=1[v][a]",
      "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
      input,
    ]);
    assert.equal(made.code, 0, made.stderr.slice(-500));

    const font = findFont();
    assert.ok(font, "A caption font should be installed.");
    const srt = path.join(dir, "captions.srt");
    await writeFile(srt, "1\n00:00:00,200 --> 00:00:01,000\nStart section\n\n2\n00:00:02,200 --> 00:00:03,000\nEnd section\n", "utf8");
    const segments: ResolvedSegment[] = [
      { id: "start", sourceStartMs: 0, sourceEndMs: 2000, outputStartMs: 0, outputEndMs: 2000, clipId: "clip_1", clipStartMs: 0, clipEndMs: 2000 },
      { id: "end", sourceStartMs: 4000, sourceEndMs: 6000, outputStartMs: 2000, outputEndMs: 4000, clipId: "clip_1", clipStartMs: 4000, clipEndMs: 6000 },
    ];
    const rendered = await runProcess(
      ffmpegBin(),
      buildExportArgs({
        clips: [{ clipId: "clip_1", path: input, hasAudio: true, width: 320, height: 240 }],
        output,
        segments,
        hasAudio: true,
        crop: null,
        captions: {
          enabled: true,
          preset: "clean",
          fontFamily: font.family as "Arial" | "Liberation Sans" | "DejaVu Sans",
          fontScale: 1,
          color: "#F4F1EA",
          highlightColor: "#FFD84D",
          wordHighlight: false,
          background: "#000000",
          position: "bottom",
          positionY: 0.86,
        },
        srtPath: srt,
        fontsDir: font.directory,
        fontName: font.family,
      }),
    );
    assert.equal(rendered.code, 0, rendered.stderr.slice(-800));

    const duration = (await probeMedia(output)).durationMs / 1000;
    assert.ok(Math.abs(duration - 4) < 0.25, `expected about 4s, got ${duration}`);

    const colors = await Promise.all([0.4, 2.4].map((ss) => readColor(output, ss)));
    assert.ok(colors[0].r > 180 && colors[0].g < 60 && colors[0].b < 60, `start frame was ${JSON.stringify(colors[0])}`);
    assert.ok(colors[1].b > 180 && colors[1].r < 80 && colors[1].g < 80, `end frame was ${JSON.stringify(colors[1])}`);

    const tones = await Promise.all([0.4, 2.4].map((ss) => readTone(output, ss)));
    assert.ok(tones[0][440] > tones[0][880] && tones[0][440] > tones[0][1320], "start audio should be 440Hz");
    assert.ok(tones[1][1320] > tones[1][440] && tones[1][1320] > tones[1][880], "end audio should be 1320Hz");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("two clips of different sizes join into one export", { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cutback-multi-"));
  try {
    // Deliberately mismatched: different resolution and frame rate, which is
    // what breaks a naive concat.
    const first = path.join(dir, "a.mp4");
    const second = path.join(dir, "b.mp4");
    const output = path.join(dir, "out.mp4");
    const madeA = await runProcess(ffmpegBin(), [
      "-y",
      "-f", "lavfi", "-i", "color=c=red:s=320x240:d=2:r=25",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      first,
    ]);
    assert.equal(madeA.code, 0, madeA.stderr.slice(-500));
    const madeB = await runProcess(ffmpegBin(), [
      "-y",
      "-f", "lavfi", "-i", "color=c=blue:s=640x360:d=2:r=15",
      "-f", "lavfi", "-i", "sine=frequency=1320:sample_rate=48000:duration=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      second,
    ]);
    assert.equal(madeB.code, 0, madeB.stderr.slice(-500));

    // Global source time runs 0-2000 for clip A then 2000-4000 for clip B.
    const segments: ResolvedSegment[] = [
      { id: "a", sourceStartMs: 0, sourceEndMs: 2000, outputStartMs: 0, outputEndMs: 2000, clipId: "clip_a", clipStartMs: 0, clipEndMs: 2000 },
      { id: "b", sourceStartMs: 2000, sourceEndMs: 4000, outputStartMs: 2000, outputEndMs: 4000, clipId: "clip_b", clipStartMs: 0, clipEndMs: 2000 },
    ];
    const rendered = await runProcess(
      ffmpegBin(),
      buildExportArgs({
        clips: [
          { clipId: "clip_a", path: first, hasAudio: true, width: 320, height: 240 },
          { clipId: "clip_b", path: second, hasAudio: true, width: 640, height: 360 },
        ],
        output,
        segments,
        hasAudio: true,
        crop: null,
        captions: {
          enabled: false,
          preset: "clean",
          fontFamily: "Arial",
          fontScale: 1,
          color: "#FFFFFF",
          highlightColor: "#FFD84D",
          wordHighlight: false,
          background: "rgba(0,0,0,0.7)",
          position: "bottom",
          positionY: 0.86,
        },
        srtPath: null,
        fontsDir: null,
        fontName: null,
        normalize: true,
      }),
    );
    assert.equal(rendered.code, 0, rendered.stderr.slice(-900));

    const duration = (await probeMedia(output)).durationMs / 1000;
    assert.ok(Math.abs(duration - 4) < 0.3, `expected about 4s, got ${duration}`);

    // Each half must still be its own clip's footage and its own clip's tone.
    const colors = await Promise.all([0.5, 3.5].map((ss) => readColor(output, ss)));
    assert.ok(colors[0].r > 150 && colors[0].g < 80 && colors[0].b < 80, `first clip frame was ${JSON.stringify(colors[0])}`);
    assert.ok(colors[1].b > 150 && colors[1].r < 90 && colors[1].g < 90, `second clip frame was ${JSON.stringify(colors[1])}`);
    const tones = await Promise.all([0.5, 3.5].map((ss) => readTone(output, ss)));
    assert.ok(tones[0][440] > tones[0][1320], "first clip audio should be 440Hz");
    assert.ok(tones[1][1320] > tones[1][440], "second clip audio should be 1320Hz");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a clip with no audio still exports in sync", { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cutback-silent-"));
  try {
    const first = path.join(dir, "a.mp4");
    const second = path.join(dir, "b.mp4");
    const output = path.join(dir, "out.mp4");
    const madeA = await runProcess(ffmpegBin(), [
      "-y",
      "-f", "lavfi", "-i", "color=c=red:s=320x240:d=2:r=25",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      first,
    ]);
    assert.equal(madeA.code, 0, madeA.stderr.slice(-500));
    // Silent clip: video only, no audio stream at all.
    const madeB = await runProcess(ffmpegBin(), [
      "-y",
      "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=2:r=25",
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
      second,
    ]);
    assert.equal(madeB.code, 0, madeB.stderr.slice(-500));

    const segments: ResolvedSegment[] = [
      { id: "a", sourceStartMs: 0, sourceEndMs: 2000, outputStartMs: 0, outputEndMs: 2000, clipId: "clip_a", clipStartMs: 0, clipEndMs: 2000 },
      { id: "b", sourceStartMs: 2000, sourceEndMs: 4000, outputStartMs: 2000, outputEndMs: 4000, clipId: "clip_b", clipStartMs: 0, clipEndMs: 2000 },
    ];
    const rendered = await runProcess(
      ffmpegBin(),
      buildExportArgs({
        clips: [
          { clipId: "clip_a", path: first, hasAudio: true, width: 320, height: 240 },
          { clipId: "clip_b", path: second, hasAudio: false, width: 320, height: 240 },
        ],
        output,
        segments,
        hasAudio: true,
        crop: null,
        captions: {
          enabled: false,
          preset: "clean",
          fontFamily: "Arial",
          fontScale: 1,
          color: "#FFFFFF",
          highlightColor: "#FFD84D",
          wordHighlight: false,
          background: "rgba(0,0,0,0.7)",
          position: "bottom",
          positionY: 0.86,
        },
        srtPath: null,
        fontsDir: null,
        fontName: null,
        normalize: true,
      }),
    );
    assert.equal(rendered.code, 0, rendered.stderr.slice(-900));
    const duration = (await probeMedia(output)).durationMs / 1000;
    // The silent clip is padded rather than dropped, so both halves survive.
    assert.ok(Math.abs(duration - 4) < 0.3, `expected about 4s, got ${duration}`);
    const colors = await Promise.all([0.5, 3.5].map((ss) => readColor(output, ss)));
    assert.ok(colors[0].r > 150 && colors[0].b < 90, `first clip frame was ${JSON.stringify(colors[0])}`);
    assert.ok(colors[1].b > 150 && colors[1].r < 90, `second clip frame was ${JSON.stringify(colors[1])}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function readColor(file: string, seconds: number): Promise<{ r: number; g: number; b: number }> {  const raw = await runBinary(ffmpegBin(), [
    "-ss", String(seconds), "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ]);
  let r = 0;
  let g = 0;
  let b = 0;
  const pixels = Math.floor(raw.length / 3);
  for (let i = 0; i < pixels; i += 1) {
    r += raw[i * 3];
    g += raw[i * 3 + 1];
    b += raw[i * 3 + 2];
  }
  return { r: r / pixels, g: g / pixels, b: b / pixels };
}

async function readTone(file: string, seconds: number): Promise<Record<number, number>> {
  const raw = await runBinary(ffmpegBin(), [
    "-ss", String(seconds), "-t", "0.5", "-i", file, "-ac", "1", "-ar", "8000", "-f", "f32le", "-",
  ]);
  const samples = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
  return {
    440: magnitude(samples, 440, 8000),
    880: magnitude(samples, 880, 8000),
    1320: magnitude(samples, 1320, 8000),
  };
}
