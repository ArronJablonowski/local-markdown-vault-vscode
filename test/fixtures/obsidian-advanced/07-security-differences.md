# Intentional security differences

The following constructs are comparison cases, not parity requirements. Local Markdown Vault deliberately keeps them inert or blocked.

<button onclick="alert('unsafe')">Raw HTML button</button>

![Blocked remote image](https://tracker.invalid/pixel.png)

[Blocked command](command:workbench.action.closeWindow)

[Blocked script](javascript:alert('unsafe'))

```mermaid
%%{init: {"securityLevel": "loose"}}%%
flowchart LR
    A[Strict mode remains enforced] --> B[Sanitized SVG]
```
