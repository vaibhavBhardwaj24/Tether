import WebSocket from "ws";

export interface Session {
  code: string;
  extensionSocket: WebSocket | null;
  mobileSocket: WebSocket | null;
  pairedAt: number | null;
}

// In-memory session store — one entry per pairing code
const sessions = new Map<string, Session>();

export function getSession(code: string): Session | undefined {
  return sessions.get(code);
}

export function getOrCreateSession(code: string): Session {
  if (!sessions.has(code)) {
    sessions.set(code, {
      code,
      extensionSocket: null,
      mobileSocket: null,
      pairedAt: null,
    });
  }
  return sessions.get(code)!;
}

export function deleteSession(code: string): void {
  sessions.delete(code);
}

// Utility: look up which code a given socket is registered under
export function findCodeBySocket(
  socket: WebSocket
): { code: string; role: "extension" | "mobile" } | null {
  for (const [code, session] of sessions.entries()) {
    if (session.extensionSocket === socket)
      return { code, role: "extension" };
    if (session.mobileSocket === socket) return { code, role: "mobile" };
  }
  return null;
}
