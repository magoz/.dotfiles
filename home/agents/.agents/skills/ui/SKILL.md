---
name: ui
description: "Build and review polished, accessible web interfaces: Emil Kowalski's design engineering principles plus Vercel's Web Interface Guidelines. Use when building or reviewing UI components, forms, animations, touch/mobile UX, accessibility (a11y, keyboard, aria), typography, layout shift, dark mode, performance, or marketing pages, and when asked to \"review my UI\", \"check accessibility\", \"audit design\" or \"review UX\"."
metadata:
  opencode/slash: "true"
---

# UI

Two modes. Pick from the request; arguments that name files or a pattern mean **review**.

- **Build:** writing or changing UI. Apply the core principles below and read the matching
  reference before implementing that area.
- **Review:** auditing existing UI. Read the named files (ask which files if none are given), check
  them against [web-interface-guidelines.md](references/web-interface-guidelines.md) and the review
  checklist below, and report in that file's output format.

Repository design systems, tokens and documented conventions win over these defaults.

## References

| Topic | Read when |
| --- | --- |
| [web-interface-guidelines.md](references/web-interface-guidelines.md) | Any review; full rule list and output format |
| [animations.md](references/animations.md) | Enter/exit transitions, easing, springs, animation performance |
| [ui-polish.md](references/ui-polish.md) | Typography, shadows, gradients, layout, colors, scrollbars |
| [forms-controls.md](references/forms-controls.md) | Inputs, buttons, form submission |
| [touch-accessibility.md](references/touch-accessibility.md) | Mobile, touch devices, keyboard navigation, a11y |
| [component-design.md](references/component-design.md) | Compound components, composition, props API |
| [marketing.md](references/marketing.md) | Landing pages, blogs, docs sites |
| [performance.md](references/performance.md) | Virtualization, preloading, optimization |

## Core principles

1. **No layout shift.** Hardcode dimensions of dynamic elements, use `font-variant-numeric:
   tabular-nums` for changing numbers, never change font weight on hover/selected.
2. **Touch-first, hover-enhanced.** 44px minimum tap targets; hover effects only under
   `@media (hover: hover)`; never rely on hover for core functionality.
3. **Keyboard navigation.** Tab order covers only visible elements and scrolls focused elements
   into view.
4. **Accessible by default.** `prefers-reduced-motion` for every animation, `aria-label` on every
   icon button, visible `:focus-visible` states on every interactive element.
5. **Speed over delight.** Product UI is fast and purposeful; skip animations on interactions seen
   100+ times a day. Marketing pages can be more elaborate.

### Should I animate this?

```
Will users see this 100+ times daily?
├── Yes → Don't animate
└── No
    ├── User-initiated? → ease-out, 150-250ms
    └── Page transition? → 300-400ms max
```

### Which easing?

```
Entering or exiting? → ease-out
Moving on screen?    → ease-in-out
Hover/color change?  → ease
Otherwise            → ease-out
```

## Review checklist

On top of the full guideline rules, always check:

- [ ] No layout shift on dynamic content
- [ ] Animations have reduced-motion support; only `transform`/`opacity` animate; no `transition: all`
- [ ] Touch targets ≥ 44px; hover effects disabled on touch devices
- [ ] Keyboard navigation and visible focus work
- [ ] Icon buttons have `aria-label`; form controls have labels
- [ ] Forms submit with Enter / Cmd+Enter; inputs ≥ 16px to avoid iOS zoom
- [ ] z-index uses a fixed scale or `isolation: isolate`, never `9999`
- [ ] Page scrollbars are not customized (small elements only)
