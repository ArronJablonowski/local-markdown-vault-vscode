import { StateEffect } from '@codemirror/state';

/** Refresh cached rendering without pretending the user moved the selection. */
export const refreshPreview = StateEffect.define<null>();
