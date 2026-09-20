---
title: Security corpus
aliases: &aliases [one, two]
copy: *aliases
unsafe: "<img src=x onerror=alert(1)>"
---

# Hostile Markdown must remain inert

<script>window.__markdownScriptRan = true</script>
<img src="x" onerror="window.__markdownHandlerRan = true">
<iframe src="https://evil.invalid/frame"></iframe>
<object data="https://evil.invalid/object"></object>
<embed src="https://evil.invalid/embed">
<form action="https://evil.invalid/submit"><input name="secret"></form>

![tracking pixel](https://tracker.invalid/pixel.png)
![data image](data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>)
![traversal](../../../../etc/passwd)
![encoded traversal](..%2f..%2f..%2fetc%2fpasswd)

[JavaScript](javascript:alert(1))
[Command](command:workbench.action.closeWindow)
[One-letter URI scheme](x:payload)
[Drive-relative ambiguity](C:relative-drive-path.md)
[VS Code](vscode://settings)
[Data](data:text/html,<script>alert(1)</script>)
[Blob](blob:https://evil.invalid/id)
[Protocol relative](//evil.invalid/path)
[Absolute file](file:///etc/passwd)
[Malformed HTTPS](https:missing-authority.example)

```mermaid
%%{init: {"securityLevel": "loose", "maxEdges": 999999}}%%
graph TD
A["<img src=x onerror=alert(1)>"] --> B
click A "javascript:alert(1)"
```

```drawio
<?xml version="1.0"?>
<!DOCTYPE mxfile [<!ENTITY outside SYSTEM "file:///etc/passwd">]>
<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="&outside;" vertex="1" parent="1"><mxGeometry width="120" height="40" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>
```
