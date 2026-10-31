import type { Config } from "tailwindcss";

// Design tokens live as CSS variables in app/globals.css (see docs/DESIGN.md).
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: token("bg"),
        surface: token("surface"),
        "surface-2": token("surface-2"),
        "surface-3": token("surface-3"),
        line: token("line"),
        fg: token("fg"),
        muted: token("muted"),
        subtle: token("subtle"),
        accent: token("accent"),
        "accent-fg": token("accent-fg"),
        gold: token("gold"),
        danger: token("danger"),
        warning: token("warning"),
        info: token("info"),
        felt: token("felt"),
        "felt-dark": token("felt-dark"),
        rail: token("rail"),
        "suit-red": token("suit-red"),
        "suit-black": token("suit-black"),
        "suit-blue": token("suit-blue"),
        "suit-green": token("suit-green"),
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
        pixel: ['"Press Start 2P"', "ui-monospace", "monospace"],
      },
      borderRadius: { xl: "0.875rem", "2xl": "1.125rem" },
      boxShadow: {
        panel: "var(--shadow-panel)",
        pop: "var(--shadow-pop)",
        glow: "0 0 0 2px rgb(var(--accent) / 0.55), 0 0 24px rgb(var(--accent) / 0.35)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "deal-card": { from: { opacity: "0", transform: "translateY(-12px) scale(0.96)" }, to: { opacity: "1", transform: "none" } },
        "scale-in": { from: { opacity: "0", transform: "scale(0.97)" }, to: { opacity: "1", transform: "scale(1)" } },
        // Table: transform-only so a card/result is never left invisible if a frame is skipped.
        "deal-in": { from: { transform: "translateY(-10px) scale(0.94)" }, to: { transform: "none" } },
        "rise-in": { from: { transform: "translateY(6px)" }, to: { transform: "none" } },
        "fly-in": { from: { transform: "translate(var(--fly-x, 0px), var(--fly-y, 0px))" }, to: { transform: "none" } },
        "sheet-in-right": { from: { transform: "translateX(100%)" }, to: { transform: "translateX(0)" } },
        "sheet-in-left": { from: { transform: "translateX(-100%)" }, to: { transform: "translateX(0)" } },
        "sheet-in-bottom": { from: { transform: "translateY(100%)" }, to: { transform: "translateY(0)" } },
        "toast-in": { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "toast-out": { from: { opacity: "1" }, to: { opacity: "0" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        "pulse-ring": { "0%,100%": { boxShadow: "0 0 0 0 rgb(var(--accent) / 0.5)" }, "50%": { boxShadow: "0 0 0 6px rgb(var(--accent) / 0)" } },
      },
      animation: {
        "fade-in": "fade-in 150ms ease-out",
        "slide-up": "slide-up 180ms ease-out",
        "deal-card": "deal-card 220ms cubic-bezier(.2,.8,.2,1) both",
        "deal-in": "deal-in 220ms cubic-bezier(.2,.8,.2,1) both",
        "rise-in": "rise-in 200ms ease-out both",
        "fly-in": "fly-in 550ms cubic-bezier(.2,.8,.2,1) both",
        "pulse-ring": "pulse-ring 1.6s ease-in-out infinite",
        "scale-in": "scale-in 160ms ease-out",
        "sheet-in-right": "sheet-in-right 220ms cubic-bezier(.2,.8,.2,1)",
        "sheet-in-left": "sheet-in-left 220ms cubic-bezier(.2,.8,.2,1)",
        "sheet-in-bottom": "sheet-in-bottom 220ms cubic-bezier(.2,.8,.2,1)",
        "toast-in": "toast-in 200ms ease-out",
        "toast-out": "toast-out 150ms ease-in forwards",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
