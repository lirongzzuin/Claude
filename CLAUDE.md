# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This repository contains a **Slack → Google Sheets automation bot** (`slack-to-sheets/`). The bot monitors Slack channels for messages containing order deletion requests, extracts order numbers, queries an external API, and writes results to a Google Sheet.

The production code (`Code.gs`) is **Google Apps Script (GAS)** — it runs in the Google cloud and cannot be executed locally. Test files (`test.js`, `test.py`) replicate the core logic in Node.js and Python so it can be validated before deploying to GAS.

## Running Tests

```bash
# JavaScript tests (Node.js required)
node slack-to-sheets/test.js

# Python tests
python3 slack-to-sheets/test.py
```

Both test suites print a pass/fail summary. There is no build step — GAS code is deployed manually by copying `Code.gs` into the Google Apps Script editor.

## Architecture

### Code.gs — Single-file GAS implementation

All logic lives in one file, structured around:

- **`CONFIG`** (top of file) — the only section users need to edit. Contains Slack credentials, API endpoint + auth, `FIELD_MAP` (maps API JSON fields to sheet columns using dot-notation paths), and sheet configuration.
- **`doPost(e)`** — webhook entry point; handles Slack URL challenge and dispatches events.
- **`processSlackEvent_`** → `parseOrderNumbers_` → `fetchWithRetry_` → `writeToSheet_` — the main processing pipeline.
- **`getNestedValue_(obj, keyPath)`** — extracts deeply nested JSON values using dot-notation (e.g. `"a.b.c"`).
- **`buildAuthHeaders_()`** — generates auth headers dynamically based on `CONFIG.API.AUTH_TYPE` (`BEARER`, `API_KEY`, `BASIC`, `NONE`).
- **Slack helpers** (`_sendSlack`, `_sendCompletionNotice`, `_handleError`) — all notifications go back to Slack using Block Kit.

### Test files mirror Code.gs logic

`test.js` and `test.py` each re-implement the same core functions (keyword detection, order number parsing, nested field extraction, FIELD_MAP row building) to enable local testing. When changing logic in `Code.gs`, update the corresponding test implementations too.

### Order number format

Order numbers follow the pattern `YYYYMMDD-NNNNNNN` and are extracted only from the `[내용]` section of a Slack message.

## Key Design Decisions

- **No external dependencies** — `Code.gs` uses only built-in GAS APIs (`SpreadsheetApp`, `UrlFetchApp`, `Utilities`, etc.).
- **Duplicate handling** — controlled by `CONFIG.SHEETS.DUPLICATE_ACTION` (`skip`, `update`, or `none`). The duplicate key is always the order number column.
- **Retry logic** — `CONFIG.API.MAX_RETRIES` and `CONFIG.API.RETRY_DELAY_MS` govern retry behavior in `fetchWithRetry_`.
- **Error reporting** — errors are categorized as `PARSE`, `API`, `SHEETS`, or `SYSTEM` and sent as Slack messages rather than thrown silently.
