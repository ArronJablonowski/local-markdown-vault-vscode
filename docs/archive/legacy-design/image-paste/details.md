# Image Paste and Drop — Original Detailed Design

The webview identified supported clipboard or dropped image files, read them as base64, and sent the insertion position, declared MIME type, and data to the host. If the insertion point was inside a Markdown table, it moved the image to a separate paragraph after the table to avoid corrupting row syntax.

The host mapped the MIME type to an extension, created an attachment directory, selected an unused filename, wrote the bytes, inserted a relative Markdown image link, and returned the new cursor position. Document synchronization then delivered the authoritative edit back to the webview.

This historical design predates the current security boundary. The production implementation now validates actual raster bytes and dimensions, enforces bounded batches and sizes, resolves symlinks, confines every path to the active vault, and rolls back rejected writes.
