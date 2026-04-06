import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GhostMarket — Autonomous Product Intelligence',
  description: 'AI-powered product intelligence platform that scrapes, scores, and surfaces winning products for e-commerce sellers before they trend. Real-time data from Amazon, AliExpress, and Google Trends.',
  icons: { icon: '/favicon.ico' },
  openGraph: {
    title: 'GhostMarket — Autonomous Product Intelligence',
    description: 'Find winning products before they trend. Real-time scoring from 1000+ products across Amazon, AliExpress, and trending sources.',
    type: 'website',
    siteName: 'GhostMarket',
  },
  twitter: {
    card: 'summary',
    title: 'GhostMarket — Autonomous Product Intelligence',
    description: 'Find winning products before they trend.',
  },
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
