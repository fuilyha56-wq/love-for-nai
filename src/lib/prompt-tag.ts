const KAOMOJIS = new Set(["0_0", "(o)_(o)", "+_+", "+_-", "._.", "<o>_<o>", "<|>_<|>", "=_=", ">_<", "3_3", "6_9", ">_o", "@_@", "^_^", "o_o", "u_u", "x_x", "|_|", "||_||"]);

/** Catalog identifiers use underscores; prompt tags use spaces except in emoticons. */
export function promptTagText(name: string): string {
  return KAOMOJIS.has(name) ? name : name.replaceAll("_", " ");
}
