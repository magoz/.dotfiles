---
name: ui
description: "Design, build and review web interfaces: distinctive visual direction, design engineering craft (Emil Kowalski), Vercel's Web Interface Guidelines and React/Next.js performance rules, with Tailwind CSS v4, shadcn/ui and Motion references. Use when building or reviewing UI components, pages or apps, forms, animations, touch/mobile UX, accessibility (a11y, keyboard, aria), typography, layout shift, dark mode, React/Next.js rendering, data fetching or bundle performance, landing pages, and when asked to \"review my UI\", \"check accessibility\", \"audit design\" or \"review UX\"."
metadata:
  opencode/slash: "true"
---

# UI

Three modes. Pick from the request; arguments that name files or a pattern mean **review**.

- **Design:** new interfaces or visual redesigns. Commit to an aesthetic direction (below) before
  coding.
- **Build:** writing or changing UI. Apply the craft principles below and read the matching
  references before implementing that area.
- **Review:** auditing existing UI. Read the named files (ask which if none are given), check them
  against [web-interface-guidelines.md](references/web-interface-guidelines.md), the review
  checklist below and, for React/Next.js code, the critical and high rules in
  [react-performance.md](references/react-performance.md). Report in the guidelines' output format.

The repository's design system, tokens, components and documented conventions win over every default
here. Use the aesthetic guidance for greenfield work or when a distinctive look is requested.

## References

| Area | Files | Read when |
| --- | --- | --- |
| Guidelines | [web-interface-guidelines.md](references/web-interface-guidelines.md) | Any review; full rule list and output format |
| Craft | [animations](references/craft/animations.md), [ui-polish](references/craft/ui-polish.md), [forms-controls](references/craft/forms-controls.md), [touch-accessibility](references/craft/touch-accessibility.md), [component-design](references/craft/component-design.md), [marketing](references/craft/marketing.md), [performance](references/craft/performance.md) | Easing/timing, typography/shadows/layout, inputs and buttons, touch/keyboard/a11y, component APIs, landing pages and docs, virtualization/preloading |
| React performance | [react-performance.md](references/react-performance.md) → `references/react-performance/<rule>.md` | React/Next.js data fetching, bundles, server components, re-renders |
| Tailwind v4 | `references/stack/tailwind/`: `v4-config`, `v4-features`, `utilities-layout`, `utilities-styling`, `responsive` | `@theme` config, container queries, OKLCH, utilities, breakpoints |
| shadcn/ui | `references/stack/shadcn/`: `setup`, `core-components`, `form-components`, `theming`, `accessibility` | Installing, using or theming shadcn components |
| Motion | `references/stack/motion/`: `motion-core`, `motion-advanced` | Gestures, layout, exit, scroll and orchestrated animations |
| Visual design | `references/visual/`: `philosophy`, `execution` | Posters, brand materials, multi-page visual systems |

## Design: aesthetic direction

Before coding, decide:

- **Purpose:** what problem, for whom.
- **Tone:** commit to one direction, e.g. brutally minimal, maximalist, retro-futuristic, organic,
  luxury, playful, editorial, brutalist, art deco, soft/pastel, industrial. Intentionality matters
  more than which.
- **Differentiation:** what makes it memorable.

Avoid generic AI aesthetics: default fonts (Inter, Roboto, Arial, system fonts, Space Grotesk),
purple gradients on white, predictable layouts and cookie-cutter components. Pair a distinctive
display font with a refined body font; use OKLCH colors with a dominant palette and sharp accents;
consider asymmetric or grid-breaking composition, generous negative space or controlled density, and
atmospheric backgrounds (gradient meshes, noise, grain, layered transparency).

## Build: stack defaults

Use the project's stack when it has one. Otherwise:

- **Tailwind CSS v4:** CSS-first config with `@theme` tokens for spacing, colors and typography;
  single `@import "tailwindcss"`; mobile-first; no dynamically built class names.
- **shadcn/ui:** Radix-based components for accessible primitives.
- **Animation:** Tailwind `transition-*` for hover/state changes, `tailwindcss-animate` for shadcn
  states, Motion (`motion/react`) for gestures, layout and exit animations, CSS `@starting-style`
  for simple enter/exit without JS.

## Build: craft principles

1. **No layout shift.** Hardcode dimensions of dynamic elements, use `font-variant-numeric:
   tabular-nums` for changing numbers, never change font weight on hover/selected.
2. **Touch-first, hover-enhanced.** 44px minimum tap targets; hover effects only under
   `@media (hover: hover)`; never rely on hover for core functionality.
3. **Keyboard navigation.** Tab order covers only visible elements and scrolls focused elements
   into view.
4. **Accessible by default.** `prefers-reduced-motion` for every animation, `aria-label` on every
   icon button, visible `:focus-visible` states on every interactive element, semantic HTML first.
5. **Speed over delight.** Product UI is fast and purposeful; skip animations on interactions seen
   100+ times a day. Marketing pages can be more elaborate.
6. **No waterfalls, small bundles.** In React/Next.js, parallelize independent async work and avoid
   barrel imports and eagerly loaded heavy modules before micro-optimizing renders.

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
- [ ] React/Next.js: no request waterfalls, no barrel imports of large libraries, heavy components
      loaded lazily
