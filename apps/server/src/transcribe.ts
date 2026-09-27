import { createReadStream } from "node:fs";
import type { Sentence, Transcript, Word } from "../../../packages/timeline/src/index.js";

const API = "https://api.assemblyai.com";

interface AssemblyWord {
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

interface AssemblySentence {
  text: string;
  start: number;
  end: number;
  words?: AssemblyWord[];
}

function authHeaders(apiKey: string): HeadersInit {
  return { authorization: apiKey };
}

// `duplex` is required by undici for streaming request bodies but is missing from the
// DOM-flavoured RequestInit that ships with our @types/node.
type StreamingRequestInit = RequestInit & { duplex: "half" };

export async function uploadMedia(filePath: string, apiKey: string): Promise<string> {
  // Stream the file straight from disk: a 200MB video must never be buffered in memory.
  const init: StreamingRequestInit = {
    method: "POST",
    headers: authHeaders(apiKey),
    body: createReadStream(filePath) as unknown as BodyInit,
    duplex: "half",
  };
  const response = await fetch(`${API}/v2/upload`, init);
  if (!response.ok) {
    throw new Error(`AssemblyAI upload failed (${response.status}).`);
  }
  const payload = (await response.json()) as { upload_url?: string };
  if (!payload.upload_url) throw new Error("AssemblyAI upload did not return a URL.");
  return payload.upload_url;
}

export async function submitTranscript(uploadUrl: string, apiKey: string): Promise<string> {
  const response = await fetch(`${API}/v2/transcript`, {
    method: "POST",
    headers: { ...authHeaders(apiKey), "content-type": "application/json" },
    body: JSON.stringify({
      audio_url: uploadUrl,
      speech_models: ["universal-3-5-pro", "universal-2"],
      language_detection: true,
      punctuate: true,
      format_text: true,
    }),
  });
  const payload = (await response.json()) as { id?: string; error?: string };
  if (!response.ok || !payload.id) {
    throw new Error(payload.error || `AssemblyAI transcript request failed (${response.status}).`);
  }
  return payload.id;
}

export async function pollTranscript(
  transcriptId: string,
  apiKey: string,
  onTick: (status: string) => Promise<void> | void,
): Promise<{ text: string; model: string | null; words: AssemblyWord[] }> {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const response = await fetch(`${API}/v2/transcript/${transcriptId}`, { headers: authHeaders(apiKey) });
    if (!response.ok) throw new Error(`AssemblyAI poll failed (${response.status}).`);
    const payload = (await response.json()) as {
      status?: string;
      error?: string;
      text?: string;
      words?: AssemblyWord[];
      speech_model_used?: string;
    };
    await onTick(payload.status ?? "processing");
    if (payload.status === "completed") {
      return {
        text: payload.text ?? "",
        model: payload.speech_model_used ?? null,
        words: payload.words ?? [],
      };
    }
    if (payload.status === "error") throw new Error(payload.error || "Transcription failed.");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Transcription timed out. Retry it.");
}

export async function fetchSentences(transcriptId: string, apiKey: string): Promise<AssemblySentence[]> {
  const response = await fetch(`${API}/v2/transcript/${transcriptId}/sentences`, {
    headers: authHeaders(apiKey),
  });
  if (!response.ok) throw new Error(`AssemblyAI sentences failed (${response.status}).`);
  const payload = (await response.json()) as { sentences?: AssemblySentence[] };
  return payload.sentences ?? [];
}

export function toTranscript(
  transcriptId: string,
  model: string | null,
  text: string,
  sentences: AssemblySentence[],
  fallbackWords: AssemblyWord[],
): Transcript {
  const words: Word[] = [];
  const built: Sentence[] = [];
  const source = sentences.length
    ? sentences
    : groupWords(fallbackWords.length ? fallbackWords : []);

  source.forEach((sentence, sentenceIndex) => {
    const sentenceId = `s${String(sentenceIndex + 1).padStart(2, "0")}`;
    const sentenceWords = sentence.words?.length
      ? sentence.words
      : fallbackWords.filter((word) => word.end > sentence.start && word.start < sentence.end);
    const wordIds: string[] = [];
    sentenceWords.forEach((word, wordIndex) => {
      const id = `${sentenceId}w${wordIndex}`;
      wordIds.push(id);
      words.push({
        id,
        sentenceId,
        text: word.text,
        startMs: word.start,
        endMs: word.end,
        confidence: word.confidence ?? 0,
      });
    });
    if (wordIds.length === 0 && sentence.text) {
      const id = `${sentenceId}w0`;
      wordIds.push(id);
      words.push({
        id,
        sentenceId,
        text: sentence.text,
        startMs: sentence.start,
        endMs: sentence.end,
        confidence: 0,
      });
    }
    built.push({
      id: sentenceId,
      text: sentence.text,
      startMs: sentence.start,
      endMs: sentence.end,
      wordIds,
    });
  });

  if (built.length === 0) throw new Error("The transcript came back without words.");
  return { id: transcriptId, model, text, words, sentences: built };
}

function groupWords(words: AssemblyWord[]): AssemblySentence[] {
  const sentences: AssemblySentence[] = [];
  let current: AssemblyWord[] = [];
  const flush = () => {
    if (!current.length) return;
    sentences.push({
      text: current.map((word) => word.text).join(" "),
      start: current[0].start,
      end: current[current.length - 1].end,
      words: current,
    });
    current = [];
  };
  for (const word of words) {
    current.push(word);
    if (/[.!?]["']?$/.test(word.text)) flush();
  }
  flush();
  return sentences;
}
