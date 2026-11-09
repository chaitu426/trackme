# TrackMe design system

One look for the whole app. Quiet graphite surfaces, the data carries the colour, motion explains something or does not happen.
`apps/web/src/design-system.test.ts` fails the build when a page drifts from this, and names the file and line.

## Principles

1. **Quiet chrome, rich data.** Surfaces, borders and text are neutral. Colour is for meaning: green good, amber warning, red wrong. One accent per chart.
2. **One thing is bright.** A screen has one primary action and one rich chart. Everything else steps down.
3. **Same thing, same component.** If a control exists below, use it. Do not restyle a button, input, tab row, menu or dialog on a page.
4. **Numbers line up.** Figures are tabular and right-aligned in a fixed column; cards in a row share row heights.
5. **Motion is feedback.** Short (120 to 320 ms), springs without bounce, only opacity and transform move, nothing loops. People who ask for reduced motion get fades only.

## Tokens

| Token | Use |
| --- | --- |
| `bg-background` `#141415` | the page |
| `bg-card` `#19191b` | a card, a menu, a dialog |
| `bg-raised` `#232325` | a control that is selected or raised (active tab, secondary button) |
| `border-border` | every hairline |
| `text-zinc-50 / 400 / 500` | primary, secondary, muted text (three roles, no more) |
| `#4cc38a` `amber-400` `#e5484d` | good, warning, wrong |
| `shadow-float` | only on a floating surface (menu, dialog, toast) |
| `rounded-lg` controls, `rounded-xl` cards and dialogs | no other radii |
| `--dur-fast 120ms`, `--dur 200ms`, `--dur-enter 320ms`, `--ease` | all durations and the one easing curve |

Type: Geist. Sizes `text-xs`, `text-sm`, `text-base`, page title `text-title` (28). Weights 400 and 500. Sentence case. No uppercase tracked labels.

## Components

All in `apps/web/src/components`. Reach for these before writing markup.

| Need | Use |
| --- | --- |
| A button | `ui/button` `Button` (`primary` once per screen, then `secondary`, `outline`, `ghost`, `danger`); `loading` shows a spinner and keeps width. `IconButton` for one icon |
| A text field | `ui/field` `Field` + `TextInput` (`inputClass`, `inputCompactClass` inside dense forms) |
| A choice from a list | `ui/field` `NativeSelect` (plain), `ui/select-dropdown` `SelectDropdown` (options with descriptions) |
| An on/off | `ui/switch` |
| Tabs, ranges, a few exclusive options | `motion/primitives` `PillTabs` (state), `ui/segmented` `Segmented` (links, lives in the URL), `RangeSwitcher` |
| A card | `ui/card` (`Card`, `CardHeader`, `CardTitle`, `CardDescription`) |
| A number with its change | `ui/stats-card` (three fixed rows, never wraps) |
| A ranked list or comparison | `ui/ranked-bar` `RankedBars` |
| A callout | `ui/alert` |
| Nothing to show yet | `ui/empty` |
| A status | `ui/status-dot` |
| A hint on an icon | `ui/tooltip` |
| A floating list or switcher | `ui/menu-panel` `MenuPanel` |
| A modal | `ui/dialog` `Dialog` (standard), `ModalFrame` (own layout), `SidePanelFrame` (slides from the right), `ConfirmDialog` (yes or no) |
| An in-place "are you sure" on a row | `ui/confirm-action` |
| Feedback after an action | `toast.success(...)`, `toast.error(...)` from `lib/toast` (never `alert`) |
| Copying text | `ui/copy-button` |
| Something is loading | `ui/matrix-loader`: `MatrixSpinner` inline (buttons use it through `Button loading`), `MatrixLoader` for a block. Never a spinning circle |
| The logo | `brand/logo-mark` (one implementation, shared with the landing page, in `packages/landing`) |
| A hint or menu inside the sidebar or a scroll area | `ui/tooltip` and `ui/menu-panel` `PortalMenu` draw in a portal so nothing clips them. Use `MenuPanel` only where no parent clips |
| Go anywhere | the command palette, Ctrl or Cmd + K (`command-palette.tsx`); it reads `lib/nav.ts` |

Navigation has one source: `lib/nav.ts` (`NAV_SUITES`, `navTargets`, `pageLabelFor`). The sidebar, the breadcrumb and the palette all read it, so a new page is added in one place.

## The matrix theme

The product's picture language is the glyph ramp `. : + #`. It appears as the page-header pictures, empty states (`MatrixArt`, `Empty`),
the 404 and error pages, the loaders and the logo. A shape stands for what the page is about (ridge traffic, steps funnel, globe locations,
gauge vitals and payments, pulse activity). Text laid over a picture always sits on a solid backing so it reads.

## Motion

Provider: `motion/provider` sets no-bounce springs and `reducedMotion="user"` for the whole app.

| Effect | How |
| --- | --- |
| Page arrives | `app/(app)/[workspace]/template.tsx`: one short fade |
| Blocks rise in | `.enter` with `--i` for a small stagger (once per page) |
| Bars and lines draw | `.grow-x`, `.draw-line` |
| A highlight slides to the chosen item | `layoutId` inside a `LayoutGroup` (`PillTabs`, `Segmented`, sidebar, palette) |
| A step changes | `StepPanel` (direction aware) |
| Something succeeded or failed | `DrawCheck` |
| An error repeats | `Notice` (fades and shakes once per change) |
| A menu or dialog opens | `MenuPanel`, `Dialog` (fade and a few pixels of rise; fade out on close) |
| A press | `.press` (a 2% scale down) |

Do not animate width, height, top, left or margins; do not loop anything that is not live; no `hover:scale`.
Height animation is allowed only for a small block (`Collapse`).

## Rules the guard test enforces

No `animate-in` classes (the plugin is not installed), no `transition-all`, no `alert` / `confirm` / `prompt`, no `bg-zinc-900` / `950`,
no `shadow-lg` / `xl` / `2xl`, no `border-white/10` (use `border-border`), no raw `<select>`, no hue colours outside the palette,
no colour gradients. Charts that draw their own pixels are exempt by name in the test.

## Adding a page

1. Add it to `NAV_SUITES` in `lib/nav.ts`; the sidebar, breadcrumb and palette pick it up.
2. Start from `PageHeader`, then `StatsCard` row, one main chart, then ranked lists or tables. Use `Empty` for no data.
3. Use only components from the table above. If a control is missing, add it to `components/ui` first and list it here.
4. Run `pnpm test` in `apps/web`.
