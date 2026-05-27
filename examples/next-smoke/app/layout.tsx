import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Next Smoke",
  description: "Manual smoke app for the local Prisma CLI beta",
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
