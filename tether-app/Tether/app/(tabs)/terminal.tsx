import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  FlatList,
  TouchableOpacity,
  TextInput,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTether } from '@/store/tether-store';

// ─── Quick-command definitions ────────────────────────────────────────────────
const QUICK_CMDS = [
  { label: 'npm start',      cmd: 'npm start',      icon: 'play-circle' as const },
  { label: 'npm test',       cmd: 'npm test',       icon: 'flask'       as const },
  { label: 'npm run build',  cmd: 'npm run build',  icon: 'construct'   as const },
  { label: 'npm install',    cmd: 'npm install',    icon: 'download'    as const },
  { label: 'git status',     cmd: 'git status',     icon: 'git-branch'  as const },
  { label: 'Custom…',        cmd: '__custom__',     icon: 'terminal'    as const },
];

// ─── Types ────────────────────────────────────────────────────────────────────
type LineType = 'normal' | 'success' | 'error' | 'info' | 'warn' | 'system';
interface LogLine { id: string; time: string; text: string; type: LineType; }

const LINE_COLOR: Record<LineType, string> = {
  normal:  '#C9D1D9',
  success: '#4ADE80',
  error:   '#F87171',
  info:    '#60A5FA',
  warn:    '#FBBF24',
  system:  '#94A3B8',
};

