import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import NeuralMesh from '@/components/NeuralMesh';

export const metadata: Metadata = {
  title: 'GhostMarket — Neural Warfare',
  description: 'Autonomous E-Commerce Command & Control',
  themeColor: '#000000',
};

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '\u25C8' },
  { href: '/dashboard/products', label: 'Products', icon: '\u25A0' },
  { href: '/dashboard/learning', label: 'Learning', icon: '\u25B2' },
  { href: '/dashboard/pnl', label: 'P&L', icon: '\u25C6' },
  { href: '/dashboard/training', label: 'Training', icon: '\u25CF' },
  { href: '/dashboard/system', label: 'System', icon: '\u25CB' },
  { href: '/dashboard/control', label: 'Control', icon: '\u2699' },
  { href: '/store', label: 'Store', icon: '\u25A3' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <meta name="theme-color" content="#000000" />
        <meta httpEquiv="refresh" content="60" />
      </head>
      <body style={{
        margin: 0,
        fontFamily: "'JetBrains Mono', 'Inter', -apple-system, BlinkMacSystemFont, monospace",
        background: '#000000',
        color: '#e0e0e0',
      }}>
        <NeuralMesh />
        <div id="gm-shell" style={{ display: 'flex', minHeight: '100vh', position: 'relative', zIndex: 1 }}>
          {/* Sidebar */}
          <nav id="gm-sidebar" style={{
            width: 200,
            minWidth: 200,
            background: '#050508',
            borderRight: '1px solid #00FFFF18',
            display: 'flex',
            flexDirection: 'column',
            position: 'fixed',
            top: 0,
            left: 0,
            bottom: 0,
            zIndex: 10,
          }}>
            {/* Logo */}
            <div style={{
              padding: '24px 20px 20px',
              borderBottom: '1px solid #00FFFF18',
            }}>
              <div style={{
                fontSize: '1.1rem',
                fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
                color: '#00FFFF',
                textShadow: '0 0 20px #00FFFF44, 0 0 40px #00FFFF18',
                letterSpacing: '0.05em',
              }}>
                GHOST<span style={{ color: '#FF6B00' }}>MARKET</span>
              </div>
              <div style={{
                fontSize: '0.55rem',
                color: '#444',
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: '0.15em',
                marginTop: 4,
                textTransform: 'uppercase',
              }}>
                Neural Warfare v2
              </div>
            </div>

            {/* Nav Items */}
            <div style={{ padding: '12px 0', flex: 1 }}>
              {NAV_ITEMS.map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 20px',
                    color: '#777',
                    textDecoration: 'none',
                    fontSize: '0.82rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    transition: 'color 0.2s, background 0.2s',
                    borderLeft: '2px solid transparent',
                  }}
                >
                  <span style={{ fontSize: '0.7rem', opacity: 0.5, color: '#FF6B00' }}>{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </div>

            {/* Bottom status */}
            <div style={{
              padding: '12px 20px',
              borderTop: '1px solid #00FFFF18',
              fontSize: '0.6rem',
              color: '#333',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#00ff66',
                  boxShadow: '0 0 6px #00ff6688',
                  display: 'inline-block',
                }} />
                <span style={{ color: '#444' }}>SYSTEM ONLINE</span>
              </div>
            </div>
          </nav>

          {/* Main content */}
          <main id="gm-main" style={{
            flex: 1,
            marginLeft: 200,
            padding: 28,
            minHeight: '100vh',
            overflow: 'auto',
          }}>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
