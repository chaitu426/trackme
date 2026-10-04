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
        sans: ["var(--font-sans)", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["var(--font-mono)", "SF Mono", "Consolas", "monospace"],
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
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
        chart: "var(--chart)",
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        sm: "var(--radius-sm)",
        lg: "var(--radius-lg)",
        xl: "12px",
        "2xl": "16px",
      },
      boxShadow: {
        card: "none",
        "card-hover": "none",
        float: "0 16px 40px -12px rgba(0,0,0,0.55)",
        nav: "none",
        xs: "0 1px 2px rgba(0,0,0,0.2)",
      },
    },
  },
  plugins: [],
};

export default config;
