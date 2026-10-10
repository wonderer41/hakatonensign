import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Continuum",
  description: "Your work, connected.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
