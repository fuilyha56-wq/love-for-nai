/** Copy in both HTTPS and the existing HTTP deployment. */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* use the user-gesture fallback below */
    }
  }
  const previous = document.activeElement as HTMLElement | null;
  const input = document.createElement("textarea");
  input.value = text;
  input.readOnly = true;
  input.setAttribute("aria-hidden", "true");
  Object.assign(input.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    opacity: "0",
  });
  document.body.appendChild(input);
  try {
    input.focus({ preventScroll: true });
    input.select();
    if (!document.execCommand("copy"))
      throw new Error("复制未成功，请在文本框中使用 Ctrl+C 或系统复制操作");
  } finally {
    input.remove();
    previous?.focus({ preventScroll: true });
  }
}
