import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Palette historique du studio, conservée pour ne pas réécrire
        // l'ensemble des panneaux existants.
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
        // Jetons attendus par les composants shadcn/ui, câblés sur les
        // variables CSS définies dans globals.css.
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "sans-serif"],
        display: ["var(--font-instrument)", "serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      animation: {
        blob: "blob 25s infinite",
      },
      keyframes: {
        blob: {
          "0%": { transform: "translate(0px, 0px) scale(1) rotate(0deg)" },
          "33%": { transform: "translate(30px, -50px) scale(1.1) rotate(90deg)" },
          "66%": { transform: "translate(-20px, 20px) scale(0.9) rotate(180deg)" },
          "100%": { transform: "translate(0px, 0px) scale(1) rotate(360deg)" },
        },
      },
    },
  },
  plugins: [animate],
};

export default config;
