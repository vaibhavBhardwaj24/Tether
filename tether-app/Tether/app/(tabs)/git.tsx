import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Platform,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTether } from '@/store/tether-store';

type GitTab = 'Changes' | 'Commits';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const EXT_ICONS: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  '.tsx': { icon: 'logo-react',      color: '#61DAFB' },
  '.ts':  { icon: 'code-slash',      color: '#3178C6' },
  '.js':  { icon: 'logo-javascript', color: '#F7DF1E' },
  '.css': { icon: 'color-palette',   color: '#E44D26' },
  '.json':{ icon: 'document-text',   color: '#F59E0B' },
  '.md':  { icon: 'book',            color: '#3B82F6' },
};

function getFileIcon(path: string) {
  const ext = '.' + path.split('.').pop()?.toLowerCase();
  return EXT_ICONS[ext] ?? { icon: 'document', color: '#8B949E' };
}

function parseStatus(raw: string) {
  if (!raw || !raw.trim()) return [];
  const lines = raw.split('\n').filter(l => l.trim().length > 0);
  return lines.map((line, i) => {
    // Standard porcelain: "XY path"
    const code = line.substring(0, 2);
    // Path starts at index 3 in porcelain -s, but let's be flexible
    const path = line.substring(2).trim().replace(/"/g, '');
    
    let statusText = 'Modified';
    const c = code.trim();
    if (c === '??') statusText = 'Untracked';
    else if (c === 'A')  statusText = 'Added';
    else if (c === 'D')  statusText = 'Deleted';
    else if (c === 'R')  statusText = 'Renamed';
    else if (c === 'M')  statusText = 'Modified';

    return { path, statusText, code, id: `${path}-${i}` };
  });
}

function parseLog(raw: string) {
  const lines = raw.split('\n').filter(Boolean);
  return lines.map((line, i) => {
    const parts = line.split('|');
    return {
      id: String(i),
      hash: parts[0] || '',
      time: parts[1] || '',
      message: parts.slice(2).join('|') || '',
    };
  });
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  Modified:  { bg: '#1A2744', text: '#3B82F6' },
  Added:     { bg: '#0E2C1A', text: '#22C55E' },
  Untracked: { bg: '#2A1F0A', text: '#F59E0B' },
  Deleted:   { bg: '#2A0E0E', text: '#EF4444' },
  Renamed:   { bg: '#2B1A3F', text: '#A855F7' },
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function GitScreen() {
  const router = useRouter();
  const { state, runShell, getGitStatus, isWsReady } = useTether();
  const [activeTab, setActiveTab] = useState<GitTab>('Changes');
  const [checkedFiles, setCheckedFiles] = useState<Record<string, boolean>>({});
  const [commitMsg, setCommitMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  // Auto-fetch on mount
  useEffect(() => {
    if (isWsReady()) {
      setLoading(true);
      getGitStatus();
    }
  }, [isWsReady]);

  // When git status arrives, stop loading
  useEffect(() => {
    setLoading(false);
    // git status received
  }, [state.lastGitStatus]);

  const lastResult = state.lastShellResult;
  useEffect(() => {
    if (!lastResult) return;
    if (lastResult.cmd.startsWith('git commit') || lastResult.cmd.startsWith('git add') || lastResult.cmd.startsWith('git push') || lastResult.cmd.startsWith('git pull')) {
      setPushing(false);
      getGitStatus(); // Refresh everything
    }
  }, [lastResult]);

  // Derivations
  const gitData = state.lastGitStatus || { branch: '', status: '', logRaw: '', repoName: '' };
  
  const files = useMemo(() => parseStatus(gitData.status), [gitData.status]);
  const commits = useMemo(() => parseLog(gitData.logRaw), [gitData.logRaw]);
  const repoName = gitData.repoName || 'Unknown Repo';
  const branch = gitData.branch || 'Unknown Branch';

  const modifiedCount = files.filter(f => f.statusText === 'Modified').length;
  const addedCount    = files.filter(f => f.statusText === 'Added' || f.statusText === 'Untracked').length;
  const deletedCount  = files.filter(f => f.statusText === 'Deleted').length;

  // Actions
  const handleRefresh = useCallback(() => {
    setLoading(true);
    getGitStatus();
    // Safety
    setTimeout(() => setLoading(false), 3000);
  }, [getGitStatus]);

  const handleCommit = () => {
    if (!commitMsg.trim() || !isWsReady()) return;
    setPushing(true);
    const activePaths = files.filter(f => checkedFiles[f.path]).map(f => `"${f.path}"`);
    
    if (activePaths.length === 0) {
      // Commit all if none explicitly checked (standard behavior when checkboxes are ignored)
      runShell(`git add . && git commit -m "${commitMsg.replace(/"/g, '\\"')}"`);
    } else {
      // Commit only checked
      const addCmd = activePaths.join(' ');
      runShell(`git add ${addCmd} && git commit -m "${commitMsg.replace(/"/g, '\\"')}"`);
    }
    setCommitMsg('');
  };

  const handlePush = () => {
    if (!isWsReady()) return;
    setPushing(true);
    runShell(`git push origin ${branch}`);
  };

  const handlePull = () => {
    if (!isWsReady()) return;
    setPushing(true);
    runShell(`git pull origin ${branch}`);
  };

  const toggleFile = (path: string) =>
    setCheckedFiles(prev => ({ ...prev, [path]: !prev[path] }));

  const selectAll = () => {
    const next: Record<string, boolean> = {};
    files.forEach(f => next[f.path] = true);
    setCheckedFiles(next);
  };

  const deselectAll = () => setCheckedFiles({});

  const allChecked = files.length > 0 && files.every(f => checkedFiles[f.path]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color="#F0F6FC" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Git Version Control</Text>
        <TouchableOpacity style={styles.iconBtn} onPress={handleRefresh}>
          {loading ? <ActivityIndicator size="small" color="#3B82F6" /> : <Ionicons name="refresh" size={20} color="#8B949E" />}
        </TouchableOpacity>
      </View>

      {/* ── Tabs ── */}
      <View style={styles.tabBar}>
        {(['Changes', 'Commits'] as GitTab[]).map(tab => (
          <TouchableOpacity key={tab} style={styles.tab} onPress={() => setActiveTab(tab)}>
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab}</Text>
            {activeTab === tab && <View style={styles.tabLine} />}
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>

        {/* ── CHANGES TAB ── */}
        {activeTab === 'Changes' && (
          <>
            <View style={styles.branchCard}>
              <View style={styles.branchIconBox}>
                <Ionicons name="git-branch" size={20} color="#3B82F6" />
              </View>
              <View style={styles.branchInfo}>
                <Text style={styles.branchName} numberOfLines={1}>{branch}</Text>
                <Text style={styles.branchTime}>{repoName}</Text>
              </View>
            </View>

            <View style={styles.statsRow}>
              {[
                { label: 'MODIFIED', num: modifiedCount, bg: '#1A2744', color: '#3B82F6' },
                { label: 'ADDED',    num: addedCount,    bg: '#0E2C1A', color: '#22C55E' },
                { label: 'DELETED',  num: deletedCount,  bg: '#2A0E0E', color: '#EF4444' },
              ].map(s => (
                <View key={s.label} style={[styles.statBox, { backgroundColor: s.bg }]}>
                  <Text style={[styles.statLabel, { color: s.color }]}>{s.label}</Text>
                  <Text style={[styles.statNum, { color: s.color }]}>{s.num}</Text>
                </View>
              ))}
            </View>

            {/* Commit Section */}
            <View style={styles.commitSection}>
              <View style={styles.commitHeader}>
                <Ionicons name="git-commit" size={18} color="#3B82F6" />
                <Text style={styles.commitTitle}>Commit Changes</Text>
              </View>
              <TextInput
                style={styles.commitInput}
                value={commitMsg}
                onChangeText={setCommitMsg}
                placeholder="Commit message..."
                placeholderTextColor="#8B949E"
              />
              <View style={styles.commitBtns}>
                <TouchableOpacity
                  style={[styles.commitBtn, (!commitMsg.trim() || files.length === 0 || pushing) && { opacity: 0.5 }]}
                  onPress={handleCommit}
                  disabled={!commitMsg.trim() || files.length === 0 || pushing}
                >
                  {pushing ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="checkmark-circle" size={15} color="#fff" />}
                  <Text style={styles.commitBtnText}>Commit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.pushBtn} onPress={handlePull} disabled={pushing}>
                  <Ionicons name="cloud-download" size={15} color="#C9D1D9" />
                  <Text style={styles.pushBtnText}>Pull</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.pushBtn} onPress={handlePush} disabled={pushing}>
                  <Ionicons name="cloud-upload" size={15} color="#C9D1D9" />
                  <Text style={styles.pushBtnText}>Push</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Changed Files */}
            <View style={styles.sectionRow}>
              <Text style={styles.sectionLabel}>CHANGED FILES ({files.length})</Text>
              {files.length > 0 && (
                <TouchableOpacity onPress={allChecked ? deselectAll : selectAll}>
                  <Text style={styles.selectAll}>{allChecked ? 'Deselect All' : 'Select All'}</Text>
                </TouchableOpacity>
              )}
            </View>

            {files.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="checkmark-done-circle" size={40} color="#21262D" />
                <Text style={styles.emptyText}>Working tree clean</Text>
              </View>
            ) : (
              files.map(file => {
                const sc = STATUS_COLORS[file.statusText] || STATUS_COLORS.Modified;
                const fi = getFileIcon(file.path);
                const checked = checkedFiles[file.path] !== false; // checked by default if undefined
                
                return (
                  <TouchableOpacity
                    key={file.id}
                    style={styles.fileRow}
                    onPress={() => toggleFile(file.path)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                      {checked && <Ionicons name="checkmark" size={12} color="#fff" />}
                    </View>
                    <Ionicons name={fi.icon} size={16} color={fi.color} />
                    <Text style={styles.filePath} numberOfLines={1}>{file.path}</Text>
                    <View style={[styles.diffPill, { backgroundColor: sc.bg }]}>
                      <Text style={[styles.diffPillText, { color: sc.text }]}>{file.code.trim()}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}

            <TouchableOpacity style={styles.viewDiffBtn} onPress={() => router.push('/review-changes')}>
              <Ionicons name="git-compare" size={16} color="#3B82F6" />
              <Text style={styles.viewDiffText}>Review Pending Diff</Text>
              <Ionicons name="chevron-forward" size={16} color="#3B82F6" />
            </TouchableOpacity>
          </>
        )}

        {/* ── COMMITS TAB ── */}
        {activeTab === 'Commits' && (
          <View style={{ paddingTop: 8 }}>
            <Text style={styles.sectionLabel}>RECENT COMMITS</Text>
            {commits.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No commits found</Text>
              </View>
            ) : (
              commits.map(c => (
                <View key={c.hash + c.id} style={styles.commitRow}>
                  <View style={styles.commitIconBox}>
                    <Ionicons name="time" size={15} color="#8B949E" />
                  </View>
                  <View style={styles.commitRowInfo}>
                    <Text style={styles.commitRowMsg}>{c.message}</Text>
                    <Text style={styles.commitRowMeta}>{c.time} · {c.hash}</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {/* Debug info if requested */}
        {showDebug && (
          <View style={styles.debugCard}>
            <View style={styles.debugHeader}>
              <Text style={styles.debugTitle}>RAW GIT STATUS</Text>
              <TouchableOpacity onPress={() => setShowDebug(false)}>
                <Ionicons name="close-circle" size={16} color="#8B949E" />
              </TouchableOpacity>
            </View>
            <ScrollView horizontal style={{ maxHeight: 200 }}>
              <Text style={styles.debugText}>{gitData.status || '(Empty status - everything clean?)'}</Text>
            </ScrollView>
          </View>
        )}

        {!showDebug && (
          <TouchableOpacity style={styles.debugToggle} onPress={() => setShowDebug(true)}>
            <Text style={styles.debugToggleText}>Show Debug Logs</Text>
          </TouchableOpacity>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D1117', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0, paddingBottom: Platform.OS === 'android' ? 12 : 0 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingTop: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#21262D' },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#F0F6FC' },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#21262D' },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12, position: 'relative' },
  tabText: { fontSize: 14, fontWeight: '600', color: '#8B949E' },
  tabTextActive: { color: '#3B82F6' },
  tabLine: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, backgroundColor: '#3B82F6', borderRadius: 1 },
  content: { padding: 14, paddingBottom: 32 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#8B949E', letterSpacing: 1, marginBottom: 8 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, marginTop: 16 },
  selectAll: { color: '#3B82F6', fontSize: 13, fontWeight: '600' },
  branchCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#161B22', borderRadius: 12, borderWidth: 1, borderColor: '#30363D', padding: 14, gap: 12, marginBottom: 16 },
  branchIconBox: { width: 36, height: 36, borderRadius: 8, backgroundColor: '#1A2744', alignItems: 'center', justifyContent: 'center' },
  branchInfo: { flex: 1 },
  branchName: { color: '#e2e8f0', fontSize: 14, fontWeight: '700' },
  branchTime: { color: '#8B949E', fontSize: 12, marginTop: 2 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  statBox: { flex: 1, borderRadius: 10, padding: 12, alignItems: 'center' },
  statLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  statNum: { fontSize: 24, fontWeight: '800', marginTop: 4 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#161B22', borderRadius: 10, borderWidth: 1, borderColor: '#30363D', padding: 12, marginBottom: 6 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: '#30363D', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0D1117' },
  checkboxOn: { backgroundColor: '#3B82F6', borderColor: '#3B82F6' },
  filePath: { flex: 1, color: '#C9D1D9', fontSize: 13 },
  diffPill: { minWidth: 26, paddingHorizontal: 6, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  diffPillText: { fontSize: 12, fontWeight: '800', fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  commitSection: { backgroundColor: '#161B22', borderRadius: 12, borderWidth: 1, borderColor: '#30363D', padding: 14, gap: 12 },
  commitHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  commitTitle: { fontSize: 15, fontWeight: '700', color: '#F0F6FC' },
  commitInput: { backgroundColor: '#0D1117', borderRadius: 8, borderWidth: 1, borderColor: '#30363D', padding: 12, color: '#F0F6FC', fontSize: 14 },
  commitBtns: { flexDirection: 'row', gap: 10 },
  commitBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#2563EB', borderRadius: 8, paddingVertical: 12 },
  commitBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  pushBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#21262D', borderRadius: 8, paddingVertical: 12 },
  pushBtnText: { color: '#C9D1D9', fontWeight: '700', fontSize: 14 },
  commitRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#21262D' },
  commitIconBox: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#21262D', alignItems: 'center', justifyContent: 'center' },
  commitRowInfo: { flex: 1 },
  commitRowMsg: { color: '#C9D1D9', fontSize: 14, fontWeight: '500' },
  commitRowMeta: { color: '#8B949E', fontSize: 12, marginTop: 4 },
  viewDiffBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#1A2744', borderWidth: 1, borderColor: '#3B82F630', borderRadius: 10, padding: 14, marginTop: 16, justifyContent: 'center' },
  viewDiffText: { color: '#3B82F6', fontWeight: '600', fontSize: 14, flex: 1, textAlign: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  emptyText: { color: '#8B949E', fontSize: 14 },
  debugCard: { backgroundColor: '#050A0F', borderRadius: 10, padding: 12, marginTop: 24, borderWidth: 1, borderColor: '#21262D' },
  debugHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  debugTitle: { color: '#F87171', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  debugText: { color: '#8B949E', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  debugToggle: { padding: 16, alignItems: 'center' },
  debugToggleText: { color: '#30363D', fontSize: 11, fontWeight: '600' },
});
