import * as vscode from "vscode";
import { sidebarLog } from "./SidebarProvider";
// ws must be imported with esModuleInterop-compatible import for bundling
import WebSocket = require("ws");

// ─── Types mirroring the relay protocol ─────────────────────────────────────

export interface InboundMsg {
  type: string;
  from?: "mobile";
  payload?: Record<string, unknown>;
}

// ─── RemoteRelay: manages WS lifecycle for the extension side ───────────────

export class RemoteRelay {
  private _ws: WebSocket | null = null;
  private _code: string = "";
  private _paired: boolean = false;
  private _reconnectTimer: NodeJS.Timeout | undefined;

  // Callbacks set by extension.ts
  public onMessage: ((msg: InboundMsg) => void) | null = null;
  public onPaired: (() => void) | null = null;
  public onDisconnected: (() => void) | null = null;
  public onStatusChange: ((status: string) => void) | null = null;

  get code() { return this._code; }
  get paired() { return this._paired; }
  get connected() { return this._ws?.readyState === WebSocket.OPEN; }

  private get _relayBaseUrl(): string {
    const cfg = vscode.workspace.getConfiguration("tether");
    return cfg.get<string>("relayUrl", "http://localhost:3000");
  }

  private get _wsBaseUrl(): string {
    return this._relayBaseUrl.replace(/^http/, "ws");
  }

  /** Step 1: Ask relay for a pairing code, then open the WS */
  async start(): Promise<string> {
    sidebarLog("relay.start() called — cleaning up old connection");
    this._cleanup();

    // 1. Generate code via REST (with 10s timeout so we don't hang forever)
    const apiUrl = `${this._relayBaseUrl}/pair/generate`;
    sidebarLog(`Fetching: POST ${apiUrl}`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    let resp: Response;
    try {
      resp = await fetch(apiUrl, { method: "POST", signal: controller.signal });
    } catch (err: any) {
      const isTimeout = err?.name === "AbortError";
      const msg = isTimeout
        ? `Relay server timed out (10s). Is the backend running at ${this._relayBaseUrl}?`
        : `Cannot reach relay server at ${this._relayBaseUrl}: ${err.message}`;
      sidebarLog(`❌ fetch failed: ${msg}`);
      throw new Error(msg);
    } finally {
      clearTimeout(timeoutId);
    }

    sidebarLog(`fetch responded: HTTP ${resp.status}`);
    if (!resp.ok) {
      throw new Error(`Relay POST /pair/generate returned ${resp.status}`);
    }
    const data = (await resp.json()) as { code: string };
    this._code = data.code;
    sidebarLog(`✅ Code received: "${this._code}"`);

    // 2. Open WebSocket
    this._openSocket();

    return this._code;
  }

  /** Pull a fresh code + reconnect */
  async refresh(): Promise<string> {
    return this.start();
  }

  /** Disconnect cleanly */
  stop() {
    sidebarLog("relay.stop() called");
    this._cleanup();
    this._paired = false;
    this._code = "";
    this.onStatusChange?.("disconnected");
  }

  /** Send a message to the mobile peer */
  send(payload: Record<string, unknown>) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(payload));
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _openSocket() {
    const wsUrl = `${this._wsBaseUrl}/ws`;
    sidebarLog(`Opening WebSocket: ${wsUrl}`);
    const ws = new WebSocket(wsUrl);
    this._ws = ws;

    ws.on("open", () => {
      sidebarLog("WebSocket open — sending register message");
      // Register as extension
      ws.send(
        JSON.stringify({ type: "register", role: "extension", code: this._code })
      );
    });

    ws.on("message", (raw: Buffer) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw.toString()); }
      catch { sidebarLog("WebSocket: received non-JSON message"); return; }

      const type = msg.type as string;
      sidebarLog(`WebSocket message received: type="${type}"`);

      if (type === "registered") {
        sidebarLog("✅ Registered with relay server — waiting for mobile");
        this.onStatusChange?.("waiting_for_mobile");
        return;
      }

      if (type === "paired") {
        sidebarLog("👋 Paired with mobile!");
        this._paired = true;
        this.onStatusChange?.("paired");
        this.onPaired?.();
        return;
      }

      if (type === "peer_disconnected") {
        sidebarLog("Mobile peer disconnected");
        this._paired = false;
        this.onStatusChange?.("peer_disconnected");
        this.onDisconnected?.();
        return;
      }

      if (type === "error") {
        sidebarLog(`❌ Relay error: ${msg.message}`);
        vscode.window.showWarningMessage(`[Relay] ${msg.message}`);
        return;
      }

      // Everything else: route to the caller
      sidebarLog(`Routing inbound message to handler: type="${type}"`);
      this.onMessage?.(msg as unknown as InboundMsg);
    });

    ws.on("close", (code: number, reason: Buffer) => {
      sidebarLog(`WebSocket closed: code=${code} reason="${reason.toString() || "(none)"}"`);
      this._paired = false;
      this.onStatusChange?.("disconnected");
      this.onDisconnected?.();
    });

    ws.on("error", (err: Error) => {
      sidebarLog(`❌ WebSocket error: ${err.message}`);
      vscode.window.showErrorMessage(`[Relay] WebSocket error: ${err.message}`);
    });
  }

  private _cleanup() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = undefined;
    }
    if (this._ws) {
      this._ws.removeAllListeners();
      try { this._ws.close(); } catch {}
      this._ws = null;
    }
  }
}

// Singleton exported for use in extension.ts and SidebarProvider.ts
export const relay = new RemoteRelay();
