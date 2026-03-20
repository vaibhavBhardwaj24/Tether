# 🔗 Tether

> **Control your AI coding assistant from your phone.**
>
> Tether bridges your VS Code editor and your mobile device over a WebSocket relay so you can monitor Antigravity AI in real-time, send prompts, accept/reject changes, run shell commands, check Git status — all without touching your keyboard.

---

## 📖 Origin Story

Born from *Distraction-Driven Development* ™️.

While vibe-coding with Antigravity AI, the author wandered off mid-task to scroll Reels. Came back 30 minutes later to find the AI had finished ages ago — just sitting there, patiently waiting for a click. Like a dog that fetched the ball and nobody noticed. 🐕

Instead of just clicking faster next time, an entire remote-control system was built instead. Naturally.

---

## 🏗️ Monorepo Structure

```
ext/
├── tether-ext/          # VS Code Extension (TypeScript)
├── tether-backend/      # WebSocket Relay Server (Node.js / Express / Redis)
├── tether-app/
│   └── Tether/          # Mobile App (React Native / Expo)
└── UI-images/           # Screenshots & UI reference images
```

All three components are required for the full experience:

| Component | Role |
|---|---|
| `tether-ext` | Runs inside VS Code; watches Antigravity, exposes commands, connects to relay |
| `tether-backend` | Cloud relay server; pairs the extension and mobile via WebSocket |
| `tether-app` | Mobile app; remote control UI that talks through the relay |

---

## 🔄 How It Works

```
┌──────────────────────┐        WebSocket         ┌──────────────────────┐
│   VS Code + Tether   │ ◄──── Relay Server ────► │   Tether Mobile App  │
│      Extension       │   (tether-backend)        │   (iOS / Android)    │
└──────────────────────┘                           └──────────────────────┘
         │                                                  │
   Watches Antigravity                              Sends prompts,
   file changes, errors,                         accepts/rejects,
   terminal, Git status                          views diffs, runs
                                                   shell commands
```

### Pairing Flow

1. **Extension** calls `POST /pair/generate` on the relay → gets an 8-character code
2. **Extension** opens a WebSocket to the relay and registers as `role: "extension"`
3. **Mobile app** enters the 8-digit code (or scans the QR shown in the sidebar) and registers as `role: "mobile"`
4. Relay sends a `paired` event to both → a bidirectional relay channel is now live
5. All subsequent messages are forwarded verbatim between both sides (with a `from` field injected by the server)

> Codes expire after **5 minutes** if unused; sessions extend to **1 hour** once paired.

---

## 📦 Components

---

### 1. `tether-ext` — VS Code Extension

**Tech stack:** TypeScript, VS Code Extension API, `ws` (WebSocket), `qrcode`

#### Features

| Feature | Description |
|---|---|
| 🤖 **AI State Detection** | Watches workspace file changes in real-time to detect when Antigravity transitions from Thinking → Editing → Done |
| 📊 **Error Count at Completion** | Captures VS Code diagnostic errors when the AI finishes |
| ⏱️ **Elapsed Time Tracking** | Measures total time from prompt send to completion |
| 📁 **File Change Tracking** | Records which files were touched during an AI session |
| 📸 **File Snapshot & Diff** | Snapshots all workspace files at prompt-send time; computes unified diffs vs. current state |
| 📱 **Mobile Notifications** | Pushes `diffComplete` events to mobile with time, error count, and file count |
| ✅ **Accept / Reject Changes** | Fires Antigravity's accept/reject commands; broadcasts idle state to mobile |
| 💬 **Send Prompts Remotely** | Accepts prompt text from mobile; opens new or existing chat windows |
| 🐚 **Shell Command Execution** | Runs arbitrary shell commands in the workspace CWD; streams output back to mobile |
| 📟 **Terminal Control** | Send commands to the active VS Code terminal; read terminal content; accept/reject terminal commands |
| 🌿 **Git Status** | Reports current branch, `git status -s`, and last 15 commits to mobile |
| 🗂️ **File Browser** | Lists open editor tabs and workspace files on demand |
| 📄 **File Peek** | Reads any workspace file content and sends it to mobile |

#### Key Source Files

| File | Purpose |
|---|---|
| `src/extension.ts` | Extension entry point; all commands, file watcher, status polling |
| `src/RemoteRelay.ts` | Manages the WebSocket lifecycle: connect, register, send, receive, reconnect |
| `src/SidebarProvider.ts` | Renders the sidebar webview (QR code, connection code, status badge, timer) |

