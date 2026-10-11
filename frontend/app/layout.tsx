import type { Metadata } from 'next';
import './globals.css';
import './competition.css';
import { CompetitionTools } from '@/components/competition/webmcp';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Code Connect 26 | Bug Hunt 2026 Advanced',
  description:
    'Bug Hunt 2026 Advanced at Code Connect 26, University of Karachi and UBIT Career Connect. Team arena, judging, and live Mission Control.',
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
