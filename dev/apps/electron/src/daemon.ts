import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

/** Keep in sync with `@upriv/shared` `RpcErrorBody` (`core-rpc/errors.ts`). */
type RpcErrorBody = { code: string; message: string; details?: unknown };

const STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_RPC_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;
const SHUTDOWN_METHOD = "app_shutdown";

type WireOutReady = { type: "ready" };
type WireOutResponse = {
  type: "response";
  id: number;
  ok: boolean;
  result?: unknown;
  error?: RpcErrorBody;
};
type WireOutEvent = { type: "event"; name: string; payload: unknown };
type WireOutMessage = WireOutReady | WireOutResponse | WireOutEvent;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export interface DaemonConnection {
  process: ChildProcess;
  nextRequestId: number;
  pending: Map<number, PendingRequest>;
  eventListeners: Set<(name: string, payload: unknown) => void>;
  alive: boolean;
  /** Serializes stdin writes so concurrent RPCs never interleave NDJSON. */
  writeChain: Promise<void>;
}

let exitAfterReadyHandler: (() => void) | null = null;

export function setDaemonExitHandler(handler: (() => void) | null): void {
  exitAfterReadyHandler = handler;
}

export function resolveDaemonBinary(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "bin", "upriv-daemon");
  }
  const devBinary = path.join(__dirname, "../../../target/debug/upriv-daemon");
  if (fs.existsSync(devBinary)) {
    return devBinary;
  }
  return path.join(__dirname, "../../../target/release/upriv-daemon");
}

function daemonEnv(): NodeJS.ProcessEnv {
  const keys = ["PATH", "HOME", "USER", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP"] as const;
  const env: NodeJS.ProcessEnv = {};
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  if (process.platform === "linux" || process.platform === "darwin") {
    for (const key of ["XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME"] as const) {
      const value = process.env[key];
      if (value !== undefined) env[key] = value;
    }
  }
  return env;
}

function formatRpcError(error: RpcErrorBody | undefined, fallback: string): string {
  if (!error) return fallback;
  // Keep in sync with `DAEMON_ERROR_MESSAGE_RE` in `apps/desktop/src/lib/invoke.ts`.
  return `${error.code}: ${error.message}`;
}

/** Write one NDJSON line, resolving once flushed (respects backpressure). */
function writeLine(connection: DaemonConnection, line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stdin = connection.process.stdin;
    if (!stdin?.writable) {
      reject(new Error("upriv-daemon stdin is not writable"));
      return;
    }
    stdin.write(`${line}\n`, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function dispatchWireMessage(connection: DaemonConnection, message: WireOutMessage): void {
  if (message.type === "ready") {
    return;
  }

  if (message.type === "response") {
    const pending = connection.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    connection.pending.delete(message.id);
    if (message.ok) {
      pending.resolve(message.result);
    } else {
      pending.reject(new Error(formatRpcError(message.error, "daemon RPC failed")));
    }
    return;
  }

  for (const listener of connection.eventListeners) {
    listener(message.name, message.payload);
  }
}

function rejectAllPending(connection: DaemonConnection, error: Error): void {
  for (const pending of connection.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  connection.pending.clear();
}

function markDaemonDead(connection: DaemonConnection, error: Error): void {
  if (!connection.alive) return;
  connection.alive = false;
  rejectAllPending(connection, error);
  exitAfterReadyHandler?.();
}

export async function startDaemon(): Promise<DaemonConnection> {
  const binary = resolveDaemonBinary();
  if (!fs.existsSync(binary)) {
    throw new Error(
      `upriv-daemon not found at ${binary}. Run: cargo build -p upriv-daemon`,
    );
  }

  const child = spawn(binary, [], {
    stdio: ["pipe", "pipe", "pipe"],
    env: daemonEnv(),
  });

  const connection: DaemonConnection = {
    process: child,
    nextRequestId: 1,
    pending: new Map(),
    eventListeners: new Set(),
    alive: true,
    writeChain: Promise.resolve(),
  };

  let buffer = "";
  let startupTimeout: ReturnType<typeof setTimeout> | undefined;

  return new Promise<DaemonConnection>((resolve, reject) => {
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      if (startupTimeout) clearTimeout(startupTimeout);
      connection.alive = false;
      rejectAllPending(connection, error);
      child.kill();
      reject(error);
    };

    const handleLine = (line: string) => {
      if (!line) return;

      let message: WireOutMessage;
      try {
        message = JSON.parse(line) as WireOutMessage;
      } catch {
        console.error("[upriv-daemon] non-JSON stdout line:", line);
        return;
      }

      if (!settled && message.type === "ready") {
        settled = true;
        if (startupTimeout) clearTimeout(startupTimeout);
        resolve(connection);
        return;
      }

      dispatchWireMessage(connection, message);
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");
        handleLine(line);
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      console.error("[upriv-daemon]", chunk.toString().trimEnd());
    });

    child.on("error", fail);
    child.on("exit", (code) => {
      const error = new Error(`upriv-daemon exited (code ${code ?? "?"})`);
      if (!settled) {
        fail(error);
        return;
      }
      markDaemonDead(connection, error);
    });

    startupTimeout = setTimeout(
      () => fail(new Error("upriv-daemon startup timeout")),
      STARTUP_TIMEOUT_MS,
    );
  });
}

export async function stopDaemon(connection: DaemonConnection | null): Promise<void> {
  if (!connection?.alive) return;

  try {
    await daemonRpc(connection, SHUTDOWN_METHOD, {}, SHUTDOWN_TIMEOUT_MS);
  } catch {
    // Daemon may already be stopping.
  }

  rejectAllPending(connection, new Error("upriv-daemon stopped"));
  connection.alive = false;

  if (connection.process.exitCode === null && !connection.process.killed) {
    connection.process.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (connection.process.exitCode === null && !connection.process.killed) {
          connection.process.kill("SIGKILL");
        }
        resolve();
      }, 2_000);
      connection.process.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

export async function daemonRpc<T>(
  connection: DaemonConnection,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = DEFAULT_RPC_TIMEOUT_MS,
): Promise<T> {
  if (!connection.alive) {
    throw new Error("upriv-daemon is not running");
  }

  const id = connection.nextRequestId++;
  const result = await new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      connection.pending.delete(id);
      reject(new Error(`daemon RPC timeout: ${method}`));
    }, timeoutMs);

    connection.pending.set(id, { resolve, reject, timer });
    const line = JSON.stringify({ type: "request", id, method, params });
    connection.writeChain = connection.writeChain
      .then(() => writeLine(connection, line))
      .catch((error: unknown) => {
        clearTimeout(timer);
        connection.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });

  return result as T;
}

export function connectDaemonEvents(
  connection: DaemonConnection,
  onEvent: (name: string, payload: unknown) => void,
): () => void {
  connection.eventListeners.add(onEvent);
  return () => {
    connection.eventListeners.delete(onEvent);
  };
}
