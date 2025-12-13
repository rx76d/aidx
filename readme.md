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

## 📖 About

**aidx** is a zero-config tool that turns your terminal into a context manager for ChatGPT, Claude, and Gemini.

It solves two problems:
1.  **Getting code TO the AI:** It scans your project, filters out junk (binaries, secrets, `node_modules`), and copies code to your clipboard with a strict XML protocol.
2.  **Getting code FROM the AI:** It reads the AI's response, shows you a visual diff, and applies changes to your disk safely.

---

## 🚀 Quick Start

No installation required. Run it instantly:

```bash
npx aidx
```

Or install globally for repeated use:
```bash
npm install -g aidx
```

## 🔄 How It Works
1. **The Outbound Loop (Copying)**

Select the files you want the AI to understand.
```
npx aidx copy
```

**Action:** Opens an interactive file picker.
Result: Copies files + hidden system instructions to your clipboard.
Next: Paste into ChatGPT/Claude.

2. **The Inbound Loop (Applying):**
When the AI replies with code, copy its entire response to your clipboard.
```
npx aidx apply
```
**Action:** Scans your clipboard for the XML tags.
**Safety:** Shows a Git-style diff (Green + / Red -).
**Result:** Updates your files only after you confirm Yes.


# 🎮 Commands

Command	Description

```npx aidx```:	Shows the main menu and status info.

```npx aidx copy```: Interactive file scanner & clipboard copier.

```npx aidx apply```:	Reads clipboard, shows diffs, and writes changes.

```npx aidx backup --on```:	Enables automatic .bak files before overwriting.

```npx aidx backup --off```:	Disables automatic backups.

```npx aidx stl```: Shows token limits of AI model.

```npx aidx --help```:	Displays help information.

```npx aidx -version```:	Displays current version.

# ✨ Features

🛡️ **Security Guard**:
Automatically detects and blocks API keys (AWS, OpenAI, Stripe) from being copied to the clipboard. If a file looks like a secret, it is skipped.

💾 **Automatic Backups**:
Don't trust the AI completely? Turn on backups.
```npx aidx backup --on```
Before src/App.tsx is updated, aidx will save a copy to src/App.tsx.bak.

🌍 **Universal Support**:
Works with almost any text-based language:
Web: TS, JS, HTML, CSS, Svelte, Vue, JSX
Backend: Python, Go, Rust, Java, C#, PHP
Config: JSON, YAML, TOML, SQL, Markdown
Smart Ignores: Automatically ignores node_modules, .git, __pycache__, venv, target, bin, and binary files (.png, .exe).

📊 **Token Awareness**:
Calculates estimated token usage before you paste, so you know if you are about to exceed the limits of GPT-5 or Claude 3.5.

🛡️ **License**:
This project is open source and available under the MIT License.
<div align="center">
<sub>Developed by rx76d</sub>
</div>