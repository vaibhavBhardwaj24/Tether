import React, { createContext, useContext, useReducer, useRef, useCallback, ReactNode, useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Configure how notifications are displayed when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ─── Types matching the Tether protocol ─────────────────────────────────────
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'failed';

/** Protocol state values from extension */
export type AiState = 'idle' | 'thinking' | 'watching' | 'editing' | 'done';

export interface OpenFile {
  name: string;
  path: string;
}

export interface HistoryEntry {
  id: string;
  prompt: string;
  timestamp: Date;
  outcome: 'done' | 'error';
  totalSeconds: number;
  errorCount: number;
}

/** Shell result from runShell command */
export interface ShellResult {
  cmd: string;
  output: string;
  success: boolean;
}

/** Terminal content from peekTerminal */
export interface TerminalContent {
  content: string;
}

// ─── Protocol message shapes ─────────────────────────────────────────────────
// Mobile → Extension
export interface SendPromptMsg { type: 'sendPrompt'; payload: { prompt: string; newConversation: boolean } }
export interface AcceptMsg { type: 'acceptChanges' }
export interface RejectMsg { type: 'rejectChanges' }
export interface StartWatchMsg { type: 'startWatching' }
export interface GetStatusMsg { type: 'getStatus' }
export interface RunShellMsg { type: 'runShell'; payload: { cmd: string } }
export interface SendToTermMsg { type: 'sendToTerminal'; payload: { cmd: string } }
export interface PeekTermMsg { type: 'peekTerminal' }
export interface PeekFileMsg { type: 'peekFile'; payload: { path: string } }
export interface ListOpenMsg { type: 'listOpenFiles' }
export interface ListWsFilesMsg { type: 'listWorkspaceFiles' }
export interface PingMsg { type: 'ping' }

// Extension → Mobile
export interface StatusMsg { type: 'status'; from: 'extension'; payload: { state: AiState; sincePrompt: number; sinceEdit: number; hasFileChanges: boolean; fileCount?: number; files?: string[] } }
export interface DiffCompleteMsg { type: 'diffComplete'; from: 'extension'; payload: { totalSeconds: number; errorCount: number; fileCount?: number; files?: string[] } }
export interface NotificationMsg { type: 'notification'; from: 'extension'; payload: { level: 'info' | 'warn' | 'error'; message: string } }
export interface ShellResultMsg { type: 'shellResult'; from: 'extension'; payload: ShellResult }
export interface FileContentMsg { type: 'fileContent'; from: 'extension'; payload: { path: string; content: string } }
export interface OpenFilesMsg { type: 'openFiles'; from: 'extension'; payload: { files: OpenFile[] } }
export interface WsFilesMsg { type: 'workspaceFiles'; from: 'extension'; payload: { files: string[] } }
export interface TerminalConMsg { type: 'terminalContent'; from: 'extension'; payload: { content: string } }
export interface PongMsg { type: 'pong'; from: 'extension' }
export interface DiffContentMsg { type: 'diffContent'; from: 'extension'; payload: { diff: string; error: string | null } }
export interface GitStatusResultMsg { type: 'gitStatusResult'; from: 'extension'; payload: { branch: string; status: string; logRaw: string; repoName: string } }

// System (relay)
export interface PairedMsg { type: 'paired'; code: string }
export interface PeerDiscMsg { type: 'peer_disconnected'; role: 'mobile' | 'extension' }
export interface ErrorMsg { type: 'error'; message: string }
export interface RegisteredMsg { type: 'registered'; code: string; status: string }

type InboundMsg = StatusMsg | DiffCompleteMsg | NotificationMsg | ShellResultMsg |
  FileContentMsg | OpenFilesMsg | WsFilesMsg | TerminalConMsg | PongMsg | DiffContentMsg |
  PairedMsg | PeerDiscMsg | ErrorMsg | RegisteredMsg | GitStatusResultMsg;

// ─── App State ───────────────────────────────────────────────────────────────
interface TetherState {
  connectionStatus: ConnectionStatus;
  pairingCode: string;
  sessionId: string;
  aiState: AiState;
  sincePrompt: number;
  sinceEdit: number;
  hasFileChanges: boolean;
  editingFileCount: number;       // live count of files Antigravity has touched
  editingFiles: string[];         // list of filenames touched (basenames)
  lastDiff: { totalSeconds: number; errorCount: number; fileCount?: number } | null;
  lastNotification: { level: 'info' | 'warn' | 'error'; message: string } | null;
  lastShellResult: ShellResult | null;
  lastGitStatus: { branch: string; status: string; logRaw: string; repoName: string } | null;
  terminalContent: string;
  openFiles: OpenFile[];
  workspaceFiles: string[];
  diffContent: string | null;
  history: HistoryEntry[];
  relayUrl: string;
  deviceLabel: string;
}

type TetherAction =
  | { type: 'SET_CONNECTION_STATUS'; status: ConnectionStatus }
  | { type: 'SET_PAIRING_CODE'; code: string }
  | { type: 'SET_SESSION_ID'; id: string }
  | { type: 'SET_AI_STATE'; payload: StatusMsg['payload'] }
  | { type: 'SET_DIFF_COMPLETE'; payload: DiffCompleteMsg['payload'] }
  | { type: 'SET_NOTIFICATION'; payload: NotificationMsg['payload'] }
  | { type: 'CLEAR_NOTIFICATION' }
  | { type: 'SET_SHELL_RESULT'; result: ShellResult }
  | { type: 'SET_GIT_STATUS'; payload: GitStatusResultMsg['payload'] }
  | { type: 'SET_TERMINAL_CONTENT'; content: string }
  | { type: 'SET_OPEN_FILES'; files: OpenFile[] }
  | { type: 'SET_WORKSPACE_FILES'; files: string[] }
  | { type: 'SET_DIFF_CONTENT'; diff: string | null }
  | { type: 'ADD_HISTORY'; entry: HistoryEntry }
  | { type: 'REMOVE_HISTORY'; id: string }
  | { type: 'CLEAR_HISTORY' }
  | { type: 'SET_RELAY_URL'; url: string }
  | { type: 'SET_DEVICE_LABEL'; label: string };

const initialState: TetherState = {
  connectionStatus: 'disconnected',
  pairingCode: '',
  sessionId: '',
  aiState: 'idle',
  sincePrompt: 0,
  sinceEdit: 0,
  hasFileChanges: false,
  editingFileCount: 0,
  editingFiles: [],
  lastDiff: null,
  lastNotification: null,
  lastShellResult: null,
  lastGitStatus: null,
  terminalContent: '',
  openFiles: [],
  workspaceFiles: [],
  diffContent: null,
  history: [], relayUrl: 'ws://localhost:3000/ws',
  deviceLabel: 'My VS Code',
};

function reducer(state: TetherState, action: TetherAction): TetherState {
  switch (action.type) {
    case 'SET_CONNECTION_STATUS': return { ...state, connectionStatus: action.status };
    case 'SET_PAIRING_CODE': return { ...state, pairingCode: action.code };
    case 'SET_SESSION_ID': return { ...state, sessionId: action.id };
    case 'SET_AI_STATE': {
      const p = action.payload;
      // Only update file tracking when we actually have data (editing state)
      const editingFileCount = p.fileCount !== undefined ? p.fileCount : (p.state === 'editing' ? state.editingFileCount : p.state === 'idle' || p.state === 'thinking' ? 0 : state.editingFileCount);
      const editingFiles = p.files !== undefined ? p.files.map((f: string) => f.split(/[\/\\]/).pop() ?? f) : (p.state === 'idle' || p.state === 'thinking' ? [] : state.editingFiles);
      return {
        ...state,
        aiState: p.state,
        sincePrompt: p.sincePrompt,
        sinceEdit: p.sinceEdit,
        hasFileChanges: p.hasFileChanges,
        editingFileCount,
        editingFiles,
      };
    }
    case 'SET_DIFF_COMPLETE': return {
      ...state,
      lastDiff: action.payload,
      aiState: 'done',
      hasFileChanges: true, // ensure Accept/Reject buttons are visible
      editingFileCount: action.payload.fileCount ?? state.editingFileCount,
    };
    case 'SET_NOTIFICATION': return { ...state, lastNotification: action.payload };
    case 'CLEAR_NOTIFICATION': return { ...state, lastNotification: null };
    case 'SET_SHELL_RESULT': return { ...state, lastShellResult: action.result };
    case 'SET_GIT_STATUS': return { ...state, lastGitStatus: action.payload };
    case 'SET_TERMINAL_CONTENT': return { ...state, terminalContent: action.content };
    case 'SET_OPEN_FILES': return { ...state, openFiles: action.files };
    case 'SET_WORKSPACE_FILES': return { ...state, workspaceFiles: action.files };
    case 'SET_DIFF_CONTENT': return { ...state, diffContent: action.diff };
    case 'ADD_HISTORY': return { ...state, history: [action.entry, ...state.history] };
    case 'REMOVE_HISTORY': return { ...state, history: state.history.filter(h => h.id !== action.id) };
    case 'CLEAR_HISTORY': return { ...state, history: [] };
    case 'SET_RELAY_URL': return { ...state, relayUrl: action.url };
    case 'SET_DEVICE_LABEL': return { ...state, deviceLabel: action.label };
    default: return state;
  }
}

// ─── Context ─────────────────────────────────────────────────────────────────
interface TetherContextType {
  state: TetherState;
  dispatch: React.Dispatch<TetherAction>;
  connect: (code: string) => void;
  disconnect: () => void;
  // Typed command senders
  sendPrompt: (prompt: string, newConversation: boolean) => void;
  acceptChanges: () => void;
  rejectChanges: () => void;
  clearNotification: () => void;
  startWatching: () => void;
  getStatus: () => void;
  runShell: (cmd: string) => void;
  sendToTerminal: (cmd: string) => void;
  peekTerminal: () => void;
  peekFile: (path: string) => void;
  getDiff: () => void;
  getGitStatus: () => void;
  listOpenFiles: () => void;
  listWorkspaceFiles: () => void;
  ping: () => void;
  isWsReady: () => boolean;
}

const TetherContext = createContext<TetherContextType | null>(null);

async function requestNotificationPermissions() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('tether-ai', {
      name: 'Tether AI Updates',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#3B82F6',
      sound: 'default',
    });
  }
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

