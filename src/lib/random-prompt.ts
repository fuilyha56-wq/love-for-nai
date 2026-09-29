// 随机提示词生成器：移植 Aaalice_NAI_Launcher（MIT）的官网 recipe。
// 词库 public/data/random-wordlists.json（NovelAI 官网前端词表，5960 条），
// 按需加载并缓存；生成逻辑复刻官网 recipe：人数按权重掷骰、各语义组按
// 概率抽取、条目按权重加权并尊重依赖（anyOfDependencies）、2% 概率 {} 强调。

type WordlistEntry = [string, number, ...string[][]];
type WordlistGroup = { id: string; semantic?: string; entries: WordlistEntry[] };
type WordlistGenerator = { id: string; groups: WordlistGroup[] };
type Wordlists = {
  generators: WordlistGenerator[];
};

let wordlistsCache: Wordlists | null = null;
let wordlistsPromise: Promise<Wordlists> | null = null;

async function loadWordlists(): Promise<Wordlists> {
  if (wordlistsCache) return wordlistsCache;
  wordlistsPromise ??= fetch("/data/random-wordlists.json", {
    cache: "force-cache",
  })
    .then(async (response) => {
      if (!response.ok) throw new Error("随机词库加载失败");
      const parsed = (await response.json()) as Wordlists;
      wordlistsCache = parsed;
      return parsed;
    })
    .catch((error) => {
      wordlistsPromise = null;
      throw error;
    });
  return wordlistsPromise;
}

// 简单可复现的随机源（每次生成一个新实例）。
function makeRandom(): () => number {
  return Math.random;
}

