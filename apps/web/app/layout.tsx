import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { LocaleProvider } from "./locale-provider";

export const metadata: Metadata = {
  title: "Solana Terminal — Market Intelligence",
  description: "Read-only Solana wallet intelligence and public market data."
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body><LocaleProvider>{children}</LocaleProvider></body>
    </html>
  );
}