#### VS Code Commands

| Command | Title |
|---|---|
| `tether.control` | Open Control Panel (quick-pick of all actions) |
| `tether.sendToNewChat` | Send prompt to a new Antigravity chat |
| `tether.sendToExistingChat` | Send prompt to the current Antigravity chat |
| `tether.acceptChanges` | Accept ALL pending AI changes |
| `tether.rejectChanges` | Reject ALL pending AI changes |
| `tether.startWatching` | Manually start the file-change watcher |
| `tether.checkStatus` | Log and report current AI state |
| `tether.listOpenFiles` | List all open editor tabs |
| `tether.listWorkspaceFiles` | List all workspace files |
| `tether.peekFileContent` | Read a file and display/send its content |
| `tether.sendPromptWithFile` | Send a prompt together with file context |
| `tether.runShellCommand` | Execute a shell command in the workspace |
| `tether.sendToTerminal` | Type a command into the active terminal |
| `tether.peekActiveTerminal` | Capture and send terminal output |
| `tether.testGetDiff` | Debug: compute and display the current diff |

#### AI State Machine

```
idle ──── [prompt sent] ──► thinking ──── [file edits start] ──► editing
                                                                       │
                                                           [4s silence after edits]
                                                                       ▼
                                                                     done
                                                                       │
                                                       [accept / reject / new prompt]
                                                                       ▼
                                                                     idle
```

- **150s timeout** with no file edits → shows a heads-up notification (at 75s) then stops watching
- **4s silence** after file edits triggers `diffComplete` pushed to mobile

#### Configuration

In VS Code settings (`settings.json`):

```json
{
  "tether.relayUrl": "https://your-relay-server.onrender.com"
}
```

Default: `http://localhost:3000` (for local dev)

#### Setup & Development

```bash
cd tether-ext
npm install
npm run compile   # Type-check + lint + bundle
npm run watch     # Watch mode (hot-reload)
```

Press **F5** in VS Code to launch the Extension Development Host.

---

### 2. `tether-backend` — WebSocket Relay Server

**Tech stack:** Node.js, Express, `ws`, Redis (`ioredis`), TypeScript

#### Architecture

```
HTTP  →  /pair/generate   (POST)  — generate a new 8-char pairing code
         /pair/status/:code (GET) — check code / session status
         /health             (GET) — health check for uptime monitors

WS    →  /ws                     — WebSocket relay endpoint
```

State is split between:
- **Redis** — stores pairing codes and their status with TTL (survives restarts / multi-instance)
- **In-memory** — stores active WebSocket socket references (per-process, fast)

#### Source Files

| File | Purpose |
|---|---|
| `src/index.ts` | Express app + HTTP server + WebSocket server bootstrap |
| `src/pairRoutes.ts` | REST endpoints to generate and check pairing codes |
| `src/wsHandler.ts` | WebSocket connection handler — registration, relay, disconnect logic |
| `src/redis.ts` | Redis client and helper functions (`getPair`, `setPair`, `getTTL`) |
| `src/sessions.ts` | In-memory session store mapping codes → `{ extensionSocket, mobileSocket }` |

#### WebSocket Protocol

**Phase 1: Registration** (must complete within 60 seconds)

```jsonc
// Client → Server (first message)
{ "type": "register", "role": "extension" | "mobile", "code": "ABCD1234" }

// Server → Extension (success)
{ "type": "registered", "code": "ABCD1234", "status": "waiting_for_mobile" }

// Server → Both (when mobile connects)
{ "type": "paired", "code": "ABCD1234" }
```

**Phase 2: Relay** (after pairing)

Any JSON sent by one peer is forwarded verbatim to the other with a `from` field injected:

```jsonc
// Mobile sends:
{ "type": "sendPrompt", "payload": { "prompt": "Add dark mode" } }

// Extension receives:
{ "type": "sendPrompt", "payload": { "prompt": "Add dark mode" }, "from": "mobile" }
```

**Disconnection:**

```jsonc
{ "type": "peer_disconnected", "role": "extension" | "mobile" }
```

#### Connection Status Lifecycle

| Status | Meaning |
|---|---|
| `waiting` | Code generated, nobody connected yet |
| `extension_connected` | VS Code extension registered, waiting for mobile |
| `paired` | Both sides connected and relaying |
| `disconnected` | Session ended |

#### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server listen port |
| `REDIS_URL` | (required) | Redis connection string |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |

#### Setup & Development

