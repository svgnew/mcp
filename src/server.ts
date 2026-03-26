#!/usr/bin/env npx tsx
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_BASE = process.env.SVG_NEW_API_URL || 'https://svg.new';
const API_KEY = process.env.SVG_NEW_API_KEY || '';

if (!API_KEY) {
  console.error('SVG_NEW_API_KEY environment variable is required');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
};

async function apiCall(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `API error: ${res.status}`);
  }
  return data;
}

async function apiGet(path: string) {
  const res = await fetch(`${API_BASE}${path}`, { headers });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `API error: ${res.status}`);
  }
  return data;
}

const server = new McpServer({
  name: 'svg-new',
  version: '1.0.0',
});

// Tool: vectorize an image
server.tool(
  'vectorize',
  'Convert a raster image (PNG, JPG, WebP) to a clean SVG vector. Accepts a base64-encoded image.',
  {
    image: z.string().describe('Base64-encoded image data, with or without data URL prefix (e.g. "data:image/png;base64,...")'),
  },
  async ({ image }) => {
    try {
      const data = await apiCall('/api/agent/vectorize', { image });
      return {
        content: [
          { type: 'text', text: `Vectorization complete (ID: ${data.id}). Credits remaining: ${data.metadata?.credits_remaining ?? 'unknown'}` },
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
    color_map: z.record(z.string(), z.string()).describe('Map of old hex colors to new hex colors, e.g. {"#ff0000": "#0000ff"}'),
  },
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
    max_colors: z.number().int().min(1).max(256).describe('Maximum number of colors to keep (1-256)'),
  },
  async ({ svg, max_colors }) => {
    try {
      const data = await apiCall('/api/agent/edit/simplify', { svg, max_colors });
      return {
        content: [
          { type: 'text', text: `Simplified from ${data.colors_before} to ${data.colors_after} colors.` },
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
  async ({ svg, image }) => {
    try {
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
    images: z.array(z.string()).min(1).max(50).describe('Array of base64-encoded images (with or without data URL prefix)'),
  },
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

// Tool: get batch status
server.tool(
  'get_batch_status',
  'Check the status of a batch vectorization job.',
  {
    batch_id: z.string().describe('Batch job ID returned from batch_vectorize'),
  },
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

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error('MCP server error:', e);
  process.exit(1);
});
