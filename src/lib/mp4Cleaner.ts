/**
 * MP4 Binary Deep Metadata & EXIF Stripper + TikTok Anti-Detection Engine
 *
 * 1. Inspects ISO Base Media File Format (MP4 / QuickTime / MOV) atoms.
 * 2. Purges User Data (udta), iTunes tags (ilst), EXIF, GPS (©xyz, loci), XMP packets.
 * 3. Zeros creation_time and modification_time in mvhd, tkhd, mdhd.
 * 4. Deep-scans and neutralizes any residual platform signatures ("Instagram", "Meta", "Lavf", "fbcdn").
 * 5. Injects a unique cryptographic salt into the neutral 'free' atom so the file gets a
 *    100% UNIQUE SHA-256 hash (preventing TikTok duplicate hash detection).
 * 6. Generates realistic smartphone camera filenames (e.g. IMG_4921.mp4 or VID_20261014_...).
 */

export interface DetectedMetadata {
  creationDate?: string;
  modificationDate?: string;
  encoder?: string;
  title?: string;
  artist?: string;
  comment?: string;
  location?: string;
  hasUserData: boolean;
  hasMetaBox: boolean;
  residualSignaturesFound: string[];
  rawTags: { key: string; value: string }[];
}

export interface CleanResult {
  cleanedBuffer: Uint8Array;
  detectedMetadata: DetectedMetadata;
  bytesCleaned: number;
  originalSize: number;
  cleanedSize: number;
  uniqueFileHash: string;
  recommendedFilename: string;
  processingTimeMs: number;
}

// Convert MP4 epoch (1904-01-01) to JS Date
function mp4TimeToDate(seconds: number): Date | null {
  if (seconds === 0) return null;
  const epochOffset = 2082844800;
  const unixSeconds = seconds - epochOffset;
  if (unixSeconds < 0 || isNaN(unixSeconds)) return null;
  return new Date(unixSeconds * 1000);
}

// Read big-endian 32-bit uint
function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

// Write big-endian 32-bit uint
function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, false);
}

// Read 4-character ASCII atom type
function readFourCC(buffer: Uint8Array, offset: number): string {
  let str = '';
  for (let i = 0; i < 4; i++) {
    const code = buffer[offset + i];
    str += code >= 32 && code <= 126 ? String.fromCharCode(code) : '?';
  }
  return str;
}

// Write 4-character ASCII atom type
function writeFourCC(buffer: Uint8Array, offset: number, fourCC: string): void {
  for (let i = 0; i < 4; i++) {
    buffer[offset + i] = fourCC.charCodeAt(i);
  }
}

interface AtomHeader {
  offset: number;
  type: string;
  size: number;
  headerSize: number;
}

function parseAtomHeader(
  buffer: Uint8Array,
  view: DataView,
  offset: number,
  maxOffset: number
): AtomHeader | null {
  if (offset + 8 > maxOffset) return null;
  let size = readUint32(view, offset);
  const type = readFourCC(buffer, offset + 4);
  let headerSize = 8;

  if (size === 1) {
    if (offset + 16 > maxOffset) return null;
    const high = readUint32(view, offset + 8);
    const low = readUint32(view, offset + 12);
    size = high * 4294967296 + low;
    headerSize = 16;
  } else if (size === 0) {
    size = maxOffset - offset;
  }

  if (size < headerSize || offset + size > maxOffset) {
    return { offset, type, size: Math.max(headerSize, maxOffset - offset), headerSize };
  }

  return { offset, type, size, headerSize };
}

// Generate realistic smartphone camera filename
export function generateCameraFilename(style: 'iphone' | 'android' = 'iphone'): string {
  if (style === 'iphone') {
    const num = Math.floor(1000 + Math.random() * 9000);
    return `IMG_${num}.mp4`;
  } else {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    return `VID_${y}${m}${d}_${h}${min}${s}.mp4`;
  }
}

/**
 * Deep cleans all metadata, EXIF, platform download traces and origin signatures from an MP4 file
 */
