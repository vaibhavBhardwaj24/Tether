import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  SafeAreaView,
  Dimensions,
  Platform,
  StatusBar,
  KeyboardAvoidingView,
  ScrollView,
  Modal,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTether } from '@/store/tether-store';
import { CameraView, useCameraPermissions } from 'expo-camera';

const { width } = Dimensions.get('window');
const CODE_LENGTH = 8;
// Calculate responsive OTP box size:
// Available = screen width - horizontal padding(32) - separating dash(28) - 7 gaps(8*7=56)
const OTP_BOX_SIZE = Math.floor((width - 32 - 28 - 56) / CODE_LENGTH);
const OTP_BOX_WIDTH = Math.min(OTP_BOX_SIZE, 44);
const OTP_BOX_HEIGHT = Math.min(Math.floor(OTP_BOX_WIDTH * 1.2), 52);
const OTP_FONT = Math.min(Math.floor(OTP_BOX_WIDTH * 0.45), 20);

export default function ConnectScreen() {
  const router = useRouter();
  const { connect, state } = useTether();
  const [code, setCode] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const inputs = useRef<(TextInput | null)[]>(Array(CODE_LENGTH).fill(null));

  // QR scanner state
  const [showScanner, setShowScanner] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const fullCode = code.join('');
  const isComplete = fullCode.length === CODE_LENGTH && code.every(c => c !== '');

  const handleChange = (text: string, index: number) => {
    // Handle paste of full code
    if (text.length > 1) {
      const chars = text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH).split('');
      const newCode = Array(CODE_LENGTH).fill('');
      chars.forEach((c, i) => { newCode[i] = c; });
      setCode(newCode);
      const nextFocusIndex = Math.min(chars.length, CODE_LENGTH - 1);
      inputs.current[nextFocusIndex]?.focus();
      return;
    }

    const char = text.toUpperCase().replace(/[^A-Z0-9]/, '');
    const newCode = [...code];
    newCode[index] = char;
    setCode(newCode);

    if (char && index < CODE_LENGTH - 1) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (key: string, index: number) => {
    if (key === 'Backspace' && !code[index] && index > 0) {
      const newCode = [...code];
      newCode[index - 1] = '';
      setCode(newCode);
      inputs.current[index - 1]?.focus();
    }
  };

  const handleConnect = () => {
    if (isComplete) {
      connect(fullCode);
      router.replace('/(tabs)');
    }
  };

  // ── QR scanner ──────────────────────────────────────────────────────────────
  const openScanner = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert(
          'Camera Permission Needed',
          'Tether needs camera access to scan the pairing QR code.',
          [{ text: 'OK' }]
        );
        return;
      }
    }
    setScanned(false);
    setShowScanner(true);
  };

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);

    // Extract the 8-char code — may be bare or wrapped e.g. "tether://pair/ABCD1234"
    const extracted = data.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-CODE_LENGTH);
    if (extracted.length === CODE_LENGTH) {
      const chars = extracted.split('');
      const newCode = Array(CODE_LENGTH).fill('');
      chars.forEach((c, i) => { newCode[i] = c; });
      setCode(newCode);
      setShowScanner(false);
    } else {
      Alert.alert('Invalid QR Code', 'This QR code doesn\'t contain a valid Tether pairing code.', [
        { text: 'Try Again', onPress: () => setScanned(false) },
        { text: 'Cancel', onPress: () => setShowScanner(false) },
      ]);
    }
  };

  const statusColor = state.connectionStatus === 'connected' ? '#22C55E'
    : state.connectionStatus === 'connecting' ? '#F59E0B'
    : state.connectionStatus === 'failed' ? '#EF4444'
    : '#3B82F6';

  const statusText = state.connectionStatus === 'connected' ? 'Connected to extension'
    : state.connectionStatus === 'connecting' ? 'Connecting...'
    : state.connectionStatus === 'failed' ? 'Connection failed'
    : 'Waiting for VS Code extension...';

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={24} color="#F0F6FC" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Device Pairing</Text>
            <View style={{ width: 40 }} />
          </View>

          {/* Illustration */}
          <View style={styles.illustration}>
            <View style={styles.illustrationInner}>
              <Ionicons name="laptop-outline" size={64} color="#3B82F6" style={{ opacity: 0.7 }} />
              <View style={styles.syncArrows}>
                <Ionicons name="arrow-forward" size={24} color="#3B82F6" />
                <Ionicons name="arrow-back" size={24} color="#3B82F6" />
              </View>
              <View style={styles.syncDash}>
                {[0, 1, 2].map(i => (
                  <View key={i} style={[styles.dashSegment, i === 0 && styles.dashSolid]} />
                ))}
              </View>
            </View>
          </View>

          {/* Heading */}
          <Text style={styles.heading}>Connect to Editor</Text>
          <Text style={styles.subheading}>
            Enter the 8-digit sync code displayed in your{' '}
            <Text style={styles.subheadingBlue}>VS Code</Text>
            {' '}extension — or scan the QR code.
          </Text>

          {/* OTP Input */}
          <View style={styles.otpRow}>
            {Array(CODE_LENGTH).fill(0).map((_, i) => (
              <React.Fragment key={i}>
                {i === 4 && <Text style={styles.dash}>-</Text>}
                <TextInput
                  ref={el => { inputs.current[i] = el; }}
                  style={[
                    styles.otpBox,
                    code[i] ? styles.otpBoxFilled : {},
                  ]}
                  value={code[i]}
                  onChangeText={text => handleChange(text, i)}
                  onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, i)}
                  maxLength={1}
                  keyboardType="default"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  selectTextOnFocus
                  caretHidden
                  placeholderTextColor="#30363D"
                  placeholder="•"
                />
              </React.Fragment>
            ))}
          </View>

          {/* QR Scan Button */}
          <TouchableOpacity style={styles.qrBtn} onPress={openScanner} activeOpacity={0.8}>
            <Ionicons name="qr-code-outline" size={20} color="#5B8AF5" />
            <Text style={styles.qrBtnText}>Scan QR Code instead</Text>
          </TouchableOpacity>

          {/* Status */}
          <View style={styles.statusBadge}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>{statusText}</Text>
          </View>

          {/* Connect Button */}
          <TouchableOpacity
            style={[styles.connectBtn, !isComplete && styles.connectBtnDisabled]}
            onPress={handleConnect}
            disabled={!isComplete}
            activeOpacity={0.85}
          >
            <Text style={styles.connectBtnText}>Pair Device </Text>
            <Text style={styles.connectBtnText}>⚡</Text>
          </TouchableOpacity>

          <Text style={styles.helpText}>Need help finding the code?</Text>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── QR Scanner Modal ─────────────────────────────────────────────────── */}
      <Modal
        visible={showScanner}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setShowScanner(false)}
      >
        <View style={styles.scannerContainer}>
          {/* Scanner header */}
          <SafeAreaView style={styles.scannerHeader}>
            <TouchableOpacity style={styles.scannerClose} onPress={() => setShowScanner(false)}>
              <Ionicons name="close" size={24} color="#F0F6FC" />
            </TouchableOpacity>
            <Text style={styles.scannerTitle}>Scan Pairing Code</Text>
            <View style={{ width: 44 }} />
          </SafeAreaView>

          {/* Camera */}
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
          >
            {/* Dark overlay with cut-out feel */}
            <View style={styles.overlay}>
              <View style={styles.overlayTop} />
              <View style={styles.overlayMiddle}>
                <View style={styles.overlaySide} />
                <View style={styles.scanWindow}>
                  {/* Corner marks */}
                  <View style={[styles.corner, styles.cornerTL]} />
                  <View style={[styles.corner, styles.cornerTR]} />
                  <View style={[styles.corner, styles.cornerBL]} />
                  <View style={[styles.corner, styles.cornerBR]} />
                </View>
                <View style={styles.overlaySide} />
              </View>
              <View style={styles.overlayBottom}>
                <Text style={styles.scanHint}>Point at the QR code shown in VS Code</Text>
              </View>
            </View>
          </CameraView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const SCAN_WINDOW = width * 0.65;
