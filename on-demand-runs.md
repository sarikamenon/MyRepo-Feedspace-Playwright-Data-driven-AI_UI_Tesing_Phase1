# On-demand validation runs

`.github/workflows/ui_test_ondemand.yml` runs `runners/runApiValidation.ondemand.js` against a single
embed. The backend dispatches it whenever a customer embeds a widget, and it can be dispatched by hand
to validate any production URL.

## 1. Find the widget id and type

The payload carries the widget type, and the type decides which feature set is audited. Omitting it
falls back to auto-detection from the DOM and network, which is slower and can land on `Unknown`, so
read the real values off the page first.

Get the embed's UUID. A widget page carries it in the path (`/widget/<uuid>`); on a customer site it is
the `data-id` attribute of the Feedspace embed element:

```bash
curl -s https://customer.example.com | grep -o 'data-id="[0-9a-f-]\{36\}"'
```

Then ask the public embed API for that UUID. Its `type` is the number to send:

```bash
curl -s https://api.feedspace.io/v3/embed/7db79d22-1a78-409a-8f89-e0b4140d8206 | head -c 120
# {"id":35936,"unique_widget_id":"7db79d22-...","type":22,"builder_js":"d22.min.js?v=1.2.17", ...
```

`helpers/widgetDetector.js` maps that number to a widget name (22 is `FLOATING_BADGE`). A page with
several embeds needs one payload entry per `data-id`, since each can be a different type.

## 2. Dispatch the run

The workflow listens for a `repository_dispatch` event of type `run-ui-tests`:

```bash
cat <<'JSON' | gh api repos/Feedspace/Feedspace-App-QA-Automation-UI/dispatches --input -
{
  "event_type": "run-ui-tests",
  "client_payload": {
    "triggered_by": "manual",
    "data": {
      "url": "https://www.feedspace.io/widget/7db79d22-1a78-409a-8f89-e0b4140d8206?info=1",
      "type": 22,
      "unique_widget_id": "7db79d22-1a78-409a-8f89-e0b4140d8206",
      "configurations": {}
    }
  }
}
JSON
```

`dispatches` answers `204 No Content` and prints nothing. The run appears a few seconds later:

```bash
gh run list --repo Feedspace/Feedspace-App-QA-Automation-UI --workflow ui_test_ondemand.yml --limit 3
```

## Payload fields

`client_payload.data` takes the same fields the backend dispatches:

| Field | Required | Notes |
| --- | --- | --- |
| `url` | yes | Page to load. Send `urls` instead (an array of these objects) to test several in one run. |
| `type` | yes, in practice | Numeric type ID or the backend's lowercased `Widget::TYPE` name; both resolve. A type the framework does not support is reported `SKIPPED` as a coverage gap, never failed. |
| `unique_widget_id` | recommended | Scopes discovery to one embed when the page carries more than one. |
| `configurations` | no | Expected-state payload. `{}` is fine: the helper merges in the widget payload it intercepts from the page. |
| `width` / `height` | no | Viewport, default 1920x1080. |

A dispatched run uses the repository's real secrets, so a FAIL posts to the Basecamp chat and files a
card. Reproduce locally first with `node runners/runValidation.js --url ... --type ...`, which files
nothing. The same payload can be replayed locally too:

```bash
WIDGET_DATA='{"data":{"url":"<url>","type":22,"configurations":{}}}' node runners/runApiValidation.ondemand.js
```