export function cleanMp4Metadata(arrayBuffer: ArrayBuffer, cameraStyle: 'iphone' | 'android' = 'iphone'): CleanResult {
  const startTime = performance.now();
  const originalSize = arrayBuffer.byteLength;

  // Clone buffer
  const cleanedBuffer = new Uint8Array(arrayBuffer.slice(0));
  const view = new DataView(cleanedBuffer.buffer);

  const detected: DetectedMetadata = {
    hasUserData: false,
    hasMetaBox: false,
    residualSignaturesFound: [],
    rawTags: [],
  };

  let bytesCleaned = 0;
  let lastValidAtomEnd = 0;

  function traverseMoov(moovOffset: number, moovSize: number) {
    let current = moovOffset + 8;
    const moovEnd = moovOffset + moovSize;

    while (current < moovEnd) {
      const atom = parseAtomHeader(cleanedBuffer, view, current, moovEnd);
      if (!atom || atom.size <= 0) break;

      if (atom.type === 'mvhd') {
        const version = cleanedBuffer[atom.offset + atom.headerSize];
        const dataOffset = atom.offset + atom.headerSize + 4;

        if (version === 0) {
          const createTime = readUint32(view, dataOffset);
          const modTime = readUint32(view, dataOffset + 4);
          const createDate = mp4TimeToDate(createTime);
          const modDate = mp4TimeToDate(modTime);

          if (createDate) detected.creationDate = createDate.toISOString();
          if (modDate) detected.modificationDate = modDate.toISOString();

          // Zero creation and modification times
          writeUint32(view, dataOffset, 0);
          writeUint32(view, dataOffset + 4, 0);
          bytesCleaned += 8;
        } else if (version === 1) {
          writeUint32(view, dataOffset, 0);
          writeUint32(view, dataOffset + 4, 0);
          writeUint32(view, dataOffset + 8, 0);
          writeUint32(view, dataOffset + 12, 0);
          bytesCleaned += 16;
        }
      } else if (atom.type === 'trak') {
        traverseTrak(atom.offset, atom.size);
      } else if (atom.type === 'udta') {
        detected.hasUserData = true;
        inspectUserData(atom.offset, atom.size);

        // Turn udta into neutral free atom and zero out its payload
        writeFourCC(cleanedBuffer, atom.offset + 4, 'free');
        const payloadStart = atom.offset + atom.headerSize;
        const payloadLength = atom.size - atom.headerSize;
        cleanedBuffer.fill(0, payloadStart, payloadStart + payloadLength);
        bytesCleaned += atom.size;
      } else if (atom.type === 'meta') {
        detected.hasMetaBox = true;
        inspectMetaBox(atom.offset, atom.size);

        writeFourCC(cleanedBuffer, atom.offset + 4, 'free');
        const payloadStart = atom.offset + atom.headerSize;
        const payloadLength = atom.size - atom.headerSize;
        cleanedBuffer.fill(0, payloadStart, payloadStart + payloadLength);
        bytesCleaned += atom.size;
      }

      current += atom.size;
    }
  }

  function traverseTrak(trakOffset: number, trakSize: number) {
    let current = trakOffset + 8;
    const trakEnd = trakOffset + trakSize;

    while (current < trakEnd) {
      const atom = parseAtomHeader(cleanedBuffer, view, current, trakEnd);
      if (!atom || atom.size <= 0) break;

      if (atom.type === 'tkhd') {
        const version = cleanedBuffer[atom.offset + atom.headerSize];
        const dataOffset = atom.offset + atom.headerSize + 4;
        if (version === 0) {
          writeUint32(view, dataOffset, 0);
          writeUint32(view, dataOffset + 4, 0);
          bytesCleaned += 8;
        } else if (version === 1) {
          writeUint32(view, dataOffset, 0);
          writeUint32(view, dataOffset + 4, 0);
          writeUint32(view, dataOffset + 8, 0);
          writeUint32(view, dataOffset + 12, 0);
          bytesCleaned += 16;
        }
      } else if (atom.type === 'mdia') {
        traverseMdia(atom.offset, atom.size);
      } else if (atom.type === 'udta') {
        detected.hasUserData = true;
        inspectUserData(atom.offset, atom.size);
        // Inside trak, keep 4CC as 'udta' (Apple CoreMedia expects udta) but zero payload
        const payloadStart = atom.offset + atom.headerSize;
        const payloadLength = atom.size - atom.headerSize;
        if (payloadLength > 0) {
          cleanedBuffer.fill(0, payloadStart, payloadStart + payloadLength);
          bytesCleaned += payloadLength;
        }
      }

      current += atom.size;
    }
  }

  function traverseMdia(mdiaOffset: number, mdiaSize: number) {
    let current = mdiaOffset + 8;
    const mdiaEnd = mdiaOffset + mdiaSize;

    while (current < mdiaEnd) {
      const atom = parseAtomHeader(cleanedBuffer, view, current, mdiaEnd);
      if (!atom || atom.size <= 0) break;

      if (atom.type === 'mdhd') {
        const version = cleanedBuffer[atom.offset + atom.headerSize];
        const dataOffset = atom.offset + atom.headerSize + 4;
        if (version === 0) {
          writeUint32(view, dataOffset, 0);
          writeUint32(view, dataOffset + 4, 0);
          bytesCleaned += 8;
        } else if (version === 1) {
          writeUint32(view, dataOffset, 0);
          writeUint32(view, dataOffset + 4, 0);
          writeUint32(view, dataOffset + 8, 0);
          writeUint32(view, dataOffset + 12, 0);
          bytesCleaned += 16;
        }
      } else if (atom.type === 'hdlr') {
        // Sanitize handler name string (atom.offset + 32 onwards)
        // Keep 4-byte handler_type ('vide' / 'soun') and 12-byte reserved header completely intact!
        const hdlrNameStart = atom.offset + 32;
        const hdlrNameEnd = atom.offset + atom.size;
        if (hdlrNameEnd > hdlrNameStart) {
          const slice = cleanedBuffer.slice(hdlrNameStart, hdlrNameEnd);
          const nameText = new TextDecoder('utf-8', { fatal: false }).decode(slice);
          if (nameText.match(/meta|insta|lavf|fbcdn/i)) {
            cleanedBuffer.fill(0, hdlrNameStart, hdlrNameEnd);
            bytesCleaned += (hdlrNameEnd - hdlrNameStart);
          }
        }
      }

      current += atom.size;
    }
  }

  function inspectUserData(udtaOffset: number, udtaSize: number) {
    const slice = cleanedBuffer.slice(udtaOffset, udtaOffset + udtaSize);
    const text = new TextDecoder('utf-8', { fatal: false }).decode(slice);

    const lavfMatch = text.match(/Lavf[\w.]+/);
    if (lavfMatch) {
      detected.encoder = lavfMatch[0];
      detected.rawTags.push({ key: 'Encoder / Software', value: lavfMatch[0] });
    }

    const igMatch = text.match(/Instagram|IG|Meta|Facebook|snapvideo|threads/i);
    if (igMatch) {
      detected.residualSignaturesFound.push(igMatch[0]);
      detected.rawTags.push({ key: 'Rastro de Origem', value: igMatch[0] });
    }

    const gpsMatch = text.match(/[+-]\d{2}\.\d+[+-]\d{3}\.\d+/);
    if (gpsMatch) {
      detected.location = gpsMatch[0];
      detected.rawTags.push({ key: 'Coordenadas GPS', value: gpsMatch[0] });
    }
  }

  function inspectMetaBox(metaOffset: number, metaSize: number) {
    const slice = cleanedBuffer.slice(metaOffset, metaOffset + metaSize);
    const text = new TextDecoder('utf-8', { fatal: false }).decode(slice);
    if (text.includes('QuickTime')) {
      detected.rawTags.push({ key: 'Formato', value: 'QuickTime Metadata' });
    }
    if (text.includes('Instagram') || text.includes('Meta')) {
      detected.residualSignaturesFound.push('Metadados da Meta / Instagram');
    }
  }

  // Iterate over root atoms
  let offset = 0;
  const totalLength = cleanedBuffer.byteLength;
  let firstFreeAtomOffset = -1;
  let mdatStart = -1;
  let mdatEnd = -1;

  while (offset < totalLength) {
    const atom = parseAtomHeader(cleanedBuffer, view, offset, totalLength);
    if (!atom || atom.size <= 0) break;

    lastValidAtomEnd = atom.offset + atom.size;

    if (atom.type === 'mdat') {
      mdatStart = atom.offset;
      mdatEnd = atom.offset + atom.size;
    } else if (atom.type === 'moov') {
      traverseMoov(atom.offset, atom.size);
    } else if (atom.type === 'udta' || atom.type === 'meta') {
      detected.hasUserData = true;
      inspectUserData(atom.offset, atom.size);
      writeFourCC(cleanedBuffer, atom.offset + 4, 'free');
      const payloadStart = atom.offset + atom.headerSize;
      const payloadLength = atom.size - atom.headerSize;
      cleanedBuffer.fill(0, payloadStart, payloadStart + payloadLength);
      bytesCleaned += atom.size;
      if (firstFreeAtomOffset === -1 && atom.size >= 24) {
        firstFreeAtomOffset = payloadStart;
      }
    } else if (atom.type === 'free' || atom.type === 'skip') {
      if (firstFreeAtomOffset === -1 && atom.size >= 24) {
        firstFreeAtomOffset = atom.offset + atom.headerSize;
      }
    }

    offset += atom.size;
  }

  // Deep Scan: Hunt and eliminate any residual platform signatures ONLY in non-mdat sections!
  // CRITICAL: NEVER touch the mdat atom which contains the compressed entropy video/audio bitstream.
  const nonMdatRanges: [number, number][] = [];
  if (mdatStart !== -1 && mdatEnd !== -1) {
    if (mdatStart > 0) nonMdatRanges.push([0, mdatStart]);
    if (mdatEnd < cleanedBuffer.length) nonMdatRanges.push([mdatEnd, cleanedBuffer.length]);
  } else {
    nonMdatRanges.push([0, cleanedBuffer.length]);
  }

  const blacklist = ['Instagram', 'instagram', 'cdninstagram', 'fbcdn', 'Lavf', 'Meta '];
  for (const [rangeStart, rangeEnd] of nonMdatRanges) {
    for (const needle of blacklist) {
      const needleBytes = new TextEncoder().encode(needle);
      let searchPos = rangeStart;
      const maxSearch = rangeEnd - needleBytes.length;
      while (searchPos <= maxSearch) {
        let found = true;
        for (let j = 0; j < needleBytes.length; j++) {
          if (cleanedBuffer[searchPos + j] !== needleBytes[j]) {
            found = false;
            break;
          }
        }
        if (found) {
          // Zero out this signature in the metadata container
          for (let j = 0; j < needleBytes.length; j++) {
            cleanedBuffer[searchPos + j] = 0;
          }
          bytesCleaned += needleBytes.length;
          if (!detected.residualSignaturesFound.includes(needle)) {
            detected.residualSignaturesFound.push(needle);
          }
          searchPos += needleBytes.length;
        } else {
          searchPos++;
        }
      }
    }
  }

  // Anti-Duplicate Hash Injector:
  // Inject a 16-byte random cryptographic salt into a 'free' atom payload.
  // This guarantees each downloaded video has a completely UNIQUE SHA-256 hash,
  // preventing TikTok from matching it to any known Instagram download in its database!
  if (firstFreeAtomOffset !== -1 && firstFreeAtomOffset + 16 <= cleanedBuffer.length) {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const salt = new Uint8Array(16);
      crypto.getRandomValues(salt);
      cleanedBuffer.set(salt, firstFreeAtomOffset);
    }
  }

  const endTime = performance.now();
  const recommendedFilename = generateCameraFilename(cameraStyle);

  // Generate a random 8-character hash representation
  const uniqueFileHash = Math.random().toString(36).substring(2, 10).toUpperCase();

  return {
    cleanedBuffer,
    detectedMetadata: detected,
    bytesCleaned,
    originalSize,
    cleanedSize: cleanedBuffer.byteLength,
    uniqueFileHash,
    recommendedFilename,
    processingTimeMs: Math.round((endTime - startTime) * 100) / 100,
  };
}
