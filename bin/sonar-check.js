#!/usr/bin/env node
'use strict';

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

function loadEnvFile() {
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith('#')) {
        const [key, ...valueParts] = trimmedLine.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').trim();
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      }
    });
  }
}

loadEnvFile();

class SonarQubeClient {
  constructor(pullRequest = null, options = {}) {
    this.baseUrl = process.env.SONARQUBE_URL;
    this.token = process.env.SONARQUBE_TOKEN;
    this.projectKey = process.env.SONARQUBE_PROJECT_KEY;
    this.pullRequest = pullRequest;
    this.outputFormat = options.format || 'text';
    this.outputFile = options.outputFile;

    if (!this.baseUrl || !this.token || !this.projectKey) {
      console.error('Missing required environment variables:');
      if (!this.baseUrl) console.error('  - SONARQUBE_URL');
      if (!this.token) console.error('  - SONARQUBE_TOKEN');
      if (!this.projectKey) console.error('  - SONARQUBE_PROJECT_KEY');
      process.exit(1);
    }

    const url = new URL(this.baseUrl);
    this.protocol = url.protocol === 'https:' ? https : http;
    this.hostname = url.hostname;
    this.port = url.port || (url.protocol === 'https:' ? 443 : 80);
    this.basePath = url.pathname.replace(/\/$/, '');
  }

