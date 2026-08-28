# Frontend Development Guidelines

> Conventions for pages, components, client API calls, and UI quality in BrainDance.

---

## Overview

BrainDance uses Next.js 15 App Router with React 19. Most interactive pages are Client Components (`"use client"`). Styling is Tailwind CSS v4. There is no separate frontend package — UI code lives under `src/app/` and `src/components/`.

These guidelines describe **current** patterns. Match them when adding or changing UI code.

---

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | App Router pages and component folders |
| [Component Guidelines](./component-guidelines.md) | Component structure, props, styling, a11y |
| [Hook Guidelines](./hook-guidelines.md) | React hooks usage (no custom hook library yet) |
| [State Management](./state-management.md) | Local state and data loading patterns |
| [Type Safety](./type-safety.md) | TypeScript and DTO conventions |
| [Quality Guidelines](./quality-guidelines.md) | Lint, E2E, accessibility, responsive checks |

---

**Language**: All documentation in this directory is written in **English**.
