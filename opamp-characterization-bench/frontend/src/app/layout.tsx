import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AUTO_OPAMP_BENCH // Controller v2.0",
  description:
    "Automated Op-Amp Characterization Bench – CD74HC4067 MUX matrix + ADS1115 16-bit ADC + Web Serial JSON-RPC dashboard",
};

export const viewport: Viewport = {
  themeColor: '#0f172a',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full bg-slate-950">
      <body className="min-h-full flex flex-col bg-slate-950 text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
