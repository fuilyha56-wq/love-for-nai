"use client";

import Link from "next/link";
import { Component, type ReactNode } from "react";

export class MobileEditorErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="image-editor-page">
        <section className="editor-error">
          <h1 role="alert">图像编辑器暂时无法继续</h1>
          <p>重新打开可读取上一次保存的草稿。</p>
          <button type="button" onClick={() => window.location.reload()}>重新打开编辑器</button>
          <Link href="/image" replace>返回工作台</Link>
        </section>
      </main>
    );
  }
}
