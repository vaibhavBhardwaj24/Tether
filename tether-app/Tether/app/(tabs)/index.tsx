import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  StatusBar,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTether, AiState, OpenFile } from '@/store/tether-store';
import TetherLogo from '@/components/TetherLogo';
import WorkflowStepper from '@/components/WorkflowStepper';

const SHORTCUT_CHIPS = [
  'Fix errors',
  'Add tests',
  'Explain this',
  'Refactor',
  'Add types',
  'Optimise',
];

interface StatusConfig {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  bg: string;
  label: string;
  subtext: string;
}

const STATUS_CONFIG: Record<AiState, StatusConfig> = {
  idle:     { icon: 'pause-circle',     color: '#8B949E', bg: '#161B22', label: 'Ready',           subtext: 'Antigravity is standing by' },
  thinking: { icon: 'bulb',             color: '#A855F7', bg: '#2B1A3F', label: 'Thinking…',       subtext: 'AI is planning changes' },
  watching: { icon: 'eye',              color: '#3B82F6', bg: '#1A2744', label: 'Watching…',        subtext: 'Waiting for AI to start editing' },
  editing:  { icon: 'pencil',           color: '#F59E0B', bg: '#2A1F0A', label: 'Writing Code…',   subtext: 'AI is actively modifying files' },
  done:     { icon: 'checkmark-circle', color: '#22C55E', bg: '#0E2C1A', label: 'Done',             subtext: 'Changes are ready to review' },
};

