# Compatibility 091

Fixture path: `unicode-stress-and-security/091-compatibility-091.md`.

## Unicode, stress, and security

Résumé · naïve · coöperate · façade · jalapeño · smörgåsbord · 😀 · 👩🏽‍💻 · é · 𝄞

Very long token: `segment-segment-segment-segment-segment-segment-segment-segment-segment-segment-segment-segment-segment-segment-segment-segment-segment-segment-segment-segment-end`.

Raw HTML must stay inert: <button onclick="alert('blocked')">Do not run</button>.

Unsafe links must stay inert: [script](javascript:alert(1)) and [command](command:workbench.action.openSettings).

Encoded traversal image: ![blocked](%2e%2e/%2e%2e/secret.png)

```mermaid
graph TD
  A[Start] --> B[Safe node 1]
  B --> C[End]
```
