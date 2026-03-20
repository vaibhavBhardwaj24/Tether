import React from 'react';
import Svg, { Rect, Path } from 'react-native-svg';

interface TetherLogoProps {
  size?: number;
  /** Show the rounded-rect background (default true) */
  showBg?: boolean;
}

/**
 * The official Tether 3-D "T" logo mark.
 * Drop-in replacement for anywhere an icon is needed.
 */
export default function TetherLogo({ size = 40, showBg = true }: TetherLogoProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 769 769" fill="none">
      {showBg && <Rect width="769" height="769" rx="100" fill="#0F1829" />}
      <Path d="M509.232 62L641.587 134.4L247.913 276.938L128 211.325L509.232 62Z" fill="#5B8AF5" />
      <Path d="M129.484 211.325L247.913 276.938L370.089 232.702V659.794L256.964 704.552L129.484 626.495L129.484 211.325Z" fill="#5B8AF5" />
      <Path d="M487.739 189.831L641.464 134.399V552.757L488.87 612.919L487.739 189.831Z" fill="#5B8AF5" />
      <Path d="M508.102 72.1799L629.146 136.661L442.057 209.171L246.782 276.937L139.313 216.98L508.102 72.1799Z" fill="#0F1829" />
      <Path d="M370.089 232.818L487.739 190.962L488.87 612.919L370.089 659.796V232.818Z" fill="#0F1829" />
    </Svg>
  );
}
