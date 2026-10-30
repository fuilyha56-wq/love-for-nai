import { requireAdmin } from "@/lib/admin-auth";
import { readGalleryOriginalProof } from "@/lib/gallery";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin();
  if ("error" in gate)
    return Response.json({ message: gate.error }, { status: 403 });
  const proof = await readGalleryOriginalProof((await params).id);
  if (!proof)
    return Response.json({ message: "校验原图不存在" }, { status: 404 });
  return new Response(new Uint8Array(proof.data), {
    headers: {
      "Content-Type": proof.extension === "jpg" ? "image/jpeg" : "image/png",
      "Cache-Control": "private, no-store",
    },
  });
}
