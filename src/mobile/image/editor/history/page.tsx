import { Suspense } from "react";
import HistoryLibrary from "./history-library";

export const metadata = { title: "重绘历史记录 · Love for NAI" };

export default function RedrawHistoryPage() {
  return <Suspense fallback={<main className="p-8">正在载入重绘历史…</main>}><HistoryLibrary /></Suspense>;
}
