# Flat Alert – free always-on setup (GitHub Actions)

Checks Otodom, Morizon and Gratka (same flat on several sites = one alert) every ~7 minutes for flats in Ursynów (incl. Imielin, Natolin) up to 800,000 zł
and pushes new ones to an ntfy topic. Runs on GitHub's servers – no PC needed.

## One-time setup (you, ~10 minutes)

1. Sign in at https://github.com (create a free account if needed).
2. **New repository** → name `flat-alert` → **Public** (public repos get free Actions minutes) → Create.
3. Upload every file in this folder (drag and drop on the repo page: "uploading an existing file").
   Include the hidden `.github` folder – if the web uploader skips it, use GitHub Desktop or `git push`.
4. Repo → **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `NTFY_TOPIC`
   - Value: `flat-25051c5634c0d3b6`  (keep it private – it works like a password)
5. Repo → **Actions** tab → "Check for new flats" → **Run workflow**. The first run records
   existing listings silently; after that only new ones trigger a phone alert.

## For your friend

Open https://ntfy.sh/flat-25051c5634c0d3b6 in Chrome on Android → Subscribe →
Settings → enable **Background notifications** → allow notifications. Optional: Chrome menu →
Add to Home screen.

## Notes
- GitHub may delay scheduled runs at busy times, so alerts can lag a few minutes.
- Public-repo schedules pause after 60 days without repo activity; the job commits `seen.json`
  when listings change, which normally counts as activity. If alerts stop, re-enable under Actions.
- Local mode: `node server.js` → http://localhost:3000 (dashboard).
