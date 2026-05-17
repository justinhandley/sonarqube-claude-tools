#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const https = require('https');
const http = require('http');

function getMcpEndpoint(sonarUrl) {
  if (sonarUrl.includes('sonarcloud.io')) return 'https://api.sonarcloud.io/mcp';
  if (sonarUrl.includes('sonarqube.us')) return 'https://api.sonarqube.us/mcp';
  return `${sonarUrl.replace(/\/$/, '')}/mcp`;
}

function fetchOrg(sonarUrl, token, projectKey) {
  return new Promise((resolve, reject) => {
    const url = new URL(sonarUrl);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `/api/components/show?component=${encodeURIComponent(projectKey)}`,
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    };
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.component?.organization || null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function readEnv() {
  const envPath = path.join(process.cwd(), '.env');
  const vars = {};
  if (!fs.existsSync(envPath)) return vars;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...parts] = trimmed.split('=');
      if (key && parts.length > 0) vars[key.trim()] = parts.join('=').trim();
    }
  }
  return vars;
}

function writeEnvVars(newVars) {
  const envPath = path.join(process.cwd(), '.env');
  const lines = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8').split('\n') : [];
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

  for (const [key, value] of Object.entries(newVars)) {
    const idx = lines.findIndex(l => l.split('=')[0].trim() === key);
    if (idx >= 0) lines[idx] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }

  fs.writeFileSync(envPath, lines.join('\n') + '\n');
}

function checkGitignore() {
  const gitignorePath = path.join(process.cwd(), '.gitignore');
  if (!fs.existsSync(gitignorePath)) return false;
  return fs.readFileSync(gitignorePath, 'utf8').split('\n').some(l => l.trim() === '.env');
}

function mergeMcpConfig(filePath, serverName, serverConfig) {
  let config = {};
  if (fs.existsSync(filePath)) {
    try { config = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}
  }
  if (!config.mcpServers) config.mcpServers = {};
  const existed = !!config.mcpServers[serverName];
  config.mcpServers[serverName] = serverConfig;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n');
  return existed;
}

function mcpConfigForClaude(mcpUrl, token, org) {
  return { type: 'http', url: mcpUrl, headers: { Authorization: `Bearer ${token}`, SONARQUBE_ORG: org } };
}

function mcpConfigForCursor(mcpUrl, token, org) {
  return { url: mcpUrl, headers: { Authorization: `Bearer ${token}`, SONARQUBE_ORG: org } };
}

function mcpConfigForWindsurf(mcpUrl, token, org) {
  return { serverUrl: mcpUrl, headers: { Authorization: `Bearer ${token}`, SONARQUBE_ORG: org } };
}

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, a => resolve(a.trim())));
}

