import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "ShortLoop",
  description: "Original Shorts from rising trends, rights-clean by construction.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
