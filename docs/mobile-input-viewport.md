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

## Keyboard layout follow-up — 2026-10-30

The current branch already handled VisualViewport resize/scroll and body portals.
The remaining reproduced defect was inside the sheet: at 390×360 the prompt
textarea still ended at y=379, outside the visible area. Its 144px minimum and
fixed viewport-minus-toolbar arithmetic did not reflect the actual pane height.
The assistant also allowed the whole composer to scroll while reserving too
little space for its transcript. The existing focus/footer selectors are valid;
browser inspection confirmed they hide the footer correctly.

- The prompt's primary toolbar/editor group now uses the available pane's
  container height. The toolbar stays in flow; the editor uses `flex: 1`,
  `min-height: 0`, and its own scrolling. Other prompt tools and characters remain
  accessible through the pane scroller.
- The assistant uses a column flex layout. The transcript receives remaining
  space with `min-height: 0; overflow-y: auto`. The composer shrinks its textarea
  and keeps its 44px send control in flow. Queue, usage, reference previews and
  model options share an independently scrolling options panel.
- Very short visible heights compact workspace navigation and the composer.
  Neither page positions its input bar with `position: fixed`.
- The provider also exposes `--lfn-keyboard-height` and `data-keyboard-open`.
  A nonzero VirtualKeyboard bounding rectangle is preferred; otherwise an
  editable-focus, thresholded height-loss estimate is used. A pre-focus baseline
  covers browsers that resize both viewports, and scale normalization prevents
  ordinary pinch zoom from being treated as a keyboard. Orientation changes reset
  the baseline. Floating keyboards and other large resizes during editing cannot
  always be distinguished without native keyboard geometry. This value is
  advisory: **never subtract it from the VisualViewport height again**.

Validation used Next.js 16.4.3 `next dev` at `http://127.0.0.1:3000/image`:

| Check | Observed result |
| --- | --- |
| Long prompt, 22 lines | Native scrolling reached the last line; 169px textarea, 1100px scroll content, scrollTop 931. |
| Visual-only keyboard simulation | Main-world innerHeight held at 844px while VisualViewport became 420px; keyboard estimate 424px; sheet height 420px. |
| Assistant at 390×420 | Real guest tag-search results remained scrollable; transcript 128px; input 64px; send bottom y=412, inside the viewport. |
| Expanded assistant at 390×280 | Transcript 39px, input 32px, 44px send button ending at y=272. |
| Viewport pan | Simulated offsetTop 35px moved the sheet to y=35 without reducing its height twice. |
| 110% scale and resize | Visual height 436.3636px; sheet height 436.3594px (rounding only). |
| Options and switching panes | Options reachable; prompt/assistant drafts retained across pane changes. |
| Desktop return | Mobile provider unmounted; geometry and keyboard properties removed. |
| Checks | 7 viewport event/lifecycle tests and TypeScript check passed; no captured browser console errors. |

Windows computer-use was initialized, but its URL safety check stopped the Edge
window action because it could not identify the current URL confidently. Screenshots
and interactive checks were completed in the supported in-app browser bound to the
explicit local URL. This verifies browser layout and scrolling, not a physical
Android/iOS IME. Temporary viewport/scale/property overrides and test drafts were
restored after verification. No image generation or paid model request was used.

References: [Chrome viewport resize behavior](https://developer.chrome.com/blog/viewport-resize-behavior),
[VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport),
[VirtualKeyboard boundingRect](https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard/boundingRect).

## Earlier manual verification — 2026-10-30

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