async function sonarInit() {
  console.log('🔧 sonar-init — SonarQube project setup\n');

  const projectName = path.basename(process.cwd());
  const serverName = `${projectName}-sonar`;
  const existing = readEnv();
  const hasExisting = Object.keys(existing).some(k => k.startsWith('SONARQUBE_'));

  if (hasExisting) {
    const show = (key) => {
      if (!existing[key]) return '❌ missing';
      if (key === 'SONARQUBE_TOKEN') return '✅ set';
      return `✅ ${existing[key]}`;
    };
    console.log('📄 Found existing .env:\n');
    console.log(`   SONARQUBE_URL         ${show('SONARQUBE_URL')}`);
    console.log(`   SONARQUBE_TOKEN       ${show('SONARQUBE_TOKEN')}`);
    console.log(`   SONARQUBE_PROJECT_KEY ${show('SONARQUBE_PROJECT_KEY')}`);
    console.log(`   SONARQUBE_ORG         ${show('SONARQUBE_ORG')}\n`);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const defaultUrl = existing.SONARQUBE_URL || 'https://sonarcloud.io';
  const sonarUrl = await ask(rl, `  SonarQube URL [${defaultUrl}]: `) || defaultUrl;

  let token;
  if (existing.SONARQUBE_TOKEN) {
    const input = await ask(rl, '  Token [press Enter to keep existing]: ');
    token = input || existing.SONARQUBE_TOKEN;
  } else {
    token = await ask(rl, '  Token: ');
  }

  const defaultKey = existing.SONARQUBE_PROJECT_KEY || '';
  const projectKey = await ask(rl, `  Project key${defaultKey ? ` [${defaultKey}]` : ''}: `) || defaultKey;

  let org = existing.SONARQUBE_ORG;
  if (org) {
    const input = await ask(rl, `  Organisation [${org}]: `);
    if (input) org = input;
  } else {
    process.stdout.write('  Organisation: ⚙️  fetching from API...');
    try {
      const fetched = await fetchOrg(sonarUrl, token, projectKey);
      if (fetched) {
        org = fetched;
        process.stdout.write(` → ${org} ✅\n`);
      } else {
        process.stdout.write(' → not found\n');
        org = await ask(rl, '  Organisation (enter manually): ');
      }
    } catch {
      process.stdout.write(' → error\n');
      org = await ask(rl, '  Organisation (enter manually): ');
    }
  }

  const updates = { SONARQUBE_URL: sonarUrl, SONARQUBE_TOKEN: token, SONARQUBE_PROJECT_KEY: projectKey, SONARQUBE_ORG: org };
  writeEnvVars(updates);
  console.log('\n✅ .env updated');

  if (!checkGitignore()) {
    console.log('⚠️  .env is not in .gitignore — add it to avoid committing your token');
  }

  const mcpUrl = getMcpEndpoint(sonarUrl);
  console.log(`\n🔌 MCP server name: ${serverName}`);
  console.log(`   Endpoint: ${mcpUrl}\n`);
  console.log('Which AI tools would you like to configure MCP for?\n');

  const yes = a => a === '' || a.toLowerCase() === 'y' || a.toLowerCase() === 'yes';
  const doClaude   = yes(await ask(rl, '  Claude Code?  [Y/n]: '));
  const doCursor   = yes(await ask(rl, '  Cursor?       [Y/n]: '));
  const doWindsurf = yes(await ask(rl, '  Windsurf?     [Y/n]: '));

  rl.close();
  console.log('');

  let configured = 0;

  if (doClaude) {
    const configPath = path.join(process.cwd(), '.claude', 'settings.json');
    const existed = mergeMcpConfig(configPath, serverName, mcpConfigForClaude(mcpUrl, token, org));
    console.log(`✅ Claude Code: .claude/settings.json (${existed ? 'updated' : 'added'} ${serverName})`);
    configured++;
  }

  if (doCursor) {
    const configPath = path.join(process.cwd(), '.cursor', 'mcp.json');
    const existed = mergeMcpConfig(configPath, serverName, mcpConfigForCursor(mcpUrl, token, org));
    console.log(`✅ Cursor: .cursor/mcp.json (${existed ? 'updated' : 'added'} ${serverName})`);
    configured++;
  }

  if (doWindsurf) {
    const configPath = path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json');
    const existed = mergeMcpConfig(configPath, serverName, mcpConfigForWindsurf(mcpUrl, token, org));
    console.log(`✅ Windsurf: ~/.codeium/windsurf/mcp_config.json (${existed ? 'updated' : 'added'} ${serverName})`);
    configured++;
  }

  if (configured === 0) {
    console.log('ℹ️  No MCP tools configured — .env was still updated.');
  } else {
    console.log(`\n🎉 Done! ${projectName} is connected to SonarQube in ${configured} tool${configured === 1 ? '' : 's'}.`);
    console.log('   Ask your AI: "What are the current SonarQube issues in this project?"');
  }
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
sonar-init — per-project SonarQube + MCP setup

USAGE:
    sonar-init

DESCRIPTION:
    Collects or reads SonarQube credentials, writes them to .env,
    auto-fetches the organisation key from the API, and configures
    the SonarQube MCP server for Claude Code, Cursor, and/or Windsurf.

    Smart: prefills values from existing .env, only prompts for what's missing.
    Run once per project from the repo root.

MCP SERVER NAMING:
    Each project gets a unique server name based on the directory:
      my-project → my-project-sonar

CONFIG FILES WRITTEN:
    Claude Code   .claude/settings.json       (project-level)
    Cursor        .cursor/mcp.json            (project-level)
    Windsurf      ~/.codeium/windsurf/mcp_config.json  (global)

OPTIONS:
    -h, --help    Show this help message
`);
  process.exit(0);
}

sonarInit().catch(err => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});
