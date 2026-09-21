# draw.io Sample

## 1. Inline XML fence

Place uncompressed draw.io XML inside a `drawio` code fence to render it in place.

```drawio
<mxfile>
  <diagram name="System Architecture">
    <mxGraphModel><root>
      <mxCell id="0"/>
      <mxCell id="1" parent="0"/>
      <mxCell id="web" value="Web Server" style="rounded=1;fillColor=#dae8fc;strokeColor=#6c8ebf" vertex="1" parent="1">
        <mxGeometry x="40" y="60" width="120" height="60" as="geometry"/>
      </mxCell>
      <mxCell id="api" value="API Server" style="rounded=1;fillColor=#d5e8d4;strokeColor=#82b366" vertex="1" parent="1">
        <mxGeometry x="220" y="60" width="120" height="60" as="geometry"/>
      </mxCell>
      <mxCell id="db" value="Database" style="shape=cylinder;fillColor=#ffe6cc;strokeColor=#d79b00" vertex="1" parent="1">
        <mxGeometry x="400" y="60" width="120" height="60" as="geometry"/>
      </mxCell>
      <mxCell id="edge1" edge="1" parent="1" source="web" target="api"><mxGeometry relative="1" as="geometry"/></mxCell>
      <mxCell id="edge2" edge="1" parent="1" source="api" target="db"><mxGeometry relative="1" as="geometry"/></mxCell>
    </root></mxGraphModel>
  </diagram>
</mxfile>
```

## 2. Basic shapes

```drawio
<mxGraphModel><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="a" value="Rectangle" vertex="1" parent="1"><mxGeometry x="20" y="20" width="100" height="50" as="geometry"/></mxCell>
  <mxCell id="b" value="Ellipse" style="ellipse" vertex="1" parent="1"><mxGeometry x="140" y="20" width="100" height="50" as="geometry"/></mxCell>
  <mxCell id="c" value="Decision" style="rhombus" vertex="1" parent="1"><mxGeometry x="260" y="15" width="90" height="60" as="geometry"/></mxCell>
</root></mxGraphModel>
```

## 3. External file reference

An uncompressed `.drawio` file inside the vault can be referenced like an image:

![Architecture diagram](./assets/architecture.drawio)

Files exported as `.drawio.svg` or `.drawio.png` remain ordinary images.
