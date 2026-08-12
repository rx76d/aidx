<div align="center">
  
  <h1>aidx</h1>

  <p>
    <strong>The CLI bridge between your local codebase and LLMs.</strong>
  </p>

  ![Version](https://img.shields.io/npm/v/aidx?style=flat-square&color=blue)
  ![Status](https://img.shields.io/badge/status-Live-success.svg)
  ![License](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)
  ![Downloads](https://img.shields.io/npm/dt/aidx?style=flat-square&color=orange)

  <br />

  <p>
    <a href="#-quick-start">Quick Start</a> •
    <a href="#-how-it-works">How It Works</a> •
    <a href="#-commands">Commands</a> •
    <a href="#-features">Features</a>
  </p>
</div>

---

## About

**aidx** is a zero-config tool that turns your terminal into a context manager for ChatGPT, Claude, and Gemini.

It solves two problems:
1.  **Getting code TO the AI:** It scans your project, filters out junk (binaries, secrets, `node_modules`), and copies code to your clipboard with a strict XML protocol.
2.  **Getting code FROM the AI:** It reads the AI's response, shows you a visual diff, and applies changes to your disk safely.

---

## Quick Start

No installation required. Run it instantly:

```bash
npx aidx
```

Or install globally for repeated use:
```bash
npm install -g aidx
```

## How It Works
1. Select the files you want the AI to understand.
```
npx aidx copy
```

**Action:** Opens an interactive file picker.
Result: Copies files + hidden system instructions to your clipboard.
Next: Paste into ChatGPT/Claude.

2. When the AI replies with code, copy its entire response to your clipboard.
```
npx aidx apply
```
**Action:** Scans your clipboard for the XML tags.
**Safety:** Shows a Git-style diff (Green + / Red -).
**Result:** Updates your files only after you confirm Yes.


# Commands

Command	Description

```npx aidx```:	Shows the main menu and status info.

```npx aidx copy```: Interactive file scanner & clipboard copier.

```npx aidx apply```:	Reads clipboard, shows diffs, and writes changes.

```npx aidx backup --on```:	Enables automatic .bak files before overwriting.

```npx aidx backup --off```:	Disables automatic backups.

```npx aidx stl```: Shows token limits of AI model.

```npx aidx --help```:	Displays help information.

```npx aidx -version```:	Displays current version.

# Features

**Security Guard**
Automatically detects common API keys like AWS, OpenAI, and Stripe and blocks them from being copied. Files that look like they contain secrets are skipped.

**Automatic Backups**
```npx aidx backup --on```
aidx creates a .bak copy before modifying files, so you can easily roll back.

**Universal Support**
Works with most text-based languages and formats, including TS, JS, Python, Go, Rust, Java, C#, PHP, JSON, YAML, SQL, and Markdown.
It also automatically ignores things like node_modules, .git, venv, and binary files.

**Token Awareness**
Estimates token usage before you paste so you know when you’re getting close to model limits.

**License**:
This project is open source and available under the MIT License.
<div align="center">
<sub>Developed by rx76d</sub>
</div>
