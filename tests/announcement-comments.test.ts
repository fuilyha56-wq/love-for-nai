import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let dataDir: string;

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: vi.fn() }));

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "lfn-comments-"));
  process.env.LFN_DATA_DIR = dataDir;
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.LFN_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("公告评论库", () => {
  it("创建评论时只使用服务端作者字段并按时间正序读取", async () => {
    const {
      createAnnouncementComment,
      listAnnouncementComments,
    } = await import("@/lib/announcement-comments");
    const item = await createAnnouncementComment({
      announcementId: "announcement-1",
      authorId: 7,
      authorName: "  小明  ",
      content: "  第一条反馈  ",
    });
    expect(item).toMatchObject({
      announcementId: "announcement-1",
      authorId: 7,
      authorName: "小明",
      content: "第一条反馈",
    });
    expect(item.createdAt).toBe(item.updatedAt);
    expect(await listAnnouncementComments("announcement-1")).toEqual([item]);
    expect(await listAnnouncementComments("other")).toEqual([]);
  });

  it("拒绝空评论和超过 2000 个字符的内容", async () => {
    const { assertCommentContent } = await import("@/lib/announcement-comments");
    expect(() => assertCommentContent("   ")).toThrow("评论内容不能为空");
    expect(() => assertCommentContent("a".repeat(2001))).toThrow("2000");
    expect(assertCommentContent("a".repeat(2000))).toHaveLength(2000);
  });

  it("删除时校验公告归属且保持其他评论不变", async () => {
    const {
      createAnnouncementComment,
      deleteAnnouncementComment,
      listAnnouncementComments,
    } = await import("@/lib/announcement-comments");
    const first = await createAnnouncementComment({
      announcementId: "announcement-1",
      authorId: 1,
      authorName: "one",
      content: "one",
    });
    const second = await createAnnouncementComment({
      announcementId: "announcement-2",
      authorId: 2,
      authorName: "two",
      content: "two",
    });
    expect(await deleteAnnouncementComment("wrong", first.id)).toBe(false);
    expect(await deleteAnnouncementComment("announcement-1", first.id)).toBe(true);
    expect(await deleteAnnouncementComment("announcement-1", first.id)).toBe(false);
    expect(await listAnnouncementComments("announcement-2")).toEqual([second]);
  });

  it("支持楼中楼回复、用户投票、管理员置顶以及删除整条回复树", async () => {
    const {
      createAnnouncementComment, deleteAnnouncementCommentTree, listAnnouncementComments,
      setAnnouncementCommentPinned, setAnnouncementCommentVote,
    } = await import("@/lib/announcement-comments");
    const parent = await createAnnouncementComment({ announcementId: "thread", authorId: 1, authorName: "甲", content: "主评论" });
    const reply = await createAnnouncementComment({ announcementId: "thread", authorId: 2, authorName: "乙", content: "回复", parentId: parent.id });
    const nested = await createAnnouncementComment({ announcementId: "thread", authorId: 3, authorName: "丙", content: "继续回复", parentId: reply.id });
    expect(await setAnnouncementCommentVote("thread", parent.id, 4, "up")).toMatchObject({ likes: 1, myVote: "up" });
    expect(await setAnnouncementCommentVote("thread", parent.id, 4, "down")).toMatchObject({ likes: 0, dislikes: 1, myVote: "down" });
    expect(await setAnnouncementCommentVote("thread", parent.id, 4, null)).toMatchObject({ dislikes: 0, myVote: null });
    expect(await setAnnouncementCommentPinned("thread", reply.id, true)).toMatchObject({ pinned: true });
    expect((await listAnnouncementComments("thread"))[0].id).toBe(reply.id);
    expect(await deleteAnnouncementCommentTree("thread", reply.id)).toEqual(expect.arrayContaining([reply.id, nested.id]));
    expect((await listAnnouncementComments("thread")).map((item) => item.id)).toEqual([parent.id]);
  });
});

