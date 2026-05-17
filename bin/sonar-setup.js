#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

function installClaudeCommands(packageDir, homeDir) {
    const claudeConfigDir = path.join(homeDir, '.claude', 'commands');

    if (!fs.existsSync(claudeConfigDir)) {
        console.log(`📁 Creating Claude config directory: ${claudeConfigDir}`);
        fs.mkdirSync(claudeConfigDir, { recursive: true });
    }

    const docsDir = path.join(packageDir, 'docs');
    const slashCommandFiles = ['sonar-fix.md'];
    let copiedCount = 0;

    for (const file of slashCommandFiles) {
        const sourcePath = path.join(docsDir, file);
        const destPath = path.join(claudeConfigDir, file);

        if (!fs.existsSync(sourcePath)) {
            console.log(`⚠️  Warning: ${file} not found, skipping`);
            continue;
        }

        const isUpdate = fs.existsSync(destPath);
        fs.copyFileSync(sourcePath, destPath);
        console.log(`✅ ${isUpdate ? 'Updated' : 'Copied'}: ${file}`);
        copiedCount++;
    }

    if (copiedCount > 0) {
        console.log(`\n🎉 Claude Code: installed ${copiedCount} slash command${copiedCount === 1 ? '' : 's'}`);
        console.log(`   Location: ${claudeConfigDir}`);
        console.log('   /sonar-fix [PR#]    - Auto-fix SonarQube issues');
    }

    return copiedCount;
}

function installGeminiCommands(packageDir, homeDir) {
    const geminiConfigDir = path.join(homeDir, '.gemini', 'commands');

    if (!fs.existsSync(geminiConfigDir)) {
        console.log(`📁 Creating Gemini config directory: ${geminiConfigDir}`);
        fs.mkdirSync(geminiConfigDir, { recursive: true });
    }

    const docsDir = path.join(packageDir, 'docs');
    const commandFiles = ['sonar-fix.md'];
    let copiedCount = 0;

    for (const file of commandFiles) {
        const sourcePath = path.join(docsDir, file);
        const destPath = path.join(geminiConfigDir, file);

        if (!fs.existsSync(sourcePath)) {
            console.log(`⚠️  Warning: ${file} not found, skipping`);
            continue;
        }

        const isUpdate = fs.existsSync(destPath);
        fs.copyFileSync(sourcePath, destPath);
        console.log(`✅ ${isUpdate ? 'Updated' : 'Copied'}: ${file}`);
        copiedCount++;
    }

    if (copiedCount > 0) {
        console.log(`\n🎉 Gemini CLI: installed ${copiedCount} command${copiedCount === 1 ? '' : 's'}`);
        console.log(`   Location: ${geminiConfigDir}`);
        console.log('   /sonar-fix [PR#]    - Auto-fix SonarQube issues');
    }

    return copiedCount;
}

function installCodexSkills(packageDir, homeDir) {
    const codexSkillsDir = path.join(homeDir, '.agents', 'skills');
    const sourceSkillsDir = path.join(packageDir, 'docs', 'codex-skills');
    const skills = ['sonar-fix'];
    let installedCount = 0;

    for (const skill of skills) {
        const sourcePath = path.join(sourceSkillsDir, skill, 'SKILL.md');
        const destDir = path.join(codexSkillsDir, skill);
        const destPath = path.join(destDir, 'SKILL.md');

        if (!fs.existsSync(sourcePath)) {
            console.log(`⚠️  Warning: Codex skill ${skill} not found, skipping`);
            continue;
        }

        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }

        const isUpdate = fs.existsSync(destPath);
        fs.copyFileSync(sourcePath, destPath);
        console.log(`✅ ${isUpdate ? 'Updated' : 'Copied'}: ${skill}/SKILL.md`);
        installedCount++;
    }

    if (installedCount > 0) {
        console.log(`\n🎉 Codex CLI: installed ${installedCount} skill${installedCount === 1 ? '' : 's'}`);
        console.log(`   Location: ${codexSkillsDir}`);
        console.log('   /sonar-fix [PR#]    - Auto-fix SonarQube issues');
    }

    return installedCount;
}

function askQuestion(rl, question) {
    return new Promise(resolve => {
        rl.question(question, answer => resolve(answer.trim().toLowerCase()));
    });
}

async function promptToolSelection() {
    if (!process.stdin.isTTY) {
        return { claude: true, gemini: true, codex: true };
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log('Which AI tools would you like to install for?\n');

    const claudeAnswer = await askQuestion(rl, '  Claude Code? [Y/n]: ');
    const geminiAnswer = await askQuestion(rl, '  Gemini CLI?  [Y/n]: ');
    const codexAnswer  = await askQuestion(rl, '  Codex CLI?   [Y/n]: ');

    rl.close();
    console.log('');

    const yes = answer => answer === '' || answer === 'y' || answer === 'yes';
    return { claude: yes(claudeAnswer), gemini: yes(geminiAnswer), codex: yes(codexAnswer) };
}

async function setupSlashCommands() {
    console.log('🚀 Setting up SonarQube tools...\n');

    const homeDir = os.homedir();
    const packageDir = path.dirname(__dirname);
    const docsDir = path.join(packageDir, 'docs');

    if (!fs.existsSync(docsDir)) {
        console.error(`❌ Docs directory not found at: ${docsDir}`);
        process.exit(1);
    }

    const selection = await promptToolSelection();
    let totalInstalled = 0;

    if (selection.claude) {
        try {
            totalInstalled += installClaudeCommands(packageDir, homeDir);
        } catch (error) {
            console.error(`❌ Error installing Claude commands: ${error.message}`);
        }
    }

    if (selection.gemini) {
        try {
            totalInstalled += installGeminiCommands(packageDir, homeDir);
        } catch (error) {
            console.error(`❌ Error installing Gemini commands: ${error.message}`);
        }
    }

    if (selection.codex) {
        try {
            totalInstalled += installCodexSkills(packageDir, homeDir);
        } catch (error) {
            console.error(`❌ Error installing Codex skills: ${error.message}`);
        }
    }

    if (totalInstalled === 0) {
        console.log('\n❌ Nothing was installed');
        process.exit(1);
    }

    console.log('\n💡 Note: Running sonar-setup again will overwrite these files with the latest version.');
    console.log('\n🔧 Next steps:');
    console.log('   1. Set environment variables in your project:');
    console.log('      SONARQUBE_URL=https://sonarcloud.io');
    console.log('      SONARQUBE_TOKEN=your_token_here');
    console.log('      SONARQUBE_PROJECT_KEY=your_project_key');
    console.log('   2. Run /sonar-fix [PR#] in Claude Code, Gemini CLI, or Codex CLI!');
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
SonarQube CLI Tools Setup

USAGE:
    sonar-setup

DESCRIPTION:
    Interactively installs SonarQube commands for your AI coding tools:
      - Claude Code  (~/.claude/commands/)
      - Gemini CLI   (~/.gemini/commands/)
      - Codex CLI    (~/.agents/skills/)

    When stdin is not a TTY (e.g. CI), installs for all tools automatically.

OPTIONS:
    -h, --help    Show this help message

EXAMPLES:
    sonar-setup   # Prompt which tools to install for
`);
    process.exit(0);
}

setupSlashCommands();
