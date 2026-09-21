# Complex Table Rendering Checks

## 1. Nested formatting

| Syntax | Expected rendering |
| --- | --- |
| `***bold italic***` | ***bold italic*** |
| `**bold with *italic***` | **bold with *italic*** |
| `[link](https://example.com)` | [link](https://example.com) |

## 2. Underscores and symbols

| Syntax | Expected rendering |
| --- | --- |
| `_em_` and `__strong__` | _em_ and __strong__ |
| `2 * 3` | 2 * 3 |
| escaped pipe | `a \| b` |

## 3. Code and inert HTML

| Case | Value |
| --- | --- |
| Multiple backticks | ``a`b`` |
| Markdown in code | `**not bold**` |
| Line break | first<br>second |
| Raw tag | <b>literal</b> |
| Symbols | 1 < 2 & 3 |

## 4. Alignment

| Left | Center | Right |
| :--- | :---: | ---: |
| A | B | C |

## 5. Uneven rows

| A | B | C |
| --- | --- | --- |
| one | two |
| one | two | three | ignored |

## 6. Table inside a list

- Weighted actions:
  | Action | Points |
  | --- | ---: |
  | Delivery | **1** |
