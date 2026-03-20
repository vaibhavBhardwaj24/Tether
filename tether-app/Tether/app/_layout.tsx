import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { TetherProvider } from '@/store/tether-store';

export default function RootLayout() {
  return (
    <TetherProvider>
      <StatusBar style="light" backgroundColor="#0D1117" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#0D1117' },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="connect" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="review-changes" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      </Stack>
    </TetherProvider>
  );
}
