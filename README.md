# SonarQube Claude Tools

Claude Code slash commands for automated SonarQube analysis and issue fixing.

## Overview

This package provides two powerful command-line tools designed to work seamlessly with Claude Code:

- **`sonar-check`** - Standalone SonarQube analysis with multiple output formats
- **`sonar-fix`** - Automated SonarQube issue fixing loop for pull requests

## Installation

```bash
npm install -g sonarqube-claude-tools
```

## Setup for Claude Code

After installation, run the setup command to install slash commands:

```bash
sonar-setup
```

This automatically copies the slash command files to `~/.claude/commands/` so you can use `/sonar-fix` and `/sonar-check` in Claude Code.

## Quick Start

1. **Set environment variables:**
```bash
export SONARQUBE_URL=https://sonarcloud.io
export SONARQUBE_TOKEN=your_token_here
export SONARQUBE_PROJECT_KEY=your_project_key
```

2. **Check SonarQube issues:**
```bash
sonar-check 172  # Check PR #172
sonar-check      # Check overall project
```

3. **Auto-fix issues with Claude:**
```bash
sonar-fix 172    # Start automated fix loop for PR #172
```

## Commands

### `sonar-check`

Analyzes your project using the SonarQube API and displays results.

```bash
# Basic usage
sonar-check                    # Check overall project
sonar-check 165                # Check specific PR
sonar-check --pr 165           # Check specific PR (alternative syntax)

# Output formats
sonar-check --json             # JSON output
sonar-check --markdown         # Markdown with checkboxes
sonar-check --markdown -o issues.md  # Save to file

# Help
sonar-check --help
```

**Features:**
- Zero dependencies (uses only Node.js built-ins)
- Multiple output formats (text, JSON, markdown)
- Pull request analysis support
- Comprehensive issue reporting
- CI/CD ready with proper exit codes

### `sonar-fix`

Automated SonarQube issue fixing loop designed for Claude Code workflows.

```bash
# Basic usage
sonar-fix 172                    # Fix issues for PR #172

# Options
sonar-fix 172 --max-iterations 5     # Limit fix cycles
sonar-fix 172 --auto-commit          # Auto-commit without waiting
sonar-fix 172 --verbose              # Detailed logging

# Help
sonar-fix --help
```

**Features:**
- 🔄 Automated fix loop until all issues resolved
- 📊 Smart issue prioritization (BLOCKER → CRITICAL → MAJOR → MINOR)
- 🤖 Claude Code integration with generated fix prompts
- 📦 Auto-commit and push capabilities
- 📈 Progress tracking across iterations
- ⏱️ Timeout protection and error handling

## Configuration

### Environment Variables

Required for both commands:

```bash
SONARQUBE_URL          # Your SonarQube server URL
SONARQUBE_TOKEN        # Authentication token  
SONARQUBE_PROJECT_KEY  # Project key to analyze
```

### .env File Support

You can also create a `.env` file in your project root:

```bash
# .env
SONARQUBE_URL=https://sonarcloud.io
SONARQUBE_TOKEN=your_token_here
SONARQUBE_PROJECT_KEY=your_project_key
```

## Claude Code Integration

These tools are designed specifically for Claude Code workflows:

### Using as Slash Commands

With Claude Code, you can use these as slash commands by invoking them through the Task tool:

```
/sonar-fix 172
```

Claude will:
1. Run the fix loop
2. Receive detailed fix prompts
3. Make code changes to resolve issues
4. Commit and push changes automatically
5. Repeat until all issues are resolved

### Workflow Example

```bash
# 1. Start the fix loop
sonar-fix 172

# 2. Claude receives a prompt like:
# 🔧 SonarQube Fix Task - Iteration 1
# Issues Found: 11
# [Detailed issue list with priorities]

# 3. Claude fixes the issues

# 4. Script auto-commits and pushes

# 5. Loop continues until clean
```

## CI/CD Integration

### GitHub Actions

```yaml
- name: Check SonarQube Quality Gate
  env:
    SONARQUBE_URL: ${{ secrets.SONARQUBE_URL }}
    SONARQUBE_TOKEN: ${{ secrets.SONARQUBE_TOKEN }}
    SONARQUBE_PROJECT_KEY: ${{ secrets.SONARQUBE_PROJECT_KEY }}
  run: npx sonarqube-claude-tools sonar-check
```

### GitLab CI

```yaml
sonarqube-check:
  script:
    - npx sonarqube-claude-tools sonar-check
  variables:
    SONARQUBE_URL: ${SONARQUBE_URL}
    SONARQUBE_TOKEN: ${SONARQUBE_TOKEN}
    SONARQUBE_PROJECT_KEY: ${SONARQUBE_PROJECT_KEY}
```

## Output Examples

### Text Output (default)

```
=== SonarQube Analysis Report ===

Project: my-project
Pull Request: #172
Quality Gate: ERROR

Metrics:
  New Bugs: 2
  New Code Smells: 15
  New Vulnerabilities: 0

Issues Found (17):

  CRITICAL CODE_SMELLs (5):
    1. src/components/Dashboard.tsx:215
       Refactor this function to reduce its Cognitive Complexity
    ...

⚠️  Quality gate failed. Please review and fix the issues above.
```

### Markdown Output

```markdown
# SonarQube Analysis Report

**Project:** my-project
**Pull Request:** #172  
**Quality Gate:** ❌ ERROR

## Issues to Fix (17 total)

### 🔴 CRITICAL CODE_SMELLs (5)

#### `src/components/Dashboard.tsx`

- [ ] **Line 215** - Refactor this function to reduce its Cognitive Complexity
  - File: `src/components/Dashboard.tsx:215`
  - Rule: `javascript:S3776`
```

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| "Missing required environment variables" | Set SONARQUBE_URL, SONARQUBE_TOKEN, SONARQUBE_PROJECT_KEY |
| "PR not found" | Verify PR number and GitHub CLI access |
| "Not in a git repository" | Run from project root directory |
| "SonarCloud timeout" | Check PR status manually, may need to wait longer |

### Debug Mode

Use `--verbose` flag for detailed logging:

```bash
sonar-fix 172 --verbose
```

Logs are saved to `.sonar-fix-<pr>.log` for debugging.

## Requirements

- Node.js 14+
- Git repository
- GitHub CLI (`gh`) for PR operations
- SonarQube/SonarCloud project setup

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Links

- [SonarQube Metric Definitions](https://docs.sonarqube.org/latest/user-guide/metric-definitions/)
- [Claude Code Documentation](https://docs.anthropic.com/en/docs/claude-code)
- [GitHub CLI Documentation](https://cli.github.com/)

---

**Made for Claude Code workflows** 🤖