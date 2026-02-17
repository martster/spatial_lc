# Spatial Live Coding AR

Browser-based AR visual live coding prototype using Hydra and a live camera stream.

## Goal

- Live-code visuals in the browser with Hydra.
- Use camera input from smartphones or computers with webcams.
- Keep all changes tracked in GitHub.
- Deploy the static site with GitHub Pages.

## Run locally

Because camera access requires a secure context on many devices, use HTTPS or localhost.

```bash
# Option 1: Python
python3 -m http.server 8000

# Option 2: Node
npx serve .
```

Open `http://localhost:8000` and allow camera access.

## GitHub tracking setup

```bash
git init
git add .
git commit -m "Initial AR live coding prototype"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

## Deploy with GitHub Pages

This repository includes `.github/workflows/deploy-pages.yml`.

Steps:

1. Push this repository to GitHub.
2. In GitHub: `Settings -> Pages`.
3. Under `Build and deployment`, select `GitHub Actions` as source.
4. Push to `main` and wait for the Pages deployment job.

After deployment, your page URL is typically:

`https://<github-username>.github.io/<repo-name>/`

## Notes

- iOS Safari and some Android browsers require explicit user interaction before media playback.
- For production AR anchoring (plane tracking/world tracking), add a WebXR or AR.js layer later. This version focuses on camera-reactive visual live coding.
- Code comments in this project are in English by design.
