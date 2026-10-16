import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { downloadImageDataUrl, downloadImageUrlDataUrl } from './download-image';

const imageFileSchema = z.object({
  download_url: z.string(),
  file_id: z.string(),
  mime_type: z.string().optional(),
  file_name: z.string().optional(),
});

// Inline SVGs above this size are returned as a download link instead (see `output`), so a
// large result does not have to travel through the model's context.
const INLINE_SVG_LIMIT = 64 * 1024;

const outputSchema = z
  .enum(['auto', 'inline', 'url'])
  .optional()
  .describe(
    'How to return the SVG: "inline" (the SVG text), "url" (a one-hour download link plus size and path count), or "auto" (default: inline up to 64 KB, link above).'
  );

/** The image argument shared by vectorize, remove_background and the batch tool: one of three forms. */
const imageArgs = {
  image: z.string().optional().describe('Base64 image data URL ("data:image/png;base64,…"), practical up to about 100 KB'),
  image_url: z.string().optional().describe('Public HTTPS URL of a PNG, JPEG or WebP (direct link, no redirect, up to 2.9 MB); the server fetches it'),
  upload_id: z.string().optional().describe('Id of a file sent with an upload ticket from create_upload (hosted svg.new MCP server only); the way to send a local file of any size'),
};

/** What a host provides so clients can send files over HTTP instead of inline base64. */
export type UploadHooks = {
  /** Mints a ticket for the authenticated caller. */
  create(): Promise<{ upload_url: string; ticket: string; upload_id: string; expires_at: string; max_bytes: number }>;
  /** The caller's uploaded image as a data URL; consumes the upload. */
  load(uploadId: string): Promise<string>;
};

type ImageArgs = { image?: string; image_url?: string; upload_id?: string };

/** The one data URL the tool should send upstream, from `image`, `image_url` or `upload_id`. */
export async function resolveImage(args: ImageArgs, loadUpload?: UploadHooks['load']): Promise<string> {
  const given = [args.image, args.image_url, args.upload_id].filter((v) => typeof v === 'string' && v.length > 0).length;
  if (given !== 1) {
    throw new Error('Give the image one way: `image` (base64 data URL), `image_url` (public HTTPS link) or `upload_id` (from create_upload)');
  }
  if (args.image) {
    if (!/^data:image\/(png|jpeg|jpg|webp);base64,/.test(args.image)) {
      throw new Error('`image` must be a data:image/<png|jpeg|webp>;base64,… URL');
    }
    return args.image;
  }
  if (args.upload_id) {
    if (!loadUpload) throw new Error('Uploads are not available on this server; use `image` or `image_url`');
    return loadUpload(args.upload_id);
  }
  return downloadImageUrlDataUrl(args.image_url!);
}

/** The text a client gets back from create_upload: the exact command to run, then what to call. */
export function uploadInstructions(t: Awaited<ReturnType<UploadHooks['create']>>): string {
  return [
    `Upload ticket ${t.upload_id} (valid until ${t.expires_at}, up to ${Math.floor(t.max_bytes / 1_000_000 * 10) / 10} MB, PNG/JPEG/WebP).`,
    'Send the file bytes with this command (replace the path):',
    `curl -sS -X POST -H "X-Upload-Ticket: ${t.ticket}" --data-binary @/path/to/image.png "${t.upload_url}"`,
    `Then call vectorize (or remove_background) with { "upload_id": "${t.upload_id}" }. The ticket works once.`,
  ].join('\n');
}

/** Size and shape count of an SVG, for the status line. */
export function svgStats(svg: string) {
  const bytes = Buffer.byteLength(svg);
  const paths = (svg.match(/<path\b/g) || []).length;
  return { bytes, paths, kb: Math.round(bytes / 1024) };
}

