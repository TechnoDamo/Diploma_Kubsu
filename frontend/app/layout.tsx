import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'RAG Demo Frontend',
  description: 'One-screen RAG demo'
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
