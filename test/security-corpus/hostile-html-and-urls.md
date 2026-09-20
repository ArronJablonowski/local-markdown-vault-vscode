# URL and HTML boundary fixture

<script>window.__markdownScriptRan = true</script>
<img src="https://network.invalid/raw-image" onerror="window.__markdownHandlerRan = true">
<iframe src="https://network.invalid/frame"></iframe>
<object data="https://network.invalid/object"></object>
<embed src="https://network.invalid/embed">
<form id="location" name="location" action="https://network.invalid/form"><input name="cookie"></form>
<a id="constructor" name="__proto__" href="javascript:alert(1)">clobber</a>
<svg><foreignObject><img src="https://network.invalid/svg" onerror="alert(1)"></foreignObject></svg>

![HTTPS tracker](https://network.invalid/pixel.png)
![HTTP tracker](http://network.invalid/pixel.png)
![protocol relative](//network.invalid/pixel.png)
![SVG data](data:image/svg+xml,%3Csvg%20onload%3Dalert(1)%3E%3C/svg%3E)
![blob](blob:https://network.invalid/opaque)
![file](file:///etc/passwd)

[mixed JavaScript](JaVaScRiPt:alert(1))
[encoded JavaScript](java%73cript:alert(1))
[command](COMMAND:workbench.action.closeWindow)
[VS Code](VsCoDe://settings)
[data](DATA:text/html,%3Cscript%3Ealert(1)%3C/script%3E)
[blob](BLOB:https://network.invalid/opaque)
[file](FILE:///etc/passwd)
[protocol relative](//network.invalid/path)
[newline](https://safe.invalid/%0Ajavascript:alert(1))
[null](https://safe.invalid/%00javascript:alert(1))
[one-letter scheme](x:payload)
[drive-relative](C:relative.md)
