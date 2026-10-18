import type { ReactNode } from "react";

export const metadata = {
  title: "ShortLoop",
  description: "Original Shorts from rising trends, rights-clean by construction.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
