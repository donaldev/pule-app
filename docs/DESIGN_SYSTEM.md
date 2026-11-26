# Pule design system

## Compact lists and information hierarchy

- Group related items in one list. Sort by the number, date, or other field users recognize as the natural order, regardless of item status.
- Use a short section heading and concise counts when they help users scan availability. Show each item's main label first, followed by essential metadata or one short status.
- Give rows a consistent layout and minimum height. Let long labels and metadata wrap in the available space while keeping actions easy to reach.
- Distinguish ready and pending items with both text and surface treatment. Use felt for actionable rows, a subdued green or charcoal surface for pending rows, and walnut for grouping where it fits the screen.
- Start long lists with a compact preview and a clear **View all** control that exposes its expanded state. Keep eligible add actions available below the list in either state.

## Brass actions and progress

- Use a filled brass button with dark text for the primary action. Use outlined brass or a text button for secondary actions. Name each action with a verb that describes what it does.
- Show progress in a compact dark-green panel with a small icon, a short status heading, and one supporting line when the user needs guidance. Use a thin brass indicator and gentle transitions.
- Show determinate progress only when the current stage reports a real measure. Use an indeterminate indicator when progress is unknown. Label the indicator for assistive technology and keep status announcements focused on stage changes.
- Keep filenames, sizes, and technical details in context where they help the user select, recover, or fix something. Use plain language for actionable errors.

## Bottom sheets and file selection

- Use content-sized bottom sheets for short mobile tasks such as file or item selection. Give the sheet a clear title and a labeled close control. Cap its height to the available viewport and scroll the content when needed.
- Use a styled **Choose [file type]** button to open the accessible native file input. Show the selected filename once with a **Change** action when replacement is supported. Constrain long filenames and preserve access to the complete name.
- Keep controls in stable positions during asynchronous checks. Put validation messages next to the relevant choice and explain how to proceed.

## Multi-step workflows and receipts

- Give each step one job and one primary action. Keep short choices compact and give precise interactions a dedicated step with enough room to work. Preserve choices when users return to edit them.
- Distinguish work on the current device, active transfer, and processing after server acceptance. During local preparation or transfer, tell users when they need to keep the screen open.
- Show a receipt only after the authoritative system confirms acceptance. State what was accepted and what happens next, then offer **Done**. When work continues after acceptance, describe it as pending until completion is confirmed.
- Keep retry, cancellation, and recovery actions available where they apply. Give destructive actions clear labels and confirm them when appropriate.

## Responsive layout and accessibility

- Check mobile layouts at 320, 375, 390, and 430 CSS pixels with long content and realistic interface states. Avoid horizontal scrolling and account for safe areas and bottom navigation so controls remain reachable.
- Give interactive controls touch targets of at least 44 × 44 CSS pixels. Use semantic controls with visible focus, meaningful accessible names, and a logical tab order. Keep row actions independent so interactive elements are never nested.
- Place focus inside dialogs when they open, keep keyboard navigation within the dialog, and restore focus to the opener when it remains available. Move focus to the next relevant step when the previous control disappears.
- Support keyboard operation for tasks that otherwise depend on touch or pointer gestures. Use text alongside color and icons to communicate state, and honor reduced-motion preferences for animations and transitions.
