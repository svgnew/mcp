# Installing the SVG.new MCP server

Instructions for an AI agent, such as Cline, that sets up this server for a user.

SVG.new converts PNG, JPG and WebP images to SVG, and can recolor an SVG, reduce its colors or remove its background. Vectorizing and removing a background use credits from the user's SVG.new account. Recoloring, reducing colors, checking a batch and listing past vectorizations are free.

There are two ways to connect. Use option 1 unless the user asks for a local server.

## Option 1: the hosted server (sign in, nothing to install)

The server runs at `https://svg.new/api/mcp` over Streamable HTTP. Add it to `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "svg-new": {
      "type": "streamableHttp",
      "url": "https://svg.new/api/mcp",
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

The server answers `401` until the user signs in. Clients that support OAuth find the sign-in from `https://svg.new/.well-known/oauth-protected-resource` and register themselves (dynamic client registration). The user signs in with their SVG.new account in the browser, or creates one. No API key is needed.

If the client can't sign in this way, use an API key in a header instead:

1. Ask the user to create an API key at https://svg.new/account. Keys start with `svk_` and are shown once.
2. Add the header to the same entry:

```json
{
  "mcpServers": {
    "svg-new": {
      "type": "streamableHttp",
      "url": "https://svg.new/api/mcp",
      "headers": { "Authorization": "Bearer svk_your_key_here" },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

## Option 2: the local server from npm (API key)

This runs `@svgnew/mcp` over stdio with `npx`, so it needs Node.js 18 or later. It needs an API key from https://svg.new/account.

```json
{
  "mcpServers": {
    "svg-new": {
      "command": "npx",
      "args": ["-y", "@svgnew/mcp"],
      "env": { "SVG_NEW_API_KEY": "svk_your_key_here" },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Ask the user for the key and put it in `env`. Don't write it into project files or commit it.

The local server has the same tools as the hosted one except `create_upload`, so images go in as a base64 data URL (`image`, up to about 100 KB) or a public HTTPS link (`image_url`, up to 20 MB).

## Check that it works

Call `list_vectorizations`. It is free and read-only. It returns the account's recent vectorizations, or "No vectorizations found." for a new account. An error that says the key or token is invalid means sign-in or the key needs fixing.

## Tools

- `vectorize`, `vectorize_file`: convert an image to SVG (1 credit)
- `batch_vectorize`, `batch_vectorize_files`: up to 10 images in one batch (1 credit each); `get_batch_status` checks progress
- `recolor_svg`: map old colors to new ones
- `simplify_svg`: reduce an SVG to at most N colors
- `remove_background`, `remove_background_file`: remove an SVG's background using its original image (1 credit)
- `create_upload`: an upload link for a local image up to 20 MB (hosted server only)
- `list_vectorizations`: recent vectorizations

Large results come back as one-hour download links. Save them with `curl -sL -o output.svg "<link>"`.
