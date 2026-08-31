/**
 * @module
 *
 * Streamable HTTP transport, for hosts that reach the server over the network.
 *
 * Stdio remains the default because that is what a locally installed host
 * spawns. This exists for the browser: a page cannot spawn a process, so every
 * in-browser host and inspector connects over HTTP, and that is the only way to
 * see the panel rendered by something other than the preview fixture.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FsGuard } from "./fsGuard.js";
import { registerTools, type ToolOptions } from "./tools/index.js";
import { SERVER_VERSION } from "./version.js";

/** The path every MCP request arrives on. */
const ENDPOINT = "/mcp";

/** What the HTTP listener needs to serve a session. */
export interface HttpOptions {
  port: number;
  guard: FsGuard;
  tools: ToolOptions;
  instructions: string;
  /** Browser origins allowed to call this server, for CORS. */
  allowedOrigins: string[];
}

/**
 * Serves the editor over Streamable HTTP until the process ends.
 *
 * Each session gets its own `McpServer`, because the host capability probe the
 * commit path uses reads the capabilities of one connected client. Sharing an
 * instance across sessions would answer for whichever connected last.
 *
 * @param options - Port, guard, tool settings and the origins to allow.
 * @returns A promise that resolves once the listener is accepting connections.
 */
export function serveHttp(options: HttpOptions): Promise<void> {
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const http = createServer((req, res) => {
    void handle(req, res, sessions, options);
  });

  return new Promise((resolve, reject) => {
    // A listener with no error handler throws the raw event and takes the
    // process down with a stack trace. The common case by far is a port still
    // held by the last run, which deserves a sentence rather than a trace.
    http.once("error", (cause: NodeJS.ErrnoException) => {
      reject(
        cause.code === "EADDRINUSE"
          ? new Error(
              `Port ${options.port} is already in use — an earlier run is probably still ` +
                `holding it. Stop that one, or pass --http-port <n> to use another.`,
            )
          : cause,
      );
    });

    // Loopback only. A file-writing server has no business accepting a
    // connection from another machine, and binding the wildcard address is how
    // that happens by accident.
    http.listen(options.port, "127.0.0.1", () => resolve());
  });
}

/**
 * Answers one HTTP request.
 *
 * @param req - The incoming request.
 * @param res - The response to write.
 * @param sessions - Live transports, keyed by session id.
 * @param options - The serving options.
 */
async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: Map<string, StreamableHTTPServerTransport>,
  options: HttpOptions,
): Promise<void> {
  applyCors(req, res, options.allowedOrigins);

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  const path = (req.url ?? "").split("?")[0];
  if (path !== ENDPOINT) {
    res.writeHead(404, { "content-type": "text/plain" }).end(`Nothing here. Try ${ENDPOINT}.\n`);
    return;
  }

  const sessionId = header(req, "mcp-session-id");
  const existing = sessionId ? sessions.get(sessionId) : undefined;

  if (existing) {
    await existing.handleRequest(req, res);
    return;
  }

  if (sessionId) {
    res.writeHead(404, { "content-type": "text/plain" }).end("Unknown session.\n");
    return;
  }

  await openSession(req, res, sessions, options);
}

/**
 * Starts a new session and lets it answer the request that opened it.
 *
 * @param req - The initialising request.
 * @param res - The response to write.
 * @param sessions - Live transports, keyed by session id.
 * @param options - The serving options.
 */
async function openSession(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: Map<string, StreamableHTTPServerTransport>,
  options: HttpOptions,
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, transport);
    },
  });

  transport.onclose = () => {
    if (transport.sessionId) sessions.delete(transport.sessionId);
  };

  const server = new McpServer(
    { name: "interactive-editor", version: SERVER_VERSION },
    { instructions: options.instructions },
  );
  registerTools(server, options.guard, options.tools);

  await server.connect(transport);
  await transport.handleRequest(req, res);
}

/**
 * Allows the configured browser origins to reach the endpoint.
 *
 * Without this a host page served from another port cannot call the server at
 * all: the browser refuses the request before it is sent, and the session id
 * header stays unreadable even when the call succeeds.
 *
 * @param req - The incoming request.
 * @param res - The response to write headers onto.
 * @param allowed - Origins to accept.
 */
function applyCors(req: IncomingMessage, res: ServerResponse, allowed: string[]): void {
  const origin = header(req, "origin");
  if (!origin || !allowed.includes(origin)) return;

  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "access-control-allow-headers",
    "content-type, mcp-session-id, mcp-protocol-version",
  );
  res.setHeader("access-control-expose-headers", "mcp-session-id");
}

/**
 * Reads one request header as a single value.
 *
 * @param req - The incoming request.
 * @param name - The header to read, lowercase.
 * @returns The value, or undefined when it was not sent.
 */
function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
