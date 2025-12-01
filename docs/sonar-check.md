# SonarQube Check Script

A standalone Node.js script for checking SonarQube analysis results via the SonarQube API.

## Overview

This script provides a simple, self-contained way to fetch and display SonarQube analysis results for your project. It connects directly to the SonarQube API, retrieves quality gate status, code metrics, and issues, then displays them in a formatted report.

## Features

- **Zero Dependencies**: Uses only Node.js built-in modules (no npm packages required)
- **Environment-Based Configuration**: Reads settings from `.env` file or environment variables
- **Comprehensive Reporting**: Shows quality gate status, metrics, and prioritized issues
- **CI/CD Ready**: Returns appropriate exit codes for automation
- **Portable**: Drop into any project and configure via environment variables

## Prerequisites

- Node.js (v14 or higher)
- Access to a SonarQube server
- A SonarQube authentication token
- Project already analyzed in SonarQube

## Configuration

The script requires three environment variables:

```bash
SONARQUBE_URL=https://sonarcloud.io      # Your SonarQube server URL
SONARQUBE_TOKEN=your-token-here          # Authentication token
SONARQUBE_PROJECT_KEY=your-project-key   # Project key in SonarQube
```

These can be set in:
1. A `.env` file in the project root (automatically loaded)
2. System environment variables
3. Inline when running the script

## Usage

### Basic Usage

```bash
# Check overall project quality
npm run sonar

# Direct execution
node scripts/sonarqube-check.js

# With inline environment variables
SONARQUBE_URL=https://sonarcloud.io node scripts/sonarqube-check.js
```

### Pull Request Analysis

```bash
# Check specific pull request
node scripts/sonarqube-check.js 165

# Using --pr flag
node scripts/sonarqube-check.js --pr 165

# Check PR via npm script (add to package.json)
npm run sonar -- 165
```

### Help

```bash
node scripts/sonarqube-check.js --help
```

## Output

The script displays:

1. **Quality Gate Status**: Overall pass/fail status
2. **Code Metrics**: 
   - Bug count
   - Vulnerabilities
   - Code smells
   - Coverage percentage
   - Duplicated lines density
3. **Issues Summary**: Grouped by severity and type
   - Shows first 5 issues of each category
   - Includes file location and issue description

Example output:
```
=== SonarQube Analysis Report ===

Project: my-project
Quality Gate: OK

Metrics:
  Bugs: 12
  Code Smells: 233
  Duplicated Lines Density: 0.3
  Vulnerabilities: 0

Issues Found (189):

  BLOCKER CODE_SMELLs (2):
    - src/lib/migrations/migration.sql:15
      Avoid using quoted identifiers.
    ... and 1 more

  CRITICAL CODE_SMELLs (12):
    - src/components/Dashboard.tsx:215
      Refactor this function to reduce its Cognitive Complexity from 21 to the 15 allowed.
    ... and 7 more

=================================

✅ Quality gate passed!
```

## Exit Codes

- `0`: Quality gate passed
- `1`: Quality gate failed or error occurred

## CI/CD Integration

### GitHub Actions

```yaml
- name: Check SonarQube Quality Gate
  env:
    SONARQUBE_URL: ${{ secrets.SONARQUBE_URL }}
    SONARQUBE_TOKEN: ${{ secrets.SONARQUBE_TOKEN }}
    SONARQUBE_PROJECT_KEY: ${{ secrets.SONARQUBE_PROJECT_KEY }}
  run: node scripts/sonarqube-check.js
```

### GitLab CI

```yaml
sonarqube-check:
  script:
    - node scripts/sonarqube-check.js
  variables:
    SONARQUBE_URL: ${SONARQUBE_URL}
    SONARQUBE_TOKEN: ${SONARQUBE_TOKEN}
    SONARQUBE_PROJECT_KEY: ${SONARQUBE_PROJECT_KEY}
```

### Pre-commit Hook

Add to `.git/hooks/pre-commit`:
```bash
#!/bin/sh
node scripts/sonarqube-check.js
```

## Customization

### Modifying Metrics

Edit the `getMeasures` method to change which metrics are fetched:

```javascript
getMeasures(metrics = ['bugs', 'vulnerabilities', 'code_smells', 'coverage', 'duplicated_lines_density'])
```

Available metrics: https://docs.sonarqube.org/latest/user-guide/metric-definitions/

### Adjusting Issue Filters

Edit the `getIssues` method to change severity/type filters:

```javascript
getIssues(
  types = ['BUG', 'VULNERABILITY', 'CODE_SMELL'], 
  severities = ['BLOCKER', 'CRITICAL', 'MAJOR']
)
```

## Troubleshooting

### Missing Environment Variables

If you see:
```
Missing required environment variables:
  - SONARQUBE_URL
  - SONARQUBE_TOKEN
  - SONARQUBE_PROJECT_KEY
```

Ensure your `.env` file exists and contains the required variables.

### Authentication Failed

If you get HTTP 401 errors, verify:
1. Your token is valid and not expired
2. The token has permissions to access the project
3. The token format is correct (no extra spaces or quotes)

### Project Not Found

If you get HTTP 404 errors:
1. Verify the project key is correct
2. Ensure the project has been analyzed at least once
3. Check that your token has access to the project

### Connection Issues

For connection errors:
1. Verify the SONARQUBE_URL is correct
2. Check network connectivity to the SonarQube server
3. Ensure any required proxy settings are configured

## Security Notes

- Never commit the `.env` file containing tokens
- Use secrets management in CI/CD environments
- Rotate tokens regularly
- Use read-only tokens when possible

## License

This script is part of the project and follows the project's license.