import { createCommentStore, type DiscussionComment } from "@/lib/comment-store";
export { MAX_COMMENT_LENGTH, MAX_COMMENT_COUNT, type CommentVote } from "@/lib/comment-store";
export type AnnouncementComment = Omit<DiscussionComment, "resourceId"> & { announcementId: string };
export type CreateAnnouncementCommentInput = { announcementId: string; authorId: number; authorName: string; content: string; parentId?: string | null };
const store = createCommentStore("announcements", "announcementId");
function convert(item: DiscussionComment): AnnouncementComment { const { resourceId, ...comment } = item; return { ...comment, announcementId: resourceId }; }
export const assertCommentContent = store.assertCommentContent;
export async function listAnnouncementComments(id: string, viewerId?: number) { return (await store.listComments(id, viewerId)).map(convert); }
export async function getAnnouncementComment(id: string, commentId: string, viewerId?: number) { const item = await store.getComment(id, commentId, viewerId); return item ? convert(item) : null; }
export async function createAnnouncementComment({ announcementId, ...input }: CreateAnnouncementCommentInput) { return convert(await store.createComment({ ...input, resourceId: announcementId })); }
export async function setAnnouncementCommentVote(id: string, commentId: string, userId: number, vote: "up" | "down" | null) { const item = await store.setCommentVote(id, commentId, userId, vote); return item ? convert(item) : null; }
export async function setAnnouncementCommentPinned(id: string, commentId: string, pinned: boolean) { const item = await store.setCommentPinned(id, commentId, pinned); return item ? convert(item) : null; }
export const deleteAnnouncementCommentTree = store.deleteCommentTree;
export const deleteOwnAnnouncementComment = store.deleteOwnComment;
export const deleteAnnouncementComment = store.deleteComment;
export const countAnnouncementComments = store.countComments;
export const deleteCommentsForAnnouncement = store.deleteCommentsForResource;
