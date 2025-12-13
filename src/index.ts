#!/usr/bin/env node
import { Command } from 'commander';
import { checkbox, confirm } from '@inquirer/prompts';
import glob from 'fast-glob';
import fs from 'fs/promises';
import { statSync } from 'fs';
import path from 'path';
import clipboardy from 'clipboardy';
import chalk from 'chalk';
import * as Diff from 'diff';

// --- CONFIGURATION ---
const METADATA = {
  name: "aidx",
  description: "A CLI bridge between local code and LLMs.",
  author: "rx76d",
  version: "1.0.3",
  license: "MIT",
  github: "https://github.com/rx76d/aidx"
};

const CONFIG_FILE = '.aidxrc.json';
const MAX_FILE_SIZE = 1.5 * 1024 * 1024; // 1.5MB Limit
const SECRET_REGEX = /(?:sk-[a-zA-Z0-9]{32,})|(?:AKIA[0-9A-Z]{16})|(?:[a-zA-Z0-9+/]{40,}=)/;

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

// --- UTILS: ZERO-DEPENDENCY HELPERS ---

// 1. Token Estimator (1 token ~= 4 chars in Code)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// 2. Binary Detector (Checks for null bytes in first 1KB)
function isBinary(buffer: Buffer): boolean {
  // If file is empty, it's text safe
  if (buffer.length === 0) return false;
  // Check first 1000 bytes for a null byte (common in images/binaries)
  const len = Math.min(buffer.length, 1000);
  for (let i = 0; i < len; i++) {
    if (buffer[i] === 0x00) return true;
  }
  return false;
}

// --- GLOBAL HANDLERS ---
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\nOperation cancelled by user.'));
  process.exit(0);
});

// --- HELPER: CONFIG MANAGEMENT ---
async function getBackupStatus(): Promise<boolean> {
  try {
    const configPath = path.resolve(process.cwd(), CONFIG_FILE);
    const data = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(data);
    return !!config.backup;
  } catch (e) {
    return false;
  }
}

async function setBackupStatus(enabled: boolean) {
  const configPath = path.resolve(process.cwd(), CONFIG_FILE);
  await fs.writeFile(configPath, JSON.stringify({ backup: enabled }, null, 2));
}

const program = new Command();

program
  .name(METADATA.name)
  .description(METADATA.description)
  .version(METADATA.version);

// --- ROOT COMMAND ---
program.action(async () => {
  const backupEnabled = await getBackupStatus();
  console.log('\n' + chalk.bgBlue.bold(` ${METADATA.name.toUpperCase()} `) + chalk.dim(` v${METADATA.version}`));
  console.log(chalk.dim('----------------------------------------'));
  console.log(`${chalk.bold('Description:')} ${METADATA.description}`);
  console.log(`${chalk.bold('Author:')}      ${METADATA.author}`);
  console.log(`${chalk.bold('Backups:')}     ${backupEnabled ? chalk.green('ENABLED') : chalk.dim('DISABLED')}`);
  console.log(`${chalk.bold('Limit:')}       1.5MB per file`);
  console.log(chalk.dim('----------------------------------------'));
  console.log('\nAvailable Commands:');
  console.log(`  ${chalk.cyan('npx aidx copy')}         Select files and copy context`);
  console.log(`  ${chalk.cyan('npx aidx apply')}        Apply AI changes to disk`);
  console.log(`  ${chalk.cyan('npx aidx backup --on')}  Enable auto-backups`);
  console.log(`  ${chalk.cyan('npx aidx backup --off')} Disable auto-backups`);
  console.log(`  ${chalk.cyan('npx aidx stl')}          Show AI token limits`);
  console.log(`\nRun ${chalk.gray('npx aidx --help')} for details.\n`);
});

