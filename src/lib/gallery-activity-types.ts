import type {
  GalleryMetadataState,
  GalleryPromptMode,
} from "@/lib/gallery-publication";

export type GalleryActivityRevision = {
  originalProofStatus?: "metadata-validated" | "reviewed";
  id: string;
  at: string;
  version: string;
  ownerId: number;
  ownerName: string;
  authorName: string;
  title: string;
  originalFileName?: string;
  rating: string;
  source: string;
  tags: string[];
  status: string;
  submittedAt: string;
  reviewedAt?: string;
  promptMode?: GalleryPromptMode;
  metadataState?: GalleryMetadataState;
  noOriginalData?: boolean;
  upscaled?: boolean;
};
export type GalleryActivityInteraction = {
  id: string;
  userId: number;
  at: string;
  version: string;
  kind: "like" | "unlike" | "import";
};
export type GalleryActivityState = {
  revisions: GalleryActivityRevision[];
  interactions: GalleryActivityInteraction[];
};