```bash
cd tether-backend
npm install

# Local dev with hot-reload
npm run dev

# Build for production
npm run build
npm start
```

#### Deployment (Render.com)

A `render.yaml` is included for one-click deploy:

```yaml
services:
  - type: web
    name: tether-relay
    runtime: node
    buildCommand: npm install && npm run build
    startCommand: npm start
    healthCheckPath: /health
```

Set `REDIS_URL` manually in the Render dashboard (pointing at a Redis instance, e.g. Redis Cloud or Render Redis).

---

### 3. `tether-app` — Mobile App

**Tech stack:** React Native, Expo (SDK 54), Expo Router, TypeScript

#### Screens & Navigation

```
App
├── Onboarding          (/onboarding)    — First-run walkthrough
├── Connect             (/connect)       — 8-digit code entry + QR scan pairing
└── Tabs (main)
    ├── Home            /(tabs)/         — AI status, quick send, accept/reject
    ├── Terminal        /(tabs)/terminal — Remote terminal control
    ├── Git             /(tabs)/git      — Git status, branch, recent commits
    └── Settings        /(tabs)/settings — Relay URL config, disconnect
```

#### Home Screen Features

- **Live AI State Card** — shows `idle / thinking / watching / editing / done` with colour-coded badges, animated icon, live elapsed timer
- **diffComplete Summary** — when done: total time, file count, error count displayed as badges
- **Accept All / Reject All** — one-tap buttons appear when AI state is `done`
- **View Diff** → navigates to the Review Changes screen
- **Quick Send** — text input + New/Existing chat toggle + shortcut chips (`Fix errors`, `Add tests`, `Refactor`, etc.)
- **Open Files** — horizontally scrollable chips of currently open editor tabs; tap to include in prompt context
- **Recent History** — last 3 prompts with outcome indicator (✅ / ⚠️) and timestamps

#### Connect Screen

- **8-char OTP input** with auto-advance and paste support
- **QR Scanner** using `expo-camera` — scan the QR displayed in the VS Code sidebar
- Real-time connection status badge

#### Terminal Screen

- Send commands to the VS Code terminal
- Peek terminal output (clipboard-based capture)
- `Ctrl+C` shortcut button
- Accept / Reject terminal command buttons (for AI-proposed terminal commands)

#### Git Screen

- Current branch display
- `git status -s` output
- Last 15 commits with hash, relative time, and subject

#### State Management

A custom Zustand-style store (`store/tether-store.ts`) manages:

```typescript
{
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'failed',
  aiState: 'idle' | 'thinking' | 'watching' | 'editing' | 'done',
  lastDiff: { totalSeconds, errorCount, fileCount, files },
  openFiles: OpenFile[],
  editingFileCount: number,
  editingFiles: string[],
  lastNotification: { level, message } | null,
  history: PromptHistoryEntry[],
}
```

WebSocket messages handled:
- `status` — updates AI state + file tracking
- `diffComplete` — stores diff summary + triggers phone buzz (`expo-haptics`)
- `openFiles` — updates open file list
- `shellResult` — terminal command output
- `gitStatusResult` — git data
- `terminalContent` — terminal peek output
- `fileContent` — file peek output
- `diffContent` — full unified diff for Review Changes screen
- `notification` — toast messages from the extension
- `pong` — keepalive response

#### Push Notifications

Uses `expo-notifications` to send a local push notification when `diffComplete` is received — so you get buzzed even when the app is backgrounded.

#### Setup & Development

```bash
cd tether-app/Tether
npm install

# Start Expo dev server
npm start

# Run on Android
npm run android

# Run on iOS
npm run ios
```