function classifyLine(text: string): LineType {
  const t = text.toLowerCase();
  if (/error|fail|exception|fatal|✗|×/.test(t)) { return 'error'; }
  if (/warn|warning/.test(t))                     { return 'warn'; }
  if (/✓|success|done|ready|compiled|started|running at/.test(t)) { return 'success'; }
  if (/^(get|post|put|patch|delete) /.test(t))    { return 'info'; }
  return 'normal';
}

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function TerminalScreen() {
  const { state, sendToTerminal, peekTerminal, isWsReady } = useTether();

  const [logs, setLogs]           = useState<LogLine[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showCustom, setShowCustom] = useState(false);
  const [customCmd, setCustomCmd] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<FlatList>(null);

  // ── Fetch terminal content on mount ─────────────────────────────────────
  useEffect(() => {
    if (isWsReady()) {
      peekTerminal();
    } else {
      setLoading(false);
    }
    // Safety timeout so loading spinner doesn't stick forever
    const t = setTimeout(() => setLoading(false), 6000);
    return () => clearTimeout(t);
  }, []);

  // ── When terminalContent arrives from the extension → replace log lines ──
  const termContent    = state.terminalContent;
  const termContentRef = useRef<typeof termContent>(null);
  useEffect(() => {
    if (termContent && termContent !== termContentRef.current) {
      termContentRef.current = termContent;
      setLoading(false);
      const time = nowTime();
      const parsed: LogLine[] = termContent
        .split('\n')
        .map((rawLine, i) => {
          const text = rawLine.trimEnd() || ' ';
          return {
            id:   `term-${Date.now()}-${i}`,
            time: i === 0 ? time : '',
            text,
            type: classifyLine(text),
          };
        });
      setLogs(parsed);
    }
  }, [termContent]);

  // ── When a shell result arrives → append to logs ─────────────────────────
  const lastResult    = state.lastShellResult;
  const lastResultRef = useRef<typeof lastResult>(null);
  useEffect(() => {
    if (lastResult && lastResult !== lastResultRef.current) {
      lastResultRef.current = lastResult;
      const time = nowTime();
      const newLines: LogLine[] = [
        { id: `${Date.now()}-cmd`, time, text: `$ ${lastResult.cmd}`, type: 'info' },
        ...lastResult.output
          .split('\n')
          .filter(Boolean)
          .map((line, i) => ({
            id:   `${Date.now()}-out-${i}`,
            time: '',
            text: line,
            type: lastResult.success ? classifyLine(line) : 'error' as LineType,
          })),
      ];
      setLogs(prev => [...prev, ...newLines]);
    }
  }, [lastResult]);

  // ── Auto-scroll to bottom ─────────────────────────────────────────────────
  useEffect(() => {
    if (autoScroll && logs.length > 0) {
      listRef.current?.scrollToEnd?.({ animated: false });
    }
  }, [logs, autoScroll]);

  // ── Commands ──────────────────────────────────────────────────────────────
  const handleRefresh = useCallback(() => {
    setLoading(true);
    peekTerminal();
    setTimeout(() => setLoading(false), 6000);
  }, [peekTerminal]);

  const dispatchCmd = useCallback((cmd: string) => {
    if (cmd === '__custom__') { setShowCustom(true); return; }
    if (!isWsReady()) {
      setLogs(prev => [...prev, {
        id: Date.now().toString(), time: nowTime(),
        text: '⚠ Not connected to VS Code.', type: 'warn',
      }]);
      return;
    }
    setLogs(prev => [...prev, {
      id: Date.now().toString(), time: nowTime(),
      text: `$ ${cmd}`, type: 'info',
    }]);
    sendToTerminal(cmd);
  }, [isWsReady, sendToTerminal]);

  const submitCustom = useCallback(() => {
    const trimmed = customCmd.trim();
    if (!trimmed) { return; }
    dispatchCmd(trimmed);
    setCustomCmd('');
    setShowCustom(false);
  }, [customCmd, dispatchCmd]);

  const sendCtrlC = useCallback(() => {
    sendToTerminal('ctrl+c');
    setLogs(prev => [...prev, { id: Date.now().toString(), time: nowTime(), text: '^C', type: 'warn' }]);
  }, [sendToTerminal]);

  // ── Render ────────────────────────────────────────────────────────────────
  const isConnected = state.connectionStatus === 'connected';

  const renderLog = ({ item }: { item: LogLine }) => (
    <View style={[styles.logRow, item.type === 'error' && styles.logRowError]}>
      {!!item.time && <Text style={styles.logTime}>{item.time} </Text>}
      <Text style={[styles.logText, { color: LINE_COLOR[item.type] }]}>{item.text}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

        {/* ── Header ────────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>Terminal</Text>
            <View style={styles.connRow}>
              <View style={[styles.connDot, { backgroundColor: isConnected ? '#4ADE80' : '#EF4444' }]} />
              <Text style={[styles.connText, { color: isConnected ? '#4ADE80' : '#8B949E' }]}>
                {isConnected ? state.deviceLabel || 'VS Code' : 'Not connected'}
              </Text>
            </View>
          </View>
          <View style={styles.headerBtns}>
            <TouchableOpacity style={styles.hBtn} onPress={handleRefresh}>
              <Ionicons name="refresh" size={17} color="#8B949E" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.hBtn} onPress={() => setLogs([])}>
              <Ionicons name="trash-outline" size={17} color="#8B949E" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.hBtn, autoScroll && styles.hBtnActive]}
              onPress={() => setAutoScroll(a => !a)}
            >
              <Ionicons name="arrow-down" size={17} color={autoScroll ? '#3B82F6' : '#8B949E'} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Quick-command chips ────────────────────────────────────────── */}
        <View style={styles.chipRow}>
          {QUICK_CMDS.map(q => (
            <TouchableOpacity
              key={q.cmd}
              style={styles.chip}
              onPress={() => dispatchCmd(q.cmd)}
              activeOpacity={0.7}
            >
              <Ionicons name={q.icon} size={13} color="#8B949E" />
              <Text style={styles.chipText}>{q.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Custom-command bar ────────────────────────────────────────── */}
        {showCustom && (
          <View style={styles.customBar}>
            <Text style={styles.prompt}>$</Text>
            <TextInput
              style={styles.customInput}
              value={customCmd}
              onChangeText={setCustomCmd}
              placeholder="Enter command…"
              placeholderTextColor="#4B5563"
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="send"
              onSubmitEditing={submitCustom}
            />
            <TouchableOpacity style={styles.sendBtn} onPress={submitCustom}>
              <Ionicons name="send" size={15} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.hBtn} onPress={() => setShowCustom(false)}>
              <Ionicons name="close" size={17} color="#8B949E" />
            </TouchableOpacity>
          </View>
        )}

        {/* ── Log area ─────────────────────────────────────────────────── */}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#3B82F6" />
            <Text style={styles.centerText}>Fetching terminal output…</Text>
          </View>
        ) : logs.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="terminal-outline" size={42} color="#21262D" />
            <Text style={styles.emptyTitle}>No output yet</Text>
            <Text style={styles.emptyText}>
              Run a command above or{'\n'}press Refresh to peek the active terminal.
            </Text>
            <TouchableOpacity style={styles.refreshBtn} onPress={handleRefresh}>
              <Ionicons name="refresh" size={14} color="#3B82F6" />
              <Text style={styles.refreshBtnText}>Peek Terminal</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={logs}
            keyExtractor={item => item.id}
            renderItem={renderLog}
            style={styles.logArea}
            contentContainerStyle={styles.logContent}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => {
              if (autoScroll) { listRef.current?.scrollToEnd({ animated: false }); }
            }}
          />
        )}

        {/* ── Bottom bar ───────────────────────────────────────────────── */}
        <View style={styles.bottomBar}>
          <TouchableOpacity style={styles.ctrlcBtn} onPress={sendCtrlC}>
            <Ionicons name="stop-circle" size={14} color="#EF4444" />
            <Text style={styles.ctrlcText}>Ctrl+C</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.customTrigger} onPress={() => setShowCustom(s => !s)}>
            <Ionicons name="terminal" size={14} color="#8B949E" />
            <Text style={styles.customTriggerText}>Custom command</Text>
          </TouchableOpacity>

          <View style={styles.pill}>
            <View style={[styles.pillDot, { backgroundColor: isConnected ? '#4ADE80' : '#EF4444' }]} />
            <Text style={styles.pillText} numberOfLines={1}>
              {state.deviceLabel || 'VS Code'}
            </Text>
          </View>
        </View>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const MONO = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D1117', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0, paddingBottom: Platform.OS === 'android' ? 12 : 0 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: '#21262D',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#F0F6FC' },
  connRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  connDot: { width: 7, height: 7, borderRadius: 4 },
  connText: { fontSize: 12, fontWeight: '500' },
  headerBtns: { flexDirection: 'row', gap: 4 },
  hBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#161B22', borderWidth: 1, borderColor: '#21262D' },
  hBtnActive: { backgroundColor: '#1A2744', borderColor: '#3B82F640' },

  // Cmd chips
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#21262D' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#161B22', borderWidth: 1, borderColor: '#30363D', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { color: '#C9D1D9', fontSize: 12, fontWeight: '500' },

  // Custom cmd bar
  customBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: '#0A0F14',
    borderBottomWidth: 1, borderBottomColor: '#21262D',
  },
  prompt: { color: '#4ADE80', fontFamily: MONO, fontSize: 14, fontWeight: '700' },
  customInput: {
    flex: 1, backgroundColor: '#161B22', borderRadius: 8,
    borderWidth: 1, borderColor: '#30363D',
    paddingHorizontal: 10, paddingVertical: 7,
    color: '#F0F6FC', fontSize: 13, fontFamily: MONO,
  },
  sendBtn: { backgroundColor: '#2563EB', borderRadius: 8, width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },

  // Log area
  logArea: { flex: 1, backgroundColor: '#080C12' },
  logContent: { paddingHorizontal: 12, paddingVertical: 10, gap: 2 },
  logRow: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 1 },
  logRowError: { backgroundColor: '#1A0A0A', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, marginVertical: 1 },
  logTime: { color: '#4B5563', fontSize: 11, fontFamily: MONO },
  logText: { fontSize: 12, fontFamily: MONO, flexShrink: 1 },

  // States
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#080C12', paddingHorizontal: 32 },
  centerText: { color: '#8B949E', fontSize: 13, marginTop: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#30363D', marginTop: 6 },
  emptyText: { color: '#4B5563', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  refreshBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6,
    backgroundColor: '#161B22', borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 9,
    borderWidth: 1, borderColor: '#30363D',
  },
  refreshBtnText: { color: '#3B82F6', fontWeight: '600', fontSize: 13 },

  // Bottom bar
  bottomBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#0D1117', borderTopWidth: 1, borderTopColor: '#21262D',
    paddingHorizontal: 12, paddingVertical: 10,
  },
  ctrlcBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1.5, borderColor: '#EF4444', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#EF444412',
  },
  ctrlcText: { color: '#EF4444', fontWeight: '700', fontSize: 12 },
  customTrigger: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#161B22', borderWidth: 1, borderColor: '#30363D',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
  },
  customTriggerText: { color: '#8B949E', fontSize: 12, fontWeight: '500' },
  pill: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'flex-end' },
  pillDot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { color: '#8B949E', fontSize: 12 },
});
