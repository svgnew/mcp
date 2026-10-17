# SVG.new

This extension connects Gemini CLI to the hosted SVG.new MCP server at `https://svg.new/api/mcp`. Its tools convert PNG, JPG and WebP images to SVG, recolor an SVG, reduce its colors or remove its background.

- Sign-in: the server uses OAuth with the user's SVG.new account, so no API key is needed. If the svg.new tools are missing, say sign-in is needed, or stop working after a while, ask the user to run `/mcp auth svg-new` and sign in in the browser.
- Credits: `vectorize`, `vectorize_file`, the batch tools and the background tools use the account's SVG.new credits. Recoloring, reducing colors, `get_batch_status` and `list_vectorizations` are free.
- Local files: call `create_upload`, run the `curl` command it returns, then pass the `upload_id` to `vectorize`, `remove_background` or `batch_vectorize`.
- Large results come back as one-hour download links. Save them with `curl -sL -o output.svg "<link>"`.
