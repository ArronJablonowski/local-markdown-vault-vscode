# Front Matter Preview — Historical Design

## Detection

Because the Markdown parser has no dedicated front matter node, detection uses a bounded line scan. It requires an exact opening delimiter on line 1 and the first later exact closing delimiter. The detected range and YAML body are returned without relying on the Markdown syntax tree.

## Rendering

The block-decoration field replaces the detected range with a property widget only when the cursor is outside it. Empty mappings use a zero-height placeholder, and parse failures use an inert error widget. Syntax-tree nodes overlapping the front matter range are skipped before other block widgets are created.

## Parsing and safety

The `yaml` package provides parsing and useful location information. The current implementation adds product-owned input, depth, node, alias, and output bounds and renders all values through DOM text APIs.

## Editing behavior

Opening a document that begins with front matter places the initial selection after the closing delimiter so the property view can render immediately. Explicit source mode or cursor entry reveals the original YAML.

This document records the initial architecture. Current implementation details and security constraints are authoritative in the source and tests.
