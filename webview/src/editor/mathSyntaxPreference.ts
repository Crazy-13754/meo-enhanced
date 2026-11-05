import { Facet } from '@codemirror/state';

/** A document's explicit syntax choice, shared by its editing projections. */
export const latexDelimitersFacet = Facet.define<boolean, boolean>({ combine: values => values[0] ?? false });
