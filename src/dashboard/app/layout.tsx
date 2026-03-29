import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'GhostMarket',
  description: 'Autonomous E-Commerce Engine',
};

const NAV_ITEMS = [
  { href: '/', label: 'Pipeline' },
  { href: '/learning', label: 'Learning' },
  { href: '/pnl', label: 'P&L' },
  { href: '/training', label: 'Training Data' },
  { href: '/system', label: 'System' },
  { href: '/control', label: 'Control Panel' },
  { href: '/control/keys', label: 'API Keys' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', background: '#0a0a0f', color: '#e0e0e0' }}>
        <div style={{ display: 'flex', minHeight: '100vh' }}>
          <nav style={{ width: 200, background: '#111118', padding: '20px 0', borderRight: '1px solid #222' }}>
            <div style={{ padding: '0 20px 20px', fontSize: '1.2rem', fontWeight: 'bold', color: '#fff' }}>
              GhostMarket
            </div>
            {NAV_ITEMS.map(item => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'block',
                  padding: '10px 20px',
                  color: '#aaa',
                  textDecoration: 'none',
                  fontSize: '0.9rem',
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <main style={{ flex: 1, padding: 24, overflow: 'auto' }}>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
