"use client";
import { AnnouncementFeed } from "@/app/announcements/announcement-feed";
import { PublicHeader } from "@/app/public-header";
import { WorkspaceNav } from "@/app/workspace-nav";
import { MarkdownView } from "@/app/markdown";
export default function AnnouncementsPage() { return <AnnouncementFeed header={<PublicHeader current="announcements" />} navigation={<WorkspaceNav />} Content={MarkdownView} />; }
