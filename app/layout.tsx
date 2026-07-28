import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MTI Business OS",
  description: "AI-powered operating system for MTI Korea"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
