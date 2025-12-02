#!/usr/bin/env node
'use strict'

const { exec, spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const util = require('util')
const execPromise = util.promisify(exec)

const TEMP_DIR = '.temp-review'

/**
 * Claude Slash Command: /sonar-fix
 *
 * Automated SonarQube issue fixing loop for Pull Requests
 *
 * This script:
 * 1. Monitors PR checks until SonarCloud completes
 * 2. Runs SonarQube analysis to identify issues
 * 3. Provides actionable fix recommendations
 * 4. Waits for Claude to fix issues
 * 5. Commits and pushes changes
 * 6. Repeats until all issues are resolved or max iterations reached
 *
 * Usage:
 *   /sonar-fix <pr-number> [options]
 *
 * Examples:
 *   /sonar-fix 172                    # Fix all SonarQube issues for PR #172
 *   /sonar-fix 172 --max-iterations 5 # Limit to 5 fix cycles
 *   /sonar-fix 172 --auto-commit      # Auto-commit after each fix
 */

class SonarFixCommand {
  constructor(prNumber, options = {}) {
    this.prNumber = prNumber
    this.maxIterations = options.maxIterations || 10
    this.autoCommit = options.autoCommit || false
    this.verbose = options.verbose || false
    this.iteration = 0
    this.fixedIssues = []
    this.tempDir = TEMP_DIR
    this.statusFile = path.join(TEMP_DIR, `sonar-fix-${prNumber}.json`)
    this.logFile = path.join(TEMP_DIR, `sonar-fix-${prNumber}.log`)
    this.issuesFile = path.join(TEMP_DIR, `sonar-issues-${prNumber}.md`)
    this.promptFile = path.join(TEMP_DIR, `claude-fix-prompt-${prNumber}.md`)

    // Ensure temp directory exists
    this.ensureTempDir()

    // Clean up any previous runs
    this.cleanup()
  }

  ensureTempDir() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true })
    }
  }

  log(message, level = 'info') {
    const timestamp = new Date().toISOString()
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`

    if (this.verbose || level === 'error' || level === 'success') {
      console.log(message)
    }

    fs.appendFileSync(this.logFile, logMessage + '\n')
  }

  async saveStatus() {
    const status = {
      prNumber: this.prNumber,
      iteration: this.iteration,
      fixedIssues: this.fixedIssues,
      timestamp: new Date().toISOString(),
      inProgress: true,
    }
    fs.writeFileSync(this.statusFile, JSON.stringify(status, null, 2))
  }

  cleanup() {
    // New temp directory files
    const tempFiles = [
      this.statusFile,
      this.logFile,
      this.issuesFile,
      this.promptFile,
      path.join(TEMP_DIR, `pr-${this.prNumber}-status.json`),
      path.join(TEMP_DIR, `pr-monitor-${this.prNumber}.pid`),
    ]

    // Legacy files (for migration cleanup)
    const legacyFiles = [
      `.sonar-fix-${this.prNumber}.json`,
      `.sonar-fix-${this.prNumber}.log`,
      `.sonar-issues-${this.prNumber}.md`,
      `.claude-fix-prompt-${this.prNumber}.md`,
      `.pr-${this.prNumber}-status.json`,
      `.pr-monitor-${this.prNumber}.pid`,
    ]

    ;[...tempFiles, ...legacyFiles].forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file)
      }
    })
  }

  async checkPrerequisites() {
    this.log('🔍 Checking prerequisites...')

    // Check if we're in a git repository
    try {
      await execPromise('git rev-parse --git-dir')
    } catch {
      throw new Error('Not in a git repository')
    }

    // Check if PR exists
    try {
      const { stdout } = await execPromise(`gh pr view ${this.prNumber} --json number`)
      const pr = JSON.parse(stdout)
      if (pr.number != this.prNumber) {
        throw new Error(`PR #${this.prNumber} not found`)
      }
    } catch (error) {
      throw new Error(`Could not access PR #${this.prNumber}: ${error.message}`)
    }

    // Check for SonarQube configuration
    if (!process.env.SONARQUBE_URL || !process.env.SONARQUBE_TOKEN) {
      this.log('⚠️  SonarQube environment variables not set', 'warn')
      this.log('  Set SONARQUBE_URL, SONARQUBE_TOKEN, and SONARQUBE_PROJECT_KEY', 'warn')
    }

    this.log('✅ Prerequisites check passed')
  }

  async waitForSonarCloud() {
    this.log('🔍 Checking if SonarCloud analysis exists...')

    try {
      // Try to run sonar-check immediately to see if results exist
      const sonarCheckPath = path.join(__dirname, 'sonar-check.js')
      const { stdout, stderr } = await execPromise(
        `node ${sonarCheckPath} ${this.prNumber} --json`,
        { timeout: 30000 } // 30 second timeout for direct check
      )

      // If we get here, analysis exists
      this.log('✅ SonarCloud analysis found')
      return true
    } catch (error) {
      // If 404 or analysis not found, wait for GitHub checks
      if (error.message.includes('404') || error.message.includes('not found')) {
        this.log('⏳ SonarCloud analysis not found, waiting for completion...')
        
        return new Promise(resolve => {
          const checkInterval = setInterval(async () => {
            try {
              const { stdout } = await execPromise(`gh pr checks ${this.prNumber} --json name,state`)
              const checks = JSON.parse(stdout)

              const sonarCheck = checks.find(c => c.name === 'SonarCloud Code Analysis')

              if (sonarCheck && (sonarCheck.state === 'success' || sonarCheck.state === 'failure')) {
                clearInterval(checkInterval)
                this.log(`✅ SonarCloud analysis complete: ${sonarCheck.state}`)
                resolve(sonarCheck.state === 'success')
              }
            } catch (error) {
              this.log(`Error checking PR status: ${error.message}`, 'error')
            }
          }, 15000) // Check every 15 seconds

          // Timeout after 8 minutes
          setTimeout(() => {
            clearInterval(checkInterval)
            this.log('⏱️ Timeout waiting for SonarCloud', 'warn')
            resolve(false)
          }, 480000)
        })
      } else {
        this.log(`Error checking SonarCloud: ${error.message}`, 'error')
        return false
      }
    }
  }

  async runSonarQubeCheck() {
    this.log('🔍 Running SonarQube analysis...')

    try {
      // Delete any existing markdown file to ensure fresh data
      const markdownFile = `.sonar-issues-${this.prNumber}.md`
      if (fs.existsSync(markdownFile)) {
        fs.unlinkSync(markdownFile)
        this.log(`🗑️ Removed old markdown file: ${markdownFile}`)
      }

      // Use the bundled sonar-check.js from the same directory
      const sonarCheckPath = path.join(__dirname, 'sonar-check.js')
      let stdout, stderr
      
      try {
        const result = await execPromise(
          `node ${sonarCheckPath} ${this.prNumber} --markdown -o ${this.issuesFile}`,
        )
        stdout = result.stdout
        stderr = result.stderr
      } catch (execError) {
        // Capture output even if command exits with error code
        stdout = execError.stdout || ''
        stderr = execError.stderr || ''
      }

      // Read the markdown file directly to get accurate issue count
      const markdownFile = this.issuesFile
      let issueCount = 0
      
      if (fs.existsSync(markdownFile)) {
        const fileContent = fs.readFileSync(markdownFile, 'utf8')
        const issueMatch = fileContent.match(/Issues to Fix \((\d+) total\)/)
        issueCount = issueMatch ? parseInt(issueMatch[1]) : 0
        console.log(`\n🔍 SONAR ANALYSIS COMPLETE`)
        console.log(`   Issues detected from file: ${issueCount}`)
        console.log(`   Markdown file size: ${fileContent.length} chars`)
        console.log(`   Stdout length: ${stdout.length} chars\n`)
      } else {
        // Fallback to parsing stdout if no file exists
        let issueMatch = stdout.match(/Issues to Fix \((\d+) total\)/)
        if (!issueMatch) {
          issueMatch = stdout.match(/Issues Found \((\d+)\)/)
        }
        if (!issueMatch) {
          issueMatch = stdout.match(/(\d+) total/)
        }
        issueCount = issueMatch ? parseInt(issueMatch[1]) : 0
        console.log(`\n🔍 SONAR ANALYSIS COMPLETE`)
        console.log(`   Issues detected from stdout: ${issueCount}`)
        console.log(`   No markdown file found`)
        console.log(`   Stdout length: ${stdout.length} chars\n`)
      }

      if (stderr && !stderr.includes('Quality gate failed')) {
        this.log(`Warning: ${stderr}`, 'warn')
      }

      this.log(`📊 Found ${issueCount} issues`)
      // Always fix issues if any exist, regardless of quality gate status
      return { success: issueCount === 0, issueCount, output: stdout }
    } catch (error) {
      this.log(`Error running SonarQube check: ${error.message}`, 'error')
      throw error
    }
  }

  async generateFixPrompt(issueCount) {
    let issuesContent = ''

    console.log(`\n📋 LOOKING FOR ISSUES FILE: ${this.issuesFile}`)
    console.log(`   File exists: ${fs.existsSync(this.issuesFile)}`)

    if (fs.existsSync(this.issuesFile)) {
      issuesContent = fs.readFileSync(this.issuesFile, 'utf8')
      console.log(`   File size: ${issuesContent.length} chars`)
      console.log(`   Contains issues: ${issuesContent.includes('Issues to Fix')}`)
    } else {
      console.log(`   ❌ Issues file not found!`)
    }

    const prompt = `
# 🔧 SonarQube Fix Task - Iteration ${this.iteration + 1}

## PR Information
- **PR Number:** #${this.prNumber}
- **Issues Found:** ${issueCount}
- **Previous Iterations:** ${this.iteration}
- **Issues Fixed So Far:** ${this.fixedIssues.length}

## Your Task
Please fix the SonarQube issues identified below. Focus on:
1. **BLOCKER** issues first (if any)
2. **CRITICAL** issues second
3. **MAJOR** issues third
4. **MINOR** and **INFO** issues last

## Important Guidelines
- **DO NOT** break existing functionality
- **DO NOT** make risky refactoring for cognitive complexity issues
- **DO** fix clear issues like:
  - Unsafe error handling
  - Missing error details in catch blocks
  - Incorrect loop variable usage
  - Unnecessary type assertions
  - Empty catch blocks

## Issues to Fix

${issuesContent}

## When Complete
After fixing the issues, I will:
1. Run tests to ensure nothing is broken
2. Commit your changes with a descriptive message
3. Push to the PR branch
4. Wait for SonarCloud to re-analyze
5. Check if more issues remain

Please proceed with fixing the issues above.
`

    fs.writeFileSync(this.promptFile, prompt)

    this.log('📝 Fix prompt generated and saved to ' + this.promptFile)
    return prompt
  }

  async commitAndPush(message) {
    this.log('📦 Committing and pushing changes...')

    try {
      // Check if there are changes to commit
      const { stdout: statusOut } = await execPromise('git status --porcelain')
      if (!statusOut.trim()) {
        this.log('No changes to commit', 'warn')
        return false
      }

      // Add all changes
      await execPromise('git add -A')

      // Commit with message
      const commitMessage =
        message ||
        `fix: resolve SonarQube issues (iteration ${this.iteration + 1})

- Automated fix for PR #${this.prNumber}
- Fixed ${this.fixedIssues.length} issues in total

🤖 Generated with Claude Code

Co-Authored-By: Claude <noreply@anthropic.com>`

      await execPromise(`git commit -m "${commitMessage}"`)

      // Push changes
      await execPromise('git push')

      this.log('✅ Changes committed and pushed')
      return true
    } catch (error) {
      this.log(`Error committing changes: ${error.message}`, 'error')
      return false
    }
  }

  async runFixLoop() {
    this.log(`🚀 Starting SonarQube fix loop for PR #${this.prNumber}`)
    this.log(`   Max iterations: ${this.maxIterations}`)
    this.log(`   Auto-commit: ${this.autoCommit}`)

    await this.checkPrerequisites()

    while (this.iteration < this.maxIterations) {
      this.iteration++
      this.log(`\n🔄 === Iteration ${this.iteration}/${this.maxIterations} ===`)

      await this.saveStatus()

      // Step 1: Wait for SonarCloud to complete
      await this.waitForSonarCloud()

      // Step 2: Run SonarQube check
      const { success, issueCount } = await this.runSonarQubeCheck()

      if (success) {
        this.log('🎉 All SonarQube issues resolved!', 'success')
        break
      }

      // Step 3: Generate fix prompt for Claude
      const prompt = await this.generateFixPrompt(issueCount)

      // Step 4: Output prompt for Claude to see
      console.log('\n' + '='.repeat(80))
      console.log('📋 CLAUDE: Please fix the following issues:')
      console.log('='.repeat(80))
      console.log(prompt)
      console.log('='.repeat(80))
      console.log(
        '⏸️ Waiting for fixes... When done, type "continue" or the script will auto-detect changes',
      )
      console.log('='.repeat(80) + '\n')

      // Step 5: Wait for Claude to fix issues (or auto-detect file changes)
      if (!this.autoCommit) {
        await this.waitForFixes()
      }

      // Step 6: Commit and push if there are changes
      const committed = await this.commitAndPush()

      if (!committed && !this.autoCommit) {
        this.log('No changes detected. Waiting for manual intervention...', 'warn')
        break
      }

      // Step 7: Wait a bit for GitHub to process the push
      this.log('⏳ Waiting for GitHub to process changes...')
      await new Promise(resolve => setTimeout(resolve, 10000))
    }

    if (this.iteration >= this.maxIterations) {
      this.log(`⚠️ Reached maximum iterations (${this.maxIterations})`, 'warn')
    }

    // Final summary
    await this.printSummary()

    // Cleanup
    this.cleanup()
  }

  async waitForFixes() {
    return new Promise(resolve => {
      this.log('⏸️ Waiting for file changes or user input...')

      // Watch for file changes in relevant directories
      const watcher = fs.watch(process.cwd(), { recursive: true }, (eventType, filename) => {
        if (
          filename &&
          (filename.endsWith('.js') || filename.endsWith('.ts')) &&
          !filename.includes('node_modules') &&
          !filename.startsWith('.')
        ) {
          this.log(`📝 Detected change in ${filename}`)
          clearTimeout(timeout)
          watcher.close()
          resolve()
        }
      })

      // Also listen for user input
      process.stdin.resume()
      process.stdin.once('data', () => {
        clearTimeout(timeout)
        watcher.close()
        resolve()
      })

      // Timeout after 10 minutes
      const timeout = setTimeout(() => {
        this.log('⏱️ Timeout waiting for fixes', 'warn')
        watcher.close()
        resolve()
      }, 600000)
    })
  }

  async printSummary() {
    this.log('\n' + '='.repeat(80), 'success')
    this.log('📊 FIX LOOP SUMMARY', 'success')
    this.log('='.repeat(80), 'success')
    this.log(`   PR Number: #${this.prNumber}`, 'success')
    this.log(`   Iterations: ${this.iteration}`, 'success')
    this.log(`   Issues Fixed: ${this.fixedIssues.length}`, 'success')

    // Get final status
    try {
      const { stdout } = await execPromise(`gh pr checks ${this.prNumber} --json name,state`)
      const checks = JSON.parse(stdout)
      const sonarCheck = checks.find(c => c.name === 'SonarCloud Code Analysis')

      if (sonarCheck) {
        this.log(
          `   Final Status: ${sonarCheck.state === 'success' ? '✅ PASSING' : '❌ FAILING'}`,
          'success',
        )
      }
    } catch {
      // Ignore errors in final status check
    }

    this.log('='.repeat(80), 'success')
    this.log(`\nLog saved to: ${this.logFile}`, 'success')
  }
}

