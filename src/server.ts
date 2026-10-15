#!/usr/bin/env npx tsx
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSvgNewMcpServer } from './create-server.js';

const apiKey = process.env.SVG_NEW_API_KEY;
if (!apiKey) {
  console.error('SVG_NEW_API_KEY environment variable is required');
  process.exit(1);
}

const server = createSvgNewMcpServer(apiKey, process.env.SVG_NEW_API_URL || 'https://svg.new');
server.connect(new StdioServerTransport()).catch((error) => {
  console.error('MCP server error:', error);
  process.exit(1);
});
