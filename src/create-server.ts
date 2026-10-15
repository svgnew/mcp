import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { downloadImageDataUrl } from './download-image';

const imageFileSchema = z.object({
  download_url: z.string(),
  file_id: z.string(),
  mime_type: z.string().optional(),
  file_name: z.string().optional(),
});

export function createSvgNewMcpServer(apiKey: string, apiBase = 'https://svg.new') {
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
    { name: 'svg-new', version: '1.0.0' },
    {
      instructions:
        "Convert supplied raster images to SVG, edit existing SVGs, and inspect the connected account's conversion history. Vectorization and background removal consume SVG.new credits. Image inputs must be real base64 data URLs; ask for an accessible source image when bytes are unavailable.",
    }
  );

  // Tool: vectorize an image
  server.tool(
    'vectorize',
    'Convert a raster image (PNG, JPG, WebP) to a clean SVG vector. Accepts a base64-encoded image.',
    {
      image: z.string().describe('Base64 image data URL (e.g. "data:image/png;base64,...")'),
    },
    { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    async ({ image }) => {
      try {
        const data = await apiCall('/api/agent/vectorize', { image });
        return {
          content: [
            {
              type: 'text',
              text: `Vectorization complete (ID: ${data.id}). Credits remaining: ${data.metadata?.credits_remaining ?? 'unknown'}`,
            },
            { type: 'text', text: data.svg },
          ],
        };
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
      inputSchema: { file: imageFileSchema },
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
      _meta: { 'openai/fileParams': ['file'] },
    },
    async ({ file }) => {
      try {
        const image = await downloadImageDataUrl(file);
        const data = await apiCall('/api/agent/vectorize', { image });
        return {
          content: [
            {
              type: 'text',
              text: `Vectorization complete (ID: ${data.id}). Credits remaining: ${data.metadata?.credits_remaining ?? 'unknown'}`,
            },
            { type: 'text', text: data.svg },
          ],
        };
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
    'Remove the background from an SVG using the original raster image for reference.',
    {
      svg: z.string().describe('SVG content as a string'),
      image: z.string().describe('Original raster image as base64 data URL'),
    },
    { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    async ({ svg, image }) => {
      try {
        const data = await apiCall('/api/agent/edit/remove-background', { svg, image });
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
    'Submit multiple images for batch vectorization. Returns a batch ID for polling.',
    {
      images: z
        .array(z.string())
        .min(1)
        .max(10)
        .describe('Array of up to 10 base64 image data URLs'),
    },
    { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    async ({ images }) => {
      try {
        const data = await apiCall('/api/agent/batch', {
          images: images.map((img) => ({ image: img })),
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
