# MTurk bounding-box survey

This is a static GitHub Pages survey for human annotation of adversarial images.

## URLs

Use one of these URLs to select a balanced survey variant:

```text
https://YOUR-USER.github.io/YOUR-REPO/?variant=1
https://YOUR-USER.github.io/YOUR-REPO/?variant=2
https://YOUR-USER.github.io/YOUR-REPO/?variant=3
```

## Updating the data

Each source case in `samples/` should contain `metadata.json`, `adversarial.png`, and the clean image named by `metadata.images.clean`. Add or replace case folders there, then run:

```bash
python3 scripts/build_dataset.py
```

The script reads `vlm_output.perturbed_prompt` and `vlm_output.prompt_objects`, balances cases by VLM model, modality, and scene type, and regenerates `data/` and `assets/`. The current 144 cases produce 48 regular tasks in each variant.

Two clean images are sampled randomly for each session as attention checks. They use the normal annotation page and append an instruction requiring `unclear_image`. Attention results are sent as `response_type: "attention"` rows; the expected and selected values are stored as JSON in `bboxes` because the supplied Sheet schema has no dedicated attention columns.

## Google Sheets

Use the Apps Script endpoint configured in `app.js`. The Sheet should have the supplied headers, including `server_received_at`. Deploy the script as a Web App executing as the owner with access set to anyone, and use the `/exec` URL. The frontend uses a no-CORS POST, so a successful browser request is opaque; verify delivery by checking the Sheet.

If no rows appear, open Apps Script → Executions while submitting a test task. Confirm the deployment is the current version, the URL ends in `/exec`, access is “Anyone”, and the script is bound to the spreadsheet containing the `responses` tab. The browser cannot report Apps Script HTTP errors because of cross-origin restrictions.

The deployment-ready script is also included at `google-apps-script/Code.gs`. After replacing the Apps Script code, deploy a new version. Opening the `/exec` URL in a browser should show `{"ok":true,"service":"bbox-survey"}`; if it does not, the deployment URL or access setting is wrong.

## GitHub Pages

Commit the repository and enable Pages from the branch and folder containing `index.html`. After adding cases, regenerate the dataset, commit the generated `assets/` and `data/` files, and push again.
