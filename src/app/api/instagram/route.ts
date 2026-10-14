import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ExtractedMedia {
  url: string;
  type: 'video' | 'image';
  thumbnail?: string;
  title?: string;
  author?: string;
  source: string;
}

// Extract shortcode from Instagram link
function extractShortcode(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const index = parts.findIndex((p) => ['reel', 'reels', 'p', 'tv'].includes(p.toLowerCase()));
    if (index !== -1 && parts[index + 1]) {
      return parts[index + 1];
    }
    for (const part of parts) {
      if (/^[A-Za-z0-9_-]{10,13}$/.test(part)) {
        return part;
      }
    }
  } catch {}
  return null;
}

// Helper to extract direct Instagram CDN URL if wrapped in a token
function extractDirectMediaUrl(rawUrl: string): string {
  try {
    const match = rawUrl.match(/[?&]token=([^&]+)/);
    if (match) {
      const parts = match[1].split('.');
      if (parts.length >= 2) {
        const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = payload + '==='.slice((payload.length + 3) % 4);
        const data = JSON.parse(Buffer.from(padded, 'base64').toString());
        if (data.url && typeof data.url === 'string' && data.url.startsWith('http')) {
          return data.url;
        }
      }
    }
  } catch {}
  return rawUrl;
}

// Strategy 1 (Cloud & Vercel Native): Fast SnapVideo extraction engine
async function trySnapVideo(targetUrl: string): Promise<ExtractedMedia | null> {
  try {
    const SnapVideo = require('cakkatrok-instagram-downloader');
    const result = await SnapVideo(targetUrl);
    if (result?.media && Array.isArray(result.media) && result.media.length > 0) {
      const videoItem = result.media.find((m: any) => m.type === 'video') || result.media[0];
      if (videoItem?.url) {
        const directUrl = extractDirectMediaUrl(videoItem.url);
        return {
          url: directUrl,
          type: 'video',
          title: videoItem.filename || 'instagram_video.mp4',
          source: 'snapvideo-cloud-engine',
        };
      }
    }
  } catch (err: any) {
    console.error('SnapVideo error:', err.message);
  }
  return null;
}

// Strategy 2: Fetch via local yt-dlp if installed (ideal for local/dedicated servers)
async function tryYtDlp(targetUrl: string): Promise<ExtractedMedia | null> {
  try {
    const { stdout } = await execPromise(
      `yt-dlp -g --no-warnings -f "best[ext=mp4][vcodec^=avc1]/best[ext=mp4]/best" -S "vcodec:h264,acodec:aac" "${targetUrl}"`,
      { timeout: 9000 }
    );
    const lines = stdout.trim().split('\n').filter(Boolean);
    if (lines.length > 0 && lines[0].startsWith('http')) {
      return {
        url: lines[0].trim(),
        type: 'video',
        source: 'yt-dlp-engine',
      };
    }
  } catch {
    // yt-dlp not installed or failed, silently fallback
  }
  return null;
}

