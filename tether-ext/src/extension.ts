import * as vscode from "vscode";
import * as cp from "child_process";
import { SidebarProvider } from "./SidebarProvider";
import { relay } from "./RemoteRelay";

// ─── Config ─────────────────────────────────────────────────────────────────
const DONE_SILENCE_MS = 4000; // ms of no file changes = "Antigravity done"

// ─── State ──────────────────────────────────────────────────────────────────
let statusBarItem: vscode.StatusBarItem;
let isWatching = false;
let lastChangeTime = 0;
let promptSentTime = 0;
let hasFileChanges = false;
let statusInterval: NodeJS.Timeout | undefined;
let isDone = false;          // true after AI finishes; cleared on next prompt
let doneDismissed = false;   // true after user accepts/rejects — suppresses 'done' until next prompt
let doneErrorCount = 0;      // error count captured when done
let doneTotalSeconds = 0;    // total time captured when done
let autoDetectChangeCount = 0;
let autoDetectResetTimer: NodeJS.Timeout | undefined;

/** Tracks which files Antigravity has touched during the current session. */
const changedFiles = new Set<string>();
let doneFileCount = 0;       // file count captured when done

/** Snapshot of file contents taken at prompt-send time.
 *  key = absolute fsPath, value = file text at that moment.
 *  Lets us diff against Antigravity edits even when files are auto-saved. */
const fileSnapshot = new Map<string, string>();

