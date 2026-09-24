# Sticky table alignment - September 24, 2026

The reported vertical/horizontal alignment issue was reproduced with unequal
column widths and a theme applying content-box padding and automatic table
layout. The sticky copy drifted by approximately 46 pixels in the regression.
This reproduces an alignment failure, but does not establish which theme or
version produced the user's screenshot.

The sticky copy now uses a measured column group and fixed border-box table
geometry. Header cells no longer add padding to measured column widths. These
geometry rules take precedence over theme layout overrides; colors and typography
remain themed. Showing a previously hidden header refreshes its geometry before
restoring the horizontal scroll offset, because hidden elements have no usable
scroll range.

Four new browser scenarios cover locked/editing modes, default/custom themes,
unequal wide columns, repeated vertical movement, left/middle/right horizontal
offsets, scrolling before the header becomes visible, and wheel gestures over
the sticky header. Assertions compare header and body column positions and widths
within two CSS pixels. Existing table tests also cover multiple tables, resizing,
source controls, and cell editing. All 20 focused table scenarios passed, and
rendered alignment was visually inspected.

No document content, network permissions, resource limits, or security policy
was changed by this fix.
