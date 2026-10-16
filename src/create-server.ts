import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';


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
  image_url: z.string().optional().describe('Public HTTPS URL of a PNG, JPEG or WebP (direct link, no redirect, up to 20 MB); the API fetches it'),
  upload_id: z.string().optional().describe('Id of a file sent with create_upload (hosted svg.new MCP server only), up to 20 MB; the API reads it from storage'),
};

/** The SVG argument shared by the editing tools: inline text or a public HTTPS URL (e.g. the link a vectorize result gave). */
const svgArgs = {
  svg: z.string().optional().describe('SVG content as a string (small SVGs)'),
  svg_url: z.string().optional().describe('Public HTTPS URL of the SVG, e.g. the download link from vectorize (up to 20 MB); the API fetches it'),
};

/** What a host provides so clients can send files over HTTP instead of inline base64. */
export type UploadHooks = {
  /** Mints an upload for the authenticated caller: a signed storage URL the client PUTs the file to. */
  create(): Promise<{ put_url: string; upload_id: string; expires_at: string; max_bytes: number }>;
};

type ImageArgs = { image?: string; image_url?: string; upload_id?: string };
type SvgArgs = { svg?: string; svg_url?: string };

/**
 * The image fields to send to the API: exactly one of `image`, `image_url`, `upload_id`. The API
 * fetches URLs and reads uploads itself, so no bytes pass through here except an inline `image`.
 */
export function imageFields(args: ImageArgs, uploadsAvailable: boolean): Record<string, string> {
  const given = [args.image, args.image_url, args.upload_id].filter((v) => typeof v === 'string' && v.length > 0).length;
  if (given !== 1) {
    throw new Error('Give the image one way: `image` (base64 data URL), `image_url` (public HTTPS link) or `upload_id` (from create_upload)');
  }
  if (args.image) {
    if (!/^data:image\/(png|jpeg|jpg|webp);base64,/.test(args.image)) {
      throw new Error('`image` must be a data:image/<png|jpeg|webp>;base64,… URL');
    }
    return { image: args.image };
  }
  if (args.upload_id) {
    if (!uploadsAvailable) throw new Error('Uploads are not available on this server; use `image` or `image_url`');
    return { upload_id: args.upload_id };
  }
  return { image_url: args.image_url! };
}

/** The SVG fields to send to the API: exactly one of `svg`, `svg_url`. */
export function svgFields(args: SvgArgs): Record<string, string> {
  const given = [args.svg, args.svg_url].filter((v) => typeof v === 'string' && v.length > 0).length;
  if (given !== 1) throw new Error('Give the SVG one way: `svg` (the text) or `svg_url` (a public HTTPS link)');
  return args.svg ? { svg: args.svg } : { svg_url: args.svg_url! };
}

