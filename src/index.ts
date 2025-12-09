#!/usr/bin/env node
import { Command } from 'commander';
import { checkbox, confirm } from '@inquirer/prompts';
import glob from 'fast-glob';
import fs from 'fs/promises';
import path from 'path';
import clipboardy from 'clipboardy';
import chalk from 'chalk';
import { encode } from 'gpt-tokenizer';
import * as Diff from 'diff';
import { isBinaryFile } from 'isbinaryfile';

// --- CONFIGURATION ---
const METADATA = {
  name: "aidx",
  description: "A CLI bridge between local code and LLMs.",
  author: "rx76d",
  version: "1.0.0",
  license: "MIT",
  github: "https://github.com/rx76d/aidx"
};

const CONFIG_FILE = '.aidxrc.json';

// Regex to detect potential secrets (OpenAI, AWS, Generic High Entropy)
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

// --- GLOBAL CTRL+C HANDLER ---
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
    return false; // Default to false if no config exists
  }
}

async function setBackupStatus(enabled: boolean) {
  const configPath = path.resolve(process.cwd(), CONFIG_FILE);
  const config = { backup: enabled };
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

const program = new Command();

program
  .name(METADATA.name)
  .description(METADATA.description)
  .version(METADATA.version);

// --- ROOT COMMAND (The Banner) ---
program
  .action(async () => {
    const backupEnabled = await getBackupStatus();
    
    console.log('\n' + chalk.bgBlue.bold(` ${METADATA.name.toUpperCase()} `) + chalk.dim(` v${METADATA.version}`));
    console.log(chalk.dim('----------------------------------------'));
    console.log(`${chalk.bold('Description:')} ${METADATA.description}`);
    console.log(`${chalk.bold('Author:')}      ${METADATA.author}`);
    console.log(`${chalk.bold('GitHub:')}      ${METADATA.github}`);
    console.log(chalk.dim('----------------------------------------'));
    console.log(`${chalk.bold('Backups:')}     ${backupEnabled ? chalk.green('ENABLED') : chalk.dim('DISABLED')}`);
    console.log(chalk.dim('----------------------------------------'));
    console.log('\nAvailable Commands:');
    console.log(`  ${chalk.cyan('npx aidx copy')}         Select files and copy context`);
    console.log(`  ${chalk.cyan('npx aidx apply')}        Apply AI changes to disk`);
    console.log(`  ${chalk.cyan('npx aidx backup --on')}  Enable auto-backups`);
    console.log(`  ${chalk.cyan('npx aidx backup --off')} Disable auto-backups`);
    console.log(`\nRun ${chalk.gray('npx aidx --help')} for details.\n`);
  });

// --- COMMAND: BACKUP CONFIG ---
program
  .command('backup')
  .description('Configure automatic backups')
  .option('--on', 'Enable backups for this directory')
  .option('--off', 'Disable backups for this directory')
  .action(async (options) => {
    if (options.on) {
      await setBackupStatus(true);
      console.log(chalk.green(`\n✔ Backups enabled. Settings saved to ${CONFIG_FILE}`));
      console.log(chalk.dim('Original files will be saved as .bak before overwriting.'));
    } else if (options.off) {
      await setBackupStatus(false);
      console.log(chalk.yellow(`\nBackups disabled. ${CONFIG_FILE} updated.`));
    } else {
      const status = await getBackupStatus();
      console.log(`\nCurrent Backup Status: ${status ? chalk.green('ENABLED') : chalk.red('DISABLED')}`);
      console.log(`Use ${chalk.cyan('--on')} or ${chalk.cyan('--off')} to change.`);
    }
  });

// --- COMMAND: COPY ---
program
  .command('copy')
  .description('Select files and copy to clipboard with strict AI protocol')
  .action(async () => {
    console.log(chalk.blue('Scanning directory...'));

    const files = await glob(['**/*'], {
      ignore: [
        '**/node_modules/**', '**/dist/**', '**/build/**', '**/.next/**', 
        '**/.git/**', '**/.vscode/**', '**/.idea/**',       
        '**/__pycache__/**', '**/venv/**', '**/.venv/**', '**/env/**', '**/*.pyc',
        '**/target/**', '**/bin/**', '**/obj/**', '**/vendor/**',      
        '**/*.lock', '**/*.log', '**/*.svg', '**/*.png', '**/*.jpg', '**/*.jpeg', 
        '**/*.gif', '**/*.ico', '**/*.pdf', '**/*.zip', '**/*.tar', '**/*.gz', '**/*.exe', '**/*.dll'
      ],
      onlyFiles: true,
      dot: true 
    });

    if (files.length === 0) {
      console.log(chalk.red('Error: No files found.'));
      return;
    }

    let selectedFiles: string[] = [];
    
    try {
      selectedFiles = await checkbox({
        message: 'Select files to send to AI:',
        choices: files.map(f => ({ name: f, value: f })),
        pageSize: 15,
        loop: false,
      });
    } catch (error) {
      console.log(chalk.yellow('\nSelection cancelled.'));
      return;
    }

    if (selectedFiles.length === 0) {
      console.log(chalk.yellow('No files selected.'));
      return;
    }

    let output = SYSTEM_HEADER + "\n";
    let skippedCount = 0;
    
    console.log(chalk.dim('Reading files...'));

    for (const file of selectedFiles) {
      try {
        const isBinary = await isBinaryFile(file);
        
        if (isBinary) {
            console.log(chalk.yellow(`⚠ Skipped binary file: ${file}`));
            skippedCount++;
            continue;
        }

        const content = await fs.readFile(file, 'utf-8');

        // --- SECURITY CHECK ---
        if (file.includes('.env') || SECRET_REGEX.test(content)) {
            console.log(chalk.red(`\n🛑 SECURITY ALERT: Secrets detected in ${file}`));
            console.log(chalk.red('   Skipping this file to protect your keys.'));
            skippedCount++;
            continue;
        }

        output += `File: ${file}\n\`\`\`\n${content}\n\`\`\`\n\n`;
      } catch (e) {
        console.log(chalk.red(`Error reading ${file}`));
      }
    }

    output += XML_SCHEMA_INSTRUCTION;

    try {
      await clipboardy.write(output);
      const tokens = encode(output).length;
      const tokenColor = tokens > 100000 ? chalk.red : tokens > 30000 ? chalk.yellow : chalk.green;
      
      const finalCount = selectedFiles.length - skippedCount;
      console.log(chalk.green(`\n✔ Copied ${finalCount} files to clipboard`));
      
      console.log(`Estimated Tokens: ${tokenColor(tokens)}`);
      console.log(chalk.cyan('Ready!'));
    } catch (e) {
      console.log(chalk.red('Clipboard write failed.'));
    }
  });

// --- COMMAND: APPLY ---
program
  .command('apply')
  .description('Read clipboard and safely apply changes')
  .action(async () => {
    // 1. Check Backup Config
    const backupsEnabled = await getBackupStatus();

    console.log(chalk.dim('Reading clipboard...'));
    let content;
    
    try {
      content = await clipboardy.read();
    } catch (e) {
      console.log(chalk.red('Error: Could not read clipboard.'));
      return;
    }

    const cleanedContent = content.replace(/```xml/g, '').replace(/```/g, '');

    const fileRegex = /<file\s+path=["'](.*?)["']\s*>([\s\S]*?)<\/file>/gi;
    const deleteRegex = /<delete\s+path=["'](.*?)["']\s*\/>/gi;

    const updates: { type: 'write' | 'delete', path: string, content?: string }[] = [];
    let match;

    while ((match = fileRegex.exec(cleanedContent)) !== null) {
      updates.push({ type: 'write', path: match[1], content: match[2].trim() });
    }
    while ((match = deleteRegex.exec(cleanedContent)) !== null) {
      updates.push({ type: 'delete', path: match[1] });
    }

    if (updates.length === 0) {
      console.log(chalk.red('\nNo valid XML tags found.'));
      console.log(chalk.dim('Tip: Ensure the AI used the <file> format provided.'));
      return;
    }

    console.log(chalk.bold(`\nFound ${updates.length} pending change(s):\n`));

    for (const update of updates) {
      const targetPath = path.resolve(process.cwd(), update.path);
      console.log(chalk.bgBlue.white(` ${update.path} `));

      if (update.type === 'delete') {
        console.log(chalk.bgRed.white(' [DELETE] '));
      } else {
        let originalContent = '';
        let fileExists = false;
        try {
          originalContent = await fs.readFile(targetPath, 'utf-8');
          fileExists = true;
        } catch (e) {
          console.log(chalk.bgGreen.black(' [NEW FILE] '));
        }

        if (fileExists && update.content !== undefined) {
          const changes = Diff.diffLines(originalContent, update.content);
          let changesCount = 0;
          changes.forEach((part) => {
            if (changesCount > 50) return;
            if (part.added) { process.stdout.write(chalk.green(part.value.replace(/^/gm, '+ '))); changesCount++; }
            else if (part.removed) { process.stdout.write(chalk.red(part.value.replace(/^/gm, '- '))); changesCount++; }
          });
          if (changesCount > 50) console.log(chalk.dim('... (diff truncated)'));
          console.log('');
        }
      }
      console.log(chalk.dim('--------------------------------------------------\n'));
    }

    let proceed = false;
    try {
        proceed = await confirm({ message: 'Apply these changes to disk?' });
    } catch (error) {
        console.log(chalk.yellow('\nConfirmation cancelled.'));
        return;
    }

    if (!proceed) {
      console.log(chalk.yellow('Aborted.'));
      return;
    }

    console.log('');
    for (const update of updates) {
      const targetPath = path.resolve(process.cwd(), update.path);
      try {
        if (update.type === 'delete') {
            try {
              // Create backup before delete if enabled
              if (backupsEnabled) {
                 await fs.access(targetPath); // ensure it exists first
                 await fs.copyFile(targetPath, `${targetPath}.bak`);
                 console.log(chalk.gray(`(Backup saved to ${path.basename(targetPath)}.bak)`));
              }
              await fs.access(targetPath);
              await fs.unlink(targetPath);
              console.log(chalk.gray(`Deleted ${update.path}`));
            } catch (err: any) {
              if (err.code === 'ENOENT') {
                console.log(chalk.gray(`Skipped delete (File not found): ${update.path}`));
              } else {
                throw err;
              }
            }
        } else {
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            
            // --- BACKUP LOGIC ---
            if (backupsEnabled) {
                try {
                    await fs.access(targetPath); // Check if file exists
                    await fs.copyFile(targetPath, `${targetPath}.bak`);
                    console.log(chalk.gray(`(Backup saved to ${path.basename(targetPath)}.bak)`));
                } catch (e) {
                    // File didn't exist, no backup needed
                }
            }

            await fs.writeFile(targetPath, update.content || '');
            console.log(chalk.green(`✔ Wrote ${update.path}`));
        }
      } catch (e: any) {
        console.log(chalk.bgRed.white(` ERROR `) + ` ${update.path}: ${e.message}`);
      }
    }
    console.log(chalk.cyan('\nDone.'));
  });

// --- UNKNOWN COMMAND HANDLER ---
program.on('command:*', (operands) => {
  console.error(chalk.red(`\nError: Unknown command '${operands[0]}'`));
  console.log(`See ${chalk.cyan('npx aidx --help')} for list of available commands.\n`);
  process.exit(1);
});

program.parse();