Requires [Expo Go](https://expo.dev/client) on your phone, or a local simulator.

---

## 🚀 Getting Started (Full Stack)

### Prerequisites

- Node.js ≥ 18
- Redis instance (local or cloud)
- VS Code with [Antigravity AI](https://antigravity.ai) extension installed
- Expo Go app on your phone (or a simulator)

### Step 1 — Start the Relay Server

```bash
cd tether-backend
cp .env.example .env      # Add your REDIS_URL
npm install
npm run dev               # Starts on http://localhost:3000
```

### Step 2 — Run the VS Code Extension

```bash
cd tether-ext
npm install
npm run compile
```

Open the `tether-ext` folder in VS Code and press **F5** to launch the Extension Development Host. The Tether sidebar will appear in the activity bar.

Or, if published to the VS Code marketplace, install it directly.

### Step 3 — Configure the Relay URL

In VS Code settings:

```json
{
  "tether.relayUrl": "http://localhost:3000"
}
```

Use your deployed Render URL for production.

### Step 4 — Start the Mobile App

```bash
cd tether-app/Tether
npm install
npm start
```

Scan the Expo QR with Expo Go, or run on a simulator.

### Step 5 — Pair

1. Click **"Get Code"** in the Tether sidebar in VS Code
2. An 8-digit code + QR code appears with a 60-second countdown
3. On your phone, go to the **Connect** screen
4. Enter the code manually or tap **"Scan QR Code"** and point at your screen
5. Both sides show **Paired ✓** — you're live 🎉

---

## 🔌 Message Protocol Reference

All messages between the extension and mobile are JSON objects with a `type` field and an optional `payload` object.

### Mobile → Extension (commands)

| `type` | Payload | Description |
|---|---|---|
| `sendPrompt` | `{ prompt, newConversation }` | Send a prompt to Antigravity |
| `acceptChanges` | — | Accept all pending AI changes |
| `rejectChanges` | — | Reject all pending AI changes |
| `getStatus` | — | Request current AI state |
| `startWatching` | — | Manually start the file watcher |
| `runShell` | `{ cmd }` | Run a shell command in the workspace |
| `sendToTerminal` | `{ cmd }` | Send to the active VS Code terminal |
| `peekTerminal` | — | Read current terminal output |
| `getGitStatus` | — | Request Git branch / status / log |
| `getDiff` | — | Request the current unified diff |
| `peekFile` | `{ path }` | Read a specific file |
| `listOpenFiles` | — | List open editor tabs |
| `listWorkspaceFiles` | — | List all workspace files |
| `ping` | — | Keepalive ping |

### Extension → Mobile (responses & events)

| `type` | Payload | Description |
|---|---|---|
| `status` | `{ state, sincePrompt, sinceEdit, hasFileChanges, fileCount, files }` | Periodic AI state update |
| `diffComplete` | `{ totalSeconds, errorCount, fileCount, files }` | AI finished editing |
| `shellResult` | `{ cmd, output, success }` | Shell command result |
| `terminalContent` | `{ content }` | Terminal text capture |
| `gitStatusResult` | `{ branch, status, logRaw, repoName }` | Git data |
| `diffContent` | `{ diff, error }` | Full unified diff text |
| `fileContent` | `{ path, content }` | File contents |
| `openFiles` | `{ files }` | List of open tabs (name + path) |
| `workspaceFiles` | `{ files }` | Workspace file paths |
| `notification` | `{ level, message }` | Info / warn / error toast |
| `pong` | — | Ping response |

---

## 🛠️ Development Tips

### Viewing Debug Logs (Extension)

In VS Code: **View → Output** → select **"Tether Debug"** from the dropdown. All relay events, file watch triggers, and command outcomes are logged here.

### Running Everything Locally

| Service | Command | URL |
|---|---|---|
| Relay server | `npm run dev` in `tether-backend` | `http://localhost:3000` |
| Extension | Press F5 in VS Code | (Extension Dev Host) |
| Mobile app | `npm start` in `tether-app/Tether` | Expo dev server |

Make sure `tether.relayUrl` in VS Code settings points to `http://localhost:3000` (or your LAN IP if testing on a physical phone).

### Testing the Relay Health

```bash
curl http://localhost:3000/health
# → { "status": "ok", "timestamp": 1234567890 }
```

---

## 📐 Architecture Decisions

| Decision | Rationale |
|---|---|
| **WebSocket relay (not direct P2P)** | VS Code extension and phone are rarely on the same network; a hosted relay works everywhere |
| **8-char alphanumeric pairing code** | Short enough to type manually; long enough (~36^8 = 2.8 trillion combinations) to avoid collisions |
| **Redis for code storage** | TTL support, multi-instance safe; in-memory session map keeps socket refs fast |
| **File snapshot for diff** | Antigravity auto-saves (no dirty docs); snapshot at prompt time guarantees accurate diff even without git |
| **4-second silence heuristic** | Detects editing completion without requiring Antigravity to emit any events |
| **Expo for mobile** | Fast iteration, QR code scanning, push notifications, cross-platform (iOS + Android) |

---

## 📱 Screenshots

UI screenshots are in the `UI-images/` directory.

---

## 📄 License

MIT — build whatever you want on top of this.

---

*Built by a person who was supposed to be working. Powered by Antigravity AI. 🤖*
