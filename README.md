# @svgnew/mcp

MCP (Model Context Protocol) server for [svg.new](https://svg.new) — AI-powered image to SVG vectorization.

Use svg.new from any MCP-compatible client: Claude Code, Claude Desktop, Cursor, Windsurf, and more.

## Quick Start

```bash
npx @svgnew/mcp
```

Requires `SVG_NEW_API_KEY` environment variable. Get your key at [svg.new/account](https://svg.new/account).

## Setup

### Claude Code / Claude Desktop

Add to your MCP config:

```json
{
  "mcpServers": {
    "svg-new": {
      "command": "npx",
      "args": ["@svgnew/mcp"],
      "env": {
        "SVG_NEW_API_KEY": "svk_your_key_here"
      }
    }
  }
}
```

### Cursor / Windsurf

Add to your MCP settings with the same configuration above.

### OpenAI Codex CLI

Add svg.new to Codex:

```
codex mcp add svg-new -- npx -y @svgnew/mcp
```

Or install as a plugin:

```
codex install svg-new
```

Set your API key:

```
codex mcp add svg-new --env SVG_NEW_API_KEY=svk_your_key_here -- npx -y @svgnew/mcp
```

## Available Tools

| Tool | Description | Cost |
|------|-------------|------|
| `vectorize` | Convert image to SVG | 1 credit |
| `recolor_svg` | Change colors in SVG | Free |
| `simplify_svg` | Reduce color palette | Free |
| `remove_background` | AI background removal | 1 credit |
| `batch_vectorize` | Process multiple images | 1 credit/image |
| `get_batch_status` | Poll batch progress | Free |
| `list_vectorizations` | View history | Free |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SVG_NEW_API_KEY` | Yes | — | Your svg.new API key |
| `SVG_NEW_API_URL` | No | `https://svg.new` | API base URL |

## Links

- [svg.new](https://svg.new) — Web app
- [Pricing](https://svg.new/pricing) — Plans and credits
- [Claude Code Plugin](https://github.com/svgnew/plugin) — Full plugin with skills
