# Mobile input viewport contract

Mobile sheets and prompt dialogs must use the same usable rectangle. The default
source is `window.visualViewport`: `width`, `height`, `offsetLeft`, and `offsetTop`,
already expressed in CSS pixels. Fall back to window dimensions when unavailable.
While the full-screen workspace owns VirtualKeyboard overlay mode, a validated
bottom-docked keyboard rectangle determines the lower edge instead. Never guess
a missing strip by adding a fixed height or taking `max(innerHeight, visualHeight)`.

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

## Residual blank-area follow-up — 2026-10-30 (r15)

The user reported the earlier release still left the same strip below both
workspaces on phones, including mobile Edge and other browsers. The screenshots
show the two workspaces ending at the same vertical position, approximately
105 CSS px above the keyboard. This points to their shared outer geometry, but
the screenshots alone do not establish which native viewport metric was wrong.
No physical phone is connected to this workstation, so device resolution is
**not yet verified**. The previous desktop resize checks were insufficient to
claim a physical keyboard fix.

Changes in this follow-up:

- The full-screen workspace locks background document scrolling and restores
  the exact previous inline styles, priorities, and scroll position on close.
- On supported secure-context Chromium browsers, the workspace opts into
  `virtualKeyboard.overlaysContent` before input focus. A finite, full-width,
  bottom-docked rectangle supplies `height = keyboard.y - viewport.offsetTop`.
  This lets actual keyboard geometry recover an undersized visual report. Native
  height is not subtracted again. Floating or invalid rectangles are rejected.
- Overlay ownership lasts only for the workspace visit. Initial zoom skips it;
  later zoom disables it. If the first focused input still has no usable native
  rectangle after 900ms, the visit falls back to browser behavior. A normal
  dismissal after successful geometry is not treated as API failure.
- The viewport metadata requests `interactive-widget=resizes-content`. Browsers
  without native geometry retain VisualViewport/window fallback. Layout height
  is accepted only when visual height agrees, preventing split-screen resizing
  from expanding content behind a keyboard.
- Resize/focus events schedule four bounded trailing measurements at 60, 180,
  350 and 600ms. A browser that notifies before its final IME geometry settles
  no longer leaves the first measurement frozen. Cleanup cancels every timer.
- A confirmed assistant defect was empty-state auto-scrolling: the welcome
  content was scrolled to its bottom on resize. Empty sessions now stay at the
  top; real results follow the latest message only while the reader is following.
  ResizeObserver reads current session state and observes the transcript as well
  as the composer, preserving user scroll position and draft text.

Next.js dev / in-app browser verification (simulated keyboard geometry):

| Scenario | Observed result |
| --- | --- |
| Layout 390×844, visual report 360px, native keyboard top 465px | Sheet bottom 465px; the missing 105px becomes usable content. Welcome heading and description appear; input 64px, send bottom 457px. |
| 40-line prompt in the same geometry | Textarea 214px, scroll content 1964px; keyboard navigation reaches line 40 with caret visible. Original prompt restored. |
| Actual guest `blue_sky` tag lookup | Search response appears in the real transcript, 173px tall; content scrolls in 373px. No paid model/image request. |
| Read older results, then change keyboard top 465→400px | Scroll position stays at 0; transcript becomes 108px; draft retained; send bottom 392px. |
| Visual-only fallback with actual layout still 844px | Visual height 420px gives sheet bottom 420px and send bottom 412px. Unlike the previous check, neither innerHeight nor the layout viewport was resized. |
| Content viewport 390×280 | Transcript 39px, textarea 32px, send bottom 272px; content remains scrollable. |
| 110% page scale | Overlay is disabled; sheet height 767.2656px matches VisualViewport 767.2727px within rounding. |
| Close all workspace panes | Body position and root overflow restored; keyboard overlay restored to false; original prompt and seed preserved. |
| Automated checks | 20 viewport/keyboard lifecycle tests, changed-source ESLint, and TypeScript passed before integrating the latest GitHub changes. Production build validates the integrated release. |

Screenshots are local QA artifacts under `scripts/.tmp/mobile-keyboard-r15/`:
`prompt-end.jpg`, `assistant-native-geometry.jpg`, `assistant-results.jpg`, and
`assistant-visual-only.jpg`. Captures are clipped to the simulated visible area;
they are not photos of a physical keyboard. All injected geometry is removed
after verification. The actual phone/browser URL and a device pass are still
needed to establish that the user's reported condition is fully resolved.

References: [VirtualKeyboard API](https://developer.chrome.com/docs/web-platform/virtual-keyboard/),
[VirtualKeyboard coordinates and overlay contract](https://www.w3.org/TR/virtual-keyboard/),
[browser viewport resize behavior](https://developer.chrome.com/blog/viewport-resize-behavior/).

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
| Earlier viewport simulation (limited) | innerHeight was mocked to 844px while the browser/layout viewport itself was resized to 420px. This did not reproduce a true visual-only keyboard resize; the r15 check above replaces that evidence. |
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
