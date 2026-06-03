# Design baseline — not final

> **This document describes a design direction baseline only.** It was derived from the Stitch prototype in this folder (`code.html`) and is **not** the approved final UI. Product behavior and copy must follow **`dev/docs/prd.md` §3.7.0–3.7**, **`dev/docs/sdd.md` §8.2.0–8.2**, and **`dev/docs/i18n/`**. See **`README.md`** in this folder for scope and usage.

---

```yaml
# Machine-readable token export (reference — may diverge from shipped theme)
name: Upriv Vault System
colors:
  surface: '#081425'
  surface-dim: '#081425'
  surface-bright: '#2f3a4c'
  surface-container-lowest: '#040e1f'
  surface-container-low: '#111c2d'
  surface-container: '#152031'
  surface-container-high: '#1f2a3c'
  surface-container-highest: '#2a3548'
  on-surface: '#d8e3fb'
  on-surface-variant: '#c6c6cd'
  inverse-surface: '#d8e3fb'
  inverse-on-surface: '#263143'
  outline: '#909097'
  outline-variant: '#45464d'
  surface-tint: '#bec6e0'
  primary: '#bec6e0'
  on-primary: '#283044'
  primary-container: '#0f172a'
  on-primary-container: '#798098'
  inverse-primary: '#565e74'
  secondary: '#b6c4ff'
  on-secondary: '#00277f'
  secondary-container: '#103eb0'
  on-secondary-container: '#a3b5ff'
  tertiary: '#49e095'
  on-tertiary: '#003920'
  tertiary-container: '#001c0d'
  on-tertiary-container: '#00935a'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#dce1ff'
  secondary-fixed-dim: '#b6c4ff'
  on-secondary-fixed: '#001550'
  on-secondary-fixed-variant: '#0a3bad'
  tertiary-fixed: '#6bfdaf'
  tertiary-fixed-dim: '#49e095'
  on-tertiary-fixed: '#002110'
  on-tertiary-fixed-variant: '#005230'
  background: '#081425'
  on-background: '#d8e3fb'
  surface-variant: '#2a3548'
typography:
  headline-xl:
    fontFamily: Hanken Grotesk
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.05em
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 48px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 32px
  max-width: 1200px
```

## Brand & Style

The design system is anchored in the concept of "Calm Security." It moves away from the aggressive, high-contrast tropes of typical cybersecurity tools, favoring a minimalist, professional, and deeply serene atmosphere. The goal is to instill a sense of absolute reliability and order, reducing the anxiety often associated with sensitive data management.

The visual style is a blend of **Corporate Modern** and **Tonal Minimalism**. It utilizes deep background values and subtle surface shifts to create a focused environment. The interface should feel "locked-in" and stable, using high-quality typography and intentional whitespace to guide the user through complex encryption workflows without friction.

## Colors

The palette is centered on a dark-mode-first experience to provide a low-strain, high-focus environment. 

- **Primary Background (#0f172a):** A deep navy that serves as the foundation, representing the "vault."
- **Surface/Container (#1e293b):** Used for cards, rows, and modals to create subtle depth against the background.
- **Accent (#6b8cff):** A soft periwinkle used for primary actions and "Unlock" states. It provides high visibility without the harshness of a standard "high-alert" blue.
- **Success/Secure (#3dd68c):** Indicates active encryption or successful vault mounting.
- **Warning/Recovery (#f5a623):** Reserved for backup reminders and critical recovery-phase interactions.
- **Neutral/Sealed (#8b8b8b):** Used for locked states and secondary metadata.

## Typography

Typography focuses on clinical precision and legibility. 

- **Headlines:** Use **Hanken Grotesk** for a contemporary, sharp professional look. It provides the "serious" tone required for a security tool.
- **Body:** Use **Inter** for its neutral, systematic qualities and exceptional legibility at small sizes.
- **Data/Labels:** Use **JetBrains Mono** for IDs, recovery keys, and status labels. This monospaced font reinforces the technical, "encrypted" nature of the product and ensures characters like `0` and `O` are easily distinguishable.

## Layout & Spacing

This design system utilizes a **Fixed-Fluid Hybrid** layout. On desktop, content is contained within a 1200px max-width container, centered on the screen to maintain focus. 

- **Grid:** A 12-column grid is used for the main dashboard. Vault inventory typically spans the full width of the container in a list view.
- **Rhythm:** An 8px base grid governs all padding and margins. 
- **Responsive:** 
    - **Desktop:** Generous padding (48px) between major sections to emphasize calm.
    - **Tablet:** Columns collapse to 8; margins reduce to 24px.
    - **Mobile:** Single-column layout with 16px margins. Headlines scale down to maintain hierarchy without overwhelming the screen.

## Elevation & Depth

Hierarchy is established primarily through **Tonal Layering** rather than heavy shadows.

- **Level 0 (Base):** The main background (`#0f172a`).
- **Level 1 (Surface):** Vault rows and secondary cards use `#1e293b`.
- **Level 2 (Active/Floating):** Modals and dropdowns use `#2d3748` with a subtle, 1px border of `#334155` (low-contrast outline) and a 12px blur, 15% opacity black shadow.
- **Interactive State:** Buttons and interactive cards use a subtle inner glow (top-down) to suggest a physical, tactile press.

## Shapes

The design system uses **Soft (0.25rem)** roundedness. This "Semi-Sharp" approach maintains a professional, architectural feel—soft enough to be modern, but sharp enough to appear disciplined and secure.

- **Standard Buttons/Inputs:** 4px radius.
- **Cards/Vault Rows:** 8px (rounded-lg) radius.
- **Modals:** 12px (rounded-xl) radius.
- **Status Dots:** 100% circular (Pill-shaped) to distinguish them from structural elements.

## Components

### Button Hierarchy
- **Primary Action (Unlock):** Soft Periwinkle background with dark navy text. Full-width on mobile.
- **Secondary (Backups/Settings):** Ghost buttons with `Slate White` borders and text.
- **Split Buttons:** Used for "Lock" and "Seal" actions. The left side performs the primary action (Lock), while the right chevron provides advanced options (Seal, Wipe, Change Password).

### Vault Rows
- **Visual Encoding:** Each row includes a leading status indicator. 
- **Mounted State:** Emerald green dot and a subtle `#3dd68c` left-edge border (2px).
- **Locked State:** Stone gray dot and no border.
- **Action:** Right-aligned icon buttons for quick access to vault settings.

### Modals
- **Structure:** Always centered. Use a heavy backdrop blur (20px) to obscure sensitive data in the background.
- **Single Task:** Modals must only contain one primary action (e.g., "Enter Password").
- **Confirmation:** For destructive actions (Delete Vault, Wipe Key), include a text input requiring the user to type the vault name exactly.

### Input Fields
- **Default:** Dark surface (`#1e293b`) with a subtle 1px border.
- **Focus:** Border transitions to Periwinkle Blue (`#6b8cff`) with a 2px outer glow.
- **Password Entry:** Use JetBrains Mono for the password characters (or dots) to ensure character spacing is consistent.

### Chips/Tags
- Small, uppercase monospaced text used for encryption types (e.g., AES-256, XChaCha20) with a low-opacity background tint based on the encryption strength.