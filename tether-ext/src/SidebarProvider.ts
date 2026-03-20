import * as vscode from "vscode";
import { relay } from "./RemoteRelay";
import * as QRCode from "qrcode";

// Shared debug channel — also used by RemoteRelay
export let sidebarLog: (msg: string) => void = () => {};

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "tether.sidebarView";

  private _view?: vscode.WebviewView;

  private _debugChannel: vscode.OutputChannel;

  constructor(private readonly _extensionUri: vscode.Uri) {
    this._debugChannel = vscode.window.createOutputChannel("Tether Debug");
    sidebarLog = (msg: string) =>
      this._debugChannel.appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`);

    sidebarLog("SidebarProvider constructed");

    // Wire relay events → sidebar UI updates
    relay.onStatusChange = (status) => {
      sidebarLog(`relay.onStatusChange → "${status}"`);
      this._updateWsStatus(status);
    };
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    sidebarLog("resolveWebviewView called — setting up webview");
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview();
    sidebarLog("Webview HTML set");

    // Handle messages FROM the webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      sidebarLog(`Message from webview: command="${message.command}"`);
      switch (message.command) {
        case "ready":
          sidebarLog("Webview is ready — calling _fetchAndConnect()");
          this._debugChannel.show(false); // auto-open the debug panel
          await this._fetchAndConnect();
          break;
        case "getCode":
        case "refreshCode":
          sidebarLog(`"${message.command}" button pressed — refreshing`);
          await this._fetchAndConnect();
          break;
        case "disconnectWebSocket":
          sidebarLog("Disconnect requested");
          relay.stop();
          break;
        default:
          sidebarLog(`Unknown command from webview: "${message.command}"`);
      }
    });

    webviewView.onDidChangeVisibility(() => {
      sidebarLog(`Webview visibility changed: visible=${webviewView.visible}`);
    });

    webviewView.onDidDispose(() => {
      sidebarLog("Webview disposed");
    });
  }

  /** Call relay to generate code + open WS as extension */
  private async _fetchAndConnect() {
    sidebarLog("_fetchAndConnect() START");
    this._postMessage({ command: "setLoading", loading: true });

    try {
      sidebarLog("Calling relay.start() ...");
      const code = await relay.start();
      sidebarLog(`relay.start() returned code: "${code}"`);
      
      let qrDataUrl = "";
      try {
        qrDataUrl = await QRCode.toDataURL(code, { width: 140, margin: 2, color: { dark: '#000000', light: '#ffffff' } });
      } catch (err: any) {
        sidebarLog(`QRCode generation failed: ${err.message}`);
      }

      this._postMessage({ command: "updateCode", code, qrDataUrl });
      this._updateWsStatus("waiting_for_mobile");
    } catch (err: any) {
      sidebarLog(`relay.start() THREW: ${err.message}`);
      vscode.window.showWarningMessage(
        `Could not reach relay server: ${err.message}`
      );
      this._postMessage({ command: "updateCode", code: "ERR" });
      this._updateWsStatus("disconnected");
    } finally {
      sidebarLog("_fetchAndConnect() DONE — setLoading: false");
      this._postMessage({ command: "setLoading", loading: false });
    }
  }

  private _updateWsStatus(status: string) {
    const labelMap: Record<string, string> = {
      waiting_for_mobile: "Waiting for mobile...",
      paired: "Paired ✓",
      peer_disconnected: "Mobile disconnected",
      disconnected: "Disconnected",
    };
    const connected = status === "paired";
    sidebarLog(`_updateWsStatus("${status}") → connected=${connected}`);
    this._postMessage({
      command: "wsStatus",
      connected,
      label: labelMap[status] ?? status,
    });
  }

  private _postMessage(message: unknown) {
    const hasView = !!this._view;
    sidebarLog(`_postMessage: ${JSON.stringify(message)} (view exists: ${hasView})`);
    this._view?.webview.postMessage(message);
  }

  private _getHtmlForWebview(): string {
    return /*html*/ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Tether</title>
  <style>
    /* ── Reset & Base ──────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family, "Segoe UI", system-ui, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      padding: 16px;
      min-height: 100vh;
    }

    /* ── Section Cards ────────────────────────────────────── */
    .card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.06));
      border-radius: 10px;
      padding: 20px;
      margin-bottom: 14px;
      position: relative;
      overflow: hidden;
    }
    .card::before {
      content: "";
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: linear-gradient(90deg, #6366f1, #8b5cf6, #a78bfa);
      border-radius: 10px 10px 0 0;
    }
    .card-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* ── Connection Code ──────────────────────────────────── */
    .code-display {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 4px;
      margin: 16px 0;
      min-height: 52px;
    }
    .code-char {
      display: inline-flex;
      justify-content: center;
      align-items: center;
      width: 36px;
      height: 46px;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.08));
      border-radius: 8px;
      font-family: "JetBrains Mono", "Fira Code", "Cascadia Code", "Consolas", monospace;
      font-size: 18px;
      font-weight: 700;
      color: var(--vscode-foreground);
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .code-char.pop { animation: charPop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); }
    @keyframes charPop {
      0%   { transform: scale(0.5); opacity: 0; }
      60%  { transform: scale(1.12); }
      100% { transform: scale(1);   opacity: 1; }
    }
    .code-char:hover {
      border-color: #8b5cf6;
      box-shadow: 0 0 0 2px rgba(139,92,246,0.15);
      transform: translateY(-2px);
    }
    .code-divider {
      width: 8px; height: 3px;
      background: var(--vscode-descriptionForeground);
      border-radius: 2px;
      opacity: 0.4;
      margin: 0 2px;
    }

    /* ── Loading Skeleton ─────────────────────────────────── */
    .skeleton {
      background: linear-gradient(
        90deg,
        var(--vscode-input-background) 25%,
        rgba(139,92,246,0.08) 50%,
        var(--vscode-input-background) 75%
      );
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
    }
    @keyframes shimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    /* ── Buttons ──────────────────────────────────────────── */
    .btn-row { display: flex; gap: 8px; margin-top: 12px; }
    button {
      flex: 1;
      padding: 9px 14px;
      border: none;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.2s ease;
      font-family: inherit;
    }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    .btn-primary { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; }
    .btn-primary:hover:not(:disabled) {
      background: linear-gradient(135deg, #818cf8, #a78bfa);
      box-shadow: 0 4px 14px rgba(99,102,241,0.35);
      transform: translateY(-1px);
    }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.06));
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
    }
    .btn-secondary:hover:not(:disabled) {
      border-color: rgba(139,92,246,0.3);
      transform: translateY(-1px);
    }
    .btn-danger {
      background: rgba(239,68,68,0.12);
      color: #f87171;
      border: 1px solid rgba(239,68,68,0.2);
    }
    .btn-danger:hover:not(:disabled) {
      background: rgba(239,68,68,0.2);
      border-color: rgba(239,68,68,0.4);
    }

    /* ── Status Badge ─────────────────────────────────────── */
    .status-badge {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.3s ease;
    }
    .status-badge.disconnected {
      background: rgba(239,68,68,0.08);
      border: 1px solid rgba(239,68,68,0.15);
      color: #f87171;
    }
    .status-badge.waiting {
      background: rgba(234,179,8,0.08);
      border: 1px solid rgba(234,179,8,0.2);
      color: #facc15;
    }
    .status-badge.connected {
      background: rgba(34,197,94,0.08);
      border: 1px solid rgba(34,197,94,0.15);
      color: #4ade80;
    }
    .status-dot {
      width: 10px; height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
      position: relative;
    }
    .status-dot.disconnected { background: #ef4444; }
    .status-dot.waiting {
      background: #eab308;
      animation: blink 1.2s ease-in-out infinite;
    }
    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    .status-dot.connected {
      background: #22c55e;
      box-shadow: 0 0 8px rgba(34,197,94,0.4);
    }
    .status-dot.connected::after {
      content: "";
      position: absolute;
      inset: -3px;
      border-radius: 50%;
      border: 2px solid rgba(34,197,94,0.3);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%   { opacity: 1; transform: scale(1); }
      50%  { opacity: 0; transform: scale(1.6); }
      100% { opacity: 0; transform: scale(1.6); }
    }

    /* ── Copy Hint ────────────────────────────────────────── */
    .copy-hint {
      text-align: center;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 8px;
      opacity: 0.7;
      transition: opacity 0.2s;
    }
    .toast {
      position: fixed;
      bottom: 16px; left: 50%;
      transform: translateX(-50%) translateY(20px);
      background: #22c55e;
      color: #fff;
      padding: 8px 18px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      opacity: 0;
      pointer-events: none;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      z-index: 999;
    }
    .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

    /* ── Timer bar ────────────────────────────────────────── */
    .timer-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    .timer-bar-track {
      flex: 1;
      height: 4px;
      background: rgba(255,255,255,0.06);
      border-radius: 4px;
      overflow: hidden;
    }
    .timer-bar-fill {
      height: 100%;
      width: 100%;
      border-radius: 4px;
      background: linear-gradient(90deg, #6366f1, #8b5cf6);
      transform-origin: left;
      transition: width 1s linear, background 0.5s ease;
    }
    .timer-bar-fill.warn  { background: linear-gradient(90deg, #f59e0b, #ef4444); }
    .timer-bar-fill.crit  {
      background: #ef4444;
      animation: barPulse 0.6s ease-in-out infinite alternate;
    }
    @keyframes barPulse {
      from { opacity: 1; }
      to   { opacity: 0.5; }
    }
    .timer-label {
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      min-width: 26px;
      text-align: right;
      transition: color 0.3s;
      color: var(--vscode-descriptionForeground);
    }
    .timer-label.warn { color: #f59e0b; }
    .timer-label.crit { color: #ef4444; }

    /* ── QR Container ────────────────────────────────────── */
    .qr-container {
      display: flex;
      justify-content: center;
      align-items: center;
      margin-bottom: 12px;
      margin-top: 4px;
    }
    .qr-container img {
      border-radius: 8px;
    }
    .skeleton-qr {
      width: 140px;
      height: 140px;
      margin: 4px auto 12px;
      border-radius: 8px;
      background: linear-gradient(
        90deg,
        var(--vscode-input-background) 25%,
        rgba(139,92,246,0.08) 50%,
        var(--vscode-input-background) 75%
      );
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
    }

    /* ── Code wrapper + expired overlay ──────────────────── */
    .code-wrapper {
      position: relative;
    }
    .expired-overlay {
      display: none;
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0.55);
      border-radius: 8px;
      backdrop-filter: blur(2px);
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      z-index: 10;
    }
    .expired-overlay.show { display: flex; }
    .expired-icon { font-size: 20px; line-height: 1; }
    .expired-text {
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 2px;
      color: #ef4444;
    }
    .expired-sub {
      font-size: 10px;
      color: rgba(255,255,255,0.5);
    }
    /* Blur the chars and QR when expired */
    .code-wrapper.expired .code-char,
    .code-wrapper.expired .qr-container {
      filter: blur(3px);
      opacity: 0.3;
      transition: filter 0.4s, opacity 0.4s;
    }

    .footer {
      text-align: center;
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      opacity: 0.5;
      margin-top: 20px;
      letter-spacing: 0.5px;
    }
  </style>
</head>
<body>

  <!-- ── Connection Code Card ──────────────────────────── -->
  <div class="card" id="connectionCard">
    <div class="card-title"><span>🔑</span> Connection Code</div>

    <div id="codeSection">
      <!-- Timer bar + countdown -->
      <div class="timer-row" id="timerRow">
        <div class="timer-bar-track">
          <div class="timer-bar-fill" id="timerBarFill"></div>
        </div>
        <span class="timer-label" id="timerLabel">—</span>
      </div>

      <div class="code-wrapper">
        <div class="qr-container" id="qrContainer"></div>
        <div class="code-display" id="codeDisplay"><!-- filled by JS --></div>
        <!-- Expired overlay -->
        <div class="expired-overlay" id="expiredOverlay">
          <span class="expired-icon">⏱</span>
          <span class="expired-text">EXPIRED</span>
          <span class="expired-sub">Click Refresh for new code</span>
        </div>
      </div>
      <div class="copy-hint" id="copyHint">Click code to copy</div>
    </div>

    <div class="btn-row" id="codeBtnRow">
      <button class="btn-primary" id="btnGetCode">⟳ Get Code</button>
      <button class="btn-secondary" id="btnRefresh">↻ Refresh</button>
    </div>
  </div>

  <!-- ── WebSocket Status Card ─────────────────────────── -->
  <div class="card">
    <div class="card-title"><span>📡</span> WebSocket</div>

    <div class="status-badge disconnected" id="statusBadge">
      <span class="status-dot disconnected" id="statusDot"></span>
      <span id="statusText">Disconnected</span>
    </div>

    <div class="btn-row" style="margin-top: 14px;">
      <button class="btn-danger" id="btnDisconnect">✕ Disconnect</button>
    </div>
  </div>

  <div class="footer">TETHER v0.1</div>
  <div class="toast" id="toast">✓ Copied!</div>

  <script>
    const vscode = acquireVsCodeApi();

    const codeDisplay    = document.getElementById("codeDisplay");
    const codeWrapper    = document.getElementById("codeDisplay").parentElement;
    const expiredOverlay = document.getElementById("expiredOverlay");
    const qrContainer    = document.getElementById("qrContainer");
    const codeSection    = document.getElementById("codeSection");
    const codeBtnRow     = document.getElementById("codeBtnRow");
    const btnGetCode     = document.getElementById("btnGetCode");
    const btnRefresh     = document.getElementById("btnRefresh");
    const btnDisconnect  = document.getElementById("btnDisconnect");
    const statusBadge    = document.getElementById("statusBadge");
    const statusDot      = document.getElementById("statusDot");
    const statusText     = document.getElementById("statusText");
    const timerBarFill   = document.getElementById("timerBarFill");
    const timerLabel     = document.getElementById("timerLabel");
    const toast          = document.getElementById("toast");

    const TOTAL_SECS = 60;
    let currentCode   = "";
    let timerInterval = null;
    let secsLeft      = 0;

    // ── Timer logic ──────────────────────────────────────────
    function startTimer() {
      stopTimer();
      secsLeft = TOTAL_SECS;
      codeWrapper.classList.remove("expired");
      expiredOverlay.classList.remove("show");
      tickTimer();
      timerInterval = setInterval(tickTimer, 1000);
    }

    function stopTimer() {
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    }

    function tickTimer() {
      const pct = (secsLeft / TOTAL_SECS) * 100;
      timerBarFill.style.width = pct + "%";
      timerLabel.textContent = secsLeft + "s";

      // Colour transitions
      const isCrit = secsLeft <= 10;
      const isWarn = secsLeft <= 20 && !isCrit;
      timerBarFill.classList.toggle("crit", isCrit);
      timerBarFill.classList.toggle("warn", isWarn);
      timerLabel.classList.toggle("crit", isCrit);
      timerLabel.classList.toggle("warn", isWarn);

      if (secsLeft <= 0) {
        stopTimer();
        markExpired();
        return;
      }
      secsLeft--;
    }

    function markExpired() {
      codeWrapper.classList.add("expired");
      expiredOverlay.classList.add("show");
      timerLabel.textContent = "0s";
      timerLabel.classList.add("crit");
      timerBarFill.style.width = "0%";
      codeDisplay.style.cursor = "default";
      codeDisplay.onclick = null;
    }

    // ── Code rendering ───────────────────────────────────────
    function renderCode(code, qrDataUrl) {
      currentCode = code;
      codeDisplay.innerHTML = "";
      
      if (qrDataUrl) {
        qrContainer.className = "qr-container";
        qrContainer.innerHTML = "<img src='" + qrDataUrl + "' width='140' height='140' />";
      } else {
        qrContainer.innerHTML = "";
      }

      code.split("").forEach((ch, i) => {
        if (i === 4) {
          const div = document.createElement("span");
          div.className = "code-divider";
          codeDisplay.appendChild(div);
        }
        const span = document.createElement("span");
        span.className = "code-char pop";
        span.style.animationDelay = (i * 0.05) + "s";
        span.textContent = ch;
        codeDisplay.appendChild(span);
      });
      codeDisplay.style.cursor = "pointer";
      codeDisplay.onclick = () =>
        navigator.clipboard.writeText(currentCode).then(() => showToast());
      startTimer();
    }

    function renderSkeleton() {
      stopTimer();
      codeWrapper.classList.remove("expired");
      expiredOverlay.classList.remove("show");
      
      qrContainer.className = "skeleton-qr";
      qrContainer.innerHTML = "";
      timerBarFill.style.width = "100%";
      timerBarFill.classList.remove("warn", "crit");
      timerLabel.classList.remove("warn", "crit");
      timerLabel.textContent = "—";
      codeDisplay.innerHTML = "";
      for (let i = 0; i < 8; i++) {
        if (i === 4) {
          const d = document.createElement("span");
          d.className = "code-divider";
          codeDisplay.appendChild(d);
        }
        const s = document.createElement("span");
        s.className = "code-char skeleton";
        codeDisplay.appendChild(s);
      }
      codeDisplay.style.cursor = "default";
      codeDisplay.onclick = null;
    }

    function showToast() {
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 1600);
    }

    function applyStatus(connected, label) {
      let cls = "disconnected";
      if (connected) cls = "connected";
      else if (label && label.toLowerCase().includes("wait")) cls = "waiting";
      statusBadge.className  = "status-badge " + cls;
      statusDot.className    = "status-dot "   + cls;
      statusText.textContent = label ?? (connected ? "Connected" : "Disconnected");
      btnDisconnect.disabled = !connected && cls === "disconnected";
      
      if (connected) {
        codeSection.style.display = "none";
        codeBtnRow.style.display = "none";
      } else {
        codeSection.style.display = "block";
        codeBtnRow.style.display = "flex";
      }
    }

    btnGetCode.addEventListener("click",    () => vscode.postMessage({ command: "getCode" }));
    btnRefresh.addEventListener("click",    () => vscode.postMessage({ command: "refreshCode" }));
    btnDisconnect.addEventListener("click", () => vscode.postMessage({ command: "disconnectWebSocket" }));

    window.addEventListener("message", (event) => {
      const msg = event.data;
      switch (msg.command) {
        case "updateCode":
          renderCode(msg.code, msg.qrDataUrl);
          break;
        case "setLoading":
          if (msg.loading) {
            renderSkeleton();
            btnGetCode.disabled = btnRefresh.disabled = true;
          } else {
            btnGetCode.disabled = btnRefresh.disabled = false;
          }
          break;
        case "wsStatus":
          applyStatus(msg.connected, msg.label);
          break;
      }
    });

    renderSkeleton();

    // Tell the extension that JS is ready to receive messages
    vscode.postMessage({ command: "ready" });
  </script>
</body>
</html>`;
  }
}
