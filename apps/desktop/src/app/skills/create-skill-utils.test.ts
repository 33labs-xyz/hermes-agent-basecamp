import { describe, expect, it } from 'vitest'

import { buildSkillMarkdown, friendlyCreateSkillError, isValidSkillSlug, slugifySkillName } from './create-skill-utils'

describe('slugifySkillName', () => {
  it('lowercases and hyphenates whitespace', () => {
    expect(slugifySkillName('Weekly Report')).toBe('weekly-report')
  })

  it('strips characters outside the allowed set', () => {
    expect(slugifySkillName('My Skill!! (v2)')).toBe('my-skill-v2')
  })

  it('collapses repeated separators and trims edges', () => {
    expect(slugifySkillName('  --Hello___World--  ')).toBe('hello___world')
  })

  it('returns empty string for all-invalid input', () => {
    expect(slugifySkillName('!!!')).toBe('')
  })
})

describe('isValidSkillSlug', () => {
  it('accepts a normal slug', () => {
    expect(isValidSkillSlug('my-skill')).toBe(true)
  })

  it('rejects empty, leading-hyphen, uppercase, and over-64-char', () => {
    expect(isValidSkillSlug('')).toBe(false)
    expect(isValidSkillSlug('-x')).toBe(false)
    expect(isValidSkillSlug('Ab')).toBe(false)
    expect(isValidSkillSlug('a'.repeat(65))).toBe(false)
  })
})

describe('buildSkillMarkdown', () => {
  it('assembles frontmatter plus body', () => {
    const md = buildSkillMarkdown({ description: 'Does X.', instructions: 'Step one.', slug: 'my-skill' })
    expect(md).toBe('---\nname: my-skill\ndescription: Does X.\n---\n\nStep one.')
  })

  it('trims surrounding whitespace on all fields', () => {
    const md = buildSkillMarkdown({ description: '  Does X.  ', instructions: '  Step one.  ', slug: 'my-skill' })
    expect(md).toBe('---\nname: my-skill\ndescription: Does X.\n---\n\nStep one.')
  })
})

describe('friendlyCreateSkillError', () => {
  it('extracts the FastAPI detail from a "400: {json}" message', () => {
    const err = new Error('400: {"detail":"Skill \'x\' already exists."}')
    expect(friendlyCreateSkillError(err, 'fallback')).toBe("Skill 'x' already exists.")
  })

  it('uses the remainder when it is not JSON', () => {
    expect(friendlyCreateSkillError(new Error('400: Bad Request'), 'fallback')).toBe('Bad Request')
  })

  it('falls back for non-Error values', () => {
    expect(friendlyCreateSkillError('nope', 'fallback')).toBe('fallback')
  })
})
