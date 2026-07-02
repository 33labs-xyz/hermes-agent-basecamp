import { describe, expect, it } from 'vitest'

import {
  buildSkillMarkdown,
  friendlyCreateSkillError,
  isValidSkillSlug,
  parseImportedSkill,
  slugifySkillName
} from './create-skill-utils'

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

describe('parseImportedSkill', () => {
  it('dumps plain text with no frontmatter into instructions', () => {
    expect(parseImportedSkill('Just do the thing.\nLine two.')).toEqual({
      instructions: 'Just do the thing.\nLine two.'
    })
  })

  it('extracts name and description from frontmatter and keeps the body', () => {
    const file = '---\nname: weekly-report\ndescription: Does X.\n---\n\nStep one.\nStep two.'
    expect(parseImportedSkill(file)).toEqual({
      name: 'weekly-report',
      description: 'Does X.',
      instructions: 'Step one.\nStep two.'
    })
  })

  it('strips surrounding single or double quotes from frontmatter values', () => {
    const file = "---\nname: \"my-skill\"\ndescription: 'Use when X.'\n---\n\nBody."
    expect(parseImportedSkill(file)).toEqual({
      name: 'my-skill',
      description: 'Use when X.',
      instructions: 'Body.'
    })
  })

  it('omits missing frontmatter keys', () => {
    const file = '---\ndescription: Does X.\n---\n\nBody.'
    expect(parseImportedSkill(file)).toEqual({
      description: 'Does X.',
      instructions: 'Body.'
    })
  })

  it('normalizes CRLF line endings from Windows files', () => {
    const file = '---\r\nname: win-skill\r\ndescription: From Windows.\r\n---\r\n\r\nBody line.'
    expect(parseImportedSkill(file)).toEqual({
      name: 'win-skill',
      description: 'From Windows.',
      instructions: 'Body line.'
    })
  })

  it('treats an unterminated frontmatter fence as plain body', () => {
    const file = '---\nname: broken\nno closing fence here'
    expect(parseImportedSkill(file)).toEqual({
      instructions: '---\nname: broken\nno closing fence here'
    })
  })

  it('keeps a colon inside a description value', () => {
    const file = '---\ndescription: Use when: the user asks.\n---\n\nBody.'
    expect(parseImportedSkill(file)).toEqual({
      description: 'Use when: the user asks.',
      instructions: 'Body.'
    })
  })
})
