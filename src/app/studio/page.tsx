import StudioWorkspace from "./studio-workspace";
import { CreatorActivities } from "./creator-activities";
export const dynamic = "force-dynamic";
export default function StudioPage() {
  return <StudioWorkspace activities={<CreatorActivities />} />;
}
