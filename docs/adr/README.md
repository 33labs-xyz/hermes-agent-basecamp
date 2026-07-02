# Architecture Decision Records

An ADR captures one significant architectural decision: its context, the choice,
and the consequences. They explain the **why** that diagrams and code can't.

## Rules

- **Append-only.** Never edit an accepted record to change the decision. If a
  decision changes, write a new ADR that **supersedes** the old one and link both.
- **Link from the code.** When code implements a decision, reference the ADR
  number near it so the next reader finds the rationale.
- **Small.** One decision per file. Number sequentially: `NNNN-kebab-title.md`.

## Status values

`Proposed` → `Accepted` → (`Superseded by NNNN` | `Deprecated`)

## Index

| #    | Title                                              | Status   |
|------|----------------------------------------------------|----------|
| 0001 | [Basecamp is a thin reskin of Hermes](0001-basecamp-thin-reskin-of-hermes.md) | Accepted |

> New ADR? Copy [`template.md`](template.md), bump the number, add a row above.
