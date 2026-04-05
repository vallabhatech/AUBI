import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/hooks/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        aubi: {
          bg: "#080808",
          text: "#e8e4dc",
          accent: "#39ff14",
          divider: "#1f1f1f"
        }
      },
      fontFamily: {
        syne: ["var(--font-display)", "Bebas Neue", "sans-serif"],
        mono: ["var(--font-mono)", "IBM Plex Mono", "monospace"],
        sans: ["var(--font-body)", "IBM Plex Sans", "sans-serif"]
      },
      keyframes: {
        "border-beam": {
          "100%": { "offset-distance": "100%" }
        },
        "shimmer-slide": {
          to: { transform: "translate(calc(100cqw - 100%), 0)" }
        },
        "spin-around": {
          "0%":        { transform: "translateZ(0) rotate(0)" },
          "15%, 35%":  { transform: "translateZ(0) rotate(90deg)" },
          "65%, 85%":  { transform: "translateZ(0) rotate(270deg)" },
          "100%":      { transform: "translateZ(0) rotate(360deg)" }
        },
        gradient: {
          to: { backgroundPosition: "var(--bg-size) 0" }
        },
        "pulse-ring": {
          "0%, 100%": { opacity: "0.4", transform: "scale(1)" },
          "50%":      { opacity: "0.8", transform: "scale(1.05)" }
        }
      },
      animation: {
        "border-beam":  "border-beam calc(var(--duration)*1s) infinite linear",
        "shimmer-slide":"shimmer-slide var(--speed) ease-in-out infinite alternate",
        "spin-around":  "spin-around calc(var(--speed) * 2) infinite linear",
        gradient:       "gradient 8s linear infinite",
        "pulse-ring":   "pulse-ring 2s ease-in-out infinite"
      }
    }
  },
  plugins: []
};

export default config;
