import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Consensus Noir — evidence meets consensus",
  description: "A GenLayer-native social deduction game for ambiguous cases.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