/** Read every workspace file (≤500 kB each) into the snapshot map. */
async function takeSnapshot() {
  fileSnapshot.clear();
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) { return; }
  try {
    const uris = await vscode.workspace.findFiles(
      "**/*",
      "{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/.next/**}",
      300
    );
    await Promise.all(uris.map(async (uri) => {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (bytes.byteLength <= 500 * 1024) {
          fileSnapshot.set(uri.fsPath, Buffer.from(bytes).toString("utf8"));
        }
      } catch { /* skip unreadable files */ }
    }));
    log(`[snapshot] captured ${fileSnapshot.size} files`);
  } catch (err: any) {
    log(`[snapshot] error: ${err.message}`);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function setStatus(icon: string, text: string) {
  statusBarItem.text = `${icon} ${text}`;
  statusBarItem.show();
}

// Debug output channel — always available
let debugChannel: vscode.OutputChannel;

function log(msg: string) {
  debugChannel?.appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

async function sendPrompt(prompt: string, newConversation: boolean) {
  setStatus("$(loading~spin)", "Sending prompt...");
  log(`sendPrompt called. newConversation=${newConversation}`);

  if (newConversation) {
    try {
      await vscode.commands.executeCommand("antigravity.prioritized.chat.openNewConversation");
      await sleep(600);
      log("Opened new conversation");
    } catch (e: any) { log(`openNewConversation skipped: ${e.message}`); }
  } else {
    try {
      await vscode.commands.executeCommand("antigravity.agentPanel.focus");
      await sleep(300);
      log("Focused existing panel");
    } catch (e: any) { log(`agentPanel.focus skipped: ${e.message}`); }
  }

  // Set watching BEFORE the command — even if it throws, we're "watching"
  promptSentTime = Date.now();
  lastChangeTime = Date.now();
  hasFileChanges = false;
  isWatching = true;
  isDone = false;
  doneDismissed = false;   // new prompt → allow 'done' to appear again
  doneErrorCount = 0;
  doneTotalSeconds = 0;
  changedFiles.clear();
  doneFileCount = 0;
  setStatus("$(loading~spin)", "Antigravity thinking...");
  log(`isWatching set to TRUE. Prompt: "${prompt.substring(0, 60)}..."`);

  // Snapshot all workspace files so we can diff after Antigravity auto-saves
  takeSnapshot().catch(e => log(`[snapshot] failed: ${e.message}`));

  // Immediately tell mobile we're in the 'thinking' phase
  relay.send({ type: "status", payload: {
    state: "thinking",
    sincePrompt: 0,
    sinceEdit: 0,
    hasFileChanges: false,
  }});

  try {
    await vscode.commands.executeCommand("antigravity.sendPromptToAgentPanel", prompt);
    log("sendPromptToAgentPanel succeeded — Antigravity is now generating");
    // Confirm thinking state after prompt was accepted
    relay.send({ type: "status", payload: {
      state: "thinking",
      sincePrompt: Date.now() - promptSentTime,
      sinceEdit: 0,
      hasFileChanges: false,
    }});
  } catch (err: any) {
    log(`sendPromptToAgentPanel threw: ${err.message} (still watching)`);
    vscode.window.showWarningMessage(`Prompt may not have sent cleanly: ${err.message}`);
  }
}

// ─── Periodic Status Checker (fires every 4s) ─────────────────────────────
function checkStatus() {
  if (!isWatching) { return; }

  const now = Date.now();
  const timeSinceChange = now - lastChangeTime;
  const timeSincePrompt = now - promptSentTime;
  const sP = (timeSincePrompt / 1000).toFixed(1);
  const sC = (timeSinceChange / 1000).toFixed(1);

  log(`[poll] fileChanges=${hasFileChanges} | sincePrompt=${sP}s | sinceEdit=${sC}s`);

  // ── Case 1: Real doc changes detected + 4s of silence = DONE (editing) ──
  if (hasFileChanges && timeSinceChange >= DONE_SILENCE_MS) {
    isWatching = false;
    isDone = true;
    const totalTime = (timeSincePrompt / 1000).toFixed(1);
    log(`✅ DIFF COMPLETE — Antigravity finished after ${totalTime}s total. ${sC}s of silence detected. Files touched: ${changedFiles.size}`);

    let errorCount = 0;
    for (const [, diags] of vscode.languages.getDiagnostics()) {
      errorCount += diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;
    }

    doneErrorCount = errorCount;
    doneTotalSeconds = parseFloat(totalTime);
    doneFileCount = changedFiles.size;

    // Push done event to mobile immediately (don't wait for next poll)
    relay.send({ type: "diffComplete", payload: { totalSeconds: doneTotalSeconds, errorCount: doneErrorCount, fileCount: doneFileCount, files: [...changedFiles] } });

    if (errorCount > 0) {
      setStatus("$(warning)", `Done — ${errorCount} error(s)`);
      vscode.window.showWarningMessage(
        `⚠️ Antigravity done — but ${errorCount} error(s) detected.`,
        "Accept Anyway", "Reject", "View Changes"
      ).then(c => {
        if (c === "Accept Anyway") { vscode.commands.executeCommand("tether.acceptChanges"); }
        if (c === "Reject") { vscode.commands.executeCommand("tether.rejectChanges"); }
        if (c === "View Changes") { vscode.commands.executeCommand("chatEditing.viewChanges"); }
      });
    } else {
      setStatus("$(check-all)", "Done — Review changes");
      vscode.window.showInformationMessage(
        "✅ Antigravity done! No errors.",
        "Accept All", "Reject", "View Changes"
      ).then(c => {
        if (c === "Accept All") { vscode.commands.executeCommand("tether.acceptChanges"); }
        if (c === "Reject") { vscode.commands.executeCommand("tether.rejectChanges"); }
        if (c === "View Changes") { vscode.commands.executeCommand("chatEditing.viewChanges"); }
      });
    }
    return;
  }

  // ── Case 2: Files still changing, keep spinner ──────────────────────────
  if (hasFileChanges) {
    const fc = changedFiles.size;
    setStatus("$(loading~spin)", `Antigravity editing... (${fc} file${fc === 1 ? '' : 's'})`);
    relay.send({ type: "status", payload: { state: "editing", sincePrompt: timeSincePrompt, sinceEdit: timeSinceChange, hasFileChanges, fileCount: fc, files: [...changedFiles] } });
    return;
  }

  // ── Case 3: No doc changes at all (Antigravity uses virtual staged diffs)
  if (timeSincePrompt >= 150000) {
    isWatching = false;
    log("150s timeout, stopped watching");
    setStatus("$(info)", "Watch timed out");
    relay.send({ type: "status", payload: { state: "idle", sincePrompt: timeSincePrompt, sinceEdit: timeSinceChange, hasFileChanges: false } });
    vscode.window.showWarningMessage(
      "⏱️ 150s elapsed with no file edits. Antigravity may have responded in chat, or changes are staged.",
      "View Staged Changes", "Accept All", "Dismiss"
    ).then(c => {
      if (c === "Accept All") { vscode.commands.executeCommand("tether.acceptChanges"); }
      if (c === "View Staged Changes") { vscode.commands.executeCommand("chatEditing.viewChanges"); }
    });
    return;
  }

  // 75s heads-up — only fire ONCE (when the tick crosses 75s)
  if (timeSincePrompt >= 75000 && timeSincePrompt < 83000) {
    log("75s heads-up notification");
    setStatus("$(bell)", "Check chat — Antigravity may be done");
    vscode.window.showInformationMessage(
      "ℹ️ 75s elapsed — Antigravity may be done in chat, or changes may be staged.",
      "View Staged Changes", "Accept All", "Still Watching"
    ).then(c => {
      if (c === "Accept All") { vscode.commands.executeCommand("tether.acceptChanges"); isWatching = false; }
      if (c === "View Staged Changes") { vscode.commands.executeCommand("chatEditing.viewChanges"); }
    });
    return;
  }

  // Default: no file changes yet = AI is still thinking / generating
  setStatus("$(loading~spin)", `Antigravity thinking... ${sP}s`);
  relay.send({ type: "status", payload: { state: "thinking", sincePrompt: timeSincePrompt, sinceEdit: timeSinceChange, hasFileChanges: false } });
}

// ─── Activate ────────────────────────────────────────────────────────────────
export function activate(context: vscode.ExtensionContext) {

  // Debug log channel — open via Output > Tether Debug
  // (SidebarProvider also appends to "Tether Debug"; we share the same name)
  debugChannel = vscode.window.createOutputChannel("Tether Debug");
  log("Extension activated");

  // ── Sidebar webview provider ───────────────────────────────────────────────
  const sidebarProvider = new SidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "tether.sidebarView",   // must match "id" in package.json contributes.views
      sidebarProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );
  log("SidebarProvider registered for view: tether.sidebarView");

  // Background Status Poller (runs every 8 seconds)
  statusInterval = setInterval(checkStatus, 8000);

  // ── Relay: dispatch inbound messages from mobile ───────────────────────────
  relay.onMessage = async (msg) => {
    log(`[relay] inbound type=${msg.type}`);
    const payload = msg.payload ?? {};

    switch (msg.type) {
      // ── Prompt ───────────────────────────────────────────────────────────
      case "sendPrompt": {
        const prompt = payload.prompt as string;
        const newConv = !!(payload.newConversation);
        if (prompt) {
          await sendPrompt(prompt, newConv);
          relay.send({ type: "notification", payload: { level: "info", message: `Prompt sent: "${prompt.substring(0, 60)}"` } });
        }
        break;
      }
      // ── Accept / Reject ───────────────────────────────────────────────────
      case "acceptChanges":
        doneDismissed = true;  // prevent 'done' from reappearing on next poll
        isDone = false;
        isWatching = false;
        hasFileChanges = false;
        relay.send({ type: "status", payload: { state: "idle", sincePrompt: 0, sinceEdit: 0, hasFileChanges: false } });
        await vscode.commands.executeCommand("tether.acceptChanges");
        break;

      case "rejectChanges":
        doneDismissed = true;  // prevent 'done' from reappearing on next poll
        isDone = false;
        isWatching = false;
        hasFileChanges = false;
        relay.send({ type: "status", payload: { state: "idle", sincePrompt: 0, sinceEdit: 0, hasFileChanges: false } });
        await vscode.commands.executeCommand("tether.rejectChanges");
        break;

      // ── Watching ──────────────────────────────────────────────────────────
      case "startWatching":
        await vscode.commands.executeCommand("tether.startWatching");
        relay.send({ type: "notification", payload: { level: "info", message: "Watch started" } });
        break;

      // ── getStatus ─────────────────────────────────────────────────────────
      case "getStatus": {
        // Never show 'done' if: no prompt sent yet, OR user already dismissed it
        const stateNow = isWatching
          ? (hasFileChanges ? "editing" : "watching")
          : (isDone && promptSentTime > 0 && !doneDismissed) ? "done" : "idle";
        const fc = stateNow === "done" ? doneFileCount : changedFiles.size;
        relay.send({ type: "status", payload: {
          state: stateNow,
          sincePrompt: Date.now() - promptSentTime,
          sinceEdit: Date.now() - lastChangeTime,
          hasFileChanges,
          fileCount: fc,
          files: stateNow === "done" ? undefined : [...changedFiles],
        }});
        break;
      }

      // ── Shell command ─────────────────────────────────────────────────────
      case "runShell": {
        const cmd = payload.cmd as string;
        if (!cmd) { break; }
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        log(`[relay] shell: ${cmd}`);
        const result = await new Promise<{ stdout: string; stderr: string; error: string | null }>((resolve) => {
          cp.exec(cmd, { cwd, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            resolve({ stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "", error: error?.message ?? null });
          });
        });
        const output = [result.stdout, result.stderr ? `[STDERR]\n${result.stderr}` : "", result.error ? `[ERROR]\n${result.error}` : ""].join("").trim();
        relay.send({ type: "shellResult", payload: { cmd, output, success: !result.error } });
        break;
      }

      // ── Send to terminal ──────────────────────────────────────────────────
      case "sendToTerminal": {
        const cmd = payload.cmd as string;
        if (!cmd) { break; }
        const terminal = vscode.window.activeTerminal;
        if (!terminal) {
          relay.send({ type: "notification", payload: { level: "error", message: "No active terminal" } });
          break;
        }
        terminal.show();
        if (cmd.toLowerCase() === "ctrl+c") { terminal.sendText("\u0003", false); }
        else { terminal.sendText(cmd); }
        relay.send({ type: "notification", payload: { level: "info", message: `Sent to terminal: ${cmd}` } });
        break;
      }

      // ── Get aggregate Git status ──────────────────────────────────────────
      case "getGitStatus": {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        
        const runGit = (cmd: string): Promise<string> => 
          new Promise((resolve) => 
            cp.exec(cmd, { cwd, maxBuffer: 1024 * 1024 }, (_, stdout) => resolve(stdout?.toString().trim() ?? ""))
          );

        try {
          const [branch, status, logRaw] = await Promise.all([
            runGit("git branch --show-current").catch(() => ""),
            runGit("git status -s").catch(() => ""),
            runGit("git log -15 --pretty=format:\"%h|%ar|%s\"").catch(() => "")
          ]);

          log(`[relay] git branch: ${branch}\ngit status -s length: ${status.length}\ngit log length: ${logRaw.length}`);

          const repoName = vscode.workspace.name || "Unknown Repo";
          relay.send({ 
            type: "gitStatusResult", 
            payload: { branch, status, logRaw, repoName } 
          });
        } catch (err: any) {
          log(`[relay] getGitStatus error: ${err.message}`);
        }
        break;
      }

      // ── Peek terminal ─────────────────────────────────────────────────────
      case "peekTerminal": {
        if (!vscode.window.activeTerminal) {
          relay.send({ type: "notification", payload: { level: "error", message: "No active terminal" } });
          break;
        }
        try {
          const orig = await vscode.env.clipboard.readText();
          vscode.window.activeTerminal.show();
          await sleep(100);
          await vscode.commands.executeCommand("workbench.action.terminal.selectAll");
          await sleep(100);
          await vscode.commands.executeCommand("workbench.action.terminal.copySelection");
          await sleep(100);
          await vscode.commands.executeCommand("workbench.action.terminal.clearSelection");
          const content = await vscode.env.clipboard.readText();
          await vscode.env.clipboard.writeText(orig);
          relay.send({ type: "terminalContent", payload: { content } });
        } catch (err: any) {
          relay.send({ type: "notification", payload: { level: "error", message: err.message } });
        }
        break;
      }

      // ── Peek file ─────────────────────────────────────────────────────────
      case "peekFile": {
        const path = payload.path as string;
        if (!path) { break; }
        try {
          const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
          const uri = vscode.Uri.file(root + "/" + path);
          const doc = await vscode.workspace.openTextDocument(uri);
          relay.send({ type: "fileContent", payload: { path, content: doc.getText() } });
        } catch (err: any) {
          relay.send({ type: "notification", payload: { level: "error", message: `peekFile: ${err.message}` } });
        }
        break;
      }

      // ── List open files ───────────────────────────────────────────────────
      case "listOpenFiles": {
        const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs);
        const files = tabs
          .filter(t => t.input instanceof vscode.TabInputText)
          .map(t => {
            const uri = (t.input as vscode.TabInputText).uri;
            if (!uri || !uri.fsPath) return null;
            const p = uri.fsPath;
            return { name: p.split(/[\\/]/).pop() ?? p, path: vscode.workspace.asRelativePath(p) || p };
          })
          .filter((f): f is { name: string; path: string } => f !== null);
          
        const unique = [];
        const seen = new Set();
        for (const f of files) {
           if (!seen.has(f.path)) {
               seen.add(f.path);
               unique.push(f);
           }
        }
        relay.send({ type: "openFiles", payload: { files: unique } });
        break;
      }

      // ── List workspace files ──────────────────────────────────────────────
      case "listWorkspaceFiles": {
        const uris = await vscode.workspace.findFiles("**/*", "**/node_modules/**", 100);
        const files = uris.map(u => vscode.workspace.asRelativePath(u));
        relay.send({ type: "workspaceFiles", payload: { files } });
        break;
      }

      // ── Get diff from VS Code pending chat edits (TabInputTextDiff) ──────
      case "getDiff": {
        log(`[relay] getDiff: scanning TabInputTextDiff tabs for pending Antigravity edits`);

        // ── Helper: build a minimal unified diff between two text blocks ──
        function buildUnifiedDiff(originalText: string, modifiedText: string, filePath: string): string {
          const origLines = originalText.split("\n");
          const modLines  = modifiedText.split("\n");

          // Simple LCS-based line diff (Myers-like, good enough for display)
          type Edit = { type: "=" | "+" | "-"; line: string; origIdx: number; modIdx: number };
          const edits: Edit[] = [];

          // Build a simple diff with a sliding window approach
          let oi = 0, mi = 0;
          while (oi < origLines.length || mi < modLines.length) {
            if (oi < origLines.length && mi < modLines.length && origLines[oi] === modLines[mi]) {
              edits.push({ type: "=", line: origLines[oi], origIdx: oi + 1, modIdx: mi + 1 });
              oi++; mi++;
            } else {
              // Look ahead up to 8 lines for a re-sync point
              let found = false;
              for (let look = 1; look <= 8 && !found; look++) {
                if (mi + look < modLines.length && oi < origLines.length && origLines[oi] === modLines[mi + look]) {
                  for (let k = 0; k < look; k++) {
                    edits.push({ type: "+", line: modLines[mi + k], origIdx: -1, modIdx: mi + k + 1 });
                    mi++;
                  }
                  found = true;
                } else if (oi + look < origLines.length && mi < modLines.length && origLines[oi + look] === modLines[mi]) {
                  for (let k = 0; k < look; k++) {
                    edits.push({ type: "-", line: origLines[oi + k], origIdx: oi + k + 1, modIdx: -1 });
                    oi++;
                  }
                  found = true;
                }
              }
              if (!found) {
                if (oi < origLines.length) { edits.push({ type: "-", line: origLines[oi], origIdx: oi + 1, modIdx: -1 }); oi++; }
                if (mi < modLines.length)  { edits.push({ type: "+", line: modLines[mi],  origIdx: -1, modIdx: mi + 1 }); mi++; }
              }
            }
          }

          // Render hunks (context = 3 lines)
          const CONTEXT = 3;
          const changed = edits.map((e, i) => e.type !== "=" ? i : -1).filter(i => i >= 0);
          if (changed.length === 0) { return ""; }

          const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
          const rel  = filePath.startsWith(root) ? filePath.slice(root.length).replace(/\\/g, "/").replace(/^\//, "") : filePath.replace(/\\/g, "/");

          let out = `diff --git a/${rel} b/${rel}\n--- a/${rel}\n+++ b/${rel}\n`;

          // Group nearby changed lines into hunks
          const hunks: Array<[number, number]> = [];
          let hStart = Math.max(0, changed[0] - CONTEXT);
          let hEnd   = Math.min(edits.length - 1, changed[0] + CONTEXT);
          for (let k = 1; k < changed.length; k++) {
            const next = changed[k];
            if (next - CONTEXT <= hEnd + CONTEXT) {
              hEnd = Math.min(edits.length - 1, next + CONTEXT);
            } else {
              hunks.push([hStart, hEnd]);
              hStart = Math.max(0, next - CONTEXT);
              hEnd   = Math.min(edits.length - 1, next + CONTEXT);
            }
          }
          hunks.push([hStart, hEnd]);

          for (const [s, e] of hunks) {
            const slice = edits.slice(s, e + 1);
            const oldStart = slice.find(x => x.origIdx > 0)?.origIdx ?? 1;
            const newStart = slice.find(x => x.modIdx  > 0)?.modIdx  ?? 1;
            const oldCount = slice.filter(x => x.type !== "+").length;
            const newCount = slice.filter(x => x.type !== "-").length;
            out += `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n`;
            for (const ed of slice) {
              out += (ed.type === "+" ? "+" : ed.type === "-" ? "-" : " ") + ed.line + "\n";
            }
          }
          return out;
        }

        // ── Step 0: Snapshot diff (MOST RELIABLE) ────────────────────────
        // Compare current on-disk content of every file against the snapshot
        // taken at prompt-send time. This is the primary strategy because
        // Antigravity auto-saves edits (isDirty=false) and the repo may have
        // no git commits.
        let combinedDiff = "";

        if (fileSnapshot.size > 0) {
          log(`[relay] getDiff: snapshot has ${fileSnapshot.size} files — comparing vs current disk`);
          const uris = await vscode.workspace.findFiles(
            "**/*",
            "{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/.next/**}",
            300
          );
          for (const uri of uris) {
            const snapText = fileSnapshot.get(uri.fsPath);
            if (snapText === undefined) { continue; }
            try {
              const bytes = await vscode.workspace.fs.readFile(uri);
              if (bytes.byteLength > 500 * 1024) { continue; }
              const currentText = Buffer.from(bytes).toString("utf8");
              if (currentText !== snapText) {
                const fileDiff = buildUnifiedDiff(snapText, currentText, uri.fsPath);
                if (fileDiff) { combinedDiff += fileDiff + "\n"; }
              }
            } catch { /* skip unreadable */ }
          }
          log(`[relay] getDiff: snapshot diff → ${combinedDiff.split("\n").length} lines`);
        } else {
          log(`[relay] getDiff: no snapshot yet — send a prompt first to populate it`);
        }

        // ── Step 1: TabInputTextDiff tabs ─────────────────────────────────
        if (!combinedDiff) {
          const allTabs = vscode.window.tabGroups.all.flatMap(g => g.tabs);
          const diffTabs = allTabs.filter(t => t.input instanceof vscode.TabInputTextDiff);
          log(`[relay] getDiff: found ${diffTabs.length} TabInputTextDiff tab(s)`);
          for (const tab of diffTabs) {
            const input = tab.input as vscode.TabInputTextDiff;
            try {
              const [origDoc, modDoc] = await Promise.all([
                vscode.workspace.openTextDocument(input.original),
                vscode.workspace.openTextDocument(input.modified),
              ]);
              const fileDiff = buildUnifiedDiff(origDoc.getText(), modDoc.getText(), input.modified.fsPath);
              if (fileDiff) { combinedDiff += fileDiff + "\n"; }
            } catch (err: any) { log(`[relay] getDiff: tab error ${err.message}`); }
          }
        }

        // ── Step 2: Dirty (unsaved) documents vs disk ─────────────────────
        if (!combinedDiff) {
          const dirtyDocs = vscode.workspace.textDocuments.filter(d => d.isDirty && d.uri.scheme === "file");
          log(`[relay] getDiff: dirty docs: ${dirtyDocs.length}`);
          for (const doc of dirtyDocs) {
            try {
              const diskBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(doc.uri.fsPath));
              const diskText = Buffer.from(diskBytes).toString("utf8");
              if (diskText !== doc.getText()) {
                const fileDiff = buildUnifiedDiff(diskText, doc.getText(), doc.uri.fsPath);
                if (fileDiff) { combinedDiff += fileDiff + "\n"; }
              }
            } catch { /* skip */ }
          }
        }

        // ── Step 3: git diff HEAD ─────────────────────────────────────────
        if (!combinedDiff) {
          const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
          const gitResult = await new Promise<string>((resolve) => {
            cp.exec("git diff HEAD", { cwd, maxBuffer: 2 * 1024 * 1024 }, (_, stdout) => {
              resolve(stdout?.toString().trim() ?? "");
            });
          });
          combinedDiff = gitResult;
        }

        relay.send({
          type: "diffContent",
          payload: { diff: combinedDiff || "(no diff found)", error: null }
        });
        break;
      }

      // ── Ping ──────────────────────────────────────────────────────────────
      case "ping":
        relay.send({ type: "pong" });
        break;

      default:
        log(`[relay] Unknown message type: ${msg.type}`);
    }
  };

  relay.onPaired = () => {
    vscode.window.showInformationMessage("📱 Mobile paired! Tether Remote is active.");
    log("[relay] Mobile paired");
    // Full state reset on new pairing — mobile gets a clean 'idle' view
    isDone = false;
    doneDismissed = false;
    promptSentTime = 0;
    isWatching = false;
    hasFileChanges = false;
    changedFiles.clear();
    doneFileCount = 0;
  };

  relay.onDisconnected = () => {
    log("[relay] Peer disconnected");
  };

  // Status bar indicator
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = "tether.control";
  statusBarItem.tooltip = "Click to open Tether Control Panel";
  setStatus("$(remote)", "Tether Ready");

  // ── Command 1: Send to NEW chat window ─────────────────────────────────────
  const sendNewChat = vscode.commands.registerCommand("tether.sendToNewChat", async () => {
    const prompt = await vscode.window.showInputBox({
      title: "Send to NEW Chat",
      prompt: "Enter your prompt",
      placeHolder: "e.g. Add dark mode support to the Header component",
    });
    if (!prompt) { return; }
    await sendPrompt(prompt, true);
  });

  // ── Command 2: Send to EXISTING chat window ────────────────────────────────
  const sendExistingChat = vscode.commands.registerCommand("tether.sendToExistingChat", async () => {
    const prompt = await vscode.window.showInputBox({
      title: "Send to EXISTING Chat",
      prompt: "Enter your prompt",
      placeHolder: "e.g. Now add error handling to that function",
      value: "Explain what the above code does in one sentence",
    });
    if (!prompt) { return; }
    await sendPrompt(prompt, false);
  });

  // ── Command 3: Accept ALL pending changes ──────────────────────────────────
  const acceptChanges = vscode.commands.registerCommand("tether.acceptChanges", async () => {
    const channel = vscode.window.createOutputChannel("Tether Accept/Reject");
    channel.clear();
    channel.appendLine("Trying to accept all changes...\n");

    const candidates = [
      "chatEditing.acceptAllFiles",
      "antigravity.prioritized.agentAcceptAllInFile",
      "antigravity.agent.acceptAgentStep",
      "antigravity.command.accept",
    ];

    let anySuccess = false;
    for (const cmd of candidates) {
      try {
        await vscode.commands.executeCommand(cmd);
        channel.appendLine(`✅ ${cmd} — worked!`);
        anySuccess = true;
      } catch (err: any) {
        channel.appendLine(`❌ ${cmd} — ${err.message}`);
      }
    }

    channel.show();
    if (anySuccess) {
      setStatus("$(check-all)", "Changes Accepted");
      // Reset state and broadcast idle to mobile
      isDone = false;
      isWatching = false;
      hasFileChanges = false;
      relay.send({ type: "status", payload: { state: "idle", sincePrompt: 0, sinceEdit: 0, hasFileChanges: false } });
    } else {
      vscode.window.showErrorMessage("Could not accept changes. Check the Tether Accept/Reject output.");
    }
  });

  // ── Command 4: Reject ALL pending changes ─────────────────────────────────
  const rejectChanges = vscode.commands.registerCommand("tether.rejectChanges", async () => {
    const channel = vscode.window.createOutputChannel("Tether Accept/Reject");
    channel.clear();
    channel.appendLine("Trying to reject all changes...\n");

    const candidates = [
      "chatEditing.discardAllFiles",
      "antigravity.prioritized.agentRejectAllInFile",
      "antigravity.command.reject",
    ];

    let anySuccess = false;
    for (const cmd of candidates) {
      try {
        await vscode.commands.executeCommand(cmd);
        channel.appendLine(`✅ ${cmd} — worked!`);
        anySuccess = true;
      } catch (err: any) {
        channel.appendLine(`❌ ${cmd} — ${err.message}`);
      }
    }

    channel.show();
    if (anySuccess) {
      setStatus("$(trash)", "Changes Rejected");
      // Reset state and broadcast idle to mobile
      isDone = false;
      isWatching = false;
      hasFileChanges = false;
      relay.send({ type: "status", payload: { state: "idle", sincePrompt: 0, sinceEdit: 0, hasFileChanges: false } });
    } else {
      vscode.window.showErrorMessage("Could not reject changes. Check the Tether output.");
    }
  });

  // ── Command 5: Quick control panel (all actions in one place) ─────────────
  const control = vscode.commands.registerCommand("tether.control", async () => {
    const choice = await vscode.window.showQuickPick([
      { label: "$(clock) Check Status", id: "checkStatus" },
      { label: "$(play) Start Watching (manual)", id: "startWatch" },
      { label: "$(comment) Send to NEW Chat", id: "newChat" },
      { label: "$(comment-discussion) Send to EXISTING Chat", id: "existingChat" },
      { label: "$(check-all) Accept ALL Changes", id: "accept" },
      { label: "$(trash) Reject ALL Changes", id: "reject" },
      { label: "$(diff) View Pending Changes", id: "view" },
      { label: "$(search) 🧪 Test Get Diff (debug)", id: "testDiff" },
      { label: "$(files) List OPEN Files", id: "listOpen" },
      { label: "$(folder) List WORKSPACE Files", id: "listWorkspace" },
      { label: "$(eye) Peek File Content", id: "peekFile" },
      { label: "$(mention) Send Prompt with File Context", id: "sendWithFile" },
      { label: "$(code) Run Shell Command", id: "runShell" },
      { label: "$(terminal) Send to Active Terminal", id: "sendToTerminal" },
      { label: "$(eye) Peek Active Terminal", id: "peekTerminal" },
      { label: "$(terminal) Accept Terminal Command", id: "termAccept" },
      { label: "$(close) Reject Terminal Command", id: "termReject" },
    ], {
      title: `Tether Control Panel  |  ${statusBarItem.text}`,
      placeHolder: "Choose an action...",
    });

    if (!choice) { return; }

    switch (choice.id) {
      case "checkStatus":
        await vscode.commands.executeCommand("tether.checkStatus"); break;
      case "startWatch":
        await vscode.commands.executeCommand("tether.startWatching"); break;
      case "newChat":
        await vscode.commands.executeCommand("tether.sendToNewChat"); break;
      case "existingChat":
        await vscode.commands.executeCommand("tether.sendToExistingChat"); break;
      case "accept":
        await vscode.commands.executeCommand("tether.acceptChanges"); break;
      case "reject":
        await vscode.commands.executeCommand("tether.rejectChanges"); break;
      case "view":
        await vscode.commands.executeCommand("chatEditing.viewChanges"); break;
      case "testDiff":
        await vscode.commands.executeCommand("tether.testGetDiff"); break;
      case "listOpen":
        await vscode.commands.executeCommand("tether.listOpenFiles"); break;
      case "listWorkspace":
        await vscode.commands.executeCommand("tether.listWorkspaceFiles"); break;
      case "sendWithFile":
        await vscode.commands.executeCommand("tether.sendPromptWithFile"); break;
      case "peekFile":
        await vscode.commands.executeCommand("tether.peekFileContent"); break;
      case "runShell":
        await vscode.commands.executeCommand("tether.runShellCommand"); break;
      case "sendToTerminal":
        await vscode.commands.executeCommand("tether.sendToTerminal"); break;
      case "peekTerminal":
        await vscode.commands.executeCommand("tether.peekActiveTerminal"); break;
      case "termAccept":
        await vscode.commands.executeCommand("antigravity.terminalCommand.accept"); break;
      case "termReject":
        await vscode.commands.executeCommand("antigravity.terminalCommand.reject"); break;
    }
  });

  // ── New Command: List Open Files ─────────────────────────────────────────
  const listOpenFiles = vscode.commands.registerCommand("tether.listOpenFiles", async () => {
    const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
    const fileTabs = tabs.filter(tab => tab.input instanceof vscode.TabInputText);
    const filenames = fileTabs.map(tab => {
      const input = tab.input as vscode.TabInputText;
      return input.uri.fsPath.split(/[\\\/]/).pop() ?? input.uri.fsPath;
    });
    const uniqueFilenames = [...new Set(filenames)];

    if (uniqueFilenames.length === 0) {
      vscode.window.showInformationMessage("No file tabs currently open.");
    } else {
      vscode.window.showQuickPick(uniqueFilenames, { title: "Open Files" });
    }
  });

  // ── New Command: List Workspace Files ────────────────────────────────────
  const listWorkspaceFiles = vscode.commands.registerCommand("tether.listWorkspaceFiles", async () => {
    vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Scanning Workspace...",
      cancellable: false
    }, async () => {
      const files = await vscode.workspace.findFiles("**/*", "**/node_modules/**", 100);
      const names = files.map(f => vscode.workspace.asRelativePath(f));
      vscode.window.showQuickPick(names, { title: "All Files (showing top 100)" });
    });
  });

  // ── New Command: Peek File Content ────────────────────────────────────────
  const peekFileContent = vscode.commands.registerCommand("tether.peekFileContent", async () => {
    const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs);
    const fileTabs = tabs.filter(t => t.input instanceof vscode.TabInputText);
    const items = fileTabs.map(t => {
      const input = t.input as vscode.TabInputText;
      return { label: input.uri.fsPath.split(/[\\\/]/).pop() ?? input.uri.fsPath, uri: input.uri };
    });

    if (items.length === 0) {
      vscode.window.showInformationMessage("No files open to peek.");
      return;
    }

    const picked = await vscode.window.showQuickPick(items, { title: "Peek File Content" });
    if (!picked) { return; }

    try {
      const doc = await vscode.workspace.openTextDocument(picked.uri);
      const channel = vscode.window.createOutputChannel(`Tether: ${picked.label}`);
      channel.clear();
      channel.appendLine(`=== ${picked.label} (${doc.lineCount} lines) ===\n`);
      channel.append(doc.getText());
      channel.show();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to peek file: ${err.message}`);
    }
  });

  // ── New Command: Send Prompt with File Context (@mention) ─────────────────
  const sendPromptWithFile = vscode.commands.registerCommand("tether.sendPromptWithFile", async () => {
    const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs);
    const fileTabs = tabs.filter(t => t.input instanceof vscode.TabInputText);
    const items = fileTabs.map(t => {
      const input = t.input as vscode.TabInputText;
      return { label: input.uri.fsPath.split(/[\\\/]/).pop() ?? input.uri.fsPath, uri: input.uri };
    });

    const picked = await vscode.window.showQuickPick(
      [...items, { label: "$(add) No file — just send prompt", uri: undefined }],
      { title: "Select file to @mention (or send without file)" }
    );
    if (!picked) { return; }

    const prompt = await vscode.window.showInputBox({
      title: "Send Prompt with File Context",
      placeHolder: "What should I do with this file?",
    });
    if (!prompt) { return; }

    if (!picked.uri) {
      await sendPrompt(prompt, false);
      return;
    }

    try {
      await vscode.commands.executeCommand("antigravity.agentPanel.focus");
      await sleep(300);
      await vscode.commands.executeCommand("chat.inlineResourceAnchor.addFileToChat", picked.uri);
      await sleep(200);
      await vscode.commands.executeCommand("antigravity.sendPromptToAgentPanel", prompt);
      promptSentTime = Date.now();
      lastChangeTime = Date.now();
      hasFileChanges = false;
      isWatching = true;
      setStatus("$(loading~spin)", "Antigravity thinking...");
      log(`sendPromptWithFile: "${picked.label}" + prompt sent`);
    } catch (err: any) {
      log(`sendPromptWithFile error: ${err.message}`);
      vscode.window.showErrorMessage(`Failed to send: ${err.message}`);
    }
  });

  // ── New Command: Run Shell Command + Return Output ────────────────────────
  const runShellCommand = vscode.commands.registerCommand("tether.runShellCommand", async () => {
    const recentCmds = ["git status", "git log --oneline -10", "git diff --stat", "npm run build", "npm run test", "dir"];

    const picked = await vscode.window.showQuickPick([
      ...recentCmds.map(c => ({ label: `$(terminal) ${c}`, cmd: c })),
      { label: "$(edit) Type custom command...", cmd: "__custom__" },
    ], { title: "Run Shell Command", placeHolder: "Pick a command or type your own..." });

    if (!picked) { return; }

    let cmd = picked.cmd;
    if (cmd === "__custom__") {
      const custom = await vscode.window.showInputBox({
        title: "Custom Shell Command",
        placeHolder: "git log, npm install, dir, etc."
      });
      if (!custom) { return; }
      cmd = custom;
    }

    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    log(`[shell] Running: ${cmd} (cwd: ${cwd})`);
    setStatus("$(loading~spin)", `Running: ${cmd}`);

    const result = await new Promise<{ stdout: string; stderr: string; error: string | null }>((resolve) => {
      cp.exec(cmd, { cwd, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        resolve({
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? "",
          error: error?.message ?? null
        });
      });
    });

    const fullOutput = [
      result.stdout,
      result.stderr ? `\n[STDERR]\n${result.stderr}` : "",
      result.error ? `\n[ERROR]\n${result.error}` : ""
    ].join("").trim();

    const exitLabel = result.error ? "❌ Error" : "✅ Success";
    log(`[shell] ${exitLabel} for: ${cmd}\n${fullOutput}`);
    setStatus(result.error ? "$(error)" : "$(check)", `Done: ${cmd}`);

    const channel = vscode.window.createOutputChannel(`Shell: ${cmd}`);
    channel.clear();
    channel.appendLine(`$ ${cmd}  [cwd: ${cwd}]`);
    channel.appendLine("─".repeat(60));
    channel.appendLine(fullOutput || "(no output)");
    channel.show();

    const preview = fullOutput.length > 300 ? fullOutput.substring(0, 300) + "..." : fullOutput;
    const action = await vscode.window.showInformationMessage(
      `${exitLabel} — \`${cmd}\`\n\n${preview}`,
      "Copy Output", "View Full Output", "Dismiss"
    );

    if (action === "Copy Output") {
      await vscode.env.clipboard.writeText(fullOutput);
      log(`[shell] Output copied to clipboard`);
    }
    if (action === "View Full Output") {
      channel.show();
    }
  });

  // ── New Command: Check Status ──────────────────────────────────────────────
  const checkLocalStatus = vscode.commands.registerCommand("tether.checkStatus", () => {
    if (!isWatching) {
      vscode.window.showInformationMessage("Tether Status: IDLE — Use 'Start Watching' or send a prompt via Tether.");
    } else {
      const msSincePrompt = Date.now() - promptSentTime;
      const msSinceChange = Date.now() - lastChangeTime;
      const fc = changedFiles.size;
      vscode.window.showInformationMessage(
        `Tether Status: WATCHING\n` +
        `Time since watch started: ${(msSincePrompt / 1000).toFixed(1)}s\n` +
        `Files edited so far: ${fc > 0 ? `${fc} (${[...changedFiles].map(f => f.split(/[\\/]/).pop()).join(', ')})` : 'none yet'}\n` +
        (hasFileChanges ? `Time since last edit: ${(msSinceChange / 1000).toFixed(1)}s` : "Waiting for first edit...")
      );
    }
  });

  // ── New Command: Start Watching (manual) ──────────────────────────────────
  const startWatching = vscode.commands.registerCommand("tether.startWatching", () => {
    promptSentTime = Date.now();
    lastChangeTime = Date.now();
    hasFileChanges = false;
    isWatching = true;
    changedFiles.clear();
    doneFileCount = 0;
    setStatus("$(loading~spin)", "Watching for Antigravity...");
    log("Manual watch started by user");
    vscode.window.showInformationMessage("👁 Tether is now watching for Antigravity activity. You'll be notified when it finishes.");
  });

  // ── New Command: Send to Active Terminal ──────────────────────────────────
  const sendToTerminal = vscode.commands.registerCommand("tether.sendToTerminal", async () => {
    const terminal = vscode.window.activeTerminal;
    if (!terminal) {
      vscode.window.showErrorMessage("No active terminal found. Open one first!");
      return;
    }

    const cmd = await vscode.window.showInputBox({
      title: "Send to Active Terminal",
      prompt: "Enter command, or type 'ctrl+c' to stop a running service",
      placeHolder: "npm start, or ctrl+c"
    });
    if (!cmd) { return; }

    terminal.show();

    if (cmd.toLowerCase() === "ctrl+c") {
      terminal.sendText("\u0003", false);
    } else {
      terminal.sendText(cmd);
    }
  });

  // ── New Command: Peek Active Terminal ─────────────────────────────────────
  const peekActiveTerminal = vscode.commands.registerCommand("tether.peekActiveTerminal", async () => {
    if (!vscode.window.activeTerminal) {
      vscode.window.showErrorMessage("No active terminal found!");
      return;
    }

    try {
      const originalClipboard = await vscode.env.clipboard.readText();

      vscode.window.activeTerminal.show();
      await sleep(100);
      await vscode.commands.executeCommand("workbench.action.terminal.selectAll");
      await sleep(100);
      await vscode.commands.executeCommand("workbench.action.terminal.copySelection");
      await sleep(100);
      await vscode.commands.executeCommand("workbench.action.terminal.clearSelection");

      const terminalText = await vscode.env.clipboard.readText();
      await vscode.env.clipboard.writeText(originalClipboard);

      const channel = vscode.window.createOutputChannel("Terminal Peek");
      channel.clear();
      channel.appendLine("=== CURRENT TERMINAL CONTENT ===");
      channel.appendLine("");
      channel.append(terminalText);
      channel.show();

      vscode.window.showInformationMessage(`Read terminal (${terminalText.length} characters)`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to peek terminal: ${err.message}`);
    }
  });

  // ── File watcher: done detection + AUTO-DETECT mode ──────────────────────
  const fileWatcher = vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document.uri.scheme !== "file") { return; }

    if (isWatching) {
      const filePath = event.document.fileName;
      const fileName = filePath.split(/[\\\/]/).pop() ?? filePath;
      const isNewFile = !changedFiles.has(filePath);

      if (!hasFileChanges) {
        const elapsed = ((Date.now() - promptSentTime) / 1000).toFixed(1);
        log(`📝 DIFF STARTED — first file edit: ${fileName} (after ${elapsed}s)`);
        vscode.window.showInformationMessage(`📝 Antigravity started writing! First file: ${fileName} (${elapsed}s after prompt)`);
      } else if (isNewFile) {
        log(`📝 New file touched: ${fileName} (${changedFiles.size + 1} total)`);
      }

      changedFiles.add(filePath);
      lastChangeTime = Date.now();
      hasFileChanges = true;

      // Update status bar live with file count
      const fc = changedFiles.size;
      setStatus("$(loading~spin)", `Antigravity editing... (${fc} file${fc === 1 ? '' : 's'})`);
    } else {
      // AUTO-DETECT: burst of 3+ changes in 2s = auto-start watch
      autoDetectChangeCount++;
      log(`[auto-detect] file change #${autoDetectChangeCount}: ${event.document.fileName.split(/[\\\/]/).pop()}`);

      if (autoDetectResetTimer) { clearTimeout(autoDetectResetTimer); }
      autoDetectResetTimer = setTimeout(() => { autoDetectChangeCount = 0; }, 2000);

      if (autoDetectChangeCount >= 3) {
        log("[auto-detect] Burst detected — auto-starting watch!");
        promptSentTime = Date.now();
        lastChangeTime = Date.now();
        hasFileChanges = true;
        isWatching = true;
        autoDetectChangeCount = 0;
        setStatus("$(loading~spin)", "Antigravity editing (auto-detected)");
      }
    }
  });

  // ── Command: Test Get Diff (runs getDiff logic locally, shows output in channel) ──
  const testGetDiff = vscode.commands.registerCommand("tether.testGetDiff", async () => {
    const ch = vscode.window.createOutputChannel("Tether Diff Preview");
    ch.clear();
    ch.show();
    ch.appendLine("=== Tether: Testing getDiff ===");
    ch.appendLine(`Timestamp: ${new Date().toISOString()}`);
    ch.appendLine("");

    // ── Shared diff helper (same algorithm as relay case 'getDiff') ────────────
    function buildDiff(originalText: string, modifiedText: string, filePath: string): string {
      const origLines = originalText.split("\n");
      const modLines  = modifiedText.split("\n");
      type Edit = { type: "=" | "+" | "-"; line: string; origIdx: number; modIdx: number };
      const edits: Edit[] = [];
      let oi = 0, mi = 0;
      while (oi < origLines.length || mi < modLines.length) {
        if (oi < origLines.length && mi < modLines.length && origLines[oi] === modLines[mi]) {
          edits.push({ type: "=", line: origLines[oi], origIdx: oi + 1, modIdx: mi + 1 }); oi++; mi++;
        } else {
          let found = false;
          for (let look = 1; look <= 8 && !found; look++) {
            if (mi + look < modLines.length && oi < origLines.length && origLines[oi] === modLines[mi + look]) {
              for (let k = 0; k < look; k++) { edits.push({ type: "+", line: modLines[mi + k], origIdx: -1, modIdx: mi + k + 1 }); mi++; }
              found = true;
            } else if (oi + look < origLines.length && mi < modLines.length && origLines[oi + look] === modLines[mi]) {
              for (let k = 0; k < look; k++) { edits.push({ type: "-", line: origLines[oi + k], origIdx: oi + k + 1, modIdx: -1 }); oi++; }
              found = true;
            }
          }
          if (!found) {
            if (oi < origLines.length) { edits.push({ type: "-", line: origLines[oi], origIdx: oi + 1, modIdx: -1 }); oi++; }
            if (mi < modLines.length)  { edits.push({ type: "+", line: modLines[mi],  origIdx: -1, modIdx: mi + 1 }); mi++; }
          }
        }
      }
      const CONTEXT = 3;
      const changed = edits.map((e, i) => e.type !== "=" ? i : -1).filter(i => i >= 0);
      if (changed.length === 0) { return ""; }
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
      const rel  = filePath.startsWith(root) ? filePath.slice(root.length).replace(/\\/g, "/").replace(/^\//, "") : filePath.replace(/\\/g, "/");
      let out = `diff --git a/${rel} b/${rel}\n--- a/${rel}\n+++ b/${rel}\n`;
      const hunks: Array<[number, number]> = [];
      let hStart = Math.max(0, changed[0] - CONTEXT);
      let hEnd   = Math.min(edits.length - 1, changed[0] + CONTEXT);
      for (let k = 1; k < changed.length; k++) {
        const next = changed[k];
        if (next - CONTEXT <= hEnd + CONTEXT) { hEnd = Math.min(edits.length - 1, next + CONTEXT); }
        else { hunks.push([hStart, hEnd]); hStart = Math.max(0, next - CONTEXT); hEnd = Math.min(edits.length - 1, next + CONTEXT); }
      }
      hunks.push([hStart, hEnd]);
      for (const [s, e] of hunks) {
        const slice = edits.slice(s, e + 1);
        const oldStart = slice.find(x => x.origIdx > 0)?.origIdx ?? 1;
        const newStart = slice.find(x => x.modIdx  > 0)?.modIdx  ?? 1;
        out += `@@ -${oldStart},${slice.filter(x => x.type !== "+").length} +${newStart},${slice.filter(x => x.type !== "-").length} @@\n`;
        for (const ed of slice) { out += (ed.type === "+" ? "+" : ed.type === "-" ? "-" : " ") + ed.line + "\n"; }
      }
      return out;
    }

    let combined = "";

    // ── Step 0: Snapshot diff (PRIMARY strategy) ──────────────────────────
    ch.appendLine(`[Step 0] Snapshot diff — ${fileSnapshot.size} files in snapshot`);
    if (fileSnapshot.size > 0) {
      const uris = await vscode.workspace.findFiles(
        "**/*",
        "{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/.next/**}",
        300
      );
      let snapshotHits = 0;
      for (const uri of uris) {
        const snapText = fileSnapshot.get(uri.fsPath);
        if (snapText === undefined) { continue; }
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          if (bytes.byteLength > 500 * 1024) { continue; }
          const current = Buffer.from(bytes).toString("utf8");
          if (current !== snapText) {
            ch.appendLine(`  → CHANGED: ${uri.fsPath}`);
            const d = buildDiff(snapText, current, uri.fsPath);
            if (d) { combined += d + "\n"; snapshotHits++; ch.appendLine(`    ✅ diff: ${d.split("\n").length} lines`); }
            else   { ch.appendLine(`    ⚠️  whitespace-only change`); }
          }
        } catch (err: any) { ch.appendLine(`  ❌ ${uri.fsPath}: ${err.message}`); }
      }
      if (snapshotHits === 0) {
        ch.appendLine("  ⚠️  snapshot found but NO files changed since last prompt");
        ch.appendLine("     (Did you send a prompt via Tether before running this?)");
      }
    } else {
      ch.appendLine("  ⚠️  No snapshot available — send a prompt via Tether first!");
      ch.appendLine("     (Snapshot is taken automatically when you send a prompt)");
    }

    // ── Step 1: TabInputTextDiff tabs ─────────────────────────────────────
    const allTabs  = vscode.window.tabGroups.all.flatMap(g => g.tabs);
    const diffTabs = allTabs.filter(t => t.input instanceof vscode.TabInputTextDiff);
    ch.appendLine(`\n[Step 1] TabInputTextDiff tabs: ${diffTabs.length} found`);
    if (!combined) {
      for (const tab of diffTabs) {
        const inp = tab.input as vscode.TabInputTextDiff;
        ch.appendLine(`  → original : ${inp.original.fsPath}`);
        ch.appendLine(`    modified : ${inp.modified.fsPath}`);
        try {
          const [origDoc, modDoc] = await Promise.all([
            vscode.workspace.openTextDocument(inp.original),
            vscode.workspace.openTextDocument(inp.modified),
          ]);
          const d = buildDiff(origDoc.getText(), modDoc.getText(), inp.modified.fsPath);
          if (d) { combined += d + "\n"; ch.appendLine(`    ✅ diff: ${d.split("\n").length} lines`); }
          else    { ch.appendLine(`    ⚠️  files are identical (no diff)`); }
        } catch (err: any) { ch.appendLine(`    ❌ error: ${err.message}`); }
      }
    } else {
      ch.appendLine("  (skipped — snapshot diff already succeeded)");
    }

    // ── Step 2: Dirty documents vs disk ──────────────────────────────────
    const dirtyDocs = vscode.workspace.textDocuments.filter(d => d.isDirty && d.uri.scheme === "file");
    ch.appendLine(`\n[Step 2] Dirty (unsaved) documents: ${dirtyDocs.length} found`);
    if (!combined) {
      for (const doc of dirtyDocs) {
        ch.appendLine(`  → ${doc.uri.fsPath}`);
        try {
          const diskBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(doc.uri.fsPath));
          const diskText  = Buffer.from(diskBytes).toString("utf8");
          const d = buildDiff(diskText, doc.getText(), doc.uri.fsPath);
          if (d) { combined += d + "\n"; ch.appendLine(`    ✅ diff: ${d.split("\n").length} lines`); }
          else    { ch.appendLine(`    ⚠️  same as disk (no diff)`); }
        } catch (err: any) { ch.appendLine(`    ❌ error: ${err.message}`); }
      }
    } else {
      ch.appendLine("  (skipped — diff already found in Step 1)");
    }

    // ── Step 3: git diff HEAD ─────────────────────────────────────────────
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    ch.appendLine(`\n[Step 3] git diff HEAD (cwd: ${cwd})`);
    if (!combined) {
      try {
        const gitOut = await new Promise<string>((resolve) => {
          cp.exec("git diff HEAD", { cwd, maxBuffer: 2 * 1024 * 1024 }, (_, stdout) =>
            resolve(stdout?.toString().trim() ?? "")
          );
        });
        if (gitOut) { combined = gitOut; ch.appendLine(`  ✅ git diff: ${gitOut.split("\n").length} lines`); }
        else         { ch.appendLine("  ⚠️  git diff returned nothing"); }
      } catch (err: any) { ch.appendLine(`  ❌ error: ${err.message}`); }
    } else {
      ch.appendLine("  (skipped — diff already found)");
    }

    // ── Final output ────────────────────────────────────────────────────────────
    ch.appendLine("");
    ch.appendLine("─".repeat(60));
    if (combined) {
      const lines = combined.split("\n");
      ch.appendLine(`✅ DIFF FOUND (${lines.length} lines total). First 100 lines:`);
      ch.appendLine("");
      lines.slice(0, 100).forEach(l => ch.appendLine(l));
      if (lines.length > 100) { ch.appendLine(`... (${lines.length - 100} more lines — copy to see all)`); }
      vscode.window.showInformationMessage(
        `✅ getDiff found ${lines.length} diff lines! Check "Tether Diff Preview" output.`,
        "Copy Full Diff"
      ).then(a => { if (a === "Copy Full Diff") { vscode.env.clipboard.writeText(combined); } });
    } else {
      ch.appendLine("❌ NO DIFF FOUND across all 3 strategies.");
      ch.appendLine("");
      ch.appendLine("Next steps:");
      ch.appendLine("  • Send a prompt to Antigravity and wait for it to start editing files");
      ch.appendLine("  • Check the Antigravity chat panel has pending accept/reject edits");
      ch.appendLine("  • Open the file Antigravity is editing so it appears in textDocuments");
      vscode.window.showWarningMessage("❌ No diff found. See \"Tether Diff Preview\" output for diagnostics.");
    }
  });

  context.subscriptions.push(
    statusBarItem,
    sendNewChat,
    sendExistingChat,
    acceptChanges,
    rejectChanges,
    control,
    listOpenFiles,
    listWorkspaceFiles,
    peekFileContent,
    sendPromptWithFile,
    runShellCommand,
    sendToTerminal,
    peekActiveTerminal,
    checkLocalStatus,
    startWatching,
    testGetDiff,
    fileWatcher
  );
}

export function deactivate() {
  if (statusInterval) { clearInterval(statusInterval); }
  relay.stop();
}
