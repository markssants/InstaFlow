import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execPromise = promisify(exec);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function convertVp9ToH264(inputBuffer: any): Promise<any> {
  try {
    await execPromise('ffmpeg -version');
  } catch {
    // ffmpeg not installed (e.g. pure serverless Vercel), return buffer as is
    return inputBuffer;
  }

  const tmpIn = path.join(os.tmpdir(), `in_${Date.now()}_${Math.random().toString(36).substring(7)}.mp4`);
  const tmpOut = path.join(os.tmpdir(), `out_${Date.now()}_${Math.random().toString(36).substring(7)}.mp4`);

  try {
    await fs.promises.writeFile(tmpIn, inputBuffer);

    // Detect if input already has an audio stream
    let hasAudio = false;
    try {
      const probeOut = await execPromise(
        `ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "${tmpIn}"`
      );
      hasAudio = probeOut.stdout.trim().length > 0;
    } catch {}

    // Transcode VP9/DASH to universal Apple/TikTok compatible H.264 (AVC) + AAC
    // -preset ultrafast -crf 23 ensures very fast encoding (~2-4 seconds)
    const cmd = hasAudio
      ? `ffmpeg -y -i "${tmpIn}" -c:v libx264 -preset ultrafast -crf 23 -c:a aac -b:a 128k -movflags +faststart "${tmpOut}"`
      : `ffmpeg -y -i "${tmpIn}" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -c:v libx264 -preset ultrafast -crf 23 -c:a aac -b:a 128k -shortest -movflags +faststart "${tmpOut}"`;

    await execPromise(cmd, { timeout: 35000 });

    if (fs.existsSync(tmpOut)) {
      const fixed = await fs.promises.readFile(tmpOut);
      if (fixed.length > 1000) {
        return fixed;
      }
    }
  } catch (err: any) {
    console.error('Erro na transcodificação para H.264 via ffmpeg:', err.message);
  } finally {
    try { await fs.promises.unlink(tmpIn); } catch {}
    try { await fs.promises.unlink(tmpOut); } catch {}
  }

  return inputBuffer;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const videoUrl = searchParams.get('url');

    if (!videoUrl) {
      return NextResponse.json({ error: 'URL do vídeo é obrigatória' }, { status: 400 });
    }

    const parsedUrl = new URL(videoUrl);
    // Ensure the host is an Instagram / Facebook CDN or valid video domain
    const isAllowedHost =
      parsedUrl.hostname.includes('cdninstagram.com') ||
      parsedUrl.hostname.includes('fbcdn.net') ||
      parsedUrl.hostname.includes('instagram.com') ||
      parsedUrl.hostname.includes('threads.net') ||
      parsedUrl.hostname.includes('cobalt') ||
      parsedUrl.hostname.includes('wuk.sh');

    if (!isAllowedHost) {
      // Still allow if it points to an mp4 video
      if (!videoUrl.toLowerCase().includes('.mp4') && !videoUrl.includes('video')) {
        return NextResponse.json({ error: 'Domínio de vídeo não autorizado' }, { status: 403 });
      }
    }

    const response = await fetch(videoUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Referer: 'https://www.instagram.com/',
        Accept: '*/*',
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Falha ao obter vídeo: status ${response.status}` },
        { status: response.status }
      );
    }

    const rawArrayBuffer = await response.arrayBuffer();
    let finalBuffer = Buffer.from(rawArrayBuffer);

    // Check if the stream is VP9 or fragmented DASH (which breaks QuickTime, iOS and TikTok)
    const headerPrefix = finalBuffer.slice(0, 1024).toString('latin1');
    const isVp9OrDash =
      headerPrefix.includes('vp09') ||
      headerPrefix.includes('vp9') ||
      headerPrefix.includes('dash') ||
      videoUrl.includes('dash_vp9') ||
      videoUrl.includes('dash');

    if (isVp9OrDash) {
      finalBuffer = await convertVp9ToH264(finalBuffer);
    }

    const headers = new Headers();
    headers.set('Content-Type', 'video/mp4');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    headers.set('Cache-Control', 'public, max-age=3600');
    headers.set('Content-Length', finalBuffer.length.toString());

    return new NextResponse(finalBuffer as any, {
      status: 200,
      headers,
    });
  } catch (err: any) {
    console.error('Erro no proxy de vídeo:', err);
    return NextResponse.json(
      { error: 'Erro ao processar proxy de vídeo', details: err.message },
      { status: 500 }
    );
  }
}
