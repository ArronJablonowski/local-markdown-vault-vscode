# Malformed syntax must remain editable

Unclosed emphasis **bold _italic ~~strike

Unclosed links [label](javascript:alert(1) and ![image](../../../../etc/passwd

Incomplete wikilinks [[Missing note and ![[Missing embed

> [!warning]- Unclosed callout
> Content remains ordinary source text.

| broken | table |
| :--- | not-a-delimiter
| cell with a bare | separator | overflow |

```mermaid
graph TD
A["unterminated --> B
```

<script>window.__markdownScriptRan = true</script>

The editor remains usable after malformed syntax.
