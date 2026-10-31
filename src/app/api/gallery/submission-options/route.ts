import { listCreatorRewardCampaigns } from "@/lib/creator-rewards";
import { gallerySubmissionOptions } from "@/lib/gallery-submission-options";

export async function GET() {
  return Response.json(gallerySubmissionOptions(await listCreatorRewardCampaigns()), { headers: { "Cache-Control": "no-store" } });
}
