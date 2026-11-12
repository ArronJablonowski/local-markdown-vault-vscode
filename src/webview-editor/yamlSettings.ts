let collapseByDefault = true;
/** New editor states use this preference; existing manual fold choices stay intact. */
export function setYamlDefault(collapsed: boolean): void { collapseByDefault = collapsed; }
export function yamlCollapsedByDefault(): boolean { return collapseByDefault; }