async function sendDoneNotification(totalSeconds: number, errorCount: number) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  const body = errorCount > 0
    ? `Done in ${timeStr} · ${errorCount} error${errorCount === 1 ? '' : 's'} detected`
    : `Done in ${timeStr} · No errors`;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: '✅ Antigravity finished',
      body,
      sound: 'default',
      ...(Platform.OS === 'android' && { channelId: 'tether-ai' }),
    },
    trigger: null, // fire immediately
  });
}

export function TetherProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const wsRef = useRef<WebSocket | null>(null);
  // Keep latest relay URL accessible in callbacks without re-creating them
  const relayUrlRef = useRef(state.relayUrl);
  relayUrlRef.current = state.relayUrl;

  // Request notification permissions once on mount
  useEffect(() => {
    requestNotificationPermissions();
  }, []);

  // ── Low-level send ──────────────────────────────────────────────────────────
  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const isWsReady = useCallback(() =>
    wsRef.current?.readyState === WebSocket.OPEN, []);

  // ── Connect ─────────────────────────────────────────────────────────────────
  const connect = useCallback((code: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close();
    }

    dispatch({ type: 'SET_CONNECTION_STATUS', status: 'connecting' });
    dispatch({ type: 'SET_PAIRING_CODE', code });

    let paired = false;

    try {
      const ws = new WebSocket(relayUrlRef.current);
      wsRef.current = ws;

      ws.onopen = () => {
        // Protocol step 3 — mobile registers
        ws.send(JSON.stringify({ type: 'register', role: 'mobile', code }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as InboundMsg;

          switch (msg.type) {
            // ── Pairing ────────────────────────────────────────────────────
            case 'registered':
              // relay acknowledged — waiting for extension to pair
              break;

            case 'paired':
              paired = true;
              dispatch({ type: 'SET_CONNECTION_STATUS', status: 'connected' });
              break;

            case 'peer_disconnected':
              dispatch({ type: 'SET_CONNECTION_STATUS', status: 'disconnected' });
              dispatch({ type: 'SET_AI_STATE', payload: { state: 'idle', sincePrompt: 0, sinceEdit: 0, hasFileChanges: false, fileCount: 0, files: [] } });
              break;

            case 'error':
              dispatch({ type: 'SET_CONNECTION_STATUS', status: 'failed' });
              break;

            // ── Extension status ───────────────────────────────────────────
            case 'status':
              dispatch({ type: 'SET_AI_STATE', payload: (msg as StatusMsg).payload });
              break;

            case 'diffComplete': {
              const diffPayload = (msg as DiffCompleteMsg).payload;
              dispatch({ type: 'SET_DIFF_COMPLETE', payload: diffPayload });
              sendDoneNotification(diffPayload.totalSeconds, diffPayload.errorCount);
              break;
            }

            // ── Responses to commands ──────────────────────────────────────
            case 'notification':
              dispatch({ type: 'SET_NOTIFICATION', payload: (msg as NotificationMsg).payload });
              break;

            case 'shellResult':
              dispatch({ type: 'SET_SHELL_RESULT', result: (msg as ShellResultMsg).payload });
              break;

            case 'terminalContent':
              dispatch({ type: 'SET_TERMINAL_CONTENT', content: (msg as TerminalConMsg).payload.content });
              break;

            case 'openFiles':
              dispatch({ type: 'SET_OPEN_FILES', files: (msg as OpenFilesMsg).payload.files });
              break;

            case 'diffContent':
              dispatch({ type: 'SET_DIFF_CONTENT', diff: (msg as DiffContentMsg).payload.diff });
              break;

            case 'workspaceFiles':
              dispatch({ type: 'SET_WORKSPACE_FILES', files: (msg as WsFilesMsg).payload.files });
              break;

            case 'fileContent':
              // caller can inspect state.lastShellResult or listen for this
              break;

            case 'pong':
              break;

            case 'gitStatusResult':
              dispatch({ type: 'SET_GIT_STATUS', payload: (msg as GitStatusResultMsg).payload });
              break;

            default:
              break;
          }
        } catch {
          // ignore malformed JSON
        }
      };

      ws.onerror = () => {
        if (!paired) {
          dispatch({ type: 'SET_CONNECTION_STATUS', status: 'failed' });
        }
      };

      ws.onclose = () => {
        if (paired) {
          dispatch({ type: 'SET_CONNECTION_STATUS', status: 'disconnected' });
        }
        // if never paired, onerror already set 'failed'
      };
    } catch {
      dispatch({ type: 'SET_CONNECTION_STATUS', status: 'failed' });
    }
  }, []);

  // ── Disconnect ───────────────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    dispatch({ type: 'SET_CONNECTION_STATUS', status: 'disconnected' });
    dispatch({ type: 'SET_SESSION_ID', id: '' });
  }, []);

  // ── Typed command senders (protocol: Mobile → Extension) ────────────────────
  const sendPrompt = useCallback((prompt: string, newConversation: boolean) => {
    const entry: HistoryEntry = {
      id: Date.now().toString(),
      prompt,
      timestamp: new Date(),
      outcome: 'done',
      totalSeconds: 0,
      errorCount: 0,
    };
    dispatch({ type: 'ADD_HISTORY', entry });
    // Optimistic: we know a prompt was just sent, so state is 'thinking'
    dispatch({ type: 'SET_AI_STATE', payload: { state: 'thinking', sincePrompt: 0, sinceEdit: 0, hasFileChanges: false, fileCount: 0, files: [] } });
    // Clear stale diff from previous run
    dispatch({ type: 'SET_DIFF_CONTENT', diff: null });
    send({ type: 'sendPrompt', payload: { prompt, newConversation } });
  }, [send]);

  const acceptChanges = useCallback(() => {
    send({ type: 'acceptChanges' });
    dispatch({ type: 'SET_AI_STATE', payload: { state: 'idle', sincePrompt: 0, sinceEdit: 0, hasFileChanges: false } });
  }, [send]);

  const rejectChanges = useCallback(() => {
    send({ type: 'rejectChanges' });
    dispatch({ type: 'SET_AI_STATE', payload: { state: 'idle', sincePrompt: 0, sinceEdit: 0, hasFileChanges: false } });
  }, [send]);
  const startWatching = useCallback(() => send({ type: 'startWatching' }), [send]);
  const getStatus = useCallback(() => send({ type: 'getStatus' }), [send]);
  const runShell = useCallback((cmd: string) => send({ type: 'runShell', payload: { cmd } }), [send]);
  const sendToTerminal = useCallback((cmd: string) => send({ type: 'sendToTerminal', payload: { cmd } }), [send]);
  const peekTerminal = useCallback(() => send({ type: 'peekTerminal' }), [send]);
  const peekFile = useCallback((path: string) => send({ type: 'peekFile', payload: { path } }), [send]);
  const listOpenFiles = useCallback(() => send({ type: 'listOpenFiles' }), [send]);
  const listWorkspaceFiles = useCallback(() => send({ type: 'listWorkspaceFiles' }), [send]);
  const getDiff = useCallback(() => send({ type: 'getDiff' }), [send]);
  const getGitStatus = useCallback(() => send({ type: 'getGitStatus' }), [send]);
  const clearNotification = useCallback(() => dispatch({ type: 'CLEAR_NOTIFICATION' }), []);
  const ping = useCallback(() => send({ type: 'ping' }), [send]);

  return (
    <TetherContext.Provider value={{
      state, dispatch,
      connect, disconnect,
      sendPrompt, acceptChanges, rejectChanges, clearNotification, startWatching, getStatus,
      runShell, sendToTerminal, peekTerminal, peekFile,
      listOpenFiles, listWorkspaceFiles, getDiff, getGitStatus, ping, isWsReady,
    }}>
      {children}
    </TetherContext.Provider>
  );
}

export function useTether() {
  const ctx = useContext(TetherContext);
  if (!ctx) throw new Error('useTether must be used within TetherProvider');
  return ctx;
}
