import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

const STARTUP_TIMEOUT_MS = 10_000;

type WireOutReady = { type: "ready" };
type WireOutResponse = {
  type: "response";
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
};
type WireOutEvent = { type: "event"; name: string; payload: unknown };
type WireOutMessage = WireOutReady | WireOutResponse | WireOutEvent;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export interface DaemonConnection {
  process: ChildProcess;
  nextRequestId: number;
  pending: Map<number, PendingRequest>;
  eventListeners: Set<(name: string, payload: unknown) => void>;
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

function writeRequest(
  connection: DaemonConnection,
  id: number,
  method: string,
  params: Record<string, unknown>,
): void {
  const stdin = connection.process.stdin;
  if (!stdin?.writable) {
    throw new Error("upriv-daemon stdin is not writable");
  }
  const line = JSON.stringify({ type: "request", id, method, params });
  stdin.write(`${line}\n`);
}

function dispatchWireMessage(connection: DaemonConnection, message: WireOutMessage): void {
  if (message.type === "ready") {
    return;
  }

  if (message.type === "response") {
    const pending = connection.pending.get(message.id);
    if (!pending) return;
    connection.pending.delete(message.id);
    if (message.ok) {
      pending.resolve(message.result);
    } else {
      pending.reject(new Error(message.error ?? "daemon RPC failed"));
    }
    return;
  }

  for (const listener of connection.eventListeners) {
    listener(message.name, message.payload);
  }
}

function rejectAllPending(connection: DaemonConnection, error: Error): void {
  for (const pending of connection.pending.values()) {
    pending.reject(error);
  }
  connection.pending.clear();
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
    env: { ...process.env },
  });

  const connection: DaemonConnection = {
    process: child,
    nextRequestId: 1,
    pending: new Map(),
    eventListeners: new Set(),
  };

  let buffer = "";
  let startupTimeout: ReturnType<typeof setTimeout> | undefined;

  return new Promise<DaemonConnection>((resolve, reject) => {
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      if (startupTimeout) clearTimeout(startupTimeout);
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
      rejectAllPending(connection, error);
      if (!settled) {
        fail(error);
      }
    });

    startupTimeout = setTimeout(
      () => fail(new Error("upriv-daemon startup timeout")),
      STARTUP_TIMEOUT_MS,
    );
  });
}

export function stopDaemon(connection: DaemonConnection | null): void {
  if (!connection) return;
  rejectAllPending(connection, new Error("upriv-daemon stopped"));
  connection.process.kill();
}

export async function daemonRpc<T>(
  connection: DaemonConnection,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const id = connection.nextRequestId++;
  const result = await new Promise<unknown>((resolve, reject) => {
    connection.pending.set(id, { resolve, reject });
    try {
      writeRequest(connection, id, method, params);
    } catch (error) {
      connection.pending.delete(id);
      reject(error);
    }
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
