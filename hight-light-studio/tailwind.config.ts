import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Palette de départ pour Hight Light Studio — distincte des couleurs
        // des autres apps du portfolio (Cusbuy=orange, FastCol=bleu, Beta
        // Pay=violet, DevOnly=vert, Anipage=argent). À ajuster librement.
        studio: {
          bg: "#12141C",
          panel: "#1A1D29",
          border: "#2A2E3E",
          accent: "#22D3D8",
          accentDark: "#0E9AA0",
          text: "#E7E9F0",
          muted: "#8A8FA3",
        },
      },
      fontFamily: {
        mono: ["var(--font-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
