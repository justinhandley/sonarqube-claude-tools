# sonarqube-cli-tools

The missing link between SonarQube and your AI coding assistant.

For **browsing** SonarQube data — quality gates, metrics, security hotspots — use the [official SonarQube MCP server](https://docs.sonarsource.com/agent-centric-development-cycle/developer-tools/mcp-server/setup/sonarqube-cloud-hosted). Your AI can answer questions about your project directly.

For **fixing** pull request issues, use `/sonar-fix`. It runs an iterative loop that MCP alone can't do: fetch issues → prompt AI to fix → commit → wait for re-analysis → repeat until passing.

---

## Quick start

### 1. Install globally (once)

```bash
npx sonar-setup
```

Prompts which AI tools to install `/sonar-fix` into:

| Tool | Location |
|------|----------|
| Claude Code | `~/.claude/commands/sonar-fix.md` |
| Gemini CLI | `~/.gemini/commands/sonar-fix.md` |
| Codex CLI | `~/.agents/skills/sonar-fix/SKILL.md` |

### 2. Configure each project

Add a `.env` to your project root:

```bash
SONARQUBE_URL=https://sonarcloud.io
SONARQUBE_TOKEN=your_token_here
SONARQUBE_PROJECT_KEY=your_project_key
```

### 3. Fix a PR

```
/sonar-fix 42
```

---

## How `/sonar-fix` works

1. Waits for SonarCloud analysis to complete on the PR (up to 8 minutes)
2. Fetches issues as a structured markdown prompt, ordered by severity: BLOCKER → CRITICAL → MAJOR → MINOR → INFO
3. AI reads the issues and applies fixes
4. Commits and pushes
5. Waits for the next SonarCloud analysis
6. Repeats until the quality gate passes or `--max-iterations` is reached

**Requirements:** GitHub CLI (`gh`) must be installed and authenticated.

### Options

```bash
sonar-fix 172
sonar-fix 172 --max-iterations 5   # default: 10
sonar-fix 172 --auto-commit        # commit without pausing
sonar-fix 172 --verbose            # detailed per-step logs
sonar-fix --help
```

Logs and temp files are written to `.temp-review/` in the project root.

---

## Per-project MCP setup (`sonar-init`)

The [official SonarQube MCP server](https://docs.sonarsource.com/agent-centric-development-cycle/developer-tools/mcp-server/setup/sonarqube-cloud-hosted) gives your AI native read access to your project's issues, quality gates, metrics, and security hotspots — no slash commands needed for exploration.

`sonar-init` makes per-project MCP setup automatic. Run it once per project from the repo root:

```bash
cd my-project
npx sonar-init
```

**What it does:**

1. Reads your existing `.env` and prefills any values already set
2. Prompts for anything missing (URL, token, project key)
3. Auto-fetches your organisation key from the SonarCloud API
4. Writes all four vars to `.env`
5. Configures the SonarQube MCP server for whichever AI tools you choose

**Each project gets a unique MCP server name** derived from the directory, so there are no collisions across projects in your AI tools:

```
my-project  →  my-project-sonar
mi-core     →  mi-core-sonar
qalatra     →  qalatra-sonar
```

**Config files written:**

| Tool | File | Scope |
|------|------|-------|
| Claude Code | `.claude/settings.json` | Project |
| Cursor | `.cursor/mcp.json` | Project |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | Global |

Once configured, just ask your AI directly:
> "What are the current SonarQube issues in this project?"
> "Is the quality gate passing?"
> "Show me the security hotspots"

---

## Configuration

All commands read from environment variables or a `.env` file in the working directory.

| Variable | Description |
|----------|-------------|
| `SONARQUBE_URL` | Base URL — `https://sonarcloud.io` or your self-hosted instance |
| `SONARQUBE_TOKEN` | User or project analysis token |
| `SONARQUBE_PROJECT_KEY` | Project key as shown in SonarQube |
| `SONARQUBE_ORG` | Organisation key — required for MCP, auto-fetched by `sonar-init` |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Missing required environment variables` | Add `SONARQUBE_URL`, `SONARQUBE_TOKEN`, `SONARQUBE_PROJECT_KEY` to `.env` |
| `PR not found` | Verify the PR number and that `gh` is authenticated |
| `Not in a git repository` | Run from the project root |
| `SonarCloud timeout` | Analysis may not have completed yet — `sonar-fix` waits up to 8 minutes |
| Issue count doesn't match UI | Ensure `SONARQUBE_PROJECT_KEY` is the exact key from SonarQube, not the display name |

Use `--verbose` for detailed logs. Logs are also written to `.temp-review/sonar-fix-<pr>.log`.

---

## Requirements

- Node.js 14+
- Git repository
- SonarQube or SonarCloud project with an analysis token
- GitHub CLI (`gh`) — required for PR operations

## License

MIT
