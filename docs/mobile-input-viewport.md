# Mobile input viewport contract

Mobile sheets and prompt dialogs must use the same visible rectangle. The source
is `window.visualViewport`: `width`, `height`, `offsetLeft`, and `offsetTop`, already
expressed in CSS pixels. Fall back to the window dimensions when unavailable.

- Never stop updating because `scale !== 1`. Pinch zoom or input zoom can coexist
  with a keyboard resize; retaining the old height creates a gap or clips content.
- Do not multiply those dimensions by scale or subtract keyboard height again.
- Update on viewport resize/scroll, window resize/pageshow, and focus changes.
  Batch measurements with requestAnimationFrame and remove properties/listeners
  when the mobile provider unmounts.
- Body portals avoid transformed application ancestors, but positioning must
  still use the visible rectangle. Native dialogs also need its center and limits.
- While an editable field has focus, hide the mobile workspace footer so it
  cannot cover the editor. Restore it when focus returns to navigation. Do not
  remount the editor or rewrite its value to handle keyboard events: preserve
  composition, selection, and draft contents.
- Keep overflow scrolling available in short screens. Desktop prompt components
  and their styling are separate and should not be changed for this behavior.

## Manual verification — 2026-10-30

Used the in-app browser against `next dev` at `http://127.0.0.1:3000/image`.
No automated test files/scripts or image/model requests were created or run.

| Check | Result |
| --- | --- |
| Resize from 390×480 to 390×650 at page scale 1.1 | Before: stored height stayed at 480px although visual height was 590.909px. After: sheet measured 590.906px, matching the visual viewport within rounding. |
| Positive/negative text and tag input at 390×480 | Workspace footer hidden while editing; underlying generation/navigation hidden. |
| Parameter numeric input | Footer hidden on focus and restored on navigation. |
| Assistant normal/expanded input; 360×360 short viewport | Input and reference/send controls reachable through scrolling; no background toolbar leakage. |
| Notebook at 110% zoom | Before: right/bottom clipped. After: dialog inset 12px inside the visual viewport. |
| Fixed-tag search at 110% zoom, 390×480 | Header, search, scrolling body, and footer remain inside the visual viewport. |
| Close/reopen panes; return to 1089×884 desktop | Main page restored; mobile viewport variables removed; desktop layout available. |
| Development console | No captured error logs during these checks. |

Browser viewport resizing and page scaling exercise the actual layout paths but
do not emulate a physical Android/iOS keyboard or an IME candidate window. A real
device pass remains useful for vendor-specific keyboard behavior. These checks
are not a guarantee against every future UI or browser change.
