#!/usr/bin/env node
import { checkbox, confirm } from '@inquirer/prompts';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import clipboardy from 'clipboardy';
import * as Diff from 'diff';

// --- CONFIGURATION ---
const METADATA = {
  name: "aidx",
  description: "A CLI bridge between local code and LLMs.",
  author: "rx76d",
  version: "1.0.6",
  license: "MIT",
  github: "https://github.com/rx76d/aidx"
};

const CONFIG_FILE = '.aidxrc.json';
const MAX_FILE_SIZE = 1.5 * 1024 * 1024; // 1.5MB Limit
const SECRET_REGEX = /(?:sk-[a-zA-Z0-9]{32,})|(?:AKIA[0-9A-Z]{16})|(?:[a-zA-Z0-9+/]{40,}=)/;

// --- UTILS: NATIVE COLORS (Replaces Chalk) ---
const colors = {
  reset: "\x1b[0m",
  red: (t: string) => `\x1b[31m${t}\x1b[0m`,
  green: (t: string) => `\x1b[32m${t}\x1b[0m`,
  yellow: (t: string) => `\x1b[33m${t}\x1b[0m`,
  blue: (t: string) => `\x1b[34m${t}\x1b[0m`,
  cyan: (t: string) => `\x1b[36m${t}\x1b[0m`,
  dim: (t: string) => `\x1b[2m${t}\x1b[0m`,
  bold: (t: string) => `\x1b[1m${t}\x1b[0m`,
  bgBlue: (t: string) => `\x1b[44m${t}\x1b[0m`,
  bgRed: (t: string) => `\x1b[41m${t}\x1b[0m`,
  bgGreen: (t: string) => `\x1b[42m\x1b[30m${t}\x1b[0m`
};

// --- UTILS: NATIVE FILE SCANNER (Replaces fast-glob) ---
// This recursively walks directories but explicitly skips ignored folders for speed.
async function scanFiles(startDir: string): Promise<string[]> {
  const ignoredFolders = new Set([
    'node_modules', '.git', '.vscode', '.idea', 'dist', 'build', '.next', 
    '__pycache__', 'venv', 'env', '.venv', 'target', 'bin', 'obj', 'vendor', 
    'Application Data', 'Cookies', 'Local Settings', 'Recent', 'Start Menu'
  ]);

  const ignoredExts = new Set([
    '.lock', '.log', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', 
    '.pdf', '.zip', '.tar', '.gz', '.exe', '.dll', '.iso', '.class', '.pyc'
  ]);

  const results: string[] = [];

  async function walk(dir: string) {
    try {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          // Optimization: Don't enter ignored folders
          if (!ignoredFolders.has(entry.name)) {
            await walk(fullPath);
          }
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (!ignoredExts.has(ext)) {
            // Store relative path
            results.push(path.relative(startDir, fullPath));
          }
        }
      }
    } catch (e) {
      // Suppress permission errors (EPERM) just like suppressErrors: true
    }
  }

  await walk(startDir);
  return results;
}

// --- UTILS: HELPERS ---
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function isBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  const len = Math.min(buffer.length, 1000);
  for (let i = 0; i < len; i++) if (buffer[i] === 0x00) return true;
  return false;
}

async function getBackupStatus(): Promise<boolean> {
  try {
    const configPath = path.resolve(process.cwd(), CONFIG_FILE);
    const data = await fsPromises.readFile(configPath, 'utf-8');
    return !!JSON.parse(data).backup;
  } catch {
    return false;
  }
}

async function setBackupStatus(enabled: boolean) {
  const configPath = path.resolve(process.cwd(), CONFIG_FILE);
  await fsPromises.writeFile(configPath, JSON.stringify({ backup: enabled }, null, 2));
}

// --- PROTOCOLS ---
const SYSTEM_HEADER = `
================================================================
SYSTEM PROMPT: STRICT CODE MODE
You are an automated coding agent. You are NOT a chatbot.
You do NOT converse. You do NOT use Markdown formatting (like \`\`\`).
You ONLY output executable XML code changes.
================================================================
`;

const XML_SCHEMA_INSTRUCTION = `
\n\n
================================================================
CRITICAL OUTPUT INSTRUCTIONS:
1. You must output file changes inside <file> tags.
2. The "path" attribute must match the file path exactly.
3. **PROVIDE THE FULL FILE CONTENT.** Do not use placeholders like "// ... rest of code ...".
4. Do NOT wrap the output in \`\`\`xml or \`\`\` blocks.

FORMAT EXAMPLE:
<file path="src/index.ts">
import fs from 'fs';
console.log("Full code here...");
</file>
================================================================
`;

// --- MAIN CLI LOGIC (Replaces Commander) ---
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'menu'; 

  // Router
  switch (command) {
    case 'copy':
      await runCopy();
      break;
    case 'apply':
      await runApply();
      break;
    case 'backup':
      await runBackup(args[1]);
      break;
    case 'stl':
      runSTL();
      break;
    case 'menu':
    case '--help':
    case '-h':
      await showMenu();
      break;
    case '-v':
    case '--version':
      console.log(METADATA.version);
      break;
    default:
      console.log(colors.red(`\nError: Unknown command '${command}'`));
      console.log(`Run ${colors.cyan('npx aidx')} for help.\n`);
      process.exit(1);
  }
}

