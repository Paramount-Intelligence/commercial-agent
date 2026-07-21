# Paramount Intelligence — UI Specification

> Complete design system reference for replicating this project's UI in another codebase.
> Source of truth: `app/globals.css`, `components/`, `app/layout.tsx`

---

## Table of Contents

1. [Brand Identity](#1-brand-identity)
2. [Tech Stack](#2-tech-stack)
3. [Color System](#3-color-system)
4. [Typography](#4-typography)
5. [Spacing & Layout](#5-spacing--layout)
6. [Border Radius & Shadows](#6-border-radius--shadows)
7. [Global CSS Classes](#7-global-css-classes)
8. [Layout Components](#8-layout-components)
9. [Section Patterns](#9-section-patterns)
10. [Form Elements](#10-form-elements)
11. [Page Templates](#11-page-templates)
12. [Animation System](#12-animation-system)
13. [Responsive Breakpoints](#13-responsive-breakpoints)
14. [Icons & Assets](#14-icons--assets)
15. [Admin UI (Separate Theme)](#15-admin-ui-separate-theme)
16. [Design Tokens JSON](#16-design-tokens-json)
17. [New Project Setup Checklist](#17-new-project-setup-checklist)

---

## 1. Brand Identity

| Attribute | Value |
|-----------|-------|
| **Theme** | Deep Navy + Electric Blue + Silver Slate |
| **Tone** | Enterprise, technical, trustworthy, modern |
| **Primary font** | Montserrat (Google Fonts) |
| **Logo** | `/images/logo.png` — 36×36 (header), 40×40 (footer) |
| **Favicon** | `/images/logo.png` |

---

## 2. Tech Stack

### Core Framework
| Package | Version | Purpose |
|---------|---------|---------|
| Next.js | 16.x | App Router, SSR/SSG |
| React | 19.x | UI library |
| TypeScript | 5.x | Type safety |
| Tailwind CSS | 4.x | Utility-first styling (CSS-first config) |

### UI Libraries
| Package | Purpose |
|---------|---------|
| `@radix-ui/react-navigation-menu` | Desktop dropdown navigation |
| `class-variance-authority` | Component variants (nav trigger) |
| `clsx` + `tailwind-merge` | Class merging via `cn()` |
| `lucide-react` | Icon library |
| shadcn/ui (partial) | Only `navigation-menu` component installed |

### Styling Approach
- **No `tailwind.config.js`** — tokens defined in `app/globals.css` via `@import "tailwindcss"` and `@theme inline`
- **PostCSS**: `@tailwindcss/postcss` only
- **Utility helper**: `cn()` in `lib/utils.ts`
- **Inline styles**: Used for brand gradients and one-off colors
- **No CSS Modules, Sass, or styled-components**

### Required Dependencies (UI only)
```json
{
  "dependencies": {
    "@radix-ui/react-navigation-menu": "^1.2.14",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.562.0",
    "tailwind-merge": "^3.4.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "tailwindcss": "^4"
  }
}
```

---

## 3. Color System

### Brand Palette (Canonical — use these in new projects)

| Token | Hex | Usage |
|-------|-----|-------|
| `navy-900` | `#060d1a` | Deepest navy, footer background |
| `navy-800` | `#0d1f3c` | Foreground, headings on light bg, surface-dark |
| `navy-700` | `#152d56` | Mid navy, gradient stops |
| `navy-600` | `#1b3a6b` | Gradient stops |
| `navy-500` | `#1e4d8c` | Gradient stops |
| `blue-500` | `#1e6fd9` | **Primary electric blue** — CTAs, links, accents |
| `blue-400` | `#3b88f5` | Accent, badges, live indicators |
| `blue-300` | `#6ba8ff` | Light blue text, eyebrow labels, gradients |
| `silver-400` | `#8fa4c4` | Muted text on dark backgrounds |
| `silver-300` | `#b5c8e2` | Body text on dark sections |
| `silver-200` | `#d4e0f0` | Light accents |
| `silver-100` | `#eef3fa` | Lightest silver |

### Semantic Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `background` | `#ffffff` | Page background |
| `foreground` | `#0d1f3c` | Default text |
| `primary` | `#1e6fd9` | Primary actions |
| `primary-dark` | `#1559b4` | Primary hover, gradient end |
| `secondary` | `#8fa4c4` | Secondary text |
| `accent` | `#3b88f5` | Highlights |
| `surface-dark` | `#0d1f3c` | Dark surfaces |
| `surface-mid` | `#152d56` | Mid-tone surfaces |
| `bg-light` | `#f1f3f6` | Subpage / light section background |
| `section-light` | `#f0f6ff` | Alternate light section |
| `section-light-border` | `rgba(30, 111, 217, 0.08)` | Light section borders |

### Section Backgrounds

**Dark section:**
```css
background: linear-gradient(160deg, #060d1a 0%, #0d1f3c 40%, #152d56 80%, #0d1f3c 100%);
```

**Hero gradient (with radial glows):**
```css
background:
  radial-gradient(ellipse at 20% 50%, rgba(30, 111, 217, 0.25) 0%, transparent 55%),
  radial-gradient(ellipse at 80% 20%, rgba(27, 58, 107, 0.35) 0%, transparent 50%),
  radial-gradient(ellipse at 60% 80%, rgba(13, 31, 60, 0.5) 0%, transparent 45%),
  linear-gradient(160deg, #060d1a 0%, #0d1f3c 50%, #060d1a 100%);
```

**Light section:**
```css
background: #f1f3f6;
background-image: radial-gradient(circle, rgba(30, 111, 217, 0.1) 1px, transparent 1px);
background-size: 32px 32px;
```

### Text Colors by Context

| Context | Heading | Body | Muted |
|---------|---------|------|-------|
| Dark background | `#ffffff` or gradient white→blue | `#b5c8e2` | `#8fa4c4` |
| Light background | `#0d1f3c` | `text-gray-700` | `text-gray-500` |
| Footer | `#3b88f5` (section titles) | `#8fa4c4` | `#4a6080` (copyright) |

### Legacy Color Note
Some older components use `#17599d` / `#144a75`. The global CSS remaps these to `#1e6fd9` / `#1559b4`. **In new projects, use the canonical palette only.**

---

## 4. Typography

### Font Family
```tsx
// app/layout.tsx
import { Montserrat } from "next/font/google";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  display: "swap",
});

// Apply to <body className={montserrat.className}>
```

```css
/* globals.css fallback */
html, body {
  font-family: 'Montserrat', sans-serif;
}
```

### Font Weights Used
| Weight | Tailwind class | Usage |
|--------|----------------|-------|
| 300 | `font-light` | Rare |
| 400 | `font-normal` | Body text |
| 500 | `font-medium` | Nav links, breadcrumbs |
| 600 | `font-semibold` | Buttons, labels, eyebrows |
| 700 | `font-bold` | Headings, logo text |
| 800 | `font-extrabold` | Rare |
| 900 | `font-black` | Stat numbers |

### Type Scale

| Role | Size | Weight | Line Height | Color |
|------|------|--------|-------------|-------|
| Homepage hero H1 | `clamp(38px, 5vw, 72px)` | bold | `1.05` | white / shimmer |
| Section H2 (major) | `text-4xl md:text-5xl` | bold | default | context-dependent |
| Section H3 | `text-2xl md:text-3xl` | bold | default | context-dependent |
| Subpage hero H1 | `text-4xl lg:text-5xl` | bold | default | gradient text |
| Card title | `text-xl` | bold | default | `#0d1f3c` |
| Stat numbers | `text-5xl` or `text-3xl` | bold/black | default | gradient |
| Eyebrow / label | `text-xs` | semibold | default | `#6ba8ff`, `tracking-widest uppercase` |
| Body (dark) | `text-base md:text-lg` | normal | relaxed | `#b5c8e2` |
| Body (light) | `text-sm`–`text-lg` | normal | relaxed | gray-500/700 |
| Nav links | `text-sm` | medium/semibold | default | `#b5c8e2` → white on hover |
| Buttons | `14px` / `text-sm` | semibold | default | white |
| Footer headings | `text-xs` | semibold | default | `#3b88f5`, `tracking-widest uppercase` |

### Text Effects

| Class | Effect |
|-------|--------|
| `.text-shimmer` | Animated white/blue gradient text |
| `.text-gradient-blue` | Static gradient `#1e6fd9` → `#6ba8ff` |
| `.text-gradient-navy` | Static gradient `#0d1f3c` → `#1e6fd9` |

---

## 5. Spacing & Layout

### Container
```
max-w-7xl mx-auto px-6 lg:px-12 xl:px-16
```
- Max width: **1280px** (`max-w-7xl`)
- Horizontal padding: 24px → 48px (lg) → 64px (xl)

### Section Spacing
| Pattern | Classes |
|---------|---------|
| Major section | `py-24` (96px vertical) |
| Compact section | `py-16` or `py-10` |
| Header clearance | `pt-24` or `mt-20` (fixed header is 80px) |

### Grid Gaps
`gap-4` | `gap-6` | `gap-8` | `gap-10` | `gap-12` | `gap-16`

### Common Grid Patterns
```
grid-cols-1 md:grid-cols-2 lg:grid-cols-3     /* 3-column cards */
grid-cols-1 lg:grid-cols-2                     /* 2-column split */
grid-cols-1 lg:grid-cols-[1fr_420px]           /* Hero with sidebar card */
grid-cols-1 lg:grid-cols-[1fr_460px] xl:...    /* Hero wider sidebar */
```

### Header
- Height: `h-20` (80px)
- Position: `fixed top-0 left-0 right-0 z-50`

### Card Padding
`p-6` | `p-8` | `p-8 md:p-10` | `p-8 md:p-12`

---

## 6. Border Radius & Shadows

### Border Radius
| Token | Value | Usage |
|-------|-------|-------|
| Button | `8px` / `rounded-lg` | Primary/secondary buttons |
| Card | `16px` / `rounded-2xl` | Cards, form panels, images |
| Dropdown | `12px` / `rounded-xl` | Nav dropdowns, social buttons |
| Pill | `rounded-full` | Badges, status dots |
| Accent line | `2px` | Decorative underlines |
| Logo | `rounded-lg` | Header/footer logo |

### Shadows
| Class / Context | Value |
|-----------------|-------|
| `.glow-blue` | `0 0 20px rgba(30,111,217,0.4), 0 0 60px rgba(30,111,217,0.15)` |
| `.glow-blue-sm` | `0 0 12px rgba(30,111,217,0.3)` |
| `.hover-glow-blue:hover` | `0 8px 40px rgba(30,111,217,0.25), 0 2px 12px rgba(30,111,217,0.15)` + `translateY(-4px)` |
| `.btn-primary:hover` | `0 8px 24px rgba(30,111,217,0.45)` |
| Header (scrolled) | `0 4px 24px rgba(0,0,0,0.4)` |
| Form card | `shadow-xl` |
| Cards | `shadow-sm` to `shadow-2xl` |

### Borders
| Context | Value |
|---------|-------|
| Light cards | `1px solid rgba(30, 111, 217, 0.12–0.15)` |
| Glass (dark) | `1px solid rgba(30, 111, 217, 0.2)` |
| Glass (light) | `1px solid rgba(143, 164, 196, 0.3)` |
| Header (scrolled) | `1px solid rgba(30, 111, 217, 0.2)` |
| Badge/pill | `1px solid rgba(30, 111, 217, 0.3)` |

---

## 7. Global CSS Classes

Copy the full `app/globals.css` into your new project. Key classes:

### Buttons
```css
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: linear-gradient(135deg, #1e6fd9 0%, #1559b4 100%);
  color: #ffffff;
  padding: 12px 28px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 14px;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(30, 111, 217, 0.45);
}

.btn-secondary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  color: #0d1f3c;
  padding: 12px 28px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 14px;
  border: 1.5px solid rgba(13, 31, 60, 0.25);
  transition: all 0.2s ease;
}
.btn-secondary:hover {
  border-color: #1e6fd9;
  color: #1e6fd9;
  background: rgba(30, 111, 217, 0.05);
}
```

### Glassmorphism
| Class | Background | Blur | Border |
|-------|------------|------|--------|
| `.glass` | `rgba(255,255,255,0.08)` | 16px | `rgba(255,255,255,0.12)` |
| `.glass-dark` | `rgba(13,31,60,0.75)` | 20px | `rgba(30,111,217,0.2)` |
| `.glass-light` | `rgba(255,255,255,0.85)` | 16px | `rgba(143,164,196,0.3)` |

### Background Utilities
| Class | Description |
|-------|-------------|
| `.bg-hero-gradient` | Multi-layer radial + linear hero background |
| `.bg-gradient-navy` | `135deg #060d1a → #0d1f3c → #152d56` |
| `.bg-gradient-blue-dark` | `135deg #0d1f3c → #1b3a6b → #1e4d8c` |
| `.geo-grid` | 60×60px blue grid lines at 6% opacity |
| `.geo-dots` | 32×32px blue dot pattern at 15% opacity |

### Decorative
| Class | Description |
|-------|-------------|
| `.accent-line` | 48×3px blue gradient bar |
| `.accent-line-sm` | 32×2px blue gradient bar |
| `.section-divider` | 1px horizontal blue gradient line |
| `.fade-mask-x` | Horizontal fade mask for tickers (8%–92%) |

### Scroll Reveal
| Class | Initial state | Revealed state |
|-------|---------------|----------------|
| `.reveal` | `opacity:0; translateY(28px)` | `opacity:1; translateY(0)` |
| `.reveal-left` | `opacity:0; translateX(-28px)` | `opacity:1; translateX(0)` |
| `.reveal-right` | `opacity:0; translateX(28px)` | `opacity:1; translateX(0)` |

Add `.revealed` class via IntersectionObserver (see `lib/useScrollReveal.ts`).

---

## 8. Layout Components

### Header (`components/Header.tsx`)

**Props:** `showAdminLogout?: boolean` (default `false`)

| Property | Specification |
|----------|---------------|
| Position | `fixed top-0 z-50 w-full h-20` |
| Background (default) | `rgba(6, 13, 26, 0.75)` + `backdrop-filter: blur(20px)` |
| Background (scrolled >20px) | `rgba(6, 13, 26, 0.92)` + border + shadow |
| Logo | 36×36, `rounded-lg`, links to `/` |
| Brand text | `text-white font-bold text-lg` (hidden below `sm`) |
| Desktop nav | `hidden lg:flex` — Radix NavigationMenu dropdowns |
| Mobile nav | `lg:hidden` — accordion dropdowns with `animate-slide-down` |
| Nav link color | `#b5c8e2` → `#ffffff` on hover |
| CTA button | `.btn-primary` → `/contact-us` |
| Mobile menu icon | Lucide `Menu` / `X`, `w-6 h-6` |

**Navigation structure:**
```
Services (dropdown)
  ├── AI Solutions and Engineering
  ├── AI Strategy and Consulting
  ├── Data and Analytics
  ├── Cloud Services
  ├── AI Workflow Automation
  └── AI Studio & Platform Engineering
Industries (dropdown)
  ├── Technology & Enterprise Software
  ├── Manufacturing, Industrial & Energy
  ├── Telecommunications
  ├── Fintech & Digital Payments
  ├── B2B Enterprise Solutions
  ├── Digital Lifestyle & Entertainment
  ├── Mobility, Ride-Hailing & Delivery
  └── E-commerce & Marketplaces
Case Studies → /case-studies
About Us → /about-us
Insights (dropdown)
  └── Blog (external)
Career (dropdown)
  └── Open Positions
[CTA] Contact Us → /contact-us
```

### Footer (`components/Footer.tsx`)

| Property | Specification |
|----------|---------------|
| Background | `#060d1a` |
| Top accent | 1px gradient line (transparent → blue → transparent) |
| Padding | `pt-16 pb-6` |
| Logo | 40×40, `rounded-lg` |
| Tagline color | `#8fa4c4`, `text-sm` |
| Section headings | `text-xs font-semibold tracking-widest uppercase`, color `#3b88f5` |
| Link color | `#b5c8e2` → `#ffffff` on hover |
| Copyright | `#4a6080` |
| Social button | 40×40, `rounded-xl`, LinkedIn icon size 18 |

**Footer link columns:**
- **Company:** About us, Blog, Privacy Policy, Contact us
- **For Candidates:** For Candidates, FAQ for Candidates
- **For Business:** Industries, Services, Case Studies, Hire Us through Toptal

### Page Shell Templates

**Homepage:**
```tsx
<div className="min-h-screen overflow-x-hidden">
  <ScrollRevealInit />
  <Header />
  {/* sections */}
  <Footer />
</div>
```

**Subpage:**
```tsx
<div className="min-h-screen text-white overflow-x-hidden bg-white">
  <Header />
  {/* hero + content sections */}
  <Footer />
</div>
```

---

## 9. Section Patterns

### Section Header (repeated across all marketing pages)
```tsx
<div className="text-center mb-16">
  <div className="flex items-center justify-center gap-3 mb-3">
    <div className="accent-line" />
    <span
      className="text-xs font-semibold tracking-widest uppercase"
      style={{ color: "#6ba8ff" }}
    >
      {eyebrow}
    </span>
    <div className="accent-line" />
  </div>
  <h2
    className="text-4xl md:text-5xl font-bold"
    style={{ color: "#ffffff" }}  {/* or "#0d1f3c" on light bg */}
  >
    {title}
  </h2>
  <p
    className="mt-4 text-base md:text-lg max-w-2xl mx-auto"
    style={{ color: "#b5c8e2" }}  {/* or text-gray-500 on light bg */}
  >
    {description}
  </p>
</div>
```

### Hero Section (Homepage)
- Background: `.bg-hero-gradient` + `.geo-grid` at 30% opacity
- Floating glow blobs: `animate-float` / `animate-float-reverse`, 500px/400px circles
- Video overlay: `/videos/background-video.webm`, `opacity-[0.08]`, `object-cover`, mirrored (`scale-x-[-1]`)
- Layout: 2-column grid on lg+, sidebar feature card on right
- Badge pill: `rounded-full`, blue border/bg, pulsing dot
- H1: `clamp(38px, 5vw, 72px)`, bold, shimmer or white text
- CTAs: `.btn-primary` + `.btn-secondary` (on dark: white border variant)
- Stats row: animated counters with `AnimatedCounter` component

### Hero Section (Subpages)
- Same dark gradient + video treatment (auto-applied via CSS on `section:has(video)`)
- Breadcrumb: `Home / Services / [Page]` in header nav area
- H1: gradient text white → `#6ba8ff`
- Body: `#b5c8e2`

### Card Pattern (Light)
```tsx
<div className="bg-white p-8 rounded-2xl border border-[rgba(30,111,217,0.15)] hover-glow-blue transition-all duration-300">
  {/* content */}
</div>
```

### Card Pattern (Dark / Glass)
```tsx
<div className="glass-dark p-8 rounded-2xl hover-glow-blue">
  {/* content */}
</div>
```

### Stat Card
```tsx
<div className="text-center p-6">
  <div className="text-5xl font-bold text-gradient-blue">{value}</div>
  <div className="mt-2 text-sm" style={{ color: "#8fa4c4" }}>{label}</div>
</div>
```

### Ticker / Marquee (Trusted Brands, Featured In)
- Container: `.fade-mask-x` + `overflow-hidden`
- Track: `.trusted-brands-track` or `.featured-publications-track`
- Animation: 29–35s linear infinite, pauses on hover
- Logos: `object-contain`, fixed slot widths

### Tabbed Section (Services, Who We Serve)
- Sidebar tabs on left (desktop), stacked on mobile
- Active tab: blue left border, `rgba(30,111,217,0.08)` background
- Content panel: white card with image + text

### CTA Banner (ScheduleCTA)
- Full-bleed background image with dark overlay gradient
- Centered white text + `.btn-primary`

### Alternating Content Rows (Project Experience)
- Image left / text right, then reversed
- Image: `rounded-2xl overflow-hidden`, `group-hover:scale-105 transition-transform duration-500`
- Image overlay: `linear-gradient(to top, rgba(13,31,60,0.65), transparent)`

---

## 10. Form Elements

### Input / Select / Textarea
```tsx
className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#1e6fd9] focus:border-transparent transition-all"
```

### Label
```tsx
className="block text-sm font-semibold text-gray-700 mb-2"
```

### Form Container
```tsx
<div className="bg-white p-8 md:p-10 rounded-2xl border border-[rgba(30,111,217,0.15)] shadow-xl">
```

### Submit Button
Uses `.btn-primary` with Lucide `Send` icon.

### Form Section Background
```tsx
<section className="py-24 relative overflow-hidden" style={{ background: "#f1f3f6" }}>
  <div className="absolute inset-0 geo-dots opacity-25 pointer-events-none" />
```

---

## 11. Page Templates

### Homepage (`/`)
```
Header → Hero → TrustedBrands → MissionStatement → WhoWeServe →
ServicesSection → AIServices → FeaturedIn → ProjectExperience → Footer
```

### Service Page (`/services/*`)
```
Header → [Service]Hero → WhyGenerativeAI → LLMServicesSection →
WhoWeServe → TrustedBrands → WhyChooseUs → ProjectExperience → Footer
```

### Industry Page (`/industries/*`)
```
Header → [Industry]Hero → SoftwareProducts → TrustedBrands →
AddAICapabilities → ProjectExperience → IndustriesServices →
WhoWeServe → WhyChooseUs → Footer
```

### Case Studies Listing (`/case-studies`)
```
Header → CaseStudiesHero → CaseStudiesGrid → Footer
```

### Case Study Detail (`/case-studies/[slug]`)
```
Header → CaseStudiesHeader → CaseStudyHero → ProjectDescription →
MeetOurClient → InANutshell → DeepDive → SolutionAgents →
TechStack → UniqueSolution → Results → Summary → Footer
```

### Contact (`/contact-us`)
```
Header → ContactHero → ContactForm → ContactInfo → Footer
```

### About (`/about-us`)
```
Header → AboutHero → CompanyIntro → Values → Mission → ClientSuccess → Footer
```

### Section Background Alternation
| Theme | Background | Text |
|-------|------------|------|
| Dark hero/section | Navy gradient + geo-grid | White headings, `#b5c8e2` body |
| Light section | `#f1f3f6` + geo-dots | `#0d1f3c` headings, gray body |
| White cards | `#ffffff` + blue border | Navy/gray text |
| Stats section | `bg-gray-50` | `text-gray-900` headings |

---

## 12. Animation System

### CSS Keyframe Animations

| Animation | Duration | Easing | Class |
|-----------|----------|--------|-------|
| fadeInUp | 0.7s | `cubic-bezier(0.22, 1, 0.36, 1)` | `.animate-fade-in-up` |
| fadeInLeft | 0.7s | same | `.animate-fade-in-left` |
| fadeInRight | 0.7s | same | `.animate-fade-in-right` |
| fadeIn | 0.6s | ease | `.animate-fade-in` |
| scaleIn | 0.5s | same cubic-bezier | `.animate-scale-in` |
| slideDown | 0.25s | ease | `.animate-slide-down` |
| float | 6s | ease-in-out, infinite | `.animate-float` |
| floatReverse | 7s | ease-in-out, infinite | `.animate-float-reverse` |
| shimmer | 4s | linear, infinite | `.text-shimmer` |
| scroll/ticker | 29–35s | linear, infinite | `.animate-scroll`, `.trusted-brands-track` |
| pulseGlow | 4s | ease, infinite | inline on hero cards |

### Stagger Delays
`.delay-100` through `.delay-800` (0.1s increments)

### Scroll Reveal (JavaScript)
```typescript
// lib/useScrollReveal.ts
// Threshold: 0.12
// rootMargin: "0px 0px -40px 0px"
// Supports data-delay attribute (ms) on elements
// Classes: .reveal, .reveal-left, .reveal-right → add .revealed
```

### Common Hover Transitions
- `transition-all duration-200` / `duration-300`
- `hover:translate-y-[-2px]` (buttons) / `hover:translate-y-[-4px]` (cards)
- `group-hover:scale-105` (images)
- `animate-pulse` (live status dots)
- `animate-spin` (loaders)

### Animated Counter Pattern
IntersectionObserver at threshold 0.5, ease-out cubic `1 - (1 - progress)³`, 2000ms default duration.

---

## 13. Responsive Breakpoints

Tailwind v4 defaults (no custom overrides):

| Prefix | Min-width | Primary usage |
|--------|-----------|---------------|
| `sm:` | 640px | Logo text visible, `sm:flex-row` |
| `md:` | 768px | 2-col grids, larger typography |
| `lg:` | 1024px | Desktop nav, 3-col grids, hero 2-col |
| `xl:` | 1280px | Container padding `xl:px-16`, wider hero grid |
| `2xl:` | 1536px | Rarely used |

### Mobile-First Patterns
- Navigation collapses below `lg` (1024px)
- Grids: `grid-cols-1` → `md:grid-cols-2` → `lg:grid-cols-3`
- Typography scales at `md:` and `lg:`

---

## 14. Icons & Assets

### Icon Library
**Lucide React** (`lucide-react`) — primary icon set.

| Icon | Usage |
|------|-------|
| `Menu`, `X` | Mobile nav toggle |
| `ChevronRight`, `ChevronDown` | Dropdowns, breadcrumbs |
| `LogOut` | Admin logout |
| `Linkedin` | Footer social |
| `Plus`, `Minus` | Accordions |
| `Mail`, `Phone`, `MapPin`, `Send` | Contact form/info |
| `Loader2` | Loading spinners |
| `AlertCircle`, `Inbox`, `RefreshCw` | Admin states |

### Icon Sizing
| Context | Size |
|---------|------|
| Nav/mobile toggle | `w-6 h-6` |
| Dropdown chevrons | `w-4 h-4` or `size-3` |
| Footer social | `size={18}` |
| Contact form | `w-5 h-5` |
| Admin | `h-4 w-4` |

### Static Assets (`public/`)

| Path | Usage |
|------|-------|
| `/images/logo.png` | Logo, favicon |
| `/images/aliazzam-s.png` | CEO photo |
| `/images/donaldson-logo.png`, `veon_logo.svg`, etc. | Brand marquee logos |
| `/images/Forbes_logo.svg`, `NewYorkTimes.svg`, etc. | Publication ticker |
| `/images/Conversational-AI-1.jpg`, etc. | Section images |
| `/images/services/llm/Lets-define-how-Generative-AI.png` | CTA backgrounds |
| `/videos/background-video.webm` | Hero video backgrounds |

### Image Treatment
| Pattern | Spec |
|---------|------|
| Hero video | `opacity-[0.08]`, `object-cover`, often mirrored |
| Card image overlay | `linear-gradient(to top, rgba(13,31,60,0.65), transparent)` |
| Hover zoom | `group-hover:scale-105 transition-transform duration-500` |
| Logo marquee | `object-contain`, fixed widths per brand |
| Publication logos | `h-8 w-auto`, opacity 0.8 → 1 on hover |
| Rounded images | `rounded-2xl overflow-hidden` |

### Dynamic Images
- Cloudinary: `https://res.cloudinary.com/**` (case study hero images)
- Next.js `Image` component with `width`/`height` or `fill` + `sizes`

---

## 15. Admin UI (Separate Theme)

The admin dashboard (`/admin`) uses a **distinct light theme** separate from marketing pages.

| Element | Specification |
|---------|---------------|
| Background | White / `slate-50` |
| Text | `slate-950` headings, `slate-500` body |
| Accent | `#17599d` (maps to `#1e6fd9` in marketing) |
| Borders | `border-slate-200` |
| Cards | `rounded-lg border border-slate-200 bg-white p-5 shadow-sm` |
| Status badges | emerald (success), rose (error), amber (warning), slate (default) |

### Admin Components (`components/admin/dashboard/AdminUi.tsx`)
| Component | Props |
|-----------|-------|
| `SectionHeader` | `eyebrow?`, `title`, `description?`, `action?` |
| `KpiCard` | `label`, `value`, `helper?`, `icon?` |
| `StatusBadge` | `status?` |
| `LoadingSkeleton` | — |
| `EmptyState` | `title`, `description?` |
| `ErrorState` | `title`, `description?` |
| `DataPanel` | `children` |

---

## 16. Design Tokens JSON

Machine-readable tokens for import into Figma, Tailwind, or CSS-in-JS:

```json
{
  "brand": {
    "name": "Paramount Intelligence",
    "theme": "Deep Navy + Electric Blue + Silver Slate"
  },
  "colors": {
    "navy": {
      "900": "#060d1a",
      "800": "#0d1f3c",
      "700": "#152d56",
      "600": "#1b3a6b",
      "500": "#1e4d8c"
    },
    "blue": {
      "500": "#1e6fd9",
      "400": "#3b88f5",
      "300": "#6ba8ff"
    },
    "silver": {
      "400": "#8fa4c4",
      "300": "#b5c8e2",
      "200": "#d4e0f0",
      "100": "#eef3fa"
    },
    "semantic": {
      "background": "#ffffff",
      "foreground": "#0d1f3c",
      "primary": "#1e6fd9",
      "primaryDark": "#1559b4",
      "secondary": "#8fa4c4",
      "accent": "#3b88f5",
      "surfaceDark": "#0d1f3c",
      "surfaceMid": "#152d56",
      "bgLight": "#f1f3f6",
      "sectionLight": "#f0f6ff"
    }
  },
  "typography": {
    "fontFamily": "Montserrat, sans-serif",
    "weights": [300, 400, 500, 600, 700, 800, 900],
    "scale": {
      "hero": "clamp(38px, 5vw, 72px)",
      "h2": "2.25rem",
      "h2Md": "3rem",
      "h3": "1.875rem",
      "body": "1rem",
      "bodyLg": "1.125rem",
      "eyebrow": "0.75rem",
      "button": "14px"
    }
  },
  "spacing": {
    "container": "1280px",
    "containerPadding": {
      "default": "24px",
      "lg": "48px",
      "xl": "64px"
    },
    "sectionY": "96px",
    "sectionYCompact": "64px",
    "headerHeight": "80px"
  },
  "borderRadius": {
    "button": "8px",
    "card": "16px",
    "dropdown": "12px",
    "pill": "9999px",
    "logo": "8px"
  },
  "shadows": {
    "glowBlue": "0 0 20px rgba(30,111,217,0.4), 0 0 60px rgba(30,111,217,0.15)",
    "glowBlueSm": "0 0 12px rgba(30,111,217,0.3)",
    "buttonHover": "0 8px 24px rgba(30,111,217,0.45)",
    "cardHover": "0 8px 40px rgba(30,111,217,0.25), 0 2px 12px rgba(30,111,217,0.15)",
    "headerScrolled": "0 4px 24px rgba(0,0,0,0.4)"
  },
  "breakpoints": {
    "sm": "640px",
    "md": "768px",
    "lg": "1024px",
    "xl": "1280px",
    "2xl": "1536px"
  },
  "animation": {
    "easing": "cubic-bezier(0.22, 1, 0.36, 1)",
    "duration": {
      "fast": "0.2s",
      "normal": "0.3s",
      "reveal": "0.7s",
      "ticker": "30s"
    }
  }
}
```

---

## 17. New Project Setup Checklist

To replicate this UI in a new project:

- [ ] **1. Install dependencies** — Next.js, React, Tailwind v4, Radix nav menu, Lucide, clsx, tailwind-merge, CVA
- [ ] **2. Copy `app/globals.css`** — Full design system (tokens, animations, buttons, glass, gradients)
- [ ] **3. Set up PostCSS** — `postcss.config.mjs` with `@tailwindcss/postcss`
- [ ] **4. Configure font** — Montserrat via `next/font/google` in root layout
- [ ] **5. Copy `lib/utils.ts`** — `cn()` helper
- [ ] **6. Copy `lib/useScrollReveal.ts`** — Scroll reveal hook
- [ ] **7. Copy `components/ui/navigation-menu.tsx`** — shadcn nav component
- [ ] **8. Copy `components/ui/ScrollRevealInit.tsx`** — Scroll reveal initializer
- [ ] **9. Copy `components/Header.tsx`** — Update nav links for your site
- [ ] **10. Copy `components/Footer.tsx`** — Update links and tagline
- [ ] **11. Copy assets** — Logo, video, brand images from `public/`
- [ ] **12. Build section components** — Use patterns from Section 9 as templates
- [ ] **13. Use canonical colors** — `#1e6fd9` primary, `#0d1f3c` foreground, `#060d1a` dark bg
- [ ] **14. Apply page shells** — Homepage vs subpage wrappers from Section 8

### Files to Copy Directly
```
app/globals.css
app/layout.tsx          (adapt metadata)
lib/utils.ts
lib/useScrollReveal.ts
components/ui/navigation-menu.tsx
components/ui/ScrollRevealInit.tsx
components/Header.tsx     (update nav links)
components/Footer.tsx     (update links)
components.json           (shadcn config)
postcss.config.mjs
public/images/logo.png
public/videos/background-video.webm
```

### Key Source Files for Reference
```
components/Hero.tsx                    — Homepage hero pattern
components/TrustedBrands.tsx           — Logo marquee
components/MissionStatement.tsx        — Quote + image section
components/WhoWeServe.tsx              — Accordion tabs
components/ServicesSection.tsx         — Tabbed services
components/AIServices.tsx              — Card grid
components/FeaturedIn.tsx              — Publication ticker
components/ProjectExperience.tsx       — Alternating rows
components/contact/ContactForm.tsx     — Form styling
components/services/*/Hero.tsx         — Subpage hero pattern
components/admin/dashboard/AdminUi.tsx — Admin components
```

---

*Generated from Paramount Intelligence codebase. Last updated: July 2026.*
