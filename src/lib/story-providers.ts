/**
 * Compatibility adapter for the former story-providers store.
 * Secrets and records now live in the unified encrypted provider registry.
 */
export {
  deleteStoryProvider,
  findStoryProvider,
  listStoryProviders,
  saveStoryProvider,
  type PublicStoryProvider,
  type StoryProvider,
} from "@/lib/provider/store";
