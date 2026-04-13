# GitHub Bots Setup for JobPilot

## 1. Renovate

This repository already contains a `renovate.json` configuration.

To activate Renovate:

1. Install the **Renovate GitHub App** on the repository:
   - https://github.com/apps/renovate
2. Grant it access to `Mbehbahani/JobPilot`.
3. Renovate will start opening dependency update PRs based on `renovate.json`.

## 2. GitHub Copilot code review

GitHub Copilot code review is primarily enabled from **GitHub repository / organization settings**, not from a custom workflow in this repo.

This repository now includes:

- `.github/copilot-instructions.md`

That file gives Copilot project-specific context for code suggestions and review behavior.

To enable Copilot code review:

1. Make sure your GitHub plan/org supports **GitHub Copilot for pull requests / code review**.
2. Open the repository settings on GitHub.
3. Enable the relevant Copilot review / PR assistance features.
4. Use pull requests normally; Copilot can then provide review assistance using the repository context plus `.github/copilot-instructions.md`.

## Notes

- Renovate is repo-driven once the GitHub App is installed.
- Copilot code review is mostly **GitHub-side feature enablement** plus repository instructions.
- No extra custom GitHub Actions workflow is required for basic Copilot review.
