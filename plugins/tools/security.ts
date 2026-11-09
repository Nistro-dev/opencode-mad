import { existsSync, writeFileSync } from "fs"
import { join } from "path"
import { tool } from "../lib/tool"
import type { PluginContext, ToolDefinition } from "../types/enitities"

export const securityTools = (ctx: PluginContext): Record<string, ToolDefinition> => ({

  /**
   * Check pentest tools availability - for Pentester agent
   */
  pentest_check_tools: tool({
    description: `Check if pentest tools are installed on the system.
Verifies availability of: nuclei, httpx, katana, subfinder, sqlmap, nmap, curl, ffuf.
Returns which tools are available and what scan capabilities are possible.`,
    args: {},
    async execute() {
      const tools = ['nuclei', 'httpx', 'katana', 'subfinder', 'sqlmap', 'nmap', 'curl', 'ffuf']
      const available: string[] = []
      const missing: string[] = []

      for (const t of tools) {
        const result = ctx.runCommand(`${t} --version`)
        if (result.success) {
          available.push(t)
        } else {
          // Try 'which' or 'where' as fallback
          const whereResult = ctx.runCommand(process.platform === 'win32' ? `where ${t}` : `which ${t}`)
          if (whereResult.success) {
            available.push(t)
          } else {
            missing.push(t)
          }
        }
      }

      const canRunBasic = available.includes('curl') || available.includes('nmap')
      const canRunDeep = available.includes('nuclei') || available.includes('httpx')
      const canRunExploit = available.includes('sqlmap')

      ctx.logEvent("info", "Pentest tools check", { available, missing })

      return JSON.stringify({
        available,
        missing,
        canRunBasic,
        canRunDeep,
        canRunExploit,
        summary: `${available.length}/${tools.length} tools available`
      }, null, 2)
    }
  }),

  /**
   * Record pentest scan results - for Pentester agent
   */
  pentest_scan: tool({
    description: `Record the results of a penetration test scan.
Called by the Pentester agent after running security scans on a target.`,
    args: {
      target: tool.schema.string().describe("Target URL or IP that was scanned"),
      mode: tool.schema.enum(['basic', 'deep', 'exploit']).describe("Scan mode used"),
      riskLevel: tool.schema.enum(['low', 'medium', 'high', 'critical']).describe("Overall risk level"),
      summary: tool.schema.string().describe("Brief summary of findings"),
      findings: tool.schema.array(tool.schema.object({
        id: tool.schema.string(),
        severity: tool.schema.enum(['info', 'low', 'medium', 'high', 'critical']),
        type: tool.schema.string(),
        title: tool.schema.string(),
        description: tool.schema.string(),
        evidence: tool.schema.string().optional(),
        remediation: tool.schema.string().optional(),
      })).optional().describe("List of vulnerabilities found"),
      outputFormat: tool.schema.enum(['json', 'markdown']).optional().describe("Output format (default: json)"),
    },
    async execute(args) {
      const { target, mode, riskLevel, summary, findings, outputFormat } = args
      const gitRoot = ctx.getGitRoot()

      const findingsCount = findings?.length || 0
      const criticalCount = findings?.filter(f => f.severity === 'critical').length || 0
      const highCount = findings?.filter(f => f.severity === 'high').length || 0

      const scanResult = {
        timestamp: new Date().toISOString(),
        target,
        mode,
        riskLevel,
        summary,
        findings: findings || [],
        stats: {
          total: findingsCount,
          critical: criticalCount,
          high: highCount,
          medium: findings?.filter(f => f.severity === 'medium').length || 0,
          low: findings?.filter(f => f.severity === 'low').length || 0,
          info: findings?.filter(f => f.severity === 'info').length || 0,
        }
      }

      // Save scan results
      const scanFile = join(gitRoot, `.pentest-scan-${Date.now()}.json`)
      writeFileSync(scanFile, JSON.stringify(scanResult, null, 2))

      ctx.logEvent("info", "Pentest scan recorded", { target, mode, riskLevel, findingsCount })

      if (outputFormat === 'markdown') {
        let md = `# Pentest Scan Report\n\n`
        md += `**Target:** ${target}\n`
        md += `**Mode:** ${mode}\n`
        md += `**Risk Level:** ${riskLevel}\n`
        md += `**Summary:** ${summary}\n\n`
        md += `## Statistics\n`
        md += `- Critical: ${criticalCount}\n`
        md += `- High: ${highCount}\n`
        md += `- Total: ${findingsCount}\n`
        return md
      }

      return `Pentest: ${riskLevel} | ${findingsCount} findings (${criticalCount} critical, ${highCount} high)`
    }
  }),

  /**
   * Security scan - for Security agent
   */
  security_scan: tool({
    description: `Submit a security scan report for a worktree or the main project.
Called by the Security agent after scanning for vulnerabilities.`,
    args: {
      target: tool.schema.string().describe("Worktree name or 'main' for main project"),
      riskLevel: tool.schema.enum(['low', 'medium', 'high', 'critical']).describe("Overall risk level"),
      summary: tool.schema.string().describe("Brief summary of findings"),
      vulnerabilities: tool.schema.array(tool.schema.object({
        id: tool.schema.string(),
        severity: tool.schema.enum(['low', 'medium', 'high', 'critical']),
        type: tool.schema.string(),
        file: tool.schema.string().optional(),
        line: tool.schema.number().optional(),
        description: tool.schema.string(),
        remediation: tool.schema.string(),
      })).optional().describe("List of vulnerabilities found"),
      dependencyIssues: tool.schema.array(tool.schema.object({
        package: tool.schema.string(),
        severity: tool.schema.string(),
        cve: tool.schema.string().optional(),
        fix: tool.schema.string(),
      })).optional().describe("Vulnerable dependencies"),
    },
    async execute(args) {
      const { target, riskLevel, summary, vulnerabilities, dependencyIssues } = args
      const gitRoot = ctx.getGitRoot()

      const vulnCount = vulnerabilities?.length || 0
      const depCount = dependencyIssues?.length || 0
      const canMerge = riskLevel === 'low' || (riskLevel === 'medium' && (!vulnerabilities || vulnerabilities.filter(v => v.severity === 'critical' || v.severity === 'high').length === 0))

      // Save if worktree
      if (target !== 'main') {
        const worktreePath = join(gitRoot, "worktrees", target)
        if (existsSync(worktreePath)) {
          writeFileSync(join(worktreePath, '.agent-security'), `${riskLevel}: ${summary}`)
        }
      }

      ctx.logEvent("info", "Security scan completed", { target, riskLevel, vulnCount })

      return `Security: ${riskLevel} (${vulnCount} vulns, ${depCount} deps)`
    }
  }),
} as unknown as Record<string, ToolDefinition>)
