# Actions YAML Builder

Build a GitHub Actions workflow file by ticking checkboxes instead of reading the docs.

- Each layer lists every field allowed at that spot, in the same order as GitHub's workflow syntax docs.
- Ticking a field opens its next layer below it.
- Ticked fields that still need a value turn orange and show up in a to-do list.
- It catches common mistakes, like a step with both `uses` and `run`, `needs` pointing at a missing job, or `branches` together with `branches-ignore`.
- The YAML updates live. Copy it or download it as a `.yml` file.
- **Import YAML** loads an existing workflow into the checkboxes.
- **Share link** puts the whole workflow inside a link, so nothing is stored on a server.
- A search box finds any field, like `timeout-minutes`, without hunting through the layers.

It's a static site (`index.html` + `app.js`) with no build step, so it runs as-is on GitHub Pages. Live at https://actions.tianharjuno.com/.

## Run locally

Open `index.html` in a browser.

## Deploy on GitHub Pages

Settings → Pages → Build and deployment → Source: **Deploy from a branch** → Branch: `main`, folder `/ (root)`.
