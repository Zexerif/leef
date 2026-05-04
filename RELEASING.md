# Leef Browser: Release Checklist 🚀

Follow these steps before every new release to ensure a clean, professional, and privacy-respecting build for your users.

## 1. Version Bump
- [ ] Update `"version": "x.x.x"` in `package.json`.
- [ ] Update the **Changelog** in `index.html` to reflect the new changes.

## 2. Pre-Flight Clean (Developer Machine)
Before running the final build, ensure your local environment isn't leaking data:
- [ ] **Delete the `dist` folder**: `rm -rf dist/`
- [ ] **Check for rogue data**: Ensure no folders named `Local Storage`, `Partitions`, or `Network` exist in the project root. (Our `package.json` now filters these, but it's good to be safe).

## 3. Generate the Installer
- [ ] Run the build command:
  ```powershell
  npm run dist
  ```
- [ ] Verify the installer size is around **150-160 MB**. If it jumps to 300MB+, you are accidentally bundling your local cache!

## 4. The "Fresh Install" Test
To verify the installer is clean on your own machine:
1. **Delete your AppData**: Go to `%AppData%` and delete the `private-browser` folder.
2. **Run the New Installer**: Ensure it starts with the **"Welcome to Leef"** onboarding screen.
3. **Check for "Ghost Data"**: Verify that History, Cookies, and Bookmarks are all empty.

## 5. GitHub Upload
- [ ] Create a new **Release** on GitHub with the version tag (e.g., `v0.3.1`).
- [ ] **MANDATORY**: Upload BOTH the `.exe` installer AND the `latest.yml` file. (Without `latest.yml`, the auto-updater will fail with a "Check Failed" error).

---

### Pro-Tip: Dev Mode Isolation
We have now configured `main.js` so that running `npm start` (Dev Mode) uses a separate folder: `%AppData%\Leef-Dev`. Your personal browsing in the "real" Leef Browser will no longer mix with your testing sessions!
