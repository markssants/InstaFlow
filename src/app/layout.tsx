import type { Metadata, Viewport } from 'next';
import './globals.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  title: 'InstaFlow - Baixar Vídeo do Instagram & Limpar Metadados EXIF/GPS',
  description:
    'Baixe vídeos e reels do Instagram e remova 100% dos metadados, carimbos de data/hora, geolocalização e identificadores para repostar de forma limpa no TikTok e Shorts.',
  keywords: [
    'instagram downloader',
    'remover metadados video',
    'limpar exif video',
    'instagram to tiktok',
    'video sem metadados',
    'repost reels sem penalizacao',
  ],
  authors: [{ name: 'InstaFlow Studio' }],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
      </head>
      <body>
        <div className="bg-glow-container" aria-hidden="true">
          <div className="glow-orb glow-orb-1" />
          <div className="glow-orb glow-orb-2" />
          <div className="glow-orb glow-orb-3" />
        </div>
        {children}
      </body>
    </html>
  );
}
