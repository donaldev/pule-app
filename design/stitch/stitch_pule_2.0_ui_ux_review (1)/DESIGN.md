---
name: Pule 2.0
colors:
  surface: '#121413'
  surface-dim: '#121413'
  surface-bright: '#383a38'
  surface-container-lowest: '#0d0f0e'
  surface-container-low: '#1a1c1b'
  surface-container: '#1e201f'
  surface-container-high: '#282a29'
  surface-container-highest: '#333534'
  on-surface: '#e2e3e0'
  on-surface-variant: '#d1c5b5'
  inverse-surface: '#e2e3e0'
  inverse-on-surface: '#2f3130'
  outline: '#9a8f81'
  outline-variant: '#4e463a'
  surface-tint: '#e8c181'
  primary: '#e8c181'
  on-primary: '#422c00'
  primary-container: '#c8a366'
  on-primary-container: '#523904'
  inverse-primary: '#775924'
  secondary: '#9ed2b8'
  on-secondary: '#003827'
  secondary-container: '#20523e'
  on-secondary-container: '#90c3ab'
  tertiary: '#d2c4bb'
  on-tertiary: '#372f29'
  tertiary-container: '#b3a69e'
  on-tertiary-container: '#453c35'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#ffdeab'
  primary-fixed-dim: '#e8c181'
  on-primary-fixed: '#271900'
  on-primary-fixed-variant: '#5d420e'
  secondary-fixed: '#b9eed4'
  secondary-fixed-dim: '#9ed2b8'
  on-secondary-fixed: '#002115'
  on-secondary-fixed-variant: '#1e4f3c'
  tertiary-fixed: '#eee0d6'
  tertiary-fixed-dim: '#d2c4bb'
  on-tertiary-fixed: '#211a15'
  on-tertiary-fixed-variant: '#4e453e'
  background: '#121413'
  on-background: '#e2e3e0'
  surface-variant: '#333534'
typography:
  display-lg:
    fontFamily: EB Garamond
    fontSize: 56px
    fontWeight: '400'
    lineHeight: 64px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: EB Garamond
    fontSize: 38px
    fontWeight: '400'
    lineHeight: 44px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: EB Garamond
    fontSize: 36px
    fontWeight: '500'
    lineHeight: 44px
    letterSpacing: -0.015em
  headline-lg-mobile:
    fontFamily: EB Garamond
    fontSize: 28px
    fontWeight: '500'
    lineHeight: 36px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: EB Garamond
    fontSize: 26px
    fontWeight: '500'
    lineHeight: 34px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: EB Garamond
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: 0em
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 17px
    fontWeight: '400'
    lineHeight: 26px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: 0em
  body-sm:
    fontFamily: Hanken Grotesk
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0.005em
  label-md:
    fontFamily: Hanken Grotesk
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.08em
  label-sm:
    fontFamily: Hanken Grotesk
    fontSize: 10px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.12em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-mobile: 0.75rem
  margin: 3rem
  margin-mobile: 1.25rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system channels the heritage of exclusive billiard parlors, private athletic lounges, and bespoke sporting instruments. It pairs the quiet authority of dark walnut woodwork, archival baize felt, and aged patinated brass with modern, razor-sharp digital craft.

The design philosophy unites **tactile luxury** with **precise athletic utility**:
- **Ambience:** Low-lit, cinematic, and focused. The interface recedes into deep charcoal and rich green baize undertones, allowing gold and brass instrumentation to command attention.
- **Form and Texture:** High tactile discipline. Surfaces suggest physical slate, premium card stocks, and brushed hardware, avoiding sterile flat design without drifting into cartoon skeuomorphism.
- **Demeanor:** Quiet confidence, uncompromising craft, and timeless sporting precision.

## Colors

The palette reproduces the chromatic weight of a private billiard room: charcoal slate, woolen table cloth, hand-rubbed timber, and brass markers.

### Palette Architecture
- **Primary (`#C8A366` - Aged Brass):** Used for decisive interactive elements, active status indicators, keyframes, and focal accents. An alternate bright gold (`#D4AF37`) serves strictly for highlights, hover flares, and triumph indicators.
- **Secondary (`#1B4D3A` - Baize Felt):** Evokes tournament cloth. Used for prominent contextual surfaces, active table states, and high-tier athletic badging. Subdued felt (`#15392B`) anchors nested structural containers.
- **Tertiary (`#332B25` - Walnut Wood):** Grounding timber tone for structural frames, tactile wells, and secondary cards. Elevated walnut tone (`#26201B`) provides depth steps.
- **Neutral Base (`#121413` - Near-Black Charcoal):** The dominant canvas shade. Raised surfaces step gently up to `#181A19` and `#202322`.
- **Text & Foreground:** Primary typography uses warm ivory linen (`#F7F3EE`), while secondary annotations and muted captions use `rgba(247, 243, 238, 0.72)` and `rgba(247, 243, 238, 0.44)`.
- **Borders & Dividers:** Subtle, structural hairlines in Walnut Edge (`#3C332A`) and Felt Rail (`#274235`).

