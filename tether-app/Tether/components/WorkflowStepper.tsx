import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, Dimensions, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AiState } from '@/store/tether-store';

const { width: SW } = Dimensions.get('window');

// ─── Step definitions ────────────────────────────────────────────────────────
interface Step {
  key: AiState;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
  color: string;
}

const STEPS: Step[] = [
  { key: 'watching', label: 'Watching', icon: 'eye-outline',              activeIcon: 'eye',              color: '#3B82F6' },
  { key: 'thinking', label: 'Thinking', icon: 'bulb-outline',             activeIcon: 'bulb',             color: '#A855F7' },
  { key: 'editing',  label: 'Writing',  icon: 'pencil-outline',           activeIcon: 'pencil',           color: '#F59E0B' },
  { key: 'done',     label: 'Done',     icon: 'checkmark-circle-outline', activeIcon: 'checkmark-circle', color: '#22C55E' },
];

// ─── Layout constants ────────────────────────────────────────────────────────
const STEP_W   = 80;   // width allocated per step column (circle + label)
const LINE_W   = 36;   // width of connecting line between steps
const ITEM_W   = STEP_W + LINE_W; // 116 total per step slot
const CIRCLE   = 42;   // circle diameter
const CTOP     = 10;   // top padding before circles

// translateX so the step at `index` ends up centred on screen
function centerOffset(index: number): number {
  return SW / 2 - STEP_W / 2 - index * ITEM_W;
}

// Map AiState → float index used by the animation
function stateToIndex(state: AiState): number {
  switch (state) {
    case 'watching': return 0;
    case 'thinking': return 1;
    case 'editing':  return 2;
    case 'done':     return 3;
    default:         return -0.6; // idle: slightly before first step
  }
}

// ─── Component ───────────────────────────────────────────────────────────────
interface Props {
  aiState: AiState;
}

export default function WorkflowStepper({ aiState }: Props) {
  const anim = useRef(new Animated.Value(stateToIndex(aiState))).current;
  const activeIndex = stateToIndex(aiState);

  useEffect(() => {
    Animated.spring(anim, {
      toValue: stateToIndex(aiState),
      useNativeDriver: true,
      tension: 55,
      friction: 12,
    }).start();
  }, [aiState]);

  // Slide the whole track so the active step is centred
  const translateX = anim.interpolate({
    inputRange: [-0.6, 0, 1, 2, 3],
    outputRange: [
      centerOffset(-0.6),
      centerOffset(0),
      centerOffset(1),
      centerOffset(2),
      centerOffset(3),
    ],
  });

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.track, { transform: [{ translateX }] }]}>
        {STEPS.map((step, i) => {
          const isPast   = activeIndex > i + 0.3;
          const isActive = Math.abs(activeIndex - i) < 0.45;

          // Smooth opacity: full at active step, dim as distance grows
          const opacity = anim.interpolate({
            inputRange: [i - 2, i - 1, i, i + 1, i + 2],
            outputRange: [0.07, 0.25, 1, 0.25, 0.07],
            extrapolate: 'clamp',
          });

          // Subtle grow/shrink around active step
          const scale = anim.interpolate({
            inputRange: [i - 1.5, i, i + 1.5],
            outputRange: [0.78, 1.1, 0.78],
            extrapolate: 'clamp',
          });

          const circleColor = isActive ? step.color : isPast ? '#22C55E' : '#2A2F37';
          const circleBg    = isActive ? step.color + '22' : isPast ? '#22C55E18' : 'transparent';
          const labelColor  = isActive ? step.color : isPast ? '#22C55E60' : '#3A414A';

          return (
            <View key={step.key} style={styles.stepItem}>
              {/* Step column: circle + label */}
              <Animated.View style={[styles.stepCol, { opacity, transform: [{ scale }] }]}>
                {/* Active glow ring */}
                {isActive && (
                  <Animated.View style={[
                    styles.glowRing,
                    { borderColor: step.color + '50' },
                  ]} />
                )}

                <View style={[styles.circle, { borderColor: circleColor, backgroundColor: circleBg }]}>
                  {isPast ? (
                    <Ionicons name="checkmark" size={16} color="#22C55E" />
                  ) : (
                    <Ionicons
                      name={isActive ? step.activeIcon : step.icon}
                      size={16}
                      color={isActive ? step.color : '#484F58'}
                    />
                  )}
                </View>

                <Text style={[styles.label, { color: labelColor, fontWeight: isActive ? '700' : '500' }]}>
                  {step.label}
                </Text>
              </Animated.View>

              {/* Horizontal connector line — not after last step */}
              {i < STEPS.length - 1 && (
                <View style={styles.lineWrap}>
                  <View style={[
                    styles.line,
                    { backgroundColor: isPast ? '#22C55E50' : '#21262D' },
                  ]} />
                </View>
              )}
            </View>
          );
        })}
      </Animated.View>

      {/* Edge fade masks — simulate a gradient fade on both sides */}
      <View style={styles.edgeLeft} pointerEvents="none">
        {[0.94, 0.78, 0.60, 0.40, 0.20, 0.07].map((o, k) => (
          <View key={k} style={[styles.fadeSlice, { opacity: o }]} />
        ))}
      </View>
      <View style={styles.edgeRight} pointerEvents="none">
        {[0.07, 0.20, 0.40, 0.60, 0.78, 0.94].map((o, k) => (
          <View key={k} style={[styles.fadeSlice, { opacity: o }]} />
        ))}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    height: 90,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 4,
  },
  track: {
    position: 'absolute',
    flexDirection: 'row',
    top: 0,
    bottom: 0,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: ITEM_W,
  },
  stepCol: {
    width: STEP_W,
    alignItems: 'center',
    paddingTop: CTOP,
  },
  glowRing: {
    position: 'absolute',
    top: CTOP - 5,
    width: CIRCLE + 10,
    height: CIRCLE + 10,
    borderRadius: (CIRCLE + 10) / 2,
    borderWidth: 1,
  },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 10,
    marginTop: 6,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  lineWrap: {
    width: LINE_W,
    // Align line with circle centre: CTOP + circle radius
    paddingTop: CTOP + CIRCLE / 2 - 1,
    alignItems: 'stretch',
  },
  line: {
    height: 1.5,
    borderRadius: 1,
  },
  // Edge fade
  edgeLeft: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 72,
    flexDirection: 'row',
  },
  edgeRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 72,
    flexDirection: 'row',
  },
  fadeSlice: {
    flex: 1,
    backgroundColor: '#0D1117',
  },
});
