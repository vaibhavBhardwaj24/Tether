import WebSocket, { WebSocketServer } from "ws";
import { IncomingMessage } from "http";
import {
  getPair,
  setPair,
  getTTL,
  PairRecord,
} from "./redis";
import {
  getOrCreateSession,
  findCodeBySocket,
  deleteSession,
  getSession,
} from "./sessions";
import { isValidCode } from "./pairRoutes";

// How long (ms) a socket has to send its register message
const REGISTER_TIMEOUT_MS = 60_000;

type Role = "extension" | "mobile";

interface RegisterMessage {
  type: "register";
  role: Role;
  code: string;
}

// Send a typed JSON message to a socket (no-op if socket isn't open)
function sendJSON(ws: WebSocket, payload: object): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

// -----------------------------------------------------------------
// Main WebSocket handler — called for every new connection at /ws
// -----------------------------------------------------------------
export function setupWebSocket(wss: WebSocketServer): void {
  wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
    console.log("[WS] New connection");

    let registered = false;
    let registeredCode: string | null = null;
    let registeredRole: Role | null = null;

    // Kick any socket that doesn't register within the timeout window
    const registerTimer = setTimeout(() => {
      if (!registered) {
        console.warn("[WS] Registration timeout — closing socket");
        ws.close(4000, "Registration timeout");
      }
    }, REGISTER_TIMEOUT_MS);

    ws.on("message", async (raw: WebSocket.RawData) => {
      let parsed: Record<string, unknown>;

      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        sendJSON(ws, { type: "error", message: "Invalid JSON" });
        return;
      }

      // ---- Registration phase ----
      if (!registered) {
        if (parsed.type !== "register") {
          sendJSON(ws, { type: "error", message: "Expected register message" });
          return;
        }

        const { role, code } = parsed as unknown as RegisterMessage;

        // Validate role
        if (role !== "extension" && role !== "mobile") {
          sendJSON(ws, { type: "error", message: "Invalid role" });
          ws.close(4001, "Invalid role");
          return;
        }

        // Validate code format
        if (!isValidCode(code)) {
          sendJSON(ws, { type: "error", message: "Invalid code format" });
          ws.close(4002, "Invalid code format");
          return;
        }

        // Validate code exists in Redis
        const record = await getPair(code);
        if (!record) {
          sendJSON(ws, { type: "error", message: "Code not found or expired" });
          ws.close(4003, "Code not found");
          return;
        }

        const session = getOrCreateSession(code);

        if (role === "extension") {
          // Reject duplicate extension connection
          if (
            session.extensionSocket !== null &&
            session.extensionSocket.readyState === WebSocket.OPEN
          ) {
            sendJSON(ws, {
              type: "error",
              message: "Extension already connected for this code",
            });
            ws.close(4004, "Duplicate extension");
            return;
          }

          session.extensionSocket = ws;

          // Update Redis status
          const ttl = await getTTL(code);
          await setPair(
            code,
            { ...record, status: "extension_connected" },
            ttl > 0 ? ttl : 300
          );

          clearTimeout(registerTimer);
          registered = true;
          registeredCode = code;
          registeredRole = "extension";

          sendJSON(ws, {
            type: "registered",
            code,
            status: "waiting_for_mobile",
          });

          console.log(`[WS] Extension registered for code: ${code}`);
        } else {
          // role === "mobile"
          // Extension must already be connected
          if (
            !session.extensionSocket ||
            session.extensionSocket.readyState !== WebSocket.OPEN
          ) {
            sendJSON(ws, {
              type: "error",
              message: "Extension not connected yet",
            });
            ws.close(4005, "Extension not connected");
            return;
          }

          // Reject duplicate mobile connection
          if (
            session.mobileSocket !== null &&
            session.mobileSocket.readyState === WebSocket.OPEN
          ) {
            sendJSON(ws, {
              type: "error",
              message: "Mobile already connected for this code",
            });
            ws.close(4006, "Duplicate mobile");
            return;
          }

          session.mobileSocket = ws;
          session.pairedAt = Date.now();

          // Update Redis — extend TTL to 1 hour on pairing
          await setPair(
            code,
            { ...record, status: "paired" },
            3600
          );

          clearTimeout(registerTimer);
          registered = true;
          registeredCode = code;
          registeredRole = "mobile";

          // Notify both sides
          const pairedMsg = { type: "paired", code };
          sendJSON(session.extensionSocket, pairedMsg);
          sendJSON(ws, pairedMsg);

          console.log(`[WS] Session PAIRED for code: ${code}`);
        }

        return; // Done handling registration
      }

      // ---- Relay phase ----
      // Once registered, relay all messages verbatim to the peer
      if (!registeredCode || !registeredRole) return;

      const session = getSession(registeredCode);
      if (!session) return;

      if (registeredRole === "mobile" && session.extensionSocket) {
        sendJSON(session.extensionSocket, { ...parsed, from: "mobile" });
      } else if (registeredRole === "extension" && session.mobileSocket) {
        sendJSON(session.mobileSocket, { ...parsed, from: "extension" });
      }
    });

    ws.on("close", async () => {
      clearTimeout(registerTimer);

      if (!registeredCode || !registeredRole) {
        console.log("[WS] Unregistered socket closed");
        return;
      }

      console.log(
        `[WS] ${registeredRole} disconnected for code: ${registeredCode}`
      );

      const session = getSession(registeredCode);
      if (!session) return;

      // Notify peer
      const peerSocket =
        registeredRole === "extension"
          ? session.mobileSocket
          : session.extensionSocket;

      if (peerSocket && peerSocket.readyState === WebSocket.OPEN) {
        sendJSON(peerSocket, { type: "peer_disconnected", role: registeredRole });
      }

      // Update Redis status
      try {
        const record = await getPair(registeredCode);
        if (record) {
          const ttl = await getTTL(registeredCode);
          await setPair(
            registeredCode,
            { ...record, status: "disconnected" },
            ttl > 0 ? ttl : 60
          );
        }
      } catch (err) {
        console.error("[WS] Redis update on disconnect failed:", err);
      }

      // Clean up socket reference
      if (registeredRole === "extension") {
        session.extensionSocket = null;
      } else {
        session.mobileSocket = null;
      }

      // If both sides gone, remove session from memory
      if (!session.extensionSocket && !session.mobileSocket) {
        deleteSession(registeredCode);
        console.log(`[WS] Session removed for code: ${registeredCode}`);
      }
    });

    ws.on("error", (err) => {
      console.error("[WS] Socket error:", err.message);
    });
  });
}
