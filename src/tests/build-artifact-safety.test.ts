import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('build artifact secret guard', () => {
  it('blocks generated dev vars from build artifacts', () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> }
    const gitignore = readFileSync(join(process.cwd(), '.gitignore'), 'utf8')

    expect(packageJson.scripts?.postbuild ?? '').toContain(
      'dist/server/.dev.vars',
    )
    expect(gitignore).toContain('dist/server/.dev.vars')
  })
})