## Typography

The typographic hierarchy pairs the classical elegance of `EB Garamond` with the clean, utilitarian legibility of `Hanken Grotesk`.

- **Editorial Titles:** Headings deploy `EB Garamond` in regular and medium cuts. It introduces quiet dignity, recalling historic tournament ledgers and etched brass placards.
- **Instrument Body & Meta:** Interface body text relies on `Hanken Grotesk` for effortless scanning under low-contrast ambient environments.
- **Micro-Typography:** Labels, scorecards, rack tallies, and technical specs use uppercase `Hanken Grotesk` with tracked letter-spacing (`0.08em` to `0.12em`) to emulate precision dial calibrations and engraved serial numbers.

## Layout & Spacing

The layout operates on a disciplined 4px base grid with deliberate, gallery-like proportions.

### Grid Framework
- **Desktop (1024px+):** 12-column layout with 24px (`1.5rem`) gutters and 48px (`3rem`) page margins. Maximum readable container constrained to 1320px to sustain intimate parlor proportions.
- **Tablet (768px - 1023px):** 8-column layout with 20px gutters and 32px margins.
- **Mobile (Below 768px):** 4-column layout with 12px (`0.75rem`) gutters and 20px (`1.25rem`) edge margins.

### Rhythmic Density
Negative space is treated with architectural reverence. Dense data blocks (such as break-and-run statistics or match odds) sit within compact card enclosures, surrounded by generous exterior intervals that keep the visual atmosphere calm and composed.

## Elevation & Depth

Rather than conventional drop shadows, elevation is rendered through physical illumination, low-contrast structural hairlines, and warm optical blooms.

- **Surface Tiers:**
  - *Base Surface (Canvas):* `#121413`
  - *Tier 1 (Panels & Rails):* `#181A19` with a 1px border of `#3C332A` (Walnut) or `#274235` (Felt).
  - *Tier 2 (Interactive Modules):* `#26201B` / `#1B4D3A` with inset hairline highlight `rgba(247, 243, 238, 0.05)`.
  - *Tier 3 (Modals & Overlays):* `#202322` topped with an amber-tinted top edge reflection.
- **Brass Luminescence:** Floating actions and active states project a soft, warm candlelit halo: `box-shadow: 0 4px 24px rgba(200, 163, 102, 0.18)`.
- **Recessed Areas:** Data tables, score tally wells, and inputs use inset shadows (`inset 0 1px 3px rgba(0, 0, 0, 0.45)`) to replicate carved timber grooves and slate recesses.

## Shapes

The geometry adheres to strict, hand-tooled cabinetry traditions.

- **Base Radius:** Components utilize crisp 4px (`0.25rem`) corners (`roundedness: 1`), conveying machined brass inlays and beveled cue-case edges.
- **Card & Dialog Contours:** Major panels and dialogs cap at 8px (`0.5rem`) to maintain structural tautness.
- **Full Radius Exception:** Billiard ball status indicators, rack pins, and player avatars alone take circular forms (`rounded-full`), accentuating their role as dynamic sporting objects against architectural cabinetry.

## Components

### Buttons
- **Primary (Solid Brass):** Background `#C8A366`, text `#121413` (`font-weight: 600`), 4px corner radius. On hover, background shifts to `#D4AF37` with an ambient glow (`rgba(200, 163, 102, 0.25)`).
- **Secondary (Baize Felt):** Background `#15392B`, border 1px solid `#274235`, text `#F7F3EE`. On hover, border shifts to `#C8A366`.
- **Tertiary / Ghost:** Transparent surface with 1px border in `#3C332A`, ivory text. Subtle timber highlight on press.

### Inputs & Selectors
- **Fields:** Recessed charcoal `#0E100F` background, 1px border `#3C332A`, text `#F7F3EE`.
- **Active State:** Border snaps to `#C8A366` with a micro-glow. Labels float in tracked uppercase `label-sm`.

### Chips & Badges
- **Status Markers:** Compact, letter-spaced uppercase capsules (`label-sm`).
- **Styles:** Felt variant (`#1B4D3A` fill, `#274235` border, `#F7F3EE` text) and Brass variant (`rgba(200, 163, 102, 0.12)` fill, `#C8A366` border, `#C8A366` text).

### Cards & Panels
- Constructed from `#181A19` or `#26201B` with a 1px border in `#3C332A`.
- Card headers pair an `EB Garamond` title with an athletic tracked label indicator.
- Content divisions rely on subtle hairlines (`rgba(247, 243, 238, 0.08)`).

### Selection Controls (Checkboxes & Radios)
- Custom square checkboxes (4px radius) and circular radio points.
- Unchecked: Inset dark slate with `#3C332A` stroke.
- Checked: `#C8A366` fill with an inset `#121413` check or dot.

### Specialized Billiard Components
- **Rack Score Tracker:** Horizontal rail featuring inset walnut recesses, brass score tallies, and ivory numbering.
- **Match Ledger Table:** Alternating rows of `#121413` and `#161918` bounded by `#274235` felt hairlines.