describe("公告评论 API", () => {
  it("公开读取，未登录不能发布，登录后使用会话作者", async () => {
    const { getSession } = await import("@/lib/session");
    const { COMMUNITY_FEEDBACK_ANNOUNCEMENT } = await import("@/lib/announcements");
    const { GET, POST } = await import("@/app/api/announcements/[id]/comments/route");
    const params = Promise.resolve({ id: COMMUNITY_FEEDBACK_ANNOUNCEMENT.id });
    expect((await GET(new Request("http://localhost"), { params })).status).toBe(200);
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await POST(new Request("http://localhost", { method: "POST" }), { params })).status).toBe(401);
    vi.mocked(getSession).mockResolvedValue({
      userId: 9,
      username: "user",
      displayName: "用户",
      upstreamCookie: "",
      expiresAt: Date.now() + 3600_000,
    });
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ content: "反馈", authorId: 999, authorName: "伪造" }),
      }),
      { params },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      item: { authorId: 9, authorName: "用户", content: "反馈" },
    });
  });

  it("回复他人公告评论后会为被回复用户创建可跳转的消息", async () => {
    const { getSession } = await import("@/lib/session");
    const { COMMUNITY_FEEDBACK_ANNOUNCEMENT } = await import("@/lib/announcements");
    const { createAnnouncementComment } = await import("@/lib/announcement-comments");
    const { listUserNotifications } = await import("@/lib/notifications");
    const parent = await createAnnouncementComment({ announcementId: COMMUNITY_FEEDBACK_ANNOUNCEMENT.id, authorId: 21, authorName: "原作者", content: "请看这个建议" });
    vi.mocked(getSession).mockResolvedValue({ userId: 22, username: "reply", displayName: "回复者", upstreamCookie: "", expiresAt: Date.now() + 3600_000 });
    const { POST } = await import("@/app/api/announcements/[id]/comments/route");
    const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ content: "收到，谢谢", parentId: parent.id }) }), { params: Promise.resolve({ id: COMMUNITY_FEEDBACK_ANNOUNCEMENT.id }) });
    expect(response.status).toBe(200);
    const notifications = await listUserNotifications(21);
    expect(notifications).toMatchObject({ unreadCount: 1, items: [{ type: "announcement-reply", title: "回复者 回复了你的评论", href: expect.stringContaining("comment=") }] });
  });

  it("管理员可以删除评论", async () => {
    const { requireAdmin } = await import("@/lib/admin-auth");
    vi.mocked(requireAdmin).mockResolvedValue({
      session: {
        userId: 1,
        username: "admin",
        displayName: "管理员",
        upstreamCookie: "",
        expiresAt: Date.now() + 3600_000,
      },
      role: 10,
    });
    const { COMMUNITY_FEEDBACK_ANNOUNCEMENT } = await import("@/lib/announcements");
    const { createAnnouncementComment, listAnnouncementComments } = await import("@/lib/announcement-comments");
    const item = await createAnnouncementComment({
      announcementId: COMMUNITY_FEEDBACK_ANNOUNCEMENT.id,
      authorId: 3,
      authorName: "用户",
      content: "待删除",
    });
    const { DELETE } = await import("@/app/api/announcements/[id]/comments/[commentId]/route");
    const response = await DELETE(new Request("http://localhost", { method: "DELETE" }), {
      params: Promise.resolve({ id: COMMUNITY_FEEDBACK_ANNOUNCEMENT.id, commentId: item.id }),
    });
    expect(response.status).toBe(200);
    expect(await listAnnouncementComments(COMMUNITY_FEEDBACK_ANNOUNCEMENT.id)).toEqual([]);
  });

  it("用户只能删除自己的评论，级联删除子回复并清理对应通知", async () => {
    const { getSession } = await import("@/lib/session");
    const { requireAdmin } = await import("@/lib/admin-auth");
    const { COMMUNITY_FEEDBACK_ANNOUNCEMENT } = await import("@/lib/announcements");
    const { createAnnouncementComment, listAnnouncementComments } = await import("@/lib/announcement-comments");
    const { createUserNotification, listUserNotifications } = await import("@/lib/notifications");
    const parent = await createAnnouncementComment({ announcementId: COMMUNITY_FEEDBACK_ANNOUNCEMENT.id, authorId: 21, authorName: "原作者", content: "主评论" });
    const ownReply = await createAnnouncementComment({ announcementId: COMMUNITY_FEEDBACK_ANNOUNCEMENT.id, authorId: 22, authorName: "示例用户", content: "重复回复", parentId: parent.id });
    const nestedReply = await createAnnouncementComment({ announcementId: COMMUNITY_FEEDBACK_ANNOUNCEMENT.id, authorId: 23, authorName: "其他用户", content: "后续回复", parentId: ownReply.id });
    await createUserNotification({ userId: 21, type: "announcement-reply", title: "有人回复你", body: ownReply.content, href: `/announcements?comment=${ownReply.id}`, dedupeKey: `announcement-reply:${ownReply.id}` });
    vi.mocked(getSession).mockResolvedValue({ userId: 22, username: "reply", displayName: "示例用户", upstreamCookie: "", expiresAt: Date.now() + 3600_000 });
    vi.mocked(requireAdmin).mockResolvedValue({ error: "仅管理员可用" });
    const { DELETE } = await import("@/app/api/announcements/[id]/comments/[commentId]/route");
    const params = Promise.resolve({ id: COMMUNITY_FEEDBACK_ANNOUNCEMENT.id, commentId: ownReply.id });
    const response = await DELETE(new Request("http://localhost", { method: "DELETE" }), { params });
    expect(response.status).toBe(200);
    expect(await listAnnouncementComments(COMMUNITY_FEEDBACK_ANNOUNCEMENT.id)).toEqual([expect.objectContaining({ id: parent.id, parentId: null })]);
    expect((await response.json()).deletedIds).toContain(nestedReply.id);
    expect(await listUserNotifications(21)).toMatchObject({ items: [], unreadCount: 0 });

    const protectedReply = await createAnnouncementComment({ announcementId: COMMUNITY_FEEDBACK_ANNOUNCEMENT.id, authorId: 22, authorName: "示例用户", content: "仍属于作者的评论", parentId: parent.id });
    vi.mocked(getSession).mockResolvedValue({ userId: 24, username: "other", displayName: "其他用户", upstreamCookie: "", expiresAt: Date.now() + 3600_000 });
    const forbidden = await DELETE(new Request("http://localhost", { method: "DELETE" }), { params: Promise.resolve({ id: COMMUNITY_FEEDBACK_ANNOUNCEMENT.id, commentId: protectedReply.id }) });
    expect(forbidden.status).toBe(403);
  });

  it("删除公告时级联清理其全部评论", async () => {
    const { createAnnouncement, listAnnouncements } = await import("@/lib/announcements");
    const {
      createAnnouncementComment,
      listAnnouncementComments,
      deleteCommentsForAnnouncement,
    } = await import("@/lib/announcement-comments");
    const announcement = await createAnnouncement({
      title: "将被删除的公告",
      content: "内容",
      level: "info",
      author: "admin",
      pinned: false,
    });
    await createAnnouncementComment({
      announcementId: announcement.id,
      authorId: 1,
      authorName: "a",
      content: "反馈一",
    });
    await createAnnouncementComment({
      announcementId: announcement.id,
      authorId: 2,
      authorName: "b",
      content: "反馈二",
    });
    expect((await listAnnouncementComments(announcement.id)).length).toBe(2);
    expect(await deleteCommentsForAnnouncement(announcement.id)).toBe(2);
    expect(await listAnnouncementComments(announcement.id)).toEqual([]);
    expect(await deleteCommentsForAnnouncement(announcement.id)).toBe(0);
    expect((await listAnnouncements()).some((item) => item.id === announcement.id)).toBe(true);
  });
});
