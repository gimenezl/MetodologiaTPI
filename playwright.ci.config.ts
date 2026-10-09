import { defineConfig } from '@playwright/test'
import original from './playwright.config'
import { coreTitles, fullProjects, uiFiles } from './scripts/ci/ui.mjs'

const full = process.env.CI_MODE === 'full'
const selection: unknown = JSON.parse(process.env.CI_UI ?? '[]')
if (!Array.isArray(selection) || !selection.length || !selection.every(s => typeof s === 'string')) {
  throw new Error('Se exige una selección UI explícita y no vacía')
}
const files = uiFiles(selection)
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const projects = original.projects ?? []
const fullProject = process.env.CI_PROJECT ?? ''
if (full && !fullProjects.includes(fullProject)) throw new Error('Proyecto completo no registrado')
export default defineConfig({
  ...original,
  retries: 0,
  workers: 1,
  globalTimeout: full ? 20 * 60_000 : 5 * 60_000,
  use: { ...original.use, trace: 'off', screenshot: 'off', video: 'off' },
  webServer: original.webServer && !Array.isArray(original.webServer)
    ? { ...original.webServer, reuseExistingServer: false } : original.webServer,
  projects: full ? projects.filter(p => p.name === fullProject || p.name === 'setup') : [
    ...projects.filter(p => p.name === 'setup'),
    ...projects.filter(p => p.name?.startsWith('chromium') && files.length).map(p => ({
      ...p, testMatch: new RegExp(`(?:^|/)(?:${files.map(escape).join('|')})$`),
    })),
    ...projects.filter(p => p.name && p.name in coreTitles).map(p => ({
      ...p, name: `core-${p.name}`, testMatch: p.name === 'chromium'
        ? /niveles-ui\.spec\.ts$/ : /usuarios-permisos-auth\.spec\.ts$/,
      grep: new RegExp(`${p.grep instanceof RegExp ? `(?=.*${p.grep.source})` : ''}(?=.*${escape(coreTitles[p.name as keyof typeof coreTitles])})`),
    })),
  ],
})
