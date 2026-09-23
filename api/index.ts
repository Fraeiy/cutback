import type { IncomingMessage, ServerResponse } from "node:http";
import app from "../apps/server/src/index.js";

await app.ready();

export default function handler(request: IncomingMessage, response: ServerResponse): void {
  const incoming = new URL(request.url || "/api", "http://cutback.local");
  const routedPath = incoming.searchParams.get("__cutback_path");
  if (routedPath !== null) {
    incoming.searchParams.delete("__cutback_path");
    const query = incoming.searchParams.toString();
    request.url = `/api/${routedPath}${query ? `?${query}` : ""}`;
  }
  app.server.emit("request", request, response);
}
