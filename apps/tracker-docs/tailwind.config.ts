import type { Config } from "tailwindcss";
import { PALETTE_COLORS } from "../../packages/landing/src/palette";

// Same design tokens as apps/web so the docs read as part of the product.
const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}", "../../packages/landing/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["var(--font-mono)", "SF Mono", "Consolas", "monospace"],
      },
      colors: {
        // Muted text and icons reach 4.5:1 on the page and card surfaces.
        ...PALETTE_COLORS,
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
      },
      fontSize: {
        title: ["40px", { lineHeight: "44px" }],
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        sm: "var(--radius-sm)",
        lg: "var(--radius-lg)",
        xl: "12px",
        "2xl": "16px",
      },
      boxShadow: {
        float: "0 16px 40px -12px rgba(0,0,0,0.55)",
        xs: "0 1px 2px rgba(0,0,0,0.2)",
      },
    },
  },
  plugins: [],
};

export default config;