  makeRequest(path, method = 'GET') {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.hostname,
        port: this.port,
        path: `${this.basePath}/api${path}`,
        method,
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'application/json'
        }
      };

      const req = this.protocol.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (parseError) {
              // If JSON parsing fails, check if data looks like JSON
              // If it does, re-throw the error. Otherwise, return raw data.
              if (data.trim().startsWith('{') || data.trim().startsWith('[')) {
                // Data looks like JSON but failed to parse - this is an actual error
                reject(new Error(`Failed to parse JSON response: ${parseError.message}`));
              } else {
                // Data is not JSON (might be plain text), return as-is
                resolve(data);
              }
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  }

  async getQualityGateStatus() {
    try {
      let url = `/qualitygates/project_status?projectKey=${encodeURIComponent(this.projectKey)}`;
      if (this.pullRequest) {
        url += `&pullRequest=${encodeURIComponent(this.pullRequest)}`;
      }
      return await this.makeRequest(url);
    } catch (error) {
      console.error('Failed to get quality gate status:', error.message);
      throw error;
    }
  }

  async getIssues(types = ['BUG', 'VULNERABILITY', 'CODE_SMELL'], severities = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'], pageSize = 500) {
    try {
      let url;
      
      if (this.pullRequest) {
        // For PRs, get only NEW issues introduced in the PR (same as GitHub integration)
        // Exclude closed issues (including those from excluded files marked as REMOVED)
        url = `/issues/search?componentKeys=${encodeURIComponent(this.projectKey)}&pullRequest=${encodeURIComponent(this.pullRequest)}&inNewCodePeriod=true&statuses=OPEN,CONFIRMED,REOPENED&ps=${pageSize}&additionalFields=_all`;
      } else {
        const typesParam = types.join(',');
        const severitiesParam = severities.join(',');
        url = `/issues/search?componentKeys=${encodeURIComponent(this.projectKey)}&types=${typesParam}&severities=${severitiesParam}&ps=${pageSize}&additionalFields=_all`;
      }
      
      const result = await this.makeRequest(url);
      
      // Debug logging for PR issue detection
      if (this.pullRequest) {
        console.log(`\n🔍 DEBUG: SonarCloud API Response for PR #${this.pullRequest}:`);
        console.log(`   URL: ${url}`);
        console.log(`   Total issues returned: ${result.total || 0}`);
        console.log(`   Issues array length: ${result.issues ? result.issues.length : 0}`);
        if (result.issues && result.issues.length > 0) {
          console.log(`   First issue: ${result.issues[0].message} (${result.issues[0].severity})`);
        }
      }
      
      // If we hit the page size limit, fetch remaining pages
      if (result.total > pageSize) {
        const totalPages = Math.ceil(result.total / pageSize);
        for (let page = 2; page <= totalPages; page++) {
          const pageUrl = `${url}&p=${page}`;
          const pageResult = await this.makeRequest(pageUrl);
          result.issues = result.issues.concat(pageResult.issues);
        }
      }
      
      return result;
    } catch (error) {
      console.error('Failed to get issues:', error.message);
      throw error;
    }
  }

  async getMeasures(metrics = ['bugs', 'vulnerabilities', 'code_smells', 'coverage', 'duplicated_lines_density', 'new_bugs', 'new_vulnerabilities', 'new_code_smells', 'new_coverage', 'new_duplicated_lines_density']) {
    try {
      const metricsParam = metrics.join(',');
      let url = `/measures/component?component=${encodeURIComponent(this.projectKey)}&metricKeys=${metricsParam}`;
      
      if (this.pullRequest) {
        url += `&pullRequest=${encodeURIComponent(this.pullRequest)}`;
      }
      
      return await this.makeRequest(url);
    } catch (error) {
      console.error('Failed to get measures:', error.message);
      throw error;
    }
  }

  formatIssue(issue) {
    // Extract line number from textRange or line field
    const line = issue.textRange?.startLine || issue.line || '?';
    
    return {
      severity: issue.severity,
      type: issue.type,
      message: issue.message,
      component: issue.component.replace(`${this.projectKey}:`, ''),
      line: line,
      effort: issue.effort,
      status: issue.status,
      rule: issue.rule
    };
  }

  printReport(qualityGate, measures, issues) {
    console.log('\n=== SonarQube Analysis Report ===\n');
    
    console.log(`Project: ${this.projectKey}`);
    if (this.pullRequest) {
      console.log(`Pull Request: #${this.pullRequest}`);
    }
    console.log(`Quality Gate: ${qualityGate?.projectStatus?.status || 'UNKNOWN'}\n`);

    if (measures?.component?.measures) {
      const prMetrics = this.pullRequest ? ['new_bugs', 'new_vulnerabilities', 'new_code_smells', 'new_coverage', 'new_duplicated_lines_density'] : [];
      const mainMetrics = ['bugs', 'vulnerabilities', 'code_smells', 'coverage', 'duplicated_lines_density'];
      
      const relevantMetrics = this.pullRequest ? prMetrics : mainMetrics;
      const filteredMeasures = measures.component.measures.filter(m => 
        relevantMetrics.some(metric => m.metric === metric)
      );
      
      if (filteredMeasures.length > 0) {
        console.log(this.pullRequest ? 'New Code Metrics:' : 'Metrics:');
        filteredMeasures.forEach(measure => {
          const metricName = measure.metric.replace(/^new_/, '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          const value = measure.value !== undefined ? measure.value : '0';
          console.log(`  ${metricName}: ${value}`);
        });
        console.log('');
      }
    }

    if (issues?.issues?.length > 0) {
      console.log(`Issues Found (${issues.total || issues.issues.length}):`);
      
      const groupedIssues = {};
      issues.issues.forEach(issue => {
        const key = `${issue.severity} ${issue.type}`;
        if (!groupedIssues[key]) {
          groupedIssues[key] = [];
        }
        groupedIssues[key].push(this.formatIssue(issue));
      });

      // Sort by severity priority
      const severityOrder = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'];
      const sortedKeys = Object.keys(groupedIssues).sort((a, b) => {
        const aSeverity = a.split(' ')[0];
        const bSeverity = b.split(' ')[0];
        return severityOrder.indexOf(aSeverity) - severityOrder.indexOf(bSeverity);
      });

      sortedKeys.forEach(key => {
        console.log(`\n  ${key}s (${groupedIssues[key].length}):`);
        groupedIssues[key].forEach((issue, index) => {
          // Show all issues with full details
          console.log(`    ${index + 1}. ${issue.component}:${issue.line}`);
          console.log(`       ${issue.message}`);
          if (issue.rule) {
            console.log(`       Rule: ${issue.rule}`);
          }
        });
      });
    } else {
      console.log('No issues found!');
    }

    console.log('\n=================================\n');

    return qualityGate?.projectStatus?.status === 'OK';
  }

  async runCheck() {
    try {
      if (this.outputFormat === 'text') {
        console.log('Fetching SonarQube analysis...');
      }
      
      const [qualityGate, measures, issues] = await Promise.all([
        this.getQualityGateStatus(),
        this.getMeasures(),
        this.getIssues()
      ]);

      if (this.outputFormat === 'json') {
        const jsonOutput = this.generateJSONReport(qualityGate, measures, issues);
        
        if (this.outputFile) {
          fs.writeFileSync(this.outputFile, JSON.stringify(jsonOutput, null, 2));
          console.log(`JSON report written to ${this.outputFile}`);
        } else {
          console.log(JSON.stringify(jsonOutput, null, 2));
        }
        
        process.exit(jsonOutput.qualityGate.status === 'OK' ? 0 : 1);
      } else if (this.outputFormat === 'markdown') {
        const markdownOutput = this.generateMarkdownReport(qualityGate, measures, issues);
        
        if (this.outputFile) {
          fs.writeFileSync(this.outputFile, markdownOutput);
          console.log(`Markdown report written to ${this.outputFile}`);
        } else {
          console.log(markdownOutput);
        }
        
        process.exit(qualityGate?.projectStatus?.status === 'OK' ? 0 : 1);
      } else {
        const passed = this.printReport(qualityGate, measures, issues);
        
        if (!passed) {
          console.log('⚠️  Quality gate failed. Please review and fix the issues above.');
          process.exit(1);
        } else {
          console.log('✅ Quality gate passed!');
          process.exit(0);
        }
      }
    } catch (error) {
      console.error('Error running SonarQube check:', error.message);
      process.exit(1);
    }
  }

  generateJSONReport(qualityGate, measures, issues) {
    const formattedIssues = issues?.issues?.map(issue => ({
      severity: issue.severity,
      type: issue.type,
      message: issue.message,
      file: issue.component.replace(`${this.projectKey}:`, ''),
      line: issue.textRange?.startLine || issue.line || null,
      endLine: issue.textRange?.endLine || null,
      column: issue.textRange?.startOffset || null,
      endColumn: issue.textRange?.endOffset || null,
      rule: issue.rule,
      effort: issue.effort,
      status: issue.status,
      debt: issue.debt
    })) || [];

    return {
      project: this.projectKey,
      pullRequest: this.pullRequest,
      qualityGate: {
        status: qualityGate?.projectStatus?.status || 'UNKNOWN',
        conditions: qualityGate?.projectStatus?.conditions || []
      },
      measures: measures?.component?.measures || [],
      issues: {
        total: issues?.total || 0,
        byFile: this.groupIssuesByFile(formattedIssues),
        bySeverity: this.groupIssuesBySeverity(formattedIssues),
        all: formattedIssues
      }
    };
  }

  groupIssuesByFile(issues) {
    const grouped = {};
    issues.forEach(issue => {
      if (!grouped[issue.file]) {
        grouped[issue.file] = [];
      }
      grouped[issue.file].push(issue);
    });
    return grouped;
  }

  groupIssuesBySeverity(issues) {
    const grouped = {};
    issues.forEach(issue => {
      const key = `${issue.severity}_${issue.type}`;
      if (!grouped[key]) {
        grouped[key] = {
          severity: issue.severity,
          type: issue.type,
          count: 0,
          issues: []
        };
      }
      grouped[key].count++;
      grouped[key].issues.push(issue);
    });
    return grouped;
  }

  generateMarkdownReport(qualityGate, measures, issues) {
    const timestamp = new Date().toISOString();
    const status = qualityGate?.projectStatus?.status || 'UNKNOWN';
    const statusEmoji = status === 'OK' ? '✅' : '❌';
    
    let markdown = `# SonarQube Analysis Report\n\n`;
    markdown += `**Generated:** ${timestamp}\n`;
    markdown += `**Project:** ${this.projectKey}\n`;
    if (this.pullRequest) {
      markdown += `**Pull Request:** #${this.pullRequest}\n`;
    }
    markdown += `**Quality Gate:** ${statusEmoji} ${status}\n\n`;

    // Add metrics summary
    if (measures?.component?.measures) {
      markdown += `## Metrics\n\n`;
      const prMetrics = this.pullRequest ? ['new_bugs', 'new_vulnerabilities', 'new_code_smells', 'new_coverage', 'new_duplicated_lines_density'] : [];
      const mainMetrics = ['bugs', 'vulnerabilities', 'code_smells', 'coverage', 'duplicated_lines_density'];
      const relevantMetrics = this.pullRequest ? prMetrics : mainMetrics;
      
      const filteredMeasures = measures.component.measures.filter(m => 
        relevantMetrics.some(metric => m.metric === metric)
      );
      
      if (filteredMeasures.length > 0) {
        markdown += `| Metric | Value |\n`;
        markdown += `|--------|-------|\n`;
        filteredMeasures.forEach(measure => {
          const metricName = measure.metric.replace(/^new_/, '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          const value = measure.value !== undefined ? measure.value : '0';
          markdown += `| ${metricName} | ${value} |\n`;
        });
        markdown += `\n`;
      }
    }

    // Add issues with checkboxes
    if (issues?.issues?.length > 0) {
      markdown += `## Issues to Fix (${issues.total || issues.issues.length} total)\n\n`;
      markdown += `Use the checkboxes below to track your progress fixing each issue.\n\n`;
      
      // Group and sort issues
      const formattedIssues = issues.issues.map(issue => ({
        severity: issue.severity,
        type: issue.type,
        message: issue.message,
        file: issue.component.replace(`${this.projectKey}:`, ''),
        line: issue.textRange?.startLine || issue.line || null,
        rule: issue.rule,
        effort: issue.effort
      }));

      // Sort by severity
      const severityOrder = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'];
      const groupedBySeverity = {};
      
      formattedIssues.forEach(issue => {
        const key = `${issue.severity} ${issue.type}`;
        if (!groupedBySeverity[key]) {
          groupedBySeverity[key] = [];
        }
        groupedBySeverity[key].push(issue);
      });

      const sortedKeys = Object.keys(groupedBySeverity).sort((a, b) => {
        const aSeverity = a.split(' ')[0];
        const bSeverity = b.split(' ')[0];
        return severityOrder.indexOf(aSeverity) - severityOrder.indexOf(bSeverity);
      });

      // Output issues by severity
      sortedKeys.forEach(key => {
        const [severity, type] = key.split(' ');
        const severityEmoji = this.getSeverityEmoji(severity);
        markdown += `### ${severityEmoji} ${key}s (${groupedBySeverity[key].length})\n\n`;
        
        // Group by file within each severity
        const byFile = {};
        groupedBySeverity[key].forEach(issue => {
          if (!byFile[issue.file]) {
            byFile[issue.file] = [];
          }
          byFile[issue.file].push(issue);
        });

        // Sort files alphabetically
        Object.keys(byFile).sort().forEach(file => {
          markdown += `#### \`${file}\`\n\n`;
          
          // Sort by line number within file
          byFile[file].sort((a, b) => (a.line || 0) - (b.line || 0)).forEach(issue => {
            const lineRef = issue.line ? `:${issue.line}` : '';
            markdown += `- [ ] **Line ${issue.line || '?'}** - ${issue.message}\n`;
            markdown += `  - File: \`${file}${lineRef}\`\n`;
            markdown += `  - Rule: \`${issue.rule}\`\n`;
            if (issue.effort) {
              markdown += `  - Estimated effort: ${issue.effort}\n`;
            }
            markdown += `\n`;
          });
        });
      });
    } else {
      markdown += `## ✅ No Issues Found!\n\n`;
      markdown += `All code meets quality standards.\n`;
    }

    // Add instructions
    markdown += `## How to Use This Report\n\n`;
    markdown += `1. Work through each issue from top to bottom (BLOCKER → CRITICAL → MAJOR → MINOR → INFO)\n`;
    markdown += `2. Check off each issue as you fix it using the checkboxes\n`;
    markdown += `3. The file paths include line numbers for easy navigation (e.g., \`file.ts:123\`)\n`;
    markdown += `4. Re-run the SonarQube check after fixing to verify all issues are resolved\n\n`;
    markdown += `### Quick Navigation Tips\n\n`;
    markdown += `- Click on file paths to jump directly to the issue location\n`;
    markdown += `- Use your IDE's "Go to Line" feature with the provided line numbers\n`;
    markdown += `- Focus on BLOCKER and CRITICAL issues first as they fail the quality gate\n`;

    return markdown;
  }

  getSeverityEmoji(severity) {
    switch(severity) {
      case 'BLOCKER': return '🚫';
      case 'CRITICAL': return '🔴';
      case 'MAJOR': return '🟠';
      case 'MINOR': return '🟡';
      case 'INFO': return 'ℹ️';
      default: return '❓';
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log('SonarQube Check Script');
    console.log('');
    console.log('Usage: node sonarqube-check.js [options] [pull-request-number]');
    console.log('');
    console.log('Examples:');
    console.log('  node sonarqube-check.js              # Check overall project');
    console.log('  node sonarqube-check.js 165          # Check PR #165');
    console.log('  node sonarqube-check.js --pr 165     # Check PR #165');
    console.log('  node sonarqube-check.js --json       # Output as JSON');
    console.log('  node sonarqube-check.js --markdown   # Output as Markdown with checkboxes');
    console.log('  node sonarqube-check.js --markdown -o issues.md  # Save Markdown to file');
    console.log('');
    console.log('Environment Variables (required):');
    console.log('  SONARQUBE_URL         - SonarQube server URL');
    console.log('  SONARQUBE_TOKEN       - Authentication token');
    console.log('  SONARQUBE_PROJECT_KEY - Project key to analyze');
    console.log('');
    console.log('Options:');
    console.log('  --help, -h         Show this help message');
    console.log('  --pr <number>      Check specific pull request');
    console.log('  --json             Output in JSON format');
    console.log('  --markdown, --md   Output in Markdown format with checkboxes');
    console.log('  --output, -o       Output file for JSON/Markdown format');
    process.exit(0);
  }

  let pullRequest = null;
  let outputFormat = 'text';
  let outputFile = null;
  
  // Check for --pr flag
  const prFlagIndex = args.findIndex(arg => arg === '--pr' || arg === '-pr');
  if (prFlagIndex !== -1 && args[prFlagIndex + 1]) {
    pullRequest = args[prFlagIndex + 1];
  } else if (args.length > 0 && /^\d+$/.test(args[0])) {
    // If first argument is a number, treat it as PR number
    pullRequest = args[0];
  }

  // Check for output format flags
  if (args.includes('--json')) {
    outputFormat = 'json';
  } else if (args.includes('--markdown') || args.includes('--md')) {
    outputFormat = 'markdown';
  }

  // Check for --output flag
  const outputFlagIndex = args.findIndex(arg => arg === '--output' || arg === '-o');
  if (outputFlagIndex !== -1 && args[outputFlagIndex + 1]) {
    outputFile = args[outputFlagIndex + 1];
  }

  const client = new SonarQubeClient(pullRequest, { format: outputFormat, outputFile });
  await client.runCheck();
}

if (require.main === module) {
  main().catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
}

module.exports = { SonarQubeClient };