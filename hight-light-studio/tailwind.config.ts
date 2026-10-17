import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        studio: {
          bg: "#FFFFFF",
          bgAlt: "#F7F8F4",
          panel: "#FFFFFF",
          border: "#E5E7EB",
          accent: "#0871E7",
          accentDark: "#065CB8",
          accentSecondary: "#0F9D58",
          accentTertiary: "#D97706",
          bgAccent: "#DEF0FC",
          text: "#1A1A1A",
          muted: "#6B7280",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "sans-serif"],
        display: ["var(--font-instrument)", "serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      animation: {
        'blob': 'blob 25s infinite',
      },
      keyframes: {
        blob: {
          '0%': { transform: 'translate(0px, 0px) scale(1) rotate(0deg)' },
          '33%': { transform: 'translate(30px, -50px) scale(1.1) rotate(90deg)' },
          '66%': { transform: 'translate(-20px, 20px) scale(0.9) rotate(180deg)' },
          '100%': { transform: 'translate(0px, 0px) scale(1) rotate(360deg)' },
        }
      }
    },
  },
  plugins: [],
};

export default config;
