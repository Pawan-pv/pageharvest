/** Types for tailwind.config.js, so tests can read the design tokens under strict TypeScript. */
export type ThemeName = 'light' | 'dark';

export declare const designTokens: {
  colors: Record<ThemeName, Record<string, string>>;
  radius: Record<string, string>;
  spacing: Record<string, string>;
  fontSize: Record<string, [string, { lineHeight: string }]>;
};

type ColorEntry = string | Record<string, string>;

declare const config: {
  content: string[];
  darkMode: 'media';
  theme: {
    extend: {
      colors: Record<string, ColorEntry>;
      borderRadius: Record<string, string>;
      spacing: Record<string, string>;
      fontSize: Record<string, [string, { lineHeight: string }]>;
      boxShadow: Record<string, string>;
      backdropBlur: Record<string, string>;
      ringColor: Record<string, string>;
      ringOffsetColor: Record<string, string>;
      keyframes: Record<string, Record<string, Record<string, string>>>;
      animation: Record<string, string>;
    };
  };
  plugins: unknown[];
};

export default config;