export default function HomeScreen() {
  const router = useRouter();
  const { state, sendPrompt, acceptChanges, rejectChanges, getStatus, listOpenFiles, clearNotification } = useTether();
  const [promptText, setPromptText] = useState('');

  // Auto-clear notifications after 6 seconds
  useEffect(() => {
    if (state.lastNotification) {
      const timer = setTimeout(clearNotification, 6000);
      return () => clearTimeout(timer);
    }
  }, [state.lastNotification]);

  const [chatMode, setChatMode] = useState<'new' | 'existing'>('new');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isConnected = state.connectionStatus === 'connected';
  const statusCfg   = STATUS_CONFIG[state.aiState];
  const canAct      = state.aiState === 'done';
  const { editingFileCount, editingFiles } = state;

  // Count up a local elapsed timer while watching/editing/thinking
  useEffect(() => {
    if (state.aiState === 'thinking' || state.aiState === 'watching' || state.aiState === 'editing') {
      setElapsed(0);
      elapsedRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    } else {
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    }
    return () => { if (elapsedRef.current) clearInterval(elapsedRef.current); };
  }, [state.aiState]);

  // Poll status every 4s when connected (mirrors extension behaviour)
  useEffect(() => {
    if (!isConnected) return;
    getStatus();
    listOpenFiles();
    const id = setInterval(getStatus, 4000);
    return () => clearInterval(id);
  }, [isConnected]);

  // Derived open files with unique folder names if collision
  const displayFiles = React.useMemo(() => {
    const counts: Record<string, number> = {};
    if (state.openFiles && Array.isArray(state.openFiles)) {
       state.openFiles.forEach((f: any) => { 
         const name = typeof f === 'string' ? f : (f?.name || 'Unknown');
         counts[name] = (counts[name] || 0) + 1; 
       });
    }
    
    return (state.openFiles || []).map((rawF: any) => {
      // Backwards compatibility for string arrays during hot reload
      const f = typeof rawF === 'string' ? { name: rawF, path: rawF, displayName: rawF } : rawF;
      
      if (!f || !f.name) return { name: 'Unknown', path: 'Unknown', displayName: 'Unknown' };
      if (counts[f.name] > 1 && f.path) {
        const parts = f.path.split(/[\\/]/);
        const parent = parts.length > 1 ? parts[parts.length - 2] : '';
        return { ...f, displayName: parent ? `${parent}/${f.name}` : f.name };
      }
      return { ...f, displayName: f.name };
    });
  }, [state.openFiles]);

  const handleSend = () => {
    if (!promptText.trim() && selectedFiles.size === 0) return;
    
    let finalPrompt = promptText.trim();
    if (selectedFiles.size > 0) {
      const fileList = Array.from(selectedFiles).join('\n');
      finalPrompt = `${finalPrompt}\n\nFiles:\n${fileList}`.trim();
    }
    
    sendPrompt(finalPrompt, chatMode === 'new');
    setPromptText('');
    setSelectedFiles(new Set());
  };

  const fmtElapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  // Last diff info (from diffComplete event)
  const diff = state.lastDiff;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.logoBox}>
              <TetherLogo size={24} showBg={false} />
            </View>
            <Text style={styles.headerTitle}>Tether</Text>
          </View>
          <View style={[styles.connBadge, { backgroundColor: isConnected ? '#0E2C1A' : '#2A0E0E' }]}>
            <View style={[styles.connDot, { backgroundColor: isConnected ? '#22C55E' : '#EF4444' }]} />
            <Text style={[styles.connText, { color: isConnected ? '#22C55E' : '#EF4444' }]}>
              {isConnected ? 'Connected' : 'Disconnected'}
            </Text>
          </View>
        </View>

        {/* Workflow Stepper */}
        <WorkflowStepper aiState={state.aiState} />

        {/* Disconnected banner */}
        {!isConnected && (
          <View style={styles.banner}>
            <Ionicons name="wifi-outline" size={16} color="#EF4444" />
            <Text style={styles.bannerText}>Not connected to VS Code</Text>
            <TouchableOpacity style={styles.reconnectBtn} onPress={() => router.push('/connect')}>
              <Text style={styles.reconnectText}>Reconnect</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Notification toast */}
        {state.lastNotification && (
          <TouchableOpacity 
            style={[
              styles.toastCard,
              state.lastNotification.level === 'error' && styles.toastError,
              state.lastNotification.level === 'warn' && styles.toastWarn,
            ]}
            onPress={clearNotification}
          >
            <Ionicons
              name={state.lastNotification.level === 'error' ? 'alert-circle' : state.lastNotification.level === 'warn' ? 'warning' : 'information-circle'}
              size={16}
              color={state.lastNotification.level === 'error' ? '#EF4444' : state.lastNotification.level === 'warn' ? '#F59E0B' : '#3B82F6'}
            />
            <Text style={styles.toastText} numberOfLines={2}>{state.lastNotification.message}</Text>
            <Ionicons name="close" size={14} color="#8B949E" />
          </TouchableOpacity>
        )}

        {/* AI Status Card */}
        <View style={[styles.statusCard, { backgroundColor: statusCfg.bg, borderColor: statusCfg.color + '40' }]}>
          <View style={styles.statusTop}>
            <Ionicons name={statusCfg.icon} size={32} color={statusCfg.color} />
            <View style={styles.statusText}>
              <Text style={[styles.statusLabel, { color: statusCfg.color }]}>{statusCfg.label}</Text>
              <Text style={styles.statusSub}>{statusCfg.subtext}</Text>
            </View>
            {(state.aiState === 'thinking' || state.aiState === 'watching' || state.aiState === 'editing') && (
              <Text style={styles.elapsed}>{fmtElapsed(elapsed)}</Text>
            )}
          </View>

          {/* Live file edit counter — shown while editing */}
          {state.aiState === 'editing' && editingFileCount > 0 && (
            <View style={styles.filesRow}>
              <Ionicons name="document-text" size={13} color="#F59E0B" />
              <Text style={styles.filesLabel}>
                {editingFileCount} file{editingFileCount !== 1 ? 's' : ''} edited
              </Text>
              {editingFiles.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filesScroll}>
                  {editingFiles.map((f, i) => (
                    <View key={i} style={styles.fileChip}>
                      <Text style={styles.fileChipText}>{f}</Text>
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>
          )}

          {/* diffComplete details */}
          {state.aiState === 'done' && diff && (
            <View style={styles.diffRow}>
              <View style={styles.diffBadge}>
                <Ionicons name="time" size={13} color="#8B949E" />
                <Text style={styles.diffBadgeText}>{diff.totalSeconds.toFixed(1)}s</Text>
              </View>
              {(diff.fileCount ?? editingFileCount) > 0 && (
                <View style={styles.diffBadge}>
                  <Ionicons name="document-text" size={13} color="#8B949E" />
                  <Text style={styles.diffBadgeText}>{diff.fileCount ?? editingFileCount} file{(diff.fileCount ?? editingFileCount) !== 1 ? 's' : ''}</Text>
                </View>
              )}
              {diff.errorCount > 0 ? (
                <View style={[styles.diffBadge, styles.diffBadgeError]}>
                  <Ionicons name="warning" size={13} color="#F59E0B" />
                  <Text style={[styles.diffBadgeText, { color: '#F59E0B' }]}>{diff.errorCount} error{diff.errorCount !== 1 ? 's' : ''}</Text>
                </View>
              ) : (
                <View style={[styles.diffBadge, { backgroundColor: '#0E2C1A' }]}>
                  <Ionicons name="checkmark" size={13} color="#22C55E" />
                  <Text style={[styles.diffBadgeText, { color: '#22C55E' }]}>No errors</Text>
                </View>
              )}
            </View>
          )}

          {/* Accept / Reject */}
          {canAct && (
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.rejectBtn} onPress={rejectChanges}>
                <Ionicons name="close" size={16} color="#EF4444" />
                <Text style={styles.rejectText}>Reject All</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.acceptBtn} onPress={acceptChanges}>
                <Ionicons name="checkmark-done" size={16} color="#fff" />
                <Text style={styles.acceptText}>Accept All</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* View Diff */}
          {canAct && (
            <TouchableOpacity style={styles.viewDiffBtn} onPress={() => router.push('/review-changes')}>
              <Ionicons name="git-compare" size={14} color="#3B82F6" />
              <Text style={styles.viewDiffText}>View Diff</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Quick Send */}
        <View style={styles.quickCard}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Text style={[styles.sectionLabel, { marginBottom: 0 }]}>QUICK SEND</Text>
            <View style={styles.modeToggle}>
              <TouchableOpacity
                style={[styles.modeBtn, chatMode === 'new' && styles.modeBtnActive]}
                onPress={() => setChatMode('new')}
              >
                <Text style={[styles.modeBtnText, chatMode === 'new' && styles.modeBtnTextActive]}>New</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeBtn, chatMode === 'existing' && styles.modeBtnActive]}
                onPress={() => setChatMode('existing')}
              >
                <Text style={[styles.modeBtnText, chatMode === 'existing' && styles.modeBtnTextActive]}>Existing</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Selected Files Row */}
          {selectedFiles.size > 0 && (
            <View style={styles.selectedFilesRow}>
              {Array.from(selectedFiles).map(path => {
                const f = displayFiles.find(d => d.path === path);
                return (
                  <View key={path} style={styles.selectedFileChip}>
                    <Ionicons name="document-text" size={11} color="#3B82F6" style={{ marginRight: 4 }} />
                    <Text style={styles.selectedFileText}>{f?.displayName || path.split(/[\\/]/).pop()}</Text>
                    <TouchableOpacity onPress={() => {
                      const next = new Set(selectedFiles);
                      next.delete(path);
                      setSelectedFiles(next);
                    }} style={{ marginLeft: 6 }}>
                      <Ionicons name="close-circle" size={14} color="#3B82F6" />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}

          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={promptText}
              onChangeText={setPromptText}
              placeholder="Type a prompt..."
              placeholderTextColor="#8B949E"
              returnKeyType="send"
              onSubmitEditing={handleSend}
            />
            <TouchableOpacity
              style={[styles.sendBtn, !promptText.trim() && styles.sendBtnOff]}
              onPress={handleSend}
              disabled={!promptText.trim()}
            >
              <Ionicons name="send" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Open Files */}
        {displayFiles.length > 0 && (
          <View style={{ marginTop: 4, marginBottom: 12 }}>
            <Text style={[styles.sectionLabel, { paddingHorizontal: 16 }]}>OPEN FILES</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsWrap}>
              {displayFiles.map(f => {
                const isSelected = selectedFiles.has(f.path);
                return (
                  <TouchableOpacity
                    key={f.path}
                    style={[styles.chip, isSelected && styles.chipActive]}
                    onPress={() => {
                      const next = new Set(selectedFiles);
                      if (next.has(f.path)) next.delete(f.path);
                      else next.add(f.path);
                      setSelectedFiles(next);
                    }}
                  >
                    <Ionicons name="document-text" size={12} color={isSelected ? '#3B82F6' : '#8B949E'} style={styles.chipIcon} />
                    <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>{f.displayName}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Shortcut chips */}
        <Text style={[styles.sectionLabel, { paddingHorizontal: 16, marginTop: 4 }]}>SHORTCUTS</Text>
        <View style={styles.chipsWrap}>
          {SHORTCUT_CHIPS.map(chip => (
            <TouchableOpacity key={chip} style={styles.chip} onPress={() => setPromptText(chip)}>
              <Text style={styles.chipText}>{chip}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* History */}
        {state.history.length > 0 && (
          <View style={{ marginTop: 16 }}>
            <Text style={[styles.sectionLabel, { paddingHorizontal: 16 }]}>RECENT</Text>
            {state.history.slice(0, 3).map(entry => (
              <TouchableOpacity
                key={entry.id}
                style={styles.historyRow}
                onPress={() => setPromptText(entry.prompt)}
              >
                <Ionicons
                  name={entry.errorCount === 0 ? 'checkmark-circle' : 'warning'}
                  size={16}
                  color={entry.errorCount === 0 ? '#22C55E' : '#F59E0B'}
                />
                <Text style={styles.historyText} numberOfLines={1}>{entry.prompt}</Text>
                <Text style={styles.historyTime}>
                  {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D1117', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  scrollContent: { paddingBottom: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoBox: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#0F1829', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#F0F6FC' },
  connBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  connDot: { width: 7, height: 7, borderRadius: 4 },
  connText: { fontSize: 12, fontWeight: '600' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#2A0E0E', borderWidth: 1, borderColor: '#EF444440', marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: 10 },
  bannerText: { flex: 1, color: '#EF9999', fontSize: 13 },
  reconnectBtn: { backgroundColor: '#EF4444', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  reconnectText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  toastCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#1A2744', borderWidth: 1, borderColor: '#3B82F640', marginHorizontal: 16, marginBottom: 10, padding: 12, borderRadius: 10 },
  toastError: { backgroundColor: '#2A0E0E', borderColor: '#EF444440' },
  toastWarn: { backgroundColor: '#2A1F0A', borderColor: '#F59E0B40' },
  toastText: { flex: 1, color: '#C9D1D9', fontSize: 13, lineHeight: 18 },
  statusCard: { marginHorizontal: 16, borderRadius: 16, padding: 20, borderWidth: 1, marginBottom: 16, gap: 14 },
  statusTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  statusText: { flex: 1 },
  statusLabel: { fontSize: 18, fontWeight: '700' },
  statusSub: { fontSize: 13, color: '#8B949E', marginTop: 2 },
  elapsed: { fontSize: 18, fontWeight: '700', color: '#8B949E' },
  diffRow: { flexDirection: 'row', gap: 8 },
  diffBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#21262D', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  diffBadgeError: { backgroundColor: '#2A1F0A' },
  diffBadgeText: { color: '#8B949E', fontSize: 12, fontWeight: '600' },
  actionRow: { flexDirection: 'row', gap: 10 },
  rejectBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderColor: '#EF4444', borderRadius: 10, paddingVertical: 12, backgroundColor: '#EF444415' },
  rejectText: { color: '#EF4444', fontWeight: '700', fontSize: 15 },
  acceptBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#2563EB', borderRadius: 10, paddingVertical: 12 },
  acceptText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  viewDiffBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  viewDiffText: { color: '#3B82F6', fontWeight: '600', fontSize: 13 },
  quickCard: { marginHorizontal: 16, backgroundColor: '#161B22', borderRadius: 14, borderWidth: 1, borderColor: '#30363D', padding: 14, marginBottom: 16 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#8B949E', letterSpacing: 1, marginBottom: 10 },
  inputRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#0D1117', borderRadius: 10, borderWidth: 1, borderColor: '#30363D', paddingHorizontal: 14, paddingVertical: 10, color: '#F0F6FC', fontSize: 14 },
  sendBtn: { backgroundColor: '#2563EB', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { opacity: 0.4 },
  selectedFilesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  selectedFileChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A2744', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: '#3B82F640' },
  selectedFileText: { fontSize: 11, color: '#3B82F6', fontWeight: '500' },
  chipsWrap: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  chip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#161B22', borderWidth: 1, borderColor: '#30363D', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { backgroundColor: '#1A2744', borderColor: '#3B82F680' },
  chipIcon: { marginRight: 4 },
  chipText: { color: '#8B949E', fontSize: 13, fontWeight: '500' },
  chipTextActive: { color: '#3B82F6' },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#21262D' },
  historyText: { flex: 1, color: '#C9D1D9', fontSize: 13 },
  historyTime: { color: '#8B949E', fontSize: 12 },
  modeToggle: { flexDirection: 'row', backgroundColor: '#0D1117', borderRadius: 8, padding: 2, borderWidth: 1, borderColor: '#30363D' },
  modeBtn: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 6 },
  modeBtnActive: { backgroundColor: '#1A2744' },
  modeBtnText: { color: '#8B949E', fontSize: 11, fontWeight: '600' },
  modeBtnTextActive: { color: '#3B82F6', fontWeight: '700' },
  // Live file edit tracker
  filesRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'nowrap' },
  filesLabel: { fontSize: 12, fontWeight: '700', color: '#F59E0B', flexShrink: 0 },
  filesScroll: { flex: 1 },
  fileChip: { backgroundColor: '#2A1F0A', borderWidth: 1, borderColor: '#F59E0B40', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginRight: 6 },
  fileChipText: { fontSize: 11, color: '#F59E0B', fontWeight: '500' },
});
