---
name: batch-vectorize
description: Convert multiple images to SVG vectors in batch
---

Use the svg-new MCP server to batch process multiple images:

1. Call `batch_vectorize` with an array of base64-encoded images (up to 50)
2. Use `get_batch_status` to poll for completion
3. Each completed item has a prompt_id for retrieval
