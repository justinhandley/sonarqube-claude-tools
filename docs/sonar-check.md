Run the sonar-check command to analyze SonarQube issues for a project or pull request.

Usage: /sonar-check [PR_NUMBER] [OPTIONS]

This command runs `npx -p sonarqube-claude-tools sonar-check [PR_NUMBER] [OPTIONS]` which:
- Fetches SonarQube analysis results
- Displays quality gate status and metrics
- Lists issues by severity and type

Examples:
- /sonar-check - Check overall project
- /sonar-check 9 - Check specific PR #9
- /sonar-check --json - Output in JSON format
- /sonar-check --markdown - Output in markdown format

Environment variables required (set in .env):
- SONARQUBE_URL
- SONARQUBE_TOKEN
- SONARQUBE_PROJECT_KEY