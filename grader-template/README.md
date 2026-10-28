# __CLASSROOM__ grader

Seeded by the Classroom app. **Keep this repository private** — it holds hidden tests.

## One-time setup

Add the callback secret so grading results can be reported back to the app:

1. Settings → Secrets and variables → Actions → **New repository secret**
2. Name: `GRADER_CALLBACK_SECRET`
3. Value: the app's `GRADER_CALLBACK_SECRET` (from the app's environment)

## Layout

```
.github/workflows/grade.yml   two-job workflow: test (untrusted, no secrets) → report (posts results)
grader/run_tests.py           runs each test in Docker with --network none
assignments/<slug>/tests.yml  test spec (managed by the app; tests.json is the validated copy)
assignments/<slug>/files/     hidden test files copied into the student's tree before tests run
```

Do not edit `assignments/` by hand — upload tests through the app so they are validated.
To debug, use **Actions → grade → Run workflow** with an assignment slug, a repo and a commit SHA.