const CORNER_SIZE = 24;
const CORNER_THICKNESS = 3;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D1117',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F6FC',
  },
  illustration: {
    alignItems: 'center',
    marginHorizontal: 24,
    marginTop: 24,
    marginBottom: 32,
    backgroundColor: '#0F2029',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1E3A4A',
    overflow: 'hidden',
  },
  illustrationInner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 48,
    paddingHorizontal: 40,
  },
  syncArrows: {
    flexDirection: 'column',
    gap: 4,
    alignItems: 'center',
  },
  syncDash: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  dashSegment: {
    width: 20,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#3B82F630',
  },
  dashSolid: {
    backgroundColor: '#3B82F6',
    width: 32,
  },
  heading: {
    fontSize: 26,
    fontWeight: '800',
    color: '#F0F6FC',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  subheading: {
    fontSize: 14,
    color: '#8B949E',
    textAlign: 'center',
    paddingHorizontal: 32,
    marginTop: 8,
    lineHeight: 22,
  },
  subheadingBlue: {
    color: '#3B82F6',
    fontWeight: '600',
  },
  otpRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 32,
    paddingHorizontal: 16,
  },
  otpBox: {
    width: OTP_BOX_WIDTH,
    height: OTP_BOX_HEIGHT,
    borderRadius: 10,
    backgroundColor: '#161B22',
    borderWidth: 1.5,
    borderColor: '#30363D',
    textAlign: 'center',
    fontSize: OTP_FONT,
    fontWeight: '700',
    color: '#F0F6FC',
  },
  otpBoxFilled: {
    borderColor: '#3B82F6',
    backgroundColor: '#1A2744',
  },
  dash: {
    color: '#30363D',
    fontSize: 24,
    fontWeight: '300',
    marginHorizontal: 2,
  },

  // QR scan trigger
  qrBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'center',
    marginTop: 18,
    backgroundColor: '#0F1829',
    borderWidth: 1.5,
    borderColor: '#5B8AF540',
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  qrBtnText: {
    color: '#5B8AF5',
    fontSize: 14,
    fontWeight: '600',
  },

  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#30363D',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignSelf: 'center',
    marginTop: 24,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '500',
  },
  connectBtn: {
    flexDirection: 'row',
    backgroundColor: '#2563EB',
    borderRadius: 14,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 24,
    marginTop: 28,
  },
  connectBtnDisabled: {
    opacity: 0.4,
  },
  connectBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  helpText: {
    textAlign: 'center',
    color: '#8B949E',
    fontSize: 13,
    marginTop: 20,
  },

  // ── Scanner modal ──────────────────────────────────────────────────────────
  scannerContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  scannerHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#00000080',
  },
  scannerClose: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: '#FFFFFF18',
  },
  scannerTitle: {
    color: '#F0F6FC',
    fontSize: 16,
    fontWeight: '700',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
  },
  overlayTop: {
    flex: 1,
    backgroundColor: '#000000AA',
  },
  overlayMiddle: {
    flexDirection: 'row',
    height: SCAN_WINDOW,
  },
  overlaySide: {
    flex: 1,
    backgroundColor: '#000000AA',
  },
  scanWindow: {
    width: SCAN_WINDOW,
    height: SCAN_WINDOW,
  },
  overlayBottom: {
    flex: 1,
    backgroundColor: '#000000AA',
    alignItems: 'center',
    paddingTop: 28,
  },
  scanHint: {
    color: '#C9D1D9',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 32,
  },

  // Corner brackets
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: '#5B8AF5',
  },
  cornerTL: {
    top: 0, left: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderTopLeftRadius: 4,
  },
  cornerTR: {
    top: 0, right: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderTopRightRadius: 4,
  },
  cornerBL: {
    bottom: 0, left: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderBottomLeftRadius: 4,
  },
  cornerBR: {
    bottom: 0, right: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderBottomRightRadius: 4,
  },
});
