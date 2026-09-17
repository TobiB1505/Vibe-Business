/**
 * The five words this product has for the state of a thing.
 *
 * Declared here rather than beside `StatusPill`, the component that colours
 * them, because view builders in `src/modules` return a tone — and a domain
 * module may not depend on where a component keeps its props (ADR 0109, rule
 * 86). `src/lib` sits below both, so the module and the component can agree on
 * the vocabulary without either importing the other.
 *
 * The words are deliberately about *state*, not about colour: `problem` is a
 * fact about a change, and whether it is drawn coral is a decision the
 * component makes. A module naming a Tailwind class would be a module deciding
 * how it looks, which is the coupling `status-vocabulary.ts` exists to prevent.
 */
export type StatusTone = "active" | "success" | "waiting" | "problem" | "neutral";
