import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Platform,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTether } from '@/store/tether-store';

// ─── Diff parsing ──────────────────────────────────────────────────────────────

type DiffLine = {
  oldNum?: number;
  newNum?: number;
  type: 'added' | 'deleted' | 'context' | 'hunk';
  content: string;
};

type DiffFile = {
  name: string;
  path: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
};

/** Parse a raw unified-diff string into per-file structures */
function parseUnifiedDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  if (!raw || raw === '(no diff found)') return files;

  const lines = raw.split('\n');
  let current: DiffFile | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    // New file block
    if (line.startsWith('diff --git ')) {
      // extract path from `diff --git a/path b/path`
      const match = line.match(/diff --git a\/.+ b\/(.+)/);
      const path = match ? match[1] : line.replace('diff --git ', '');
      const name = path.split(/[\\/]/).pop() ?? path;
      current = { name, path, additions: 0, deletions: 0, lines: [] };
      files.push(current);
      oldLine = 0;
      newLine = 0;
      continue;
    }
    if (!current) continue;

    // Skip index / --- / +++ header lines
    if (
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('Binary ') ||
      line.startsWith('new file ') ||
      line.startsWith('deleted file ') ||
      line.startsWith('similarity ') ||
      line.startsWith('rename ')
    ) {
      continue;
    }

    // Hunk header e.g. @@ -12,7 +12,10 @@
    if (line.startsWith('@@')) {
      const hunkMatch = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkMatch) {
        oldLine = parseInt(hunkMatch[1], 10);
        newLine = parseInt(hunkMatch[2], 10);
      }
      current.lines.push({ type: 'hunk', content: line });
      continue;
    }

    if (line.startsWith('+')) {
      current.lines.push({ newNum: newLine++, type: 'added', content: line.slice(1) });
      current.additions++;
    } else if (line.startsWith('-')) {
      current.lines.push({ oldNum: oldLine++, type: 'deleted', content: line.slice(1) });
      current.deletions++;
    } else if (line.startsWith(' ') || line === '') {
      current.lines.push({ oldNum: oldLine++, newNum: newLine++, type: 'context', content: line.slice(1) });
    }
  }

  return files;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ReviewChangesScreen() {
  const router = useRouter();
  const { state, acceptChanges, rejectChanges, getDiff } = useTether();
  const [activeFileIdx, setActiveFileIdx] = useState(0);
  const [loading, setLoading] = useState(true);

  // Request diff on mount
  useEffect(() => {
    getDiff();
    // Give the extension 5s to respond; after that stop spinner regardless
    const t = setTimeout(() => setLoading(false), 5000);
    return () => clearTimeout(t);
  }, []);

  // When diffContent arrives, stop loading
  useEffect(() => {
    if (state.diffContent !== null) {
      setLoading(false);
    }
  }, [state.diffContent]);

  const diffFiles = React.useMemo(
    () => parseUnifiedDiff(state.diffContent ?? ''),
    [state.diffContent]
  );

  const totalAdditions = diffFiles.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = diffFiles.reduce((s, f) => s + f.deletions, 0);

  const activeFile = diffFiles[activeFileIdx] ?? null;

  const handleAcceptAll = () => {
    acceptChanges();
    router.back();
  };

  const handleRejectAll = () => {
    rejectChanges();
    router.back();
  };

  const renderDiffLine = (line: DiffLine, index: number) => {
    if (line.type === 'hunk') {
      return (
        <View key={index} style={styles.hunkLine}>
          <Text style={styles.hunkText} numberOfLines={1}>{line.content}</Text>
        </View>
      );
    }

    const isAdded = line.type === 'added';
    const isDeleted = line.type === 'deleted';

    return (
      <View
        key={index}
        style={[
          styles.diffLine,
          isAdded && styles.diffLineAdded,
          isDeleted && styles.diffLineDeleted,
        ]}
      >
        {/* Line numbers */}
        <View style={styles.lineNums}>
          <Text style={styles.lineNum}>{line.oldNum ?? ''}</Text>
          <Text style={styles.lineNum}>{line.newNum ?? ''}</Text>
        </View>
        {/* Strip indicator */}
        {isAdded && <View style={styles.addedStrip} />}
        {isDeleted && <View style={styles.deletedStrip} />}
        {!isAdded && !isDeleted && <View style={styles.contextStrip} />}
        {/* Code */}
        <Text
          style={[
            styles.diffCode,
            isAdded && styles.diffCodeAdded,
            isDeleted && styles.diffCodeDeleted,
          ]}
          numberOfLines={1}
        >
          {isAdded ? '+' : isDeleted ? '-' : ' '}{line.content}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}>
          <Ionicons name="close" size={24} color="#F0F6FC" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Review Changes</Text>
        <TouchableOpacity style={styles.iconBtn} onPress={() => { setLoading(true); getDiff(); }}>
          <Ionicons name="refresh" size={20} color="#8B949E" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Fetching diff from VS Code…</Text>
        </View>
      ) : diffFiles.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="git-compare-outline" size={48} color="#30363D" />
          <Text style={styles.emptyTitle}>No pending changes found</Text>
          <Text style={styles.emptySubtitle}>
            Antigravity's pending edits may not be visible yet.{'\n\n'}
            <Text style={{ color: '#F59E0B' }}>Try:</Text>
            {'\n'}• Open the Antigravity chat panel in VS Code{'\n'}
            • Make sure VS Code is open and the extension is running{'\n'}
            • If AI is still working, wait for it to finish
          </Text>
          <TouchableOpacity style={styles.refreshBtn} onPress={() => { setLoading(true); getDiff(); }}>
            <Ionicons name="refresh" size={16} color="#3B82F6" />
            <Text style={styles.refreshBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {/* Summary badges */}
          <View style={styles.summaryRow}>
            <View style={styles.additionsBadge}>
              <Ionicons name="add-circle" size={18} color="#22C55E" />
              <Text style={styles.additionsText}>+{totalAdditions} additions</Text>
            </View>
            <View style={styles.deletionsBadge}>
              <Ionicons name="remove-circle" size={18} color="#EF4444" />
              <Text style={styles.deletionsText}>-{totalDeletions} deletions</Text>
            </View>
          </View>

          {/* File tabs */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.fileTabs}
            contentContainerStyle={styles.fileTabsContent}
          >
            {diffFiles.map((file, idx) => (
              <TouchableOpacity
                key={file.path}
                style={styles.fileTab}
                onPress={() => setActiveFileIdx(idx)}
              >
                <Text style={[styles.fileTabText, idx === activeFileIdx && styles.fileTabTextActive]}>
                  {file.name}
                  {' '}
                  <Text style={styles.fileTabStats}>
                    +{file.additions} -{file.deletions}
                  </Text>
                </Text>
                {idx === activeFileIdx && <View style={styles.fileTabUnderline} />}
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* File path */}
          {activeFile && (
            <View style={styles.fileHeader}>
              <Ionicons name="document-text" size={16} color="#8B949E" />
              <Text style={styles.filePath}>{activeFile.path}</Text>
            </View>
          )}

          {/* Diff view */}
          <ScrollView
            style={styles.diffView}
            showsVerticalScrollIndicator={false}
          >
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View>
                {activeFile?.lines.map(renderDiffLine)}
              </View>
            </ScrollView>
          </ScrollView>
        </>
      )}

      {/* Bottom actions — always visible */}
      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.rejectAllBtn} onPress={handleRejectAll}>
          <Ionicons name="close" size={18} color="#C9D1D9" />
          <Text style={styles.rejectAllText}>Reject All</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.acceptAllBtn} onPress={handleAcceptAll}>
          <Ionicons name="checkmark-done" size={18} color="#fff" />
          <Text style={styles.acceptAllText}>Accept All</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D1117', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#21262D',
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#F0F6FC' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { color: '#8B949E', fontSize: 14 },
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#C9D1D9', marginTop: 8 },
  emptySubtitle: { color: '#8B949E', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: '#161B22', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderColor: '#30363D' },
  refreshBtnText: { color: '#3B82F6', fontWeight: '600', fontSize: 14 },
  summaryRow: { flexDirection: 'row', gap: 12, padding: 16, paddingBottom: 8 },
  additionsBadge: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#0E2C1A', borderRadius: 10, padding: 12 },
  additionsText: { color: '#22C55E', fontWeight: '700', fontSize: 14 },
  deletionsBadge: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#2A0E0E', borderRadius: 10, padding: 12 },
  deletionsText: { color: '#EF4444', fontWeight: '700', fontSize: 14 },
  fileTabs: { borderBottomWidth: 1, borderBottomColor: '#21262D', maxHeight: 44 },
  fileTabsContent: { paddingHorizontal: 16, gap: 8, alignItems: 'flex-end' },
  fileTab: { paddingHorizontal: 4, paddingBottom: 10, position: 'relative', marginRight: 16 },
  fileTabText: { color: '#8B949E', fontSize: 13, fontWeight: '500' },
  fileTabTextActive: { color: '#3B82F6', fontWeight: '700' },
  fileTabStats: { fontSize: 11, fontWeight: '400' },
  fileTabUnderline: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, backgroundColor: '#3B82F6', borderRadius: 1 },
  fileHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#21262D', backgroundColor: '#0D1117' },
  filePath: { flex: 1, color: '#C9D1D9', fontSize: 13 },
  diffView: { flex: 1, backgroundColor: '#0D1117' },
  hunkLine: { backgroundColor: '#1C2A4A', paddingHorizontal: 8, paddingVertical: 3 },
  hunkText: { color: '#3B82F6', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  diffLine: { flexDirection: 'row', alignItems: 'center', minHeight: 26, borderBottomWidth: 0.5, borderBottomColor: '#21262D10' },
  diffLineAdded: { backgroundColor: '#0D2818' },
  diffLineDeleted: { backgroundColor: '#2A0E0E' },
  lineNums: { flexDirection: 'row', width: 60, paddingHorizontal: 4 },
  lineNum: { width: 28, color: '#8B949E', fontSize: 11, textAlign: 'right', fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  addedStrip: { width: 3, alignSelf: 'stretch', backgroundColor: '#22C55E', marginRight: 6 },
  deletedStrip: { width: 3, alignSelf: 'stretch', backgroundColor: '#EF4444', marginRight: 6 },
  contextStrip: { width: 3, alignSelf: 'stretch', backgroundColor: 'transparent', marginRight: 6 },
  diffCode: { fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', color: '#C9D1D9', paddingRight: 16, paddingVertical: 3 },
  diffCodeAdded: { color: '#86EFAC' },
  diffCodeDeleted: { color: '#FCA5A5' },
  bottomBar: { flexDirection: 'row', gap: 12, padding: 16, borderTopWidth: 1, borderTopColor: '#21262D', backgroundColor: '#0D1117' },
  rejectAllBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#21262D', borderRadius: 14, paddingVertical: 16 },
  rejectAllText: { color: '#C9D1D9', fontWeight: '700', fontSize: 15 },
  acceptAllBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#2563EB', borderRadius: 14, paddingVertical: 16 },
  acceptAllText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
