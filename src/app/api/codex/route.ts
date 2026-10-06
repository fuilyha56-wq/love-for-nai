import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

type CodexRow = {
  id: string; title: string; selector_title: string | null; type: string | null; version: string | null;
  author: string | null; entry_count: number; nsfw: boolean; tree: unknown;
};
type EntryRow = {
  codex_id: string; id: string; title: string; category_path: string[]; rating: string; tags: string;
  negative: string | null; character_prompts: unknown; note: string | null; image_url: string | null;
  original_url: string | null; image_width: number | null; image_height: number | null;
};

/** GET /api/codex 列出法典；带 codex/q/category 参数时检索条目，默认只返回 safe。 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const codex = params.get("codex")?.trim().slice(0, 80) || "";
  const query = params.get("q")?.trim().slice(0, 100) || "";
  const category = params.get("category")?.trim().slice(0, 160) || "";
  const includeAdult = params.get("adult") === "1";
  const limit = Math.min(100, Math.max(1, Number(params.get("limit")) || 30));
  const offset = Math.max(0, Number(params.get("offset")) || 0);

  try {
    if (!codex && !query && !category) {
      const codexes = await db.any<CodexRow>(
        `SELECT id, title, selector_title, type, version, author, entry_count, nsfw, tree
         FROM quicktagcloud_codexes WHERE $1 OR NOT nsfw ORDER BY nsfw, title`,
        [includeAdult],
      );
      return NextResponse.json({ codexes });
    }
    const entries = await db.any<EntryRow>(
      `SELECT e.codex_id, e.id, e.title, e.category_path, e.rating, e.tags, e.negative, e.character_prompts,
              e.note, e.image_url, e.original_url, e.image_width, e.image_height
       FROM quicktagcloud_entries e JOIN quicktagcloud_codexes c ON c.id = e.codex_id
       WHERE ($1 OR (e.rating = 'safe' AND NOT c.nsfw))
         AND ($2 = '' OR e.codex_id = $2)
         AND ($3 = '' OR array_to_string(e.category_path, ' / ') ILIKE '%' || $3 || '%')
         AND ($4 = '' OR e.title ILIKE '%' || $4 || '%' OR e.tags ILIKE '%' || $4 || '%')
       ORDER BY e.codex_id, e.category_path, e.id
       LIMIT $5 OFFSET $6`,
      [includeAdult, codex, category, query, limit, offset],
    );
    return NextResponse.json({ entries, limit, offset });
  } catch {
    return NextResponse.json({ message: "法典数据暂不可用，请确认已运行 npm run import:codex" }, { status: 503 });
  }
}
