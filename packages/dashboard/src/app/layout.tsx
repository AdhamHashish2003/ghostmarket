import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GhostMarket — Autonomous Product Intelligence',
  description: 'AI-powered product intelligence that finds winning products before they trend.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#0a0a0a] text-zinc-100 min-h-screen overflow-x-hidden">
        {children}
      </body>
    </html>
  );
}
