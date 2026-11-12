# Displaying YAML

This fenced block displays YAML as code, without treating it as note properties.

```yaml
service:
  name: local-vault
  enabled: true
  port: 8080
tags:
  - notes
  - local
description: |
  A local Markdown workspace.
```

The shorter `yml` label also works:

```yml
review:
  owner: Alex
  complete: false
```
