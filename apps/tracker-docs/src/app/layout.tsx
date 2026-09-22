import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Growth Intelligence Tracker Documentation",
  description: "Installation, framework adapters, and public event API reference.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif", background: "#090a0f", color: "#f8fafc" }}>
        {children}
      </body>
    </html>
  );
}