// Helper to select the highest quality progressive H.264 stream with combined audio
function extractBestInstagramMediaUrl(html: string): string | null {
  // 1. Look for explicit video_url fields (always progressive H.264 with audio)
  const videoUrlMatches =
    html.match(/"video_url"\s*:\s*"([^"]+)"/i) ||
    html.match(/\\"video_url\\"\s*:\s*\\"([^\\"]+)\\"/i) ||
    html.match(/&quot;video_url&quot;\s*:\s*&quot;([^&]+)&quot;/i);

  if (videoUrlMatches && videoUrlMatches[1]) {
    return videoUrlMatches[1]
      .replace(/\\u0026/g, '&')
      .replace(/\\/g, '');
  }

  // 2. Score all .mp4 URLs in script tags to find progressive H.264 instead of DASH VP9
  const mp4Matches = html.match(/https?:\\?\/\\?\/[^"'\s<>]+\.mp4[^"'\s<>]*/gi) || [];
  if (mp4Matches.length === 0) return null;

  const candidates: { url: string; score: number }[] = [];

  for (const raw of mp4Matches) {
    const cleanUrl = raw
      .replace(/\\u0026/g, '&')
      .replace(/\\\//g, '/')
      .replace(/\\/g, '');

    let score = 50;
    try {
      const u = new URL(cleanUrl);
      const efg = u.searchParams.get('efg');
      if (efg) {
        try {
          const dec = Buffer.from(efg, 'base64').toString();
          const json = JSON.parse(dec);
          const tag = (json.vencode_tag || '').toLowerCase();

          // Top priority: progressive H.264 streams
          if (tag.includes('xpv_progressive')) score += 1000;
          else if (tag.includes('progressive')) score += 500;
          // Medium priority: baseline / high H.264
          else if (tag.includes('baseline') || tag.includes('high') || tag.includes('h264')) score += 100;
          // Lowest priority: VP9 DASH (often video-only and breaks on QuickTime/Apple)
          else if (tag.includes('vp9')) score -= 500;
        } catch {}
      }
    } catch {}

    if (cleanUrl.includes('xpv_progressive')) score += 500;
    if (cleanUrl.includes('progressive')) score += 200;
    if (cleanUrl.includes('vp9')) score -= 400;

    candidates.push({ url: cleanUrl, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.url || null;
}

// Strategy 3: Fetch embed HTML and scrape JSON
async function tryEmbedScrape(shortcode: string): Promise<ExtractedMedia | null> {
  try {
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
    const res = await fetch(embedUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-IG-App-ID': '936619743392459',
      },
      next: { revalidate: 0 },
    });

    if (!res.ok) return null;
    const html = await res.text();

    const bestUrl = extractBestInstagramMediaUrl(html);
    if (bestUrl) {
      return {
        url: bestUrl,
        type: 'video',
        source: 'instagram-embed-stream',
      };
    }
  } catch (err) {
    // Ignore and proceed to next strategy
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const url = body.url?.trim();

    if (!url) {
      return NextResponse.json({ error: 'Por favor, insira o link do Instagram.' }, { status: 400 });
    }

    if (!url.includes('instagram.com')) {
      return NextResponse.json(
        { error: 'Link inválido. Deve ser um link válido do Instagram (Reel ou Post).' },
        { status: 400 }
      );
    }

    const shortcode = extractShortcode(url);

    // Try Strategy 1: SnapVideo Cloud Engine (Fastest & 100% reliable on Vercel)
    const snapResult = await trySnapVideo(url);
    if (snapResult) {
      return NextResponse.json({
        success: true,
        media: snapResult,
        shortcode,
        proxyUrl: `/api/proxy?url=${encodeURIComponent(snapResult.url)}`,
      });
    }

    // Try Strategy 2: yt-dlp if available locally
    const ytDlpResult = await tryYtDlp(url);
    if (ytDlpResult) {
      return NextResponse.json({
        success: true,
        media: ytDlpResult,
        shortcode,
        proxyUrl: `/api/proxy?url=${encodeURIComponent(ytDlpResult.url)}`,
      });
    }

    // Try Strategy 3: Embed Scraper
    if (shortcode) {
      const embedResult = await tryEmbedScrape(shortcode);
      if (embedResult) {
        return NextResponse.json({
          success: true,
          media: embedResult,
          shortcode,
          proxyUrl: `/api/proxy?url=${encodeURIComponent(embedResult.url)}`,
        });
      }
    }

    // If Instagram temporarily throttled direct cloud scraping for this link,
    // display friendly fallback to upload video directly or use direct link
    return NextResponse.json(
      {
        success: false,
        requiresFallback: true,
        error:
          'O Instagram limitou temporariamente o acesso direto para este link específico.',
        shortcode,
        help: 'Você pode fazer o upload direto do arquivo de vídeo (.mp4 / .mov) ou colar o link direto do vídeo para remover todos os metadados instantaneamente!',
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error('Erro na API Instagram:', err);
    return NextResponse.json(
      { error: 'Erro ao processar requisição.', details: err.message },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'Parâmetro url é obrigatório' }, { status: 400 });
  }

  const fakeReq = new NextRequest(req.url, {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
  return POST(fakeReq);
}
