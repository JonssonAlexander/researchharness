# Keyboard shortcuts

Press **?** for the current bindings. The [shortcut registry](../src/core/keyboard.ts) supplies the cheat sheet and default map. Overrides live in localStorage at `lh:keymap`. Display-only entries document surface keys and stay out of global dispatch.

## Focus and Escape

The [window listener](../components/keyboard-shortcuts.tsx) normalizes key events and dispatches `lh:kbd-<action-id>` to the active surface. Bare keys stay with typing fields. Surface handlers claim a key before it reaches the window when they own the action.

- **Tab** cycles the active surface's fields where supported. The question dock handles its own focus loop. Browser-wide Tab navigation is suppressed. **Shift+Tab** still cycles the thinking level.
- **Escape** takes one action on the topmost active layer. Fields and surfaced menus, dialogs, and plans claim it first. The window fallback closes its cheat sheet, cancels active dictation without flushing text, or asks the chat to abort an eligible turn. Handlers that act stop propagation.
- Keep the existing focus styling. Keyboard behavior belongs to the relevant surface.

## Menus and question dock

The model menu keeps input focus in search. Up/down walks filtered rows without wrapping. Enter selects the walked row or the first match. A new query resets the walk. Escape closes the menu.

The expanded question dock walks answerable rows without wrapping, including the applicable “I don't know” or “Other…” row. Space acts like a click. Enter submits when a valid answer exists. Tab switches between thinking and the selected answer row. Typing fields keep their native arrows and spaces. A collapsed dock's button still handles its own Enter.
