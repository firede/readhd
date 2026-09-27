// Pure logic for validating cloud segmentation output and mapping token
// boundaries back onto the original string (whose whitespace is preserved).

export interface TokenSpan {
  start: number;
  end: number;
  text: string;
}

const WHITESPACE = /\s/u;

function stripWs(s: string): string {
  return s.replace(/\s+/gu, '');
}

/**
 * Extract the JSON array from a model response text. Takes the substring from
 * the first '[' to the last ']'. Returns null if unparseable.
 */
export function extractJsonArray(text: string): unknown[] | null {
  const first = text.indexOf('[');
  const last = text.lastIndexOf(']');
  if (first < 0 || last <= first) return null;
  try {
    const parsed = JSON.parse(text.slice(first, last + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Align model tokens onto the original string. The model is allowed to drop
 * whitespace, so we walk non-whitespace chars of the original and match them
 * against each token's non-whitespace chars. Returns null if the tokens do
 * not reconstruct the original (ignoring whitespace).
 */
export function alignTokens(
  original: string,
  tokens: unknown,
): TokenSpan[] | null {
  if (!Array.isArray(tokens) || tokens.some((t) => typeof t !== 'string')) {
    return null;
  }
  const joined = (tokens as string[]).join('');
  if (stripWs(joined) !== stripWs(original)) return null;

  // Positions of non-whitespace chars in the original.
  const origChars = [...original];
  const nwPos: number[] = [];
  origChars.forEach((ch, i) => {
    if (!WHITESPACE.test(ch)) nwPos.push(i);
  });

  const spans: TokenSpan[] = [];
  let cursor = 0; // index into nwPos
  for (const token of tokens as string[]) {
    const tNw = [...token].filter((ch) => !WHITESPACE.test(ch)).length;
    if (tNw === 0) continue; // pure-whitespace token: contributes nothing
    let start = nwPos[cursor]!;
    let end = nwPos[cursor + tNw - 1]! + 1;
    cursor += tNw;
    // Trim whitespace that belongs to the gaps between tokens.
    while (start < end && WHITESPACE.test(origChars[start]!)) start++;
    while (end > start && WHITESPACE.test(origChars[end - 1]!)) end--;
    spans.push({ start, end, text: original.slice(start, end) });
  }
  return spans;
}

/**
 * Validate a whole batch response against the input batch.
 * Returns one entry per input: aligned spans, or null on failure.
 * If the outer array length mismatches, every entry is null.
 */
export function validateBatch(
  inputs: string[],
  output: unknown,
): (TokenSpan[] | null)[] {
  const results: (TokenSpan[] | null)[] = inputs.map(() => null);
  if (!Array.isArray(output) || output.length !== inputs.length) {
    return results;
  }
  return inputs.map((input, i) => alignTokens(input, output[i]));
}

/**
 * Parse a full Anthropic-style response body: concatenate `text` content
 * blocks (ignoring `thinking`), extract the JSON array, validate.
 */
export function parseSegmentResponse(
  inputs: string[],
  body: unknown,
): (TokenSpan[] | null)[] {
  const content = (body as { content?: unknown })?.content;
  if (!Array.isArray(content)) return inputs.map(() => null);
  const text = content
    .filter((b) => (b as { type?: string })?.type === 'text')
    .map((b) => (b as { text?: string }).text ?? '')
    .join('');
  const arr = extractJsonArray(text);
  if (!arr) return inputs.map(() => null);
  return validateBatch(inputs, arr);
}
