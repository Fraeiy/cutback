import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createProject, defaultEdit, type Project } from "../../../packages/timeline/src/index.js";

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function dataRoot(): string {
  return path.resolve(process.env.CUTBACK_DATA_DIR || path.join(process.cwd(), "data"));
}

export function assertId(id: string): string {
  if (!ID_PATTERN.test(id)) throw new Error("Invalid project id.");
  return id;
}

export function projectDir(id: string): string {
  return path.join(dataRoot(), assertId(id));
}

const tails = new Map<string, Promise<unknown>>();

export function withProjectLock<T>(id: string, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(id) ?? Promise.resolve();
  const run = previous.then(task, task);
  tails.set(
    id,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

export async function loadProject(id: string): Promise<Project> {
  const file = path.join(projectDir(id), "project.json");
  const raw = await readFile(file, "utf8");
  const project = JSON.parse(raw) as Project;
  if (project.version !== 1) throw new Error(`Unsupported project version ${String(project.version)}.`);
  const defaults = defaultEdit(project.media?.durationMs ?? 0);
  project.edit = {
    ...defaults,
    ...project.edit,
    pause: { ...defaults.pause, ...project.edit?.pause },
    captions: { ...defaults.captions, ...project.edit?.captions },
    framing: { ...defaults.framing, ...project.edit?.framing },
    audio: { ...defaults.audio, ...project.edit?.audio },
    history: project.edit?.history ?? [],
    spans: project.edit?.spans ?? defaults.spans,
  };
  project.music ??= null;
  project.proposals ??= [];
  project.appliedCalls ??= {};
  return project;
}

export async function saveProject(project: Project): Promise<void> {
  const dir = projectDir(project.id);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "project.json");
  const temp = path.join(dir, "project.json.tmp");
  const body = JSON.stringify(project);
  await writeFile(temp, body, "utf8");
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rename(temp, file);
      return;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EBUSY" && code !== "ENOENT") throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
      try {
        await writeFile(temp, body, "utf8");
      } catch {
        /* the previous rename may have consumed the temp file */
      }
    }
  }
  throw lastError;
}

export async function createEmptyProject(title?: string): Promise<Project> {
  const project = createProject(crypto.randomUUID(), title?.slice(0, 120) || "Untitled");
  await saveProject(project);
  return project;
}
