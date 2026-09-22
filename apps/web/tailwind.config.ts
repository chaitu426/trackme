import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ['"JetBrains Mono"', "Fira Code", "Consolas", "monospace"],
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        border: "var(--border)",
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        sm: "var(--radius-sm)",
        lg: "var(--radius-lg)",
        xl: "16px",
        "2xl": "20px",
      },
      boxShadow: {
        "card":     "0 1px 2px rgba(0,0,0,0.02), 0 4px 16px -2px rgba(0,0,0,0.03)",
        "card-hover": "0 2px 6px rgba(0,0,0,0.03), 0 10px 28px -4px rgba(0,0,0,0.05)",
        "float":    "0 12px 40px -8px rgba(0,0,0,0.08), 0 4px 12px -2px rgba(0,0,0,0.03)",
        "nav":      "0 2px 8px rgba(0,0,0,0.03)",
        "xs":       "0 1px 2px rgba(0,0,0,0.03)",
      },
    },
  },
  plugins: [],
};

export default config;
