# Feedspace AI Visual Validation (Programmatic)

A streamlined Node.js automation framework that uses **Playwright** for browser control and **Google Gemini AI** for visual UI analysis.

## Overview
This framework fetches widget data (URLs, types, and configurations) from the Feedspace API and automatically validates the visual state of the widgets against their expected configurations.

## Features
- **Dynamic Data Source**: Fetches live test data from `https://api.feedspace.io/v3/embed-widget-urls`.
- **AI-Powered Validation**: No more brittle CSS selectors. Gemini AI analyzes screenshots to verify features.
- **Smart Detection**: Uses numeric widget type IDs for robust element identification.
- **Visual Evidence**: Automatically captures high-resolution screenshots for every test run.
- **Consolidated Dashboard**: Generates a single HTML/JSON report summary for all tested URLs.

## Quick Start

### 1. Prerequisite
Ensure you have an `.env` file with your Gemini API Key:
```env
GEMINI_API_KEY=your_api_key_here
```

### 2. Install Dependencies
```bash
npm install
npx playwright install chromium
```

### 3. Run Validation
```bash
npm test
```
*Note: This runs `node runValidation.js`*

## Project Structure
- `runValidation.js`: The main entry point and orchestrator.
- `helpers/`:
  - `playwrightHelper.js`: Handles browser navigation, scrolling, and screenshot capture.
  - `aiEngine.js`: Interacts with the Gemini API.
  - `promptBuilder.js`: Constructs the AI validation prompt based on widget config.
  - `widgetDetector.js`: Maps numeric IDs to widget types.
  - `reportHelper.js`: Generates consolidated HTML/JSON reports.
- `reports/`: Contains the generated validation dashboards.
- `screenshots/`: Storage for captured widget images.
