import type { Metadata } from "next";
import { EvmWalletProvider } from "@/components/EvmWalletProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Archived Football Duel",
  description: "An archived six-pick football prediction prototype.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <EvmWalletProvider>{children}</EvmWalletProvider>
      </body>
    </html>
  );
}