function pickWeighted<T>(entries: Array<[T, number]>, random: () => number): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let ticket = Math.floor(random() * total) + 1;
  for (const [value, weight] of entries) {
    ticket -= weight;
    if (ticket <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

function chance(probability: number, random: () => number): boolean {
  return random() < probability;
}

function randomInt(max: number, random: () => number, min = 0): number {
  return Math.floor(random() * (max - min)) + min;
}

function groupEntries(
  generator: WordlistGenerator,
  groupId: string,
): WordlistEntry[] {
  return generator.groups.find((group) => group.id === groupId)?.entries ?? [];
}

// 依赖：条目第 3 字段 anyOfDependencies，任一已选 tag 命中即可入选。
function legacyChoice(
  generator: WordlistGenerator,
  groupId: string,
  selectedTags: string[],
  random: () => number,
): string {
  const eligible = groupEntries(generator, groupId).filter((entry) => {
    const dependencies = entry[2] ?? [];
    return dependencies.length === 0 || dependencies.some((dep) => selectedTags.includes(dep));
  });
  if (!eligible.length) return "";
  const total = eligible.reduce((sum, entry) => sum + entry[1], 0);
  const ticket = Math.floor(random() * (total - 1)) + 1;
  let cumulative = 0;
  for (const entry of eligible) {
    cumulative += entry[1];
    if (ticket <= cumulative) return entry[0];
  }
  return eligible[eligible.length - 1][0];
}

function prependCharacterCount(
  tags: string[],
  count: number,
  singular: string,
  plural: string,
): void {
  if (count === 1) tags.unshift(`1${singular}`);
  else if (count > 1) tags.unshift(`${count}${plural}`);
}

function commaStableDeduplicate(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags.join(", ").split(", ")) {
    if (seen.add(tag)) result.push(tag);
  }
  return result;
}

function characterBlock(
  generator: WordlistGenerator,
  gender: string,
  framing: string | null,
  specialMode: boolean,
  totalCharacterCount: number,
  random: () => number,
): string[] {
  const tags: string[] = [];
  if (chance(0.1, random)) tags.push(legacyChoice(generator, "lH", tags, random));
  const specialBody = ["mermaid", "centaur", "lamia"].some((tag) => tags.includes(tag));
  if (chance(0.4, random)) tags.push(legacyChoice(generator, "lG", tags, random));
  if (chance(0.8, random)) tags.push(legacyChoice(generator, "ch", tags, random));
  if (chance(0.1, random)) tags.push(legacyChoice(generator, "lX", tags, random));
  if (chance(0.2, random)) tags.push(legacyChoice(generator, "lY", tags, random));
  if (chance(0.8, random)) tags.push(legacyChoice(generator, "lQ", tags, random));
  if (chance(0.5, random)) tags.push(legacyChoice(generator, "lK", tags, random));
  if (chance(0.7, random)) tags.push(legacyChoice(generator, "cu", tags, random));
  if (chance(0.1, random)) {
    tags.push(legacyChoice(generator, "cp", tags, random));
    tags.push(legacyChoice(generator, "cu", tags, random));
  }
  if (chance(0.1, random)) tags.push(legacyChoice(generator, "lZ", tags, random));
  if (chance(0.2, random)) tags.push(legacyChoice(generator, "lJ", tags, random));
  if (gender.startsWith("f") && chance(0.5, random))
    tags.push(legacyChoice(generator, "l0", tags, random));
  const featureCount = legacyCharacterCount(totalCharacterCount, random);
  for (let index = 0; index < featureCount; index += 1)
    tags.push(legacyChoice(generator, "l3", tags, random));
  if (chance(0.2, random)) {
    tags.push(legacyChoice(generator, "l2", tags, random));
    if (chance(0.2, random)) tags.push(legacyChoice(generator, "l5", tags, random));
  } else if (chance(0.3, random)) {
    tags.push(legacyChoice(generator, "l1", tags, random));
  }

  const clothingType = pickWeighted(
    [
      ["uniform", 10],
      ["swimsuit", 5],
      ["bodysuit", 5],
      ["normal clothes", 40],
    ],
    random,
  );
  if (clothingType === "uniform") {
    tags.push(legacyChoice(generator, "ct", tags, random));
  } else if (clothingType === "swimsuit") {
    tags.push(legacyChoice(generator, "ci", tags, random));
  } else if (clothingType === "bodysuit") {
    tags.push(legacyChoice(generator, "cr", tags, random));
  } else {
    if (gender.startsWith("f") && chance(0.5, random)) {
      tags.push(legacyChoice(generator, "l4", tags, random));
      if (chance(0.2, random)) tags.push(legacyChoice(generator, "l8", tags, random));
    }
    if (gender.startsWith("f") && chance(0.2, random)) {
      tags.push(legacyChoice(generator, "l6", tags, random));
    } else {
      if (chance(0.85, random)) tags.push(legacyChoice(generator, "l7", tags, random));
      if (!specialBody) {
        const lowerRoll = chance(0.85, random);
        if (lowerRoll && framing !== "portrait")
          tags.push(legacyChoice(generator, "l9", tags, random));
        const footwearRoll = chance(0.6, random);
        if (footwearRoll && (framing === "full body" || framing == null))
          tags.push(legacyChoice(generator, "ce", tags, random));
      }
    }
  }
  if (chance(0.6, random)) tags.push(legacyChoice(generator, "cn", tags, random));
  const actionProbability =
    specialMode && totalCharacterCount === 1 ? 1.0 : 0.4;
  if (chance(actionProbability, random))
    tags.push(legacyChoice(generator, "cc", tags, random));
  const miscCount = legacyCharacterCount(totalCharacterCount, random);
  for (let index = 0; index < miscCount; index += 1)
    tags.push(legacyChoice(generator, "ca", tags, random));
  return tags;
}

function legacyCharacterCount(totalCharacterCount: number, random: () => number): number {
  if (totalCharacterCount === 1)
    return pickWeighted([[0, 10], [1, 30], [2, 15], [3, 5]], random);
  if (totalCharacterCount === 2)
    return pickWeighted([[0, 20], [1, 40], [2, 10]], random);
  return pickWeighted([[0, 30], [1, 30]], random);
}

// 官网 legacyAnime recipe：随机一条完整提示词。
export async function generateRandomPrompt(): Promise<string> {
  const wordlists = await loadWordlists();
  const generator =
    wordlists.generators.find((item) => item.id === "legacyAnime") ??
    wordlists.generators[0];
  const random = makeRandom();
  const tags: string[] = [];
  const personCount = pickWeighted(
    [
      [1, 70],
      [2, 20],
      [3, 7],
      [0, 5],
    ],
    random,
  );
  if (personCount === 0) {
    tags.push("no humans");
    if (chance(0.3, random)) tags.push(legacyChoice(generator, "l$", tags, random));
    tags.push(legacyChoice(generator, "lV", tags, random));
    const environmentCount = pickWeighted(
      [[2, 15], [3, 50], [4, 15], [5, 5]],
      random,
    );
    for (let index = 0; index < environmentCount; index += 1)
      tags.push(legacyChoice(generator, "cs", tags, random));
    let objectCount = pickWeighted(
      [[0, 15], [1, 10], [2, 20], [3, 20], [4, 20], [5, 15]],
      random,
    );
    objectCount = Math.max(0, objectCount - personCount);
    for (let index = 0; index < objectCount; index += 1)
      tags.push(legacyChoice(generator, "cl", tags, random));
    return tags.join(", ");
  }

  if (chance(0.3, random)) tags.push(legacyChoice(generator, "l$", tags, random));
  let femaleCount = 0;
  let maleCount = 0;
  let otherCount = 0;
  for (let index = 0; index < personCount; index += 1) {
    const gender = pickWeighted([["m", 30], ["f", 50]], random);
    if (gender === "f") femaleCount += 1;
    else if (gender === "m") maleCount += 1;
    else otherCount += 1;
  }
  prependCharacterCount(tags, femaleCount, "girl", "girls");
  prependCharacterCount(tags, maleCount, "boy", "boys");
  prependCharacterCount(tags, otherCount, "other", "others");

  if (chance(0.8, random)) {
    const background = legacyChoice(generator, "lU", tags, random);
    tags.push(background);
    if (background === "scenery" && chance(0.5, random)) {
      const count = randomInt(3, random, 1);
      for (let index = 0; index < count; index += 1)
        tags.push(legacyChoice(generator, "cs", tags, random));
    }
  }
  if (chance(0.3, random)) tags.push(legacyChoice(generator, "lF", tags, random));
  let framing: string | null = null;
  if (chance(0.7, random)) {
    framing = legacyChoice(generator, "lW", tags, random);
    if (framing) tags.push(framing);
  }
  for (let index = 0; index < femaleCount; index += 1)
    tags.push(...characterBlock(generator, "f", framing, false, personCount, random));
  for (let index = 0; index < maleCount; index += 1)
    tags.push(...characterBlock(generator, "m", framing, false, personCount, random));
  for (let index = 0; index < otherCount; index += 1)
    tags.push(...characterBlock(generator, "o", framing, false, personCount, random));
  if (chance(0.2, random)) {
    let objectCount = randomInt(4, random);
    if (personCount === 2) objectCount = randomInt(3, random);
    for (let index = 0; index < objectCount; index += 1)
      tags.push(legacyChoice(generator, "cl", tags, random));
  }
  if (chance(0.25, random)) {
    const effectCount = randomInt(3, random, 1);
    for (let index = 0; index < effectCount; index += 1)
      tags.push(legacyChoice(generator, "cd", tags, random));
  }
  if (chance(0.2, random)) tags.push(legacyChoice(generator, "co", tags, random));
  if (chance(0.1, random)) tags.push(legacyChoice(generator, "lO", tags, random));

  const deduplicated = commaStableDeduplicate(tags);
  const emphasized = deduplicated.map((tag) =>
    chance(0.02, random) ? `{${tag}}` : tag,
  );
  return emphasized.filter(Boolean).join(", ");
}
