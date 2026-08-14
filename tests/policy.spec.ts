import { describe, expect, it } from 'vitest'
import { compileToolPolicy, globMatches } from '../src/policy.js'

describe('globMatches', () => {
  it('matches only literals and stars', () => {
    expect(globMatches('github/*', 'github/create_issue')).toBe(true)
    expect(globMatches('*/read_*', 'files/read_file')).toBe(true)
    expect(globMatches('github/create_*', 'github/delete_repo')).toBe(false)
    expect(globMatches('server/a.b', 'server/a.b')).toBe(true)
  })
})

describe('compileToolPolicy', () => {
  it('lets deny override allow', () => {
    const policy = compileToolPolicy(['github/*'], ['github/delete_*'])
    expect(policy.allows('github', 'list_issues')).toBe(true)
    expect(policy.allows('github', 'delete_repo')).toBe(false)
    expect(policy.allows('slack', 'list_messages')).toBe(false)
  })

  it('fails loud on ambiguous patterns', () => {
    expect(() => compileToolPolicy(['*'], [])).toThrow(/include/)
    expect(() => compileToolPolicy([''], [])).toThrow(/1-256/)
  })
})
