import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  ScrollView,
  SafeAreaView,
  FlatList,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import TetherLogo from '@/components/TetherLogo';

const { width } = Dimensions.get('window');

const SLIDES = [
  {
    id: '1',
    title: 'Pair',
    description: 'Connect your repositories and start collaborating with AI in real-time.',
    image: require('@/assets/images/card_pair.png'),
    bgColor: '#0D1829',
  },
  {
    id: '2',
    title: 'Prompt',
    description: 'Send prompts directly from your phone while your code runs.',
    image: require('@/assets/images/card_prompt.png'),
    bgColor: '#120D29',
  },
  {
    id: '3',
    title: 'Notify',
    description: 'Get push notifications when Antigravity finishes — no need to watch the screen.',
    image: require('@/assets/images/card_notify.png'),
    bgColor: '#0A1A14',
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  const handleScroll = (event: any) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / (width * 0.75));
    setActiveIndex(index);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Logo + Title */}
      <View style={styles.header}>
        <View style={styles.logoContainer}>
          <TetherLogo size={52} showBg={false} />
        </View>
        <Text style={styles.title}>Tether</Text>
        <Text style={styles.subtitle}>Your AI Coding Companion</Text>
      </View>

      {/* Carousel */}
      <View style={styles.carouselWrapper}>
        <FlatList
          ref={flatListRef}
          data={SLIDES}
          horizontal
          pagingEnabled={false}
          snapToInterval={width * 0.75 + 16}
          snapToAlignment="start"
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 24, gap: 16 }}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={[styles.card, { width: width * 0.75 }]}>
              {/* Card image */}
              <View style={[styles.cardImageArea, { backgroundColor: item.bgColor }]}>
                <Image
                  source={item.image}
                  style={styles.cardImage}
                  resizeMode="cover"
                />
              </View>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardDesc}>{item.description}</Text>
            </View>
          )}
        />
      </View>

      {/* Dots */}
      <View style={styles.dotsRow}>
        {SLIDES.map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              i === activeIndex ? styles.dotActive : styles.dotInactive,
            ]}
          />
        ))}
      </View>

      {/* CTA */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.ctaButton}
          onPress={() => router.push('/connect')}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaText}>Get Started</Text>
        </TouchableOpacity>
        <View style={styles.loginRow}>
          <Text style={styles.loginGray}>Already have an account? </Text>
          <TouchableOpacity onPress={() => router.push('/connect')}>
            <Text style={styles.loginBlue}>Log in</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D1117',
  },
  header: {
    alignItems: 'center',
    paddingTop: 48,
    paddingBottom: 24,
  },
  logoContainer: {
    width: 72,
    height: 72,
    borderRadius: 18,
    backgroundColor: '#0F1829',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#5B8AF533',
  },
  title: {
    fontSize: 36,
    fontWeight: '800',
    color: '#F0F6FC',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    color: '#8B949E',
    marginTop: 4,
  },
  carouselWrapper: {
    flex: 1,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#161B22',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#30363D',
  },
  cardImageArea: {
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F0F6FC',
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  cardDesc: {
    fontSize: 14,
    color: '#8B949E',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
    lineHeight: 22,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 20,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    width: 24,
    backgroundColor: '#3B82F6',
  },
  dotInactive: {
    width: 8,
    backgroundColor: '#30363D',
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === 'android' ? 32 : 16,
    gap: 16,
  },
  ctaButton: {
    backgroundColor: '#2563EB',
    borderRadius: 14,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  loginRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginGray: {
    color: '#8B949E',
    fontSize: 14,
  },
  loginBlue: {
    color: '#3B82F6',
    fontSize: 14,
    fontWeight: '600',
  },
});
