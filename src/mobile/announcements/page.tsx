"use client";
import { AnnouncementFeed } from "@/mobile/announcements/announcement-feed";
import { PublicHeader } from "@/mobile/public-header";
import { WorkspaceNav } from "@/mobile/workspace-nav";
import { MarkdownView } from "@/mobile/markdown";
export default function AnnouncementsPage() { return <AnnouncementFeed header={<PublicHeader current="announcements" />} navigation={<WorkspaceNav />} Content={MarkdownView} />; }
