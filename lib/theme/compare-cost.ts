/**
 * What an answer would have cost on the models you did not pick.
 *
 * Arithmetic, not a request. Every number here comes from two things already in
 * the database — the token counts recorded for the message, and the per-1K
 * prices on each model row — so nothing is sent anywhere and nothing is spent
 * to produce it. That is the whole reason this can exist: a product that sells
 * one vendor's models has no price table for anyone else's.
 *
 * Client-safe. `lib/db/costs.ts` is `server-only`, and the comparison is
 * rendered in the browser.
 */

import { formatUsd } from './money';

export type PricedModel = {
  id: string;
  displayName: string;
  providerName: string;
  /** Null when the admin has not set a price for this model. */
  inputCostPer1k: number | null;
  outputCostPer1k: number | null;
};

export type CostComparison = {
  modelId: string;
  displayName: string;
  providerName: string;
  /** Null when this model has no price set — never 0, which would read as free. */
  usd: number | null;
  /** True for the model that actually produced the answer. */
  actual: boolean;
  /**
   * Difference against the actual model, as a multiple. Null when either side
   * has no price, or when this IS the actual model.
   */
  ratio: number | null;
};

/**
 * The estimate's limit, in one sentence, shown wherever the numbers are.
 *
 * Vendors tokenise differently: the same prompt is not the same number of
 * tokens on every model, so a comparison priced from OUR token counts is
 * indicative rather than exact. Saying so costs one line and is the difference
 * between an estimate and a claim.
 */
export const ESTIMATE_CAVEAT =
  'Estimated from this answer’s token counts. Models tokenise text differently, so another model would not use exactly the same number.';

export function compareCost(
  inputTokens: number,
  outputTokens: number,
  models: PricedModel[],
  actualModelId: string | null,
): CostComparison[] {
  /**
   * Null means "nobody set a price", and that is NOT the same as free.
   *
   * `models.input_cost_per_1k` is `not null default 0`, so a model the admin
   * never priced does not arrive as null — it arrives as **0 and 0**. Rendered
   * naively that model tops the table at $0.0000 and reads as the cheapest
   * option available, which is the most expensive kind of wrong this feature
   * could produce. Both-zero is therefore treated as unpriced.
   *
   * A genuinely free model is indistinguishable from an unset one in this
   * schema, and "no price set" is the safer of the two readings: it prompts
   * someone to go and set it, where "free" invites a decision.
   *
   * The null branch is kept for the day the column allows one.
   */
  const priceOf = (m: PricedModel): number | null => {
    if (m.inputCostPer1k === null || m.outputCostPer1k === null) return null;
    if (m.inputCostPer1k === 0 && m.outputCostPer1k === 0) return null;
    return (inputTokens / 1000) * m.inputCostPer1k + (outputTokens / 1000) * m.outputCostPer1k;
  };

  const actual = models.find((m) => m.id === actualModelId) ?? null;
  const actualUsd = actual ? priceOf(actual) : null;

  return (
    models
      .map((m) => {
        const usd = priceOf(m);
        return {
          modelId: m.id,
          displayName: m.displayName,
          providerName: m.providerName,
          usd,
          actual: m.id === actualModelId,
          ratio:
            m.id === actualModelId || usd === null || actualUsd === null || actualUsd === 0
              ? null
              : usd / actualUsd,
        };
      })
      // Cheapest first, and models with no price last — they are a gap in the
      // admin's setup, not a bargain.
      .sort((a, b) => {
        if (a.usd === null) return 1;
        if (b.usd === null) return -1;
        return a.usd - b.usd;
      })
  );
}

/** "3.4× more" / "8× less" / "same". Null ratios render as an em dash upstream. */
export function describeRatio(ratio: number | null): string | null {
  if (ratio === null) return null;
  if (ratio > 0.995 && ratio < 1.005) return 'about the same';
  if (ratio > 1) return `${trim(ratio)}× more`;
  return `${trim(1 / ratio)}× less`;
}

function trim(n: number): string {
  return n >= 10 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, '');
}

export { formatUsd };
