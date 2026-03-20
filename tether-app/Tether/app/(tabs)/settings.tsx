import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  Alert,
  Platform,
  StatusBar,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTether } from '@/store/tether-store';

export default function SettingsScreen() {
  const router = useRouter();
  const { state, disconnect, dispatch, ping } = useTether();
  const [relayUrl, setRelayUrl] = useState(state.relayUrl);
  const [deviceLabel, setDeviceLabel] = useState(state.deviceLabel);
  const [notifDone, setNotifDone] = useState(true);
  const [notifEditing, setNotifEditing] = useState(false);
  const [notifDisconnect, setNotifDisconnect] = useState(true);

  const handleSaveRelay = () => {
    dispatch({ type: 'SET_RELAY_URL', url: relayUrl });
  };

  const handleClearHistory = () => {
    Alert.alert(
      'Clear History',
      'This will delete all prompt history from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => dispatch({ type: 'CLEAR_HISTORY' }) },
      ]
    );
  };

  const handleUnpair = () => {
    Alert.alert(
      'Disconnect',
      'This will disconnect from the VS Code extension.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: () => {
          disconnect();
          router.replace('/connect');
        }},
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Connection */}
        <Text style={styles.sectionLabel}>CONNECTION</Text>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Relay Server URL</Text>
          <TextInput
            style={styles.input}
            value={relayUrl}
            onChangeText={setRelayUrl}
            onBlur={handleSaveRelay}
            placeholder="ws://localhost:3000/ws"
            placeholderTextColor="#8B949E"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Device Label</Text>
          <TextInput
            style={styles.input}
            value={deviceLabel}
            onChangeText={setDeviceLabel}
            onBlur={() => dispatch({ type: 'SET_DEVICE_LABEL', label: deviceLabel })}
            placeholder="My VS Code"
            placeholderTextColor="#8B949E"
          />
        </View>

        {/* Notifications */}
        <Text style={styles.sectionLabel}>NOTIFICATIONS</Text>
        <View style={styles.card}>
          {[
            { label: 'Done (no errors)', value: notifDone, onChange: setNotifDone },
            { label: 'Writing code (editing)', value: notifEditing, onChange: setNotifEditing },
            { label: 'Disconnected', value: notifDisconnect, onChange: setNotifDisconnect },
          ].map(item => (
            <View key={item.label} style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>{item.label}</Text>
              <Switch
                value={item.value}
                onValueChange={item.onChange}
                trackColor={{ false: '#30363D', true: '#2563EB' }}
                thumbColor="#fff"
              />
            </View>
          ))}
        </View>

        {/* Data */}
        <Text style={styles.sectionLabel}>DATA</Text>
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Prompt history</Text>
            <Text style={styles.infoValue}>{state.history.length} entries</Text>
          </View>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.actionRow} onPress={handleClearHistory}>
            <Ionicons name="trash" size={16} color="#EF4444" />
            <Text style={styles.actionTextRed}>Clear History</Text>
          </TouchableOpacity>
        </View>

        {/* About */}
        <Text style={styles.sectionLabel}>ABOUT</Text>
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>App Version</Text>
            <Text style={styles.infoValue}>1.0.0</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Expo SDK</Text>
            <Text style={styles.infoValue}>54.0</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Status</Text>
            <Text style={[
              styles.infoValue,
              { color: state.connectionStatus === 'connected' ? '#22C55E' : '#EF4444' }
            ]}>
              {state.connectionStatus === 'connected' ? 'Connected' : 'Disconnected'}
            </Text>
          </View>
        </View>

        {/* Test Connection */}
        <TouchableOpacity
          style={[styles.testBtn, state.connectionStatus !== 'connected' && { opacity: 0.4 }]}
          onPress={ping}
          disabled={state.connectionStatus !== 'connected'}
        >
          <Ionicons name="pulse" size={18} color="#3B82F6" />
          <Text style={styles.testBtnText}>Test Connection (ping)</Text>
        </TouchableOpacity>

        {/* Disconnect */}
        <TouchableOpacity style={styles.disconnectBtn} onPress={handleUnpair}>
          <Ionicons name="log-out" size={18} color="#EF4444" />
          <Text style={styles.disconnectText}>Disconnect & Unpair</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D1117', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0, paddingBottom: Platform.OS === 'android' ? 12 : 0 },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#21262D',
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#F0F6FC' },
  scrollContent: { padding: 16, paddingBottom: 40, gap: 8 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8B949E',
    letterSpacing: 1,
    marginTop: 12,
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#161B22',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#30363D',
    padding: 14,
    gap: 10,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8B949E',
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#0D1117',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#30363D',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#F0F6FC',
    fontSize: 14,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  toggleLabel: { color: '#C9D1D9', fontSize: 14 },
  divider: { height: 1, backgroundColor: '#21262D' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  infoLabel: { color: '#C9D1D9', fontSize: 14 },
  infoValue: { color: '#8B949E', fontSize: 14, fontWeight: '500' },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  actionTextRed: { color: '#EF4444', fontSize: 14, fontWeight: '600' },
  testBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderColor: '#3B82F6',
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
    backgroundColor: '#1A2744',
  },
  testBtnText: { color: '#3B82F6', fontSize: 15, fontWeight: '700' },
  disconnectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderColor: '#EF4444',
    borderRadius: 14,
    padding: 14,
    marginTop: 10,
    backgroundColor: '#2A0E0E',
  },
  disconnectText: { color: '#EF4444', fontSize: 15, fontWeight: '700' },
});
