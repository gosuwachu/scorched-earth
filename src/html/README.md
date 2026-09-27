# HTML UI library

The browser mounts `UiHost` through `App.mountUi(canvas)`. The battlefield and HUD
remain on the game canvas. Screens retain their existing models, getters/setters,
and action handlers; HTML is their production presentation. Legacy canvas panel
painters remain available to the differential/reference harnesses.

- `components.ts`: element/button/field factories, the shared native modal shell,
  standalone dialog layout and animated close/disposal, stable keyed lists, and the `Component<T>` lifecycle
  (`element`, `update(value)`, `dispose()`). Uses text nodes, never HTML injection.
- `theme.ts` / `theme.css`: shared palette and bevels. Add `se-ui` to a container;
  add `ui-compact` for the original game density, including host new-game and online
  setup dialogs. Guest controllers keep the larger touch-friendly default density.
  Local screens reflow below 800px width or 600px height.
- `widgets.ts`: `PanelView` and `WidgetView` bind existing widget models to native
  controls. `WidgetActions` separates rendering from authorized action dispatch,
  value changes, and screen-specific accessible labels.
- `screens.ts`: composed content for shop/inventory/save lists, About, and title
  artwork. Use stable item identifiers for changing lists; do not rebuild focused
  controls during frame or network updates.
- `host.ts`: screen/nested-dialog lifecycle, keyboard ownership, focus restoration,
  fullscreen placement, and transitions. All local mutations pass the active-screen
  and online-ownership guards. Guest actions still use the existing remote adapter.
- `transitions.ts`: shared opening/closing animation and sound for screen-backed
  and standalone dialogs, including reduced-motion support. Standalone transitions
  do not pause an active online match. Settings and setup dialogs share a responsive
  600px width.
- `targeting.ts`: a temporary HTML player-name/status/Cancel row in the top bar.
  It measures its content and shares logical-pixel bounds with the renderer;
  the canvas hides readouts that cannot fit and restores them when targeting ends.
  Only Cancel captures pointer input, leaving the battlefield clickable.

To add a screen, construct its existing widget model and route buttons through
`dispatchAction(action)` (the same handler used for legacy input). Put derived UI
state in `syncUi()`, rather than in a canvas painter. Use `ScreenContent` for custom
regions, and dispose any resources the region owns. Decorative sprite canvases are
allowed inside HTML controls; text, focus, selection and actions belong to HTML.

Run `npm run test:ui:browser` for real browser interaction checks and composed-page
screenshots in `test-browser/out/ui-*.png`. This suite makes legacy `Panel.draw`
throw to verify production menus never fall back to canvas UI. Also run `npm test`,
`npm run build`, `npm run test:online:browser`, and `npm run test:online:production`.
