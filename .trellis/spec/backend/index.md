# Backend Development Guidelines

> Conventions for API routes, domain modules, database access, and server-side logic in BrainDance.

---

## Overview

BrainDance is a TypeScript full-stack Next.js app. Backend code lives in the same repo as the frontend. Route handlers are thin; business logic sits in domain modules under `src/modules/`. PostgreSQL is accessed through Drizzle ORM.

These guidelines describe **current** patterns in the codebase. Match them when adding or changing server-side code.

---

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | Route, module, lib, and db layout |
| [Database Guidelines](./database-guidelines.md) | Drizzle schema, migrations, transactions, queries |
| [Error Handling](./error-handling.md) | Domain errors and HTTP mapping |
| [Logging Guidelines](./logging-guidelines.md) | Current logging posture and boundaries |
| [Quality Guidelines](./quality-guidelines.md) | Tests, lint, typecheck, build gates |

---

**Language**: All documentation in this directory is written in **English**.
