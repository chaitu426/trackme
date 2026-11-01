import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "../../packages/landing/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["var(--font-mono)", "SF Mono", "Consolas", "monospace"],
      },
      colors: {
        // Muted text and icons reach 4.5:1 on the page and card surfaces (zinc-500 did not).
        zinc: { 500: "#85858b", 600: "#6e6e74" },
        sidebar: "var(--sidebar)",
        raised: "var(--raised)",
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
      fontSize: {
        // Page title; everything below it uses Tailwind's xs / sm / base.
        title: ["28px", { lineHeight: "36px" }],
      },
      transitionTimingFunction: {
        DEFAULT: "cubic-bezier(0.22, 1, 0.36, 1)",
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