// --- COMMAND: STL (Safe Token Limits) ---
program
  .command('stl')
  .description('Show safe token limits for AI models')
  .action(() => {
    console.log('\n' + chalk.bold('AI Model Context Limits (2025 Reference)'));
    console.log(chalk.dim('--------------------------------------------------'));
    
    const models = [
      // HUGE (≈ 1M+ tokens)
      { name: "Gemini 3 Pro",         limit: "2,000,000+", type: "Huge" },
      { name: "Gemini 2.5 Pro",       limit: "1,000,000+", type: "Huge" },
      { name: "Gemini 2.5 Flash",     limit: "1,000,000+", type: "Huge" },
      { name: "Llama 4 Scout",        limit: "1,000,000+", type: "Huge" },
      { name: "Llama 4 Maverick",     limit: "1,000,000+", type: "Huge" },
      { name: "Qwen 2.5 1M",          limit: "1,000,000+", type: "Huge" },
      { name: "GPT-4.1",              limit: "1,000,000+", type: "Huge" },

      // LARGE (≈ 200K–500K tokens)
      { name: "ChatGPT-5",            limit: "200,000+",   type: "Large" },
      { name: "Claude 4.5 Sonnet",    limit: "200,000+",   type: "Large" },
      { name: "Claude 4.5 Opus",      limit: "200,000+",   type: "Large" },
      { name: "Grok 4",               limit: "256,000",    type: "Large" },
      { name: "Cohere Command A",     limit: "256,000",    type: "Large" },

      // MEDIUM (≈ 100K–150K tokens)
      { name: "GPT-4o",               limit: "128,000",    type: "Medium" },
      { name: "Llama 4 405B",         limit: "128,000",    type: "Medium" },
      { name: "DeepSeek V3",          limit: "128,000",    type: "Medium" },
      { name: "Grok 3",               limit: "128,000",    type: "Medium" },
      { name: "GPT-5 Mini",           limit: "128,000",    type: "Medium" },

      // SMALL (< 50K tokens)
      { name: "ChatGPT (Free)",       limit: "~8,000",     type: "Small" },
      { name: "Claude Haiku",         limit: "~16,000",    type: "Small" },
    ];

    console.log(chalk.cyan('Model Name'.padEnd(20)) + chalk.yellow('Max Tokens'.padEnd(15)) + chalk.white('Category'));
    console.log(chalk.dim('--------------------------------------------------'));

    models.forEach(m => {
      const color = m.type === "Huge" ? chalk.green : m.type === "Large" ? chalk.blue : chalk.gray;
      console.log(m.name.padEnd(20) + color(m.limit.padEnd(15)) + chalk.dim(m.type));
    });

    console.log(chalk.dim('--------------------------------------------------'));
    console.log(chalk.dim('* 1,000 tokens ≈ 750 words of code/text.'));
    console.log(chalk.dim('* Estimates based on latest model specs.\n'));
  });

// --- COMMAND: BACKUP ---
program
  .command('backup')
  .description('Configure automatic backups')
  .option('--on', 'Enable backups')
  .option('--off', 'Disable backups')
  .action(async (options) => {
    if (options.on) {
      await setBackupStatus(true);
      console.log(chalk.green(`\n✔ Backups enabled. Settings saved to ${CONFIG_FILE}`));
    } else if (options.off) {
      await setBackupStatus(false);
      console.log(chalk.yellow(`\nBackups disabled.`));
    } else {
      const status = await getBackupStatus();
      console.log(`\nCurrent Backup Status: ${status ? chalk.green('ENABLED') : chalk.red('DISABLED')}`);
    }
  });

// --- COMMAND: COPY (FAST) ---
program
  .command('copy')
  .description('Select files and copy to clipboard')
  .action(async () => {
    console.log(chalk.blue('Scanning directory...'));

    const files = await glob(['**/*'], {
      ignore: [
        '**/Application Data/**', '**/Cookies/**', '**/Local Settings/**', '**/Recent/**', '**/Start Menu/**',
        '**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**', '**/.vscode/**', 
        '**/__pycache__/**', '**/venv/**', '**/target/**', '**/bin/**', '**/obj/**', 
        '**/vendor/**', '**/*.lock', '**/*.log', '**/*.png', '**/*.exe', '**/*.dll', '**/*.zip', '**/*.tar', '**/*.gz'
      ],
      onlyFiles: true,
      dot: true,
      suppressErrors: true,     
      followSymbolicLinks: false 
    });

    if (files.length === 0) return console.log(chalk.red('Error: No files found.'));

    let selectedFiles: string[] = [];
    try {
      selectedFiles = await checkbox({
        message: 'Select files to send to AI:',
        choices: files.map(f => ({ name: f, value: f })),
        pageSize: 15, loop: false,
      });
    } catch (e) { return console.log(chalk.yellow('\nSelection cancelled.')); }

    if (selectedFiles.length === 0) return console.log(chalk.yellow('No files selected.'));

    let output = SYSTEM_HEADER + "\n";
    let skippedCount = 0;
    
    console.log(chalk.dim('Reading files...'));
    for (const file of selectedFiles) {
      try {
        const stats = statSync(file);
        if (stats.size > MAX_FILE_SIZE) {
            console.log(chalk.yellow(`⚠ Skipped large file (>1.5MB): ${file}`));
            skippedCount++; continue;
        }

        // Optimized Read: Read buffer first to check binary, then convert to string
        const buffer = await fs.readFile(file);
        
        if (isBinary(buffer)) {
            console.log(chalk.yellow(`⚠ Skipped binary file: ${file}`));
            skippedCount++; continue;
        }

        const content = buffer.toString('utf-8');

        if (file.includes('.env') || SECRET_REGEX.test(content)) {
            console.log(chalk.red(`\n🛑 SECURITY ALERT: Secrets detected in ${file}`));
            skippedCount++; continue;
        }

        output += `File: ${file}\n\`\`\`\n${content}\n\`\`\`\n\n`;
      } catch (e) { console.log(chalk.red(`Error reading ${file}`)); }
    }
    output += XML_SCHEMA_INSTRUCTION;

    try {
      await clipboardy.write(output);
      // LIGHTWEIGHT TOKENIZER USAGE
      const tokens = estimateTokens(output);
      const finalCount = selectedFiles.length - skippedCount;
      const tokenColor = tokens > 100000 ? chalk.red : tokens > 30000 ? chalk.yellow : chalk.green;
      
      console.log(chalk.green(`\n✔ Copied ${finalCount} files to clipboard`));
      console.log(`Estimated Tokens: ${tokenColor(tokens.toLocaleString())}`);
      
    } catch (e) { 
        console.log(chalk.red('❌ Clipboard write failed (File too large for OS).')); 
        console.log(chalk.dim('Try selecting fewer files.'));
    }
  });