async function main() {
  const args = process.argv.slice(2)

  // Handle help
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Claude Slash Command: /sonar-fix

Automated SonarQube issue fixing loop for Pull Requests

Usage: /sonar-fix <pr-number> [options]

Options:
  --max-iterations <n>  Maximum number of fix cycles (default: 10)
  --auto-commit        Automatically commit changes without waiting
  --verbose            Show detailed logging
  --help, -h           Show this help message

Examples:
  /sonar-fix 172                        # Fix issues for PR #172
  /sonar-fix 172 --max-iterations 5     # Limit to 5 iterations
  /sonar-fix 172 --auto-commit          # Auto-commit mode
  /sonar-fix 172 --verbose              # Detailed output

How it works:
1. Monitors PR checks until SonarCloud completes
2. Runs SonarQube analysis to find issues
3. Generates a fix prompt for Claude
4. Waits for fixes (file changes or user input)
5. Commits and pushes changes
6. Repeats until all issues are resolved

The command will:
- Create a detailed prompt for each iteration
- Track progress across iterations
- Provide a summary when complete
- Save logs for debugging
`)
    process.exit(0)
  }

  // Parse arguments
  const prNumber = args[0]
  if (!/^\d+$/.test(prNumber)) {
    console.error('Error: PR number must be a number')
    process.exit(1)
  }

  // Parse options
  const options = {}
  let i = 1
  while (i < args.length) {
    switch (args[i]) {
      case '--max-iterations':
        if (i + 1 < args.length) {
          options.maxIterations = parseInt(args[i + 1])
          i += 2 // Skip both the flag and its value
        } else {
          i++
        }
        break
      case '--auto-commit':
        options.autoCommit = true
        i++
        break
      case '--verbose':
        options.verbose = true
        i++
        break
      default:
        i++
        break
    }
  }

  // Run the fix loop
  try {
    const command = new SonarFixCommand(prNumber, options)
    await command.runFixLoop()
  } catch (error) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  }
}

// Support both slash command and direct execution
if (require.main === module) {
  // Check if called as slash command
  const isSlashCommand = process.argv[1].includes('sonar-fix')

  if (isSlashCommand && process.argv.length > 2 && process.argv[2].startsWith('/')) {
    // Parse slash command format: /sonar-fix 172
    const commandArgs = process.argv[2].substring(1).split(' ')
    if (commandArgs[0] === 'sonar-fix') {
      process.argv = ['node', 'sonar-fix.js', ...commandArgs.slice(1)]
    }
  }

  main().catch(error => {
    console.error('Unexpected error:', error)
    process.exit(1)
  })
}

module.exports = { SonarFixCommand }