/** The text a client gets back from create_upload: the exact command to run, then what to call. */
export function uploadInstructions(t: Awaited<ReturnType<UploadHooks['create']>>): string {
  return [
    `Upload ${t.upload_id} (valid until ${t.expires_at}, up to ${Math.floor((t.max_bytes / 1_000_000) * 10) / 10} MB, PNG/JPEG/WebP).`,
    'Send the file with this command (replace the path; set Content-Type to image/png, image/jpeg or image/webp):',
    `curl -sS -X PUT -H "Content-Type: image/png" --upload-file /path/to/image.png "${t.put_url}"`,
    `Then call vectorize with { "upload_id": "${t.upload_id}" } (remove_background and batch_vectorize take it too, up to 2.9 MB). The upload works once.`,
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
  const uploadsAvailable = !!options.uploads;
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
        "Convert raster images to SVG, edit existing SVGs, and inspect the connected account's conversion history. Vectorization and background removal consume SVG.new credits. Give an image one of three ways: inline as a base64 data URL (small files, up to ~100 KB), as `image_url` (a public HTTPS link the API fetches itself, up to 20 MB), or as `upload_id` after sending the file with create_upload (any local file up to 20 MB, nothing passes through the model). Editing tools take the SVG inline (`svg`) or by link (`svg_url`, e.g. the link a previous result gave). Results come back inline when small; larger ones come back as one-hour download links (`output: \"url\"` asks for links always), which a client can save with curl.",
    }
  );

  if (options.uploads) {
    const uploads = options.uploads;
    server.registerTool(
      'create_upload',
      {
        title: 'Get an upload link for a local image',
        description: 'Get an upload URL for sending a local image file to svg.new over HTTP (up to 20 MB) without pasting base64. Returns the curl command to run and the upload_id to pass to vectorize afterwards.',
        inputSchema: {},
        annotations: { title: 'Get an upload link for a local image', readOnlyHint: false, openWorldHint: true, destructiveHint: false },
      },
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
    const svg: string | undefined = typeof data.svg === 'string' ? data.svg : undefined;
    const stats = svg ? svgStats(svg) : { bytes: data.svg_bytes ?? 0, paths: data.paths ?? 0, kb: Math.round((data.svg_bytes ?? 0) / 1024) };
    const status = `Vectorization complete (ID: ${data.id}): ${stats.kb} KB, ${stats.paths} paths. Credits remaining: ${data.metadata?.credits_remaining ?? 'unknown'}`;
    if (!svg) {
      // The API kept the SVG in storage (large result, or a storage-backed upload) and sent a link.
      const link: string | undefined = data.svg_url;
      if (!link) return { content: [{ type: 'text' as const, text: `${status} (the API returned neither the SVG nor a link)` }], isError: true };
      return { content: [{ type: 'text' as const, text: `${status}\nSVG download (valid for one hour): ${link}\nSave it with: curl -sL -o output.svg "${link}"` }] };
    }
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
  server.registerTool(
    'vectorize',
    {
      title: 'Vectorize an image',
      description: 'Convert a raster image (PNG, JPG, WebP) to a clean SVG vector. Give the image inline (`image`, base64 data URL) or as a public HTTPS link (`image_url`).',
      inputSchema: {
        ...imageArgs,
        output: outputSchema,
      },
      annotations: { title: 'Vectorize an image', readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    },
    async ({ image, image_url, upload_id, output }) => {
      try {
        // References are passed through: the API fetches URLs and reads uploads itself, and
        // answers with a link when the result is large or when asked.
        const data = await apiCall('/api/agent/vectorize', { ...imageFields({ image, image_url, upload_id }, uploadsAvailable), ...(output === 'url' ? { output: 'url' } : {}) });
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
      annotations: { title: 'Vectorize an attached image', readOnlyHint: false, openWorldHint: true, destructiveHint: false },
      _meta: { 'openai/fileParams': ['file'] },
    },
    async ({ file, output }) => {
      try {
        const data = await apiCall('/api/agent/vectorize', { image_url: file.download_url, ...(output === 'url' ? { output: 'url' } : {}) });
        return await vectorizeResult(data, output);
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  /** An editing result: the SVG text when the API sent it, else its download link. */
  function svgResult(data: any, lead?: string) {
    const parts: { type: 'text'; text: string }[] = [];
    if (lead) parts.push({ type: 'text', text: lead });
    if (typeof data.svg === 'string') parts.push({ type: 'text', text: data.svg });
    else if (data.svg_url) parts.push({ type: 'text', text: `SVG download (valid for one hour): ${data.svg_url}${data.png_url ? `\nTransparent PNG: ${data.png_url}` : ''}\nSave it with: curl -sL -o output.svg "${data.svg_url}"` });
    else return { content: [{ type: 'text' as const, text: 'Error: the API returned neither the SVG nor a link' }], isError: true };
    return { content: parts };
  }

  // Tool: recolor SVG shapes
  server.registerTool(
    'recolor_svg',
    {
      title: 'Recolor an SVG',
      description: 'Change colors in an SVG (given inline or by svg_url). Provide a mapping of old colors to new colors.',
      inputSchema: {
        ...svgArgs,
        color_map: z
          .record(z.string(), z.string())
          .describe('Map of old hex colors to new hex colors, e.g. {"#ff0000": "#0000ff"}'),
        output: outputSchema,
      },
      annotations: { title: 'Recolor an SVG', readOnlyHint: true, openWorldHint: true, destructiveHint: false },
    },
    async ({ svg, svg_url, color_map, output }) => {
      try {
        const data = await apiCall('/api/agent/edit/recolor', { ...svgFields({ svg, svg_url }), color_map, ...(output === 'url' ? { output: 'url' } : {}) });
        return svgResult(data);
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // Tool: simplify SVG (reduce colors)
  server.registerTool(
    'simplify_svg',
    {
      title: 'Reduce an SVG\'s colors',
      description: 'Reduce the number of colors in an SVG (given inline or by svg_url) by quantizing the palette.',
      inputSchema: {
        ...svgArgs,
        max_colors: z
          .number()
          .int()
          .min(1)
          .max(256)
          .describe('Maximum number of colors to keep (1-256)'),
        output: outputSchema,
      },
      annotations: { title: 'Reduce an SVG\'s colors', readOnlyHint: true, openWorldHint: true, destructiveHint: false },
    },
    async ({ svg, svg_url, max_colors, output }) => {
      try {
        const data = await apiCall('/api/agent/edit/simplify', { ...svgFields({ svg, svg_url }), max_colors, ...(output === 'url' ? { output: 'url' } : {}) });
        return svgResult(data, `Simplified from ${data.colors_before} to ${data.colors_after} colors.`);
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // Tool: remove background
  server.registerTool(
    'remove_background',
    {
      title: 'Remove an SVG\'s background',
      description: 'Remove the background from an SVG (inline or by svg_url) using the original raster image, given inline (`image`), as a public HTTPS link (`image_url`) or as an upload (`upload_id`).',
      inputSchema: {
        ...svgArgs,
        ...imageArgs,
        output: outputSchema,
      },
      annotations: { title: 'Remove an SVG\'s background', readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    },
    async ({ svg, svg_url, image, image_url, upload_id, output }) => {
      try {
        const data = await apiCall('/api/agent/edit/remove-background', {
          ...svgFields({ svg, svg_url }),
          ...imageFields({ image, image_url, upload_id }, uploadsAvailable),
          ...(output === 'url' ? { output: 'url' } : {}),
        });
        return svgResult(data);
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
      annotations: { title: 'Remove an SVG background using an attached image', readOnlyHint: false, openWorldHint: true, destructiveHint: false },
      _meta: { 'openai/fileParams': ['file'] },
    },
    async ({ svg, file }) => {
      try {
        const data = await apiCall('/api/agent/edit/remove-background', { svg, image_url: file.download_url });
        return svgResult(data);
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // Tool: submit batch vectorization
  server.registerTool(
    'batch_vectorize',
    {
      title: 'Vectorize images as a batch',
      description: 'Submit multiple images for batch vectorization (up to 10 across base64 data URLs in `images`, public HTTPS links in `image_urls` and ticket uploads in `upload_ids`). Returns a batch ID for polling.',
      inputSchema: {
        images: z.array(z.string()).max(10).optional().describe('Base64 image data URLs'),
        image_urls: z.array(z.string()).max(10).optional().describe('Public HTTPS image links the server fetches itself'),
        upload_ids: z.array(z.string()).max(10).optional().describe('Ids of files sent with create_upload (hosted server only)'),
      },
      annotations: { title: 'Vectorize images as a batch', readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    },
    async ({ images = [], image_urls = [], upload_ids = [] }) => {
      try {
        const total = images.length + image_urls.length + upload_ids.length;
        if (total === 0 || total > 10) {
          throw new Error('Give between 1 and 10 images across `images`, `image_urls` and `upload_ids`');
        }
        if (upload_ids.length && !uploadsAvailable) throw new Error('Uploads are not available on this server; use `images` or `image_urls`');
        const data = await apiCall('/api/agent/batch', {
          images: [
            ...images.map((image) => ({ image })),
            ...image_urls.map((image_url) => ({ image_url })),
            ...upload_ids.map((upload_id) => ({ upload_id })),
          ],
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
      annotations: { title: 'Vectorize attached images as a batch', readOnlyHint: false, openWorldHint: true, destructiveHint: false },
      _meta: { 'openai/fileParams': ['files'] },
    },
    async ({ files }) => {
      try {
        const data = await apiCall('/api/agent/batch', {
          images: files.map((file) => ({ image_url: file.download_url })),
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
  server.registerTool(
    'get_batch_status',
    {
      title: 'Check a batch\'s progress',
      description: 'Check the status of a batch vectorization job.',
      inputSchema: {
        batch_id: z.string().describe('Batch job ID returned from batch_vectorize'),
      },
      annotations: { title: 'Check a batch\'s progress', readOnlyHint: true, openWorldHint: true, destructiveHint: false },
    },
    async ({ batch_id }) => {
      try {
        const data = await apiGet(`/api/agent/batch/${batch_id}`);
        const summary = `Status: ${data.status} | Completed: ${data.completed_items}/${data.total_items} | Failed: ${data.failed_items}`;
        const items = (data.items || [])
          .map((i: any) => `Item ${i.index}: ${i.status}${i.svg_url ? ` — ${i.svg_url}` : ''}${i.error ? ` — ${i.error}` : ''}`)
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
  server.registerTool(
    'list_vectorizations',
    {
      title: 'List recent vectorizations',
      description: 'List recent vectorizations for the authenticated user.',
      inputSchema: {},
      annotations: { title: 'List recent vectorizations', readOnlyHint: true, openWorldHint: true, destructiveHint: false },
    },
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