// --- ACTIONS ---

async function showMenu() {
  const backupEnabled = await getBackupStatus();
  console.log('\n' + colors.bgBlue(` ${METADATA.name.toUpperCase()} `) + colors.dim(` v${METADATA.version}`));
  console.log(colors.dim('----------------------------------------'));
  console.log(`${colors.bold('Description:')} ${METADATA.description}`);
  console.log(`${colors.bold('Author:')}      ${METADATA.author}`);
  console.log(`${colors.bold('Backups:')}     ${backupEnabled ? colors.green('ENABLED') : colors.dim('DISABLED')}`);
  console.log(colors.dim('----------------------------------------'));
  console.log('\nAvailable Commands:');
  console.log(`  ${colors.cyan('npx aidx copy')}         Select files and copy context`);
  console.log(`  ${colors.cyan('npx aidx apply')}        Apply AI changes to disk`);
  console.log(`  ${colors.cyan('npx aidx backup --on')}  Enable auto-backups`);
  console.log(`  ${colors.cyan('npx aidx backup --off')} Disable auto-backups`);
  console.log(`  ${colors.cyan('npx aidx stl')}          Show AI token limits`);
  console.log(`\nRun ${colors.dim('npx aidx copy')} to start.\n`);
}

function runSTL() {
  console.log('\n' + colors.bold('AI Model Context Limits (2026 Reference)'));
  console.log(colors.dim('--------------------------------------------------'));
  
  const models = [
    { name: "Gemini 3 Pro",         limit: "2,000,000+", type: "Huge" },
    { name: "Gemini 2.5 Pro",       limit: "1,000,000+", type: "Huge" },
    { name: "Gemini 2.5 Flash",     limit: "1,000,000+", type: "Huge" },
    { name: "Llama 4 Scout",        limit: "1,000,000+", type: "Huge" },
    { name: "Llama 4 Maverick",     limit: "1,000,000+", type: "Huge" },
    { name: "Qwen 2.5 1M",          limit: "1,000,000+", type: "Huge" },
    { name: "GPT-4.1",              limit: "1,000,000+", type: "Huge" },
    { name: "ChatGPT-5",            limit: "200,000+",   type: "Large" },
    { name: "Claude 4.5 Sonnet",    limit: "200,000+",   type: "Large" },
    { name: "Claude 4.5 Opus",      limit: "200,000+",   type: "Large" },
    { name: "Grok 4",               limit: "256,000",    type: "Large" },
    { name: "Cohere Command A",     limit: "256,000",    type: "Large" },
    { name: "GPT-4o",               limit: "128,000",    type: "Medium" },
    { name: "Llama 4 405B",         limit: "128,000",    type: "Medium" },
    { name: "DeepSeek V3",          limit: "128,000",    type: "Medium" },
    { name: "Grok 3",               limit: "128,000",    type: "Medium" },
    { name: "GPT-5 Mini",           limit: "128,000",    type: "Medium" },
    { name: "ChatGPT (Free)",       limit: "~8,000",     type: "Small" },
    { name: "Claude Haiku",         limit: "~16,000",    type: "Small" },
  ];

  console.log(colors.cyan('Model Name'.padEnd(20)) + colors.yellow('Max Tokens'.padEnd(15)) + colors.dim('Category'));
  console.log(colors.dim('--------------------------------------------------'));

  models.forEach(m => {
    const color = m.type === "Huge" ? colors.green : m.type === "Large" ? colors.blue : colors.dim;
    console.log(m.name.padEnd(20) + color(m.limit.padEnd(15)) + colors.dim(m.type));
  });

  console.log(colors.dim('--------------------------------------------------'));
  console.log(colors.dim('* 1,000 tokens ≈ 750 words of code/text.'));
  console.log(colors.dim('* Estimates based on latest model specs.\n'));
}

async function runBackup(flag: string) {
  if (flag === '--on') {
    await setBackupStatus(true);
    console.log(colors.green(`\n✔ Backups enabled. Settings saved to ${CONFIG_FILE}`));
  } else if (flag === '--off') {
    await setBackupStatus(false);
    console.log(colors.yellow(`\nBackups disabled.`));
  } else {
    console.log(colors.red('Error: Use --on or --off'));
  }
}

