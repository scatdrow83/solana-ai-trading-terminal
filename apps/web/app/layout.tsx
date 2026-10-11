import type { ReactNode } from "react";

export const metadata = {
  title: "Solana Terminal",
  description: "Local-first Solana market intelligence terminal"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
