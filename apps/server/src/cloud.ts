import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { get, issueSignedToken, presignUrl, put } from "@vercel/blob";

function localProjectDir(id: string): string {
  return path.join(path.resolve(process.env.CUTBACK_DATA_DIR || path.join(process.cwd(), "data")), id);
}

export function usesBlobStorage(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

export function projectBlobPath(id: string, name: string): string {
  return `projects/${id}/${name.replace(/^\/+/, "")}`;
}

export async function readPrivateText(pathname: string): Promise<string | null> {
  const result = await get(pathname, { access: "private", useCache: false });
  if (!result) return null;
  return new Response(result.stream).text();
}

export async function writePrivateText(pathname: string, body: string): Promise<void> {
  await put(pathname, body, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/json",
  });
}

export async function uploadPrivateFile(localPath: string, pathname: string, contentType: string): Promise<void> {
  await put(pathname, createReadStream(localPath), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType,
    multipart: true,
  });
}

export async function materializeProjectFile(id: string, storedName: string): Promise<string> {
  if (!usesBlobStorage()) return path.join(localProjectDir(id), storedName);
  const localPath = path.join(localProjectDir(id), path.basename(storedName));
  if (existsSync(localPath)) return localPath;
  const result = await get(storedName, { access: "private", useCache: true });
  if (!result) throw new Error("Stored media is missing.");
  await mkdir(localProjectDir(id), { recursive: true });
  await pipeline(Readable.fromWeb(result.stream as never), createWriteStream(localPath));
  return localPath;
}

export async function signedReadUrl(pathname: string, validForMs = 60 * 60 * 1000): Promise<string> {
  const validUntil = Date.now() + validForMs;
  const token = await issueSignedToken({ pathname, operations: ["get"], validUntil });
  const result = await presignUrl(token, {
    access: "private",
    operation: "get",
    pathname,
    validUntil,
  });
  return result.presignedUrl;
}

export async function signedUploadUrl(
  pathname: string,
  contentType: string,
  maximumSizeInBytes: number,
): Promise<string> {
  const validUntil = Date.now() + 15 * 60 * 1000;
  const token = await issueSignedToken({
    pathname,
    operations: ["put"],
    validUntil,
    allowedContentTypes: [contentType],
    maximumSizeInBytes,
  });
  const result = await presignUrl(token, {
    access: "private",
    operation: "put",
    pathname,
    validUntil,
    allowedContentTypes: [contentType],
    maximumSizeInBytes,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return result.presignedUrl;
}
