import { StateEffect, StateField } from '@codemirror/state';
import { yamlCollapsedByDefault } from './yamlSettings';

export const setFrontmatterExpanded = StateEffect.define<boolean>();
export const frontmatterExpanded = StateField.define<boolean>({
	create: () => !yamlCollapsedByDefault(),
	update(value, transaction) {
		for (const effect of transaction.effects) if (effect.is(setFrontmatterExpanded)) value = effect.value;
		return value;
	},
});
