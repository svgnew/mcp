# SVG.new for Cursor

Cursor plugin that connects the agent to the hosted [SVG.new](https://svg.new) MCP server at `https://svg.new/api/mcp`.

The agent can convert PNG, JPG and WebP images to SVG, recolor an SVG, reduce its colors or remove its background, and list the account's recent conversions.

## Install

1. Open **Cursor Settings → Plugins** and search for **SVG.new**.
2. Click **Install**, then sign in with your SVG.new account when Cursor asks. There is no API key to copy.

## MCP

```json
{
  "mcpServers": {
    "svg-new": {
      "type": "http",
      "url": "https://svg.new/api/mcp"
    }
  }
}
```

Sign-in is OAuth. The server answers `401` until you sign in, and Cursor finds the sign-in page from `https://svg.new/.well-known/oauth-protected-resource`. To use an API key instead, create one at [svg.new/account](https://svg.new/account) and add `"headers": { "Authorization": "Bearer svk_..." }` to the entry.

## Tools

| Tool | What it does | Cost |
|------|--------------|------|
| `vectorize`, `vectorize_file` | Convert an image to SVG | 1 credit |
| `batch_vectorize`, `batch_vectorize_files` | Convert up to 10 images in one batch | 1 credit each |
| `get_batch_status` | Check a batch's progress | Free |
| `recolor_svg` | Map old colors to new ones | Free |
| `simplify_svg` | Reduce an SVG to at most N colors | Free |
| `remove_background`, `remove_background_file` | Remove an SVG's background using its original image | 1 credit |
| `create_upload` | Get an upload link for a local image up to 20 MB | Free |
| `list_vectorizations` | List recent vectorizations | Free |

Free accounts get 1 vectorization a day. Large results come back as one-hour download links.

## Links

- [Setup for other clients](https://svg.new/mcp)
- [Pricing](https://svg.new/pricing)
- [Privacy](https://svg.new/privacy)
- Support: contact@svg.new

## License

MIT
