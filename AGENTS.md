# Publishing

Always publish completed changes unless the user explicitly says otherwise. Do not stop after local implementation or ask for publication confirmation again.

GitHub Pages serves the `main` branch's `docs/` directory at https://ryanlmelvin.github.io/practice-looper/.

- Run the relevant tests and `npm run build`; include source changes and generated `docs/` in the commit.
- Push the completed changes to `origin/main` using the established GitHub Pages workflow.
- Wait for the Pages deployment to succeed and verify the live `release.json` matches the local build before reporting publication complete.
- If publication is blocked, report the specific blocker and the unpublished state.
