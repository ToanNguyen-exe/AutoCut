# Project Constraints & Engineering Boundaries (`CONSTRAINTS.md`)

This document defines non-negotiable architectural boundaries, quality standards, and operating rules for the **AutoCut** codebase. All contributors and AI assistants must strictly comply with these rules.

---

## 1. Test Invariants
- **Never Delete or Skip Tests**: It is strictly forbidden to delete, comment out, ignore, or disable existing tests (`@Disabled`, `@Ignore`, `.skip`, etc.) to get a build or CI to pass.
- **Failures Demand Investigation**: A failing test indicates a broken implementation or an outdated specification. If the requirement has legitimately changed, document the reason before updating assertions.

## 2. Engineering Standards
- **No Lowering Standards**: Do not suppress compiler warnings or linter errors (e.g. no `@SuppressWarnings("all")`, no `any`, no `// @ts-ignore`).
- **Strict Error Handling**: Do not silence exceptions with empty catch blocks or catch generic `Throwable`/`Exception` without logging or rethrowing.
- **Strict Scope Control**: Do not engage in drive-by refactoring or unrelated edits. Only touch code directly relevant to the current objective.

## 3. Simplicity & YAGNI (Ponytail)
- **Zero Speculative Code**: Write code only for present requirements. No "just in case" abstractions, hypothetical generic frameworks, or unused options.
- **Dependency Control**: Do not install new third-party libraries (npm / Maven) without explicit approval. Maximize standard libraries and existing utilities.
- **Rule of Three**: Do not introduce generic interfaces or abstract classes until there are 3 distinct concrete implementations.
- **Minimal Diff**: Prioritize the smallest, cleanest diff that solves the problem.

## 4. Workflow Disciplines
- **Spec-Driven**: Clarify and lock specifications/acceptance criteria before coding. Do not guess user requirements.
- **Incremental Implementation**: Break large changes into atomic, verifiable steps. Ensure the application compiles and passes tests at every intermediate step.
- **Test-Driven (TDD)**: Write failing tests first before production logic; only write code sufficient to pass tests.
- **Post-Implementation Simplification**: Once tests pass, prune complexity, flatten nested conditionals, and remove dead code.
- **Doubt & Critique**: Actively critique technical decisions, evaluate failure modes, and verify assumptions before committing to designs.
