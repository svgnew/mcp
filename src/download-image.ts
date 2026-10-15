import { lookup } from 'node:dns/promises';
import { request } from 'node:https';

export type McpImageFile = {
  download_url: string;
  file_id: string;
  mime_type?: string;
  file_name?: string;
};

// Base64 adds roughly one third; leave room under Vercel's 4.5 MB request limit.
const MAX_IMAGE_BYTES = 2_900_000;

function isPublicIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || (b === 0 && c === 0))) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 198 && b >= 18 && b <= 19) return false;
  return true;
}

function imageMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/** Fetch a ChatGPT file URL without allowing redirects or local-network connections. */
export async function downloadImageDataUrl(file: McpImageFile): Promise<string> {
  const url = new URL(file.download_url);
  if (url.protocol !== 'https:' || url.port || url.username || url.password) {
    throw new Error('Image download URL must use standard HTTPS');
  }

  const addresses = await lookup(url.hostname, { family: 4, all: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicIpv4(address))) {
    throw new Error('Image download URL must resolve to a public address');
  }
  const pinnedAddress = addresses[0].address;

  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const req = request(
      url,
      {
        timeout: 15_000,
        lookup: (_hostname, _options, callback) => callback(null, pinnedAddress, 4),
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Image download failed (${res.statusCode ?? 'unknown status'})`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_IMAGE_BYTES) {
            req.destroy(new Error('Image exceeds the 2.9 MB download limit'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('Image download timed out')));
    req.on('error', reject);
    req.end();
  });

  const mime = imageMime(bytes);
  if (!mime) throw new Error('Only PNG, JPEG, and WebP image files are supported');
  return `data:${mime};base64,${bytes.toString('base64')}`;
}
