import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Domain Map",
  description: "A calm, spatial workspace for discovering local domains.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