async function runCopy() {
  console.log(colors.blue('Scanning directory...'));
  
  const files = await scanFiles(process.cwd());
  if (files.length === 0) return console.log(colors.red('Error: No files found.'));

  let selectedFiles;
  try {
    selectedFiles = await checkbox({
      message: 'Select files to send to AI:',
      choices: files.map(f => ({ name: f, value: f })),
      pageSize: 15, loop: false,
    });
  } catch (e) { return console.log(colors.yellow('\nSelection cancelled.')); }

  if (selectedFiles.length === 0) return console.log(colors.yellow('No files selected.'));

  let output = SYSTEM_HEADER + "\n";
  let skippedCount = 0;
  
  console.log(colors.dim('Reading files...'));
  for (const file of selectedFiles) {
    try {
      const stats = fs.statSync(file);
      if (stats.size > MAX_FILE_SIZE) {
          console.log(colors.yellow(`⚠ Skipped large file (>1.5MB): ${file}`));
          skippedCount++; continue;
      }

      const buffer = await fsPromises.readFile(file);
      if (isBinary(buffer)) {
          console.log(colors.yellow(`⚠ Skipped binary file: ${file}`));
          skippedCount++; continue;
      }

      const content = buffer.toString('utf-8');
      if (file.includes('.env') || SECRET_REGEX.test(content)) {
          console.log(colors.red(`\n🛑 SECURITY ALERT: Secrets detected in ${file}`));
          skippedCount++; continue;
      }

      output += `File: ${file}\n\`\`\`\n${content}\n\`\`\`\n\n`;
    } catch (e) { console.log(colors.red(`Error reading ${file}`)); }
  }
  output += XML_SCHEMA_INSTRUCTION;

  try {
    await clipboardy.write(output);
    const tokens = estimateTokens(output);
    const finalCount = selectedFiles.length - skippedCount;
    const tokenColor = tokens > 100000 ? colors.red : tokens > 30000 ? colors.yellow : colors.green;
    
    console.log(colors.green(`\n✔ Copied ${finalCount} files to clipboard`));
    console.log(`Estimated Tokens: ${tokenColor(tokens.toLocaleString())}`);
  } catch (e) { 
      console.log(colors.red(`❌ Clipboard write failed: ${e instanceof Error ? e.message : 'Unknown'}`)); 
  }
}

async function runApply() {
  const backupsEnabled = await getBackupStatus();
  console.log(colors.dim('Reading clipboard...'));
  let content;
  try { content = await clipboardy.read(); } catch (e) { 
      console.log(colors.red(`Error: Could not read clipboard.`));
      return; 
  }

  const cleanedContent = content.replace(/```xml/g, '').replace(/```/g, '');
  const fileRegex = /<file\s+path=["'](.*?)["']\s*>([\s\S]*?)<\/file>/gi;
  const deleteRegex = /<delete\s+path=["'](.*?)["']\s*\/>/gi;
  const updates: { type: 'write' | 'delete', path: string, content?: string }[] = [];
  let match;

  while ((match = fileRegex.exec(cleanedContent)) !== null) updates.push({ type: 'write', path: match[1], content: match[2].trim() });
  while ((match = deleteRegex.exec(cleanedContent)) !== null) updates.push({ type: 'delete', path: match[1] });

  if (updates.length === 0) return console.log(colors.red('\nNo valid XML tags found.'));

  console.log(colors.bold(`\nFound ${updates.length} pending change(s):\n`));
  for (const update of updates) {
    const targetPath = path.resolve(process.cwd(), update.path);
    console.log(colors.bgBlue(` ${update.path} `));
    
    if (update.type === 'delete') {
      console.log(colors.bgRed(' [DELETE] '));
    } else {
      let originalContent = '';
      try { originalContent = await fsPromises.readFile(targetPath, 'utf-8'); } catch (e) { console.log(colors.bgGreen(' [NEW FILE] ')); }
      if (originalContent && update.content !== undefined) {
        const changes = Diff.diffLines(originalContent, update.content);
        let count = 0;
        changes.forEach((part) => {
          if (count > 50) return;
          if (part.added) { process.stdout.write(colors.green(part.value.replace(/^/gm, '+ '))); count++; }
          else if (part.removed) { process.stdout.write(colors.red(part.value.replace(/^/gm, '- '))); count++; }
        });
        if (count > 50) console.log(colors.dim('...'));
        console.log('');
      }
    }
    console.log(colors.dim('--------------------------------------------------\n'));
  }

  let proceed = false;
  try { proceed = await confirm({ message: 'Apply these changes to disk?' }); } catch (e) { return; }
  if (!proceed) return console.log(colors.yellow('Aborted.'));

  console.log('');
  for (const update of updates) {
    const targetPath = path.resolve(process.cwd(), update.path);
    try {
      if (update.type === 'delete') {
           if (backupsEnabled) {
               try { await fsPromises.copyFile(targetPath, `${targetPath}.bak`); } catch(e) {}
           }
           try { await fsPromises.unlink(targetPath); console.log(colors.dim(`Deleted ${update.path}`)); } catch(e) {}
      } else {
          await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });
          if (backupsEnabled) {
              try { await fsPromises.copyFile(targetPath, `${targetPath}.bak`); console.log(colors.dim(`(Backup saved)`)); } catch(e) {}
          }
          await fsPromises.writeFile(targetPath, update.content || '');
          console.log(colors.green(`✔ Wrote ${update.path}`));
      }
    } catch (e: any) { console.log(colors.bgRed(` ERROR `) + ` ${update.path}: ${e.message}`); }
  }
  console.log(colors.cyan('\nDone.'));
}

main().catch(() => { process.exit(1); });