export function createSvgNewMcpServer(
  apiKey: string,
  apiBase = 'https://svg.new',
  options: { uploads?: UploadHooks } = {}
) {
  const loadUpload = options.uploads?.load;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  async function apiCall(path: string, body: Record<string, unknown>) {
    const payload = JSON.stringify(body);
    if (Buffer.byteLength(payload) > 4_000_000) {
      throw new Error('Image payload exceeds the hosted 4 MB request limit');
    }
    const res = await fetch(`${apiBase}${path}`, {
      method: 'POST',
      headers,
      body: payload,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `API error: ${res.status}`);
    }
    return data;
  }

  async function apiGet(path: string) {
    const res = await fetch(`${apiBase}${path}`, { headers });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `API error: ${res.status}`);
    }
    return data;
  }

  const server = new McpServer(
    { name: 'svg-new', version: '1.2.0' },
    {
      instructions:
        "Convert raster images to SVG, edit existing SVGs, and inspect the connected account's conversion history. Vectorization and background removal consume SVG.new credits. Give an image one of three ways: inline as a base64 data URL (small files, up to ~100 KB), as `image_url` (a public HTTPS link the server fetches itself, up to 2.9 MB), or as `upload_id` after sending the file with an upload ticket from create_upload (any local file up to 2.9 MB, nothing passes through the model). Results come back inline when small; larger SVGs come back as a one-hour download link (`output: \"url\"` asks for the link always), which a client can save with curl.",
    }
  );

  if (options.uploads) {
    const uploads = options.uploads;
    server.tool(
      'create_upload',
      'Get an upload ticket for sending a local image file to svg.new over HTTP (any size up to 2.9 MB) without pasting base64. Returns the curl command to run and the upload_id to pass to vectorize or remove_background afterwards.',
      {},
      { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
      async () => {
        try {
          const ticket = await uploads.create();
          return { content: [{ type: 'text', text: uploadInstructions(ticket) }] };
        } catch (e: any) {
          return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
        }
      }
    );
  }

  /** The vectorize result: inline SVG, or a download link for large output / on request. */
  async function vectorizeResult(data: any, output: 'auto' | 'inline' | 'url' | undefined) {
    const svg: string = data.svg;
    const stats = svgStats(svg);
    const status = `Vectorization complete (ID: ${data.id}): ${stats.kb} KB, ${stats.paths} paths. Credits remaining: ${data.metadata?.credits_remaining ?? 'unknown'}`;
    const asLink = output === 'url' || (output !== 'inline' && stats.bytes > INLINE_SVG_LIMIT);
    if (!asLink) {
      return { content: [{ type: 'text' as const, text: status }, { type: 'text' as const, text: svg }] };
    }
    let link: string | undefined;
    try {
      link = (await apiGet(`/api/vectorizations/${data.id}`)).svg_url;
    } catch {
      link = undefined;
    }
    if (!link) {
      return { content: [{ type: 'text' as const, text: `${status} (no download link available, returning the SVG inline)` }, { type: 'text' as const, text: svg }] };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: `${status}\nSVG download (valid for one hour): ${link}\nSave it with: curl -sL -o output.svg "${link}"`,
        },
      ],
    };
  }

  // Tool: vectorize an image
  server.tool(
    'vectorize',
    'Convert a raster image (PNG, JPG, WebP) to a clean SVG vector. Give the image inline (`image`, base64 data URL) or as a public HTTPS link (`image_url`).',
    {
      ...imageArgs,
      output: outputSchema,
    },
    { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    async ({ image, image_url, upload_id, output }) => {
      try {
        const data = await apiCall('/api/agent/vectorize', { image: await resolveImage({ image, image_url, upload_id }, loadUpload) });
        return await vectorizeResult(data, output);
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    'vectorize_file',
    {
      title: 'Vectorize an attached image',
      description:
        'Convert a user-supplied PNG, JPEG, or WebP file into an editable SVG. Uses SVG.new credits.',
      inputSchema: { file: imageFileSchema, output: outputSchema },
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
      _meta: { 'openai/fileParams': ['file'] },
    },
    async ({ file, output }) => {
      try {
        const image = await downloadImageDataUrl(file);
        const data = await apiCall('/api/agent/vectorize', { image });
        return await vectorizeResult(data, output);
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // Tool: recolor SVG shapes
  server.tool(
    'recolor_svg',
    'Change colors in an SVG. Provide a mapping of old colors to new colors.',
    {
      svg: z.string().describe('SVG content as a string'),
      color_map: z
        .record(z.string(), z.string())
        .describe('Map of old hex colors to new hex colors, e.g. {"#ff0000": "#0000ff"}'),
    },
    { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
    async ({ svg, color_map }) => {
      try {
        const data = await apiCall('/api/agent/edit/recolor', { svg, color_map });
        return { content: [{ type: 'text', text: data.svg }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // Tool: simplify SVG (reduce colors)
  server.tool(
    'simplify_svg',
    'Reduce the number of colors in an SVG by quantizing the palette.',
    {
      svg: z.string().describe('SVG content as a string'),
      max_colors: z
        .number()
        .int()
        .min(1)
        .max(256)
        .describe('Maximum number of colors to keep (1-256)'),
    },
    { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
    async ({ svg, max_colors }) => {
      try {
        const data = await apiCall('/api/agent/edit/simplify', { svg, max_colors });
        return {
          content: [
            {
              type: 'text',
              text: `Simplified from ${data.colors_before} to ${data.colors_after} colors.`,
            },
            { type: 'text', text: data.svg },
          ],
        };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // Tool: remove background
  server.tool(
    'remove_background',
    'Remove the background from an SVG using the original raster image for reference. Give the image inline (`image`) or as a public HTTPS link (`image_url`).',
    {
      svg: z.string().describe('SVG content as a string'),
      ...imageArgs,
    },
    { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    async ({ svg, image, image_url, upload_id }) => {
      try {
        const data = await apiCall('/api/agent/edit/remove-background', {
          svg,
          image: await resolveImage({ image, image_url, upload_id }, loadUpload),
        });
        return { content: [{ type: 'text', text: data.svg }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    'remove_background_file',
    {
      title: 'Remove an SVG background using an attached image',
      description:
        'Remove the background from an SVG using its original user-supplied raster image. Uses SVG.new credits.',
      inputSchema: { svg: z.string(), file: imageFileSchema },
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
      _meta: { 'openai/fileParams': ['file'] },
    },
    async ({ svg, file }) => {
      try {
        const image = await downloadImageDataUrl(file);
        const data = await apiCall('/api/agent/edit/remove-background', { svg, image });
        return { content: [{ type: 'text', text: data.svg }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // Tool: submit batch vectorization
  server.tool(
    'batch_vectorize',
    'Submit multiple images for batch vectorization (up to 10 across base64 data URLs in `images`, public HTTPS links in `image_urls` and ticket uploads in `upload_ids`). Returns a batch ID for polling.',
    {
      images: z.array(z.string()).max(10).optional().describe('Base64 image data URLs'),
      image_urls: z.array(z.string()).max(10).optional().describe('Public HTTPS image links the server fetches itself'),
      upload_ids: z.array(z.string()).max(10).optional().describe('Ids of files sent with upload tickets from create_upload (hosted server only)'),
    },
    { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    async ({ images = [], image_urls = [], upload_ids = [] }) => {
      try {
        const total = images.length + image_urls.length + upload_ids.length;
        if (total === 0 || total > 10) {
          throw new Error('Give between 1 and 10 images across `images`, `image_urls` and `upload_ids`');
        }
        const fetched = await Promise.all([
          ...image_urls.map((url) => resolveImage({ image_url: url })),
          ...upload_ids.map((id) => resolveImage({ upload_id: id }, loadUpload)),
        ]);
        const data = await apiCall('/api/agent/batch', {
          images: [...images, ...fetched].map((img) => ({ image: img })),
        });
        return {
          content: [
            {
              type: 'text',
              text: `Batch submitted: ${data.batch_id} (${data.total_items} items). Poll status with get_batch_status.`,
            },
          ],
        };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    'batch_vectorize_files',
    {
      title: 'Vectorize attached images as a batch',
      description:
        'Submit up to 10 user-supplied PNG, JPEG, or WebP files for vectorization. Uses SVG.new credits.',
      inputSchema: { files: z.array(imageFileSchema).min(1).max(10) },
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
      _meta: { 'openai/fileParams': ['files'] },
    },
    async ({ files }) => {
      try {
        const images = await Promise.all(files.map(downloadImageDataUrl));
        const data = await apiCall('/api/agent/batch', {
          images: images.map((image) => ({ image })),
        });
        return {
          content: [
            {
              type: 'text',
              text: `Batch submitted: ${data.batch_id} (${data.total_items} items). Poll status with get_batch_status.`,
            },
          ],
        };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // Tool: get batch status
  server.tool(
    'get_batch_status',
    'Check the status of a batch vectorization job.',
    {
      batch_id: z.string().describe('Batch job ID returned from batch_vectorize'),
    },
    { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
    async ({ batch_id }) => {
      try {
        const data = await apiGet(`/api/agent/batch/${batch_id}`);
        const summary = `Status: ${data.status} | Completed: ${data.completed_items}/${data.total_items} | Failed: ${data.failed_items}`;
        const items = (data.items || [])
          .filter((i: any) => i.status === 'completed')
          .map((i: any) => `Item ${i.index}: ${i.prompt_id || 'no id'}`)
          .join('\n');
        return {
          content: [
            { type: 'text', text: summary },
            ...(items ? [{ type: 'text' as const, text: items }] : []),
          ],
        };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // Tool: list vectorizations
  server.tool(
    'list_vectorizations',
    'List recent vectorizations for the authenticated user.',
    {},
    { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
    async () => {
      try {
        const data = await apiGet('/api/vectorizations');
        const list = (data.vectorizations || data || [])
          .slice(0, 20)
          .map((v: any) => `${v.id} — ${v.created_at}`)
          .join('\n');
        return { content: [{ type: 'text', text: list || 'No vectorizations found.' }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  return server;
}
