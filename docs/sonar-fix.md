Run the sonar-fix command to automatically detect and fix SonarQube issues in a pull request.

Usage: /sonar-fix [PR_NUMBER] [OPTIONS]

This command runs `sonar-fix [PR_NUMBER] [OPTIONS]` which:
- Analyzes SonarQube issues for the specified PR
- Creates fix prompts for Claude to resolve issues
- Automates the commit/push cycle until issues are resolved

Examples:
- /sonar-fix 9 - Fix issues for PR #9
- /sonar-fix 9 --auto-commit - Fix with auto-commit
- /sonar-fix 9 --max-iterations 5 - Limit to 5 iterations

Environment variables required (set in .env):
- SONARQUBE_URL
- SONARQUBE_TOKEN  
- SONARQUBE_PROJECT_KEY