// --- COMMAND: APPLY ---
program
  .command('apply')
  .description('Apply AI changes from clipboard')
  .action(async () => {
    const backupsEnabled = await getBackupStatus();
    console.log(chalk.dim('Reading clipboard...'));
    let content;
    try { content = await clipboardy.read(); } catch (e) { return console.log(chalk.red('Error: Could not read clipboard.')); }

    const cleanedContent = content.replace(/```xml/g, '').replace(/```/g, '');
    const fileRegex = /<file\s+path=["'](.*?)["']\s*>([\s\S]*?)<\/file>/gi;
    const deleteRegex = /<delete\s+path=["'](.*?)["']\s*\/>/gi;
    const updates: { type: 'write' | 'delete', path: string, content?: string }[] = [];
    let match;

    while ((match = fileRegex.exec(cleanedContent)) !== null) updates.push({ type: 'write', path: match[1], content: match[2].trim() });
    while ((match = deleteRegex.exec(cleanedContent)) !== null) updates.push({ type: 'delete', path: match[1] });

    if (updates.length === 0) return console.log(chalk.red('\nNo valid XML tags found.'));

    console.log(chalk.bold(`\nFound ${updates.length} pending change(s):\n`));
    for (const update of updates) {
      const targetPath = path.resolve(process.cwd(), update.path);
      console.log(chalk.bgBlue.white(` ${update.path} `));
      if (update.type === 'delete') {
        console.log(chalk.bgRed.white(' [DELETE] '));
      } else {
        let originalContent = '';
        try { originalContent = await fs.readFile(targetPath, 'utf-8'); } catch (e) { console.log(chalk.bgGreen.black(' [NEW FILE] ')); }
        if (originalContent && update.content !== undefined) {
          const changes = Diff.diffLines(originalContent, update.content);
          let count = 0;
          changes.forEach((part) => {
            if (count > 50) return;
            if (part.added) { process.stdout.write(chalk.green(part.value.replace(/^/gm, '+ '))); count++; }
            else if (part.removed) { process.stdout.write(chalk.red(part.value.replace(/^/gm, '- '))); count++; }
          });
          if (count > 50) console.log(chalk.dim('...'));
          console.log('');
        }
      }
      console.log(chalk.dim('--------------------------------------------------\n'));
    }

    let proceed = false;
    try { proceed = await confirm({ message: 'Apply these changes to disk?' }); } catch (e) { return; }
    if (!proceed) return console.log(chalk.yellow('Aborted.'));

    console.log('');
    for (const update of updates) {
      const targetPath = path.resolve(process.cwd(), update.path);
      try {
        if (update.type === 'delete') {
             if (backupsEnabled) {
                 try { await fs.copyFile(targetPath, `${targetPath}.bak`); } catch(e) {}
             }
             try { await fs.unlink(targetPath); console.log(chalk.gray(`Deleted ${update.path}`)); } catch(e) {}
        } else {
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            if (backupsEnabled) {
                try { await fs.copyFile(targetPath, `${targetPath}.bak`); console.log(chalk.gray(`(Backup saved)`)); } catch(e) {}
            }
            await fs.writeFile(targetPath, update.content || '');
            console.log(chalk.green(`✔ Wrote ${update.path}`));
        }
      } catch (e: any) { console.log(chalk.bgRed.white(` ERROR `) + ` ${update.path}: ${e.message}`); }
    }
    console.log(chalk.cyan('\nDone.'));
  });

program.on('command:*', (operands) => {
  console.error(chalk.red(`\nError: Unknown command '${operands[0]}'`));
  process.exit(1);
});

program.parse();