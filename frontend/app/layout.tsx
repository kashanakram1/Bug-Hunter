import type { Metadata } from 'next';
import './globals.css';
import './competition.css';
import './event-theme.css';
import { CompetitionTools } from '@/components/competition/webmcp';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Code Connect 26 | Bug Hunter Module-5',
  description:
    'Bug Hunter Module-5 at Code Connect 26. Online rounds on 17 October 2026 and a qualified-team on-site final on 22 October 2026.',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <CompetitionTools />
        {children}
      </body>
    </html>
  );
}
