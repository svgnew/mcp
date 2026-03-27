---
name: vectorize
description: Convert a raster image to a clean SVG vector using svg.new
---

Use the svg-new MCP server to convert raster images (PNG, JPG, WebP) to SVG vectors.

1. Call the `vectorize` tool with a base64-encoded image (include the data URL prefix like `data:image/png;base64,...`)
2. The tool returns the SVG content and a vectorization ID
3. You can then use `recolor_svg`, `simplify_svg`, or `remove_background` to edit the result
