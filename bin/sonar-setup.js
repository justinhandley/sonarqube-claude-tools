#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

function setupSlashCommands() {
    console.log('🚀 Setting up SonarQube Claude Code slash commands...\n');

    // Determine Claude config directory
    const homeDir = os.homedir();
    const claudeConfigDir = path.join(homeDir, '.claude', 'commands');
    
    // Check if Claude config directory exists
    if (!fs.existsSync(claudeConfigDir)) {
        console.log(`📁 Creating Claude config directory: ${claudeConfigDir}`);
        try {
            fs.mkdirSync(claudeConfigDir, { recursive: true });
        } catch (error) {
            console.error(`❌ Error creating directory: ${error.message}`);
            process.exit(1);
        }
    }

    // Get the package directory (where docs/ is located)
    const packageDir = path.dirname(__dirname); // Go up from bin/ to package root
    const docsDir = path.join(packageDir, 'docs');
    
    if (!fs.existsSync(docsDir)) {
        console.error(`❌ Docs directory not found at: ${docsDir}`);
        process.exit(1);
    }

    // Copy slash command files
    const slashCommandFiles = ['sonar-check.md', 'sonar-fix.md'];
    let copiedCount = 0;

    for (const file of slashCommandFiles) {
        const sourcePath = path.join(docsDir, file);
        const destPath = path.join(claudeConfigDir, file);

        if (!fs.existsSync(sourcePath)) {
            console.log(`⚠️  Warning: ${file} not found, skipping`);
            continue;
        }

        try {
            fs.copyFileSync(sourcePath, destPath);
            console.log(`✅ Copied: ${file}`);
            copiedCount++;
        } catch (error) {
            console.error(`❌ Error copying ${file}: ${error.message}`);
        }
    }

    if (copiedCount === 0) {
        console.log('\n❌ No slash commands were installed');
        process.exit(1);
    }

    console.log(`\n🎉 Successfully installed ${copiedCount} slash command${copiedCount === 1 ? '' : 's'}!`);
    console.log('\n📋 Available commands in Claude Code:');
    console.log('   /sonar-check [PR#]  - Check SonarQube issues');
    console.log('   /sonar-fix [PR#]    - Auto-fix SonarQube issues');
    
    console.log('\n🔧 Next steps:');
    console.log('   1. Set environment variables in your project:');
    console.log('      SONARQUBE_URL=https://sonarcloud.io');
    console.log('      SONARQUBE_TOKEN=your_token_here');
    console.log('      SONARQUBE_PROJECT_KEY=your_project_key');
    console.log('   2. Use the slash commands in Claude Code!');
}

// Handle command line arguments
if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
SonarQube Claude Tools Setup

USAGE:
    sonar-setup

DESCRIPTION:
    Installs SonarQube slash commands for Claude Code by copying them to:
    ~/.claude/commands/

OPTIONS:
    -h, --help    Show this help message

EXAMPLES:
    sonar-setup   # Install slash commands
`);
    process.exit(0);
}

setupSlashCommands();