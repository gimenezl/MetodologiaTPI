import { writeFileSync } from 'node:fs'
import { coreTitles, uiFiles } from './ui.mjs'
import { declaredOmission } from './omissions.mjs'

// Solo contadores y revisión: nunca persistir estados de sesión, cuerpos o traces.
export default class Reporter {
  onBegin(_config, suite) {
    this.expected = suite.allTests().length
    this.selected = suite.allTests().filter(t => t.parent.project()?.name !== 'setup').length
    this.covered = process.env.CI_MODE === 'full' || uiFiles(JSON.parse(process.env.CI_UI ?? '[]'))
      .every(file => suite.allTests().some(t => t.location.file.replaceAll('\\', '/').endsWith(`/${file}`)))
    if (process.env.CI_MODE !== 'full') this.covered &&= Object.keys(coreTitles)
      .every(name => suite.allTests().some(t => t.parent.project()?.name === `core-${name}`))
    this.completed = 0; this.skipped = 0; this.omissions = []; this.invalid = false; this.executedCases = 0
    this.executedFiles = new Set(); this.executedProjects = new Set()
  }
  onTestEnd(test, result) {
    this.completed++
    if (result.status === 'skipped') {
      this.skipped++; const omission = declaredOmission(test)
      if (omission) this.omissions.push(omission); else this.invalid = true
    } else if (result.status === test.expectedStatus && ['passed', 'failed'].includes(result.status)) {
      this.executedFiles.add(test.location.file.replaceAll('\\', '/').split('/').pop())
      this.executedProjects.add(test.parent.project()?.name)
      if (test.parent.project()?.name !== 'setup') this.executedCases++
    } else this.invalid = true
  }
  onEnd(result) {
    const listed = process.env.CI_LIST === '1'
    const executed = process.env.CI_MODE === 'full' || (uiFiles(JSON.parse(process.env.CI_UI ?? '[]'))
      .every(f => this.executedFiles.has(f)) && Object.keys(coreTitles).every(p => this.executedProjects.has(`core-${p}`)))
    const ok = this.selected > 0 && this.covered && (listed || (result.status === 'passed'
      && this.completed === this.expected && this.executedCases > 0 && !this.invalid && executed))
    writeFileSync('ci-ui-result.json', JSON.stringify({ sha: process.env.CI_HEAD_SHA,
      listed, expected: this.expected, selected: this.selected, completed: this.completed,
      skipped: this.skipped, executedCases: this.executedCases, omissions: this.omissions, status: ok ? 'passed' : 'failed' }))
    return { status: ok ? 'passed' : 'failed' }
  }
}
