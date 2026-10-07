# Meeting formatting QA October 7 2026

Fenced code now treats typed backticks as literal code characters. Markdown inline-code pairing previously inserted an extra backtick inside an existing fence and could wrap selected code as an inline span. The new regression failed before the fix in both 480-pixel and 1,100-pixel panes and passed afterward. Existing inline-code and automatic fence creation checks still pass.

Native macOS VS Code testing included character-by-character notes, corrections with Left and Right, Up and Down navigation, Shift+Arrow word selection, list indentation, changed objectives, callout title revisions, code entry, and editing earlier sections after adding follow-up actions. Accessibility observations and a screenshot allowed rendering to settle between navigation and edit batches.

The long synthetic note began with 800 lines and 30 each of tables, callouts, JavaScript blocks, and Mermaid flowcharts. Three exact editor-to-disk checks passed, including the final long-note revision at 11,951 bytes with SHA-256 `dbcac187a4c77d4ef4121ad436e42da615f4fb1540c970ada851bd588d14e93e`.

The native runner also recorded one failed expected-text check: the test expectation placed a manually typed space before a newline, while Right had moved the cursor onto the next line. Inspection corrected the expectation and the subsequent exact check passed. The runner's overall status remains failed because it retains that earlier check; it reported no editor or page errors.

Verification passed 57 meeting-note and object-revision browser tests, 64 code/fence-related browser tests, and the final four-test formatting regression file. These suites overlap and their counts should not be added. All 2,037 unit tests, source compilation, test type checking, and US English verification passed. The packaged extension passed its trusted, restricted, and disabled clean-profile smoke checks.

The native exercise used disposable files. It did not test native Windows or Linux interactions in this session.
