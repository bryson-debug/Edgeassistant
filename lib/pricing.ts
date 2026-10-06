import type Anthropic from "@anthropic-ai/sdk";

// $ per million tokens. 5-minute cache writes cost 1.25x input; reads 0.1x.
export const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

export function priceFor(model: string) {
  return PRICES[model] ?? Object.entries(PRICES).find(([id]) => model.startsWith(id))?.[1];
}

// Cost in US dollars, or NaN when the model has no price entry.
export function costOf(model: string, usage: Anthropic.Usage): number {
  const price = priceFor(model);
  if (!price) return NaN;
  return (
    ((usage.input_tokens ?? 0) * price.input +
      (usage.cache_creation_input_tokens ?? 0) * price.input * 1.25 +
      (usage.cache_read_input_tokens ?? 0) * price.input * 0.1 +
      (usage.output_tokens ?? 0) * price.output) /
    1_000_000
  );
}
