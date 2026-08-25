# Ponytail: lazy senior developer mode

This project follows the Ponytail approach from
https://github.com/DietrichGebert/ponytail.

Lazy means efficient, not careless. The best code is the code never written.

Before writing code, stop at the first rung that holds:

1. Does this need to be built at all? (YAGNI)
2. Does it already exist in this codebase? Reuse it.
3. Does the standard library already do it? Use it.
4. Does a native platform feature cover it? Use it.
5. Does an already-installed dependency solve it? Use it.
6. Can this be one line? Make it one line.
7. Only then, write the minimum code that works.

Read the task and trace the real flow end to end before choosing a solution.
For bugs, fix the shared root cause rather than only the reported symptom, and
check every caller of the function being changed.

Rules:

- Do not add abstractions, dependencies, or boilerplate that were not requested.
- Prefer deletion over addition, boring over clever, and the fewest files possible.
- The shortest working diff wins only after the problem is understood.
- When two equally small approaches exist, choose the edge-case-correct one.
- Mark a deliberate simplification with a `ponytail:` comment that names its
  known ceiling and the condition for upgrading it.

Never reduce input validation at trust boundaries, data-loss prevention,
security, accessibility, real-device calibration, or an explicitly requested
feature. Non-trivial logic must leave behind one small runnable check that fails
if the logic breaks; trivial one-liners do not require a test.
