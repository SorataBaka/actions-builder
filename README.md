# Actions YAML Builder

Build a GitHub Actions workflow file by ticking checkboxes instead of reading the docs.

- Each layer lists every field allowed at that spot, in the same order as GitHub's workflow syntax docs.
- Ticking a field opens its next layer below it.
- Ticked fields that still need a value turn orange and show up in a to-do list.
- The YAML updates live; copy it into `.github/workflows/<name>.yml`.

It's a single static `index.html` with no build step, so it runs as-is on GitHub Pages. Live at https://actions.tianharjuno.com/.

## Run locally

Open `index.html` in a browser.

## Deploy on GitHub Pages

Settings → Pages → Build and deployment → Source: **Deploy from a branch** → Branch: `main`, folder `/ (root)`.
