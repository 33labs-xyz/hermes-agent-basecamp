import { describe, expect, it, vi } from 'vitest'

import { KNOWLEDGE_ACCEPT, classifyKnowledgeFile, extractKnowledgeText } from './knowledge-files'

function fakeFile(name: string, type = '', bytes = new Uint8Array([0x68, 0x69])): File {
  return new File([bytes], name, { type })
}

describe('classifyKnowledgeFile', () => {
  it('classifies markdown and plain text as text', () => {
    expect(classifyKnowledgeFile('notes.md', 'text/markdown')).toBe('text')
    expect(classifyKnowledgeFile('readme.txt', 'text/plain')).toBe('text')
  })

  it('classifies data and code files as text', () => {
    expect(classifyKnowledgeFile('rows.csv', 'text/csv')).toBe('text')
    expect(classifyKnowledgeFile('config.yaml', '')).toBe('text')
    expect(classifyKnowledgeFile('index.ts', '')).toBe('text')
    expect(classifyKnowledgeFile('main.py', '')).toBe('text')
    expect(classifyKnowledgeFile('page.html', 'text/html')).toBe('text')
    expect(classifyKnowledgeFile('data.json', 'application/json')).toBe('text')
  })

  it('classifies pdf and docx by their own kinds', () => {
    expect(classifyKnowledgeFile('brief.pdf', 'application/pdf')).toBe('pdf')
    expect(classifyKnowledgeFile('brief.PDF', '')).toBe('pdf')
    expect(classifyKnowledgeFile('spec.docx', '')).toBe('docx')
  })

  it('classifies images as their own kind, since only their text is read', () => {
    expect(classifyKnowledgeFile('screenshot.png', 'image/png')).toBe('image')
    expect(classifyKnowledgeFile('scan.JPG', '')).toBe('image')
    expect(classifyKnowledgeFile('shot.webp', 'image/webp')).toBe('image')
  })

  it('rejects binaries that cannot become prompt text', () => {
    expect(classifyKnowledgeFile('clip.mp4', 'video/mp4')).toBe('unsupported')
    expect(classifyKnowledgeFile('archive.zip', 'application/zip')).toBe('unsupported')
    expect(classifyKnowledgeFile('legacy.doc', '')).toBe('unsupported')
  })

  it('trusts an unknown extension when the mime type is text/*', () => {
    expect(classifyKnowledgeFile('notes.whatever', 'text/plain')).toBe('text')
  })

  it('offers an accept string covering every supported kind', () => {
    for (const ext of ['.md', '.txt', '.csv', '.json', '.yaml', '.ts', '.py', '.pdf', '.docx', '.png', '.jpg']) {
      expect(KNOWLEDGE_ACCEPT).toContain(ext)
    }
    expect(KNOWLEDGE_ACCEPT).not.toContain('.mp4')
  })
})

describe('extractKnowledgeText', () => {
  it('reads text files directly', async () => {
    const text = await extractKnowledgeText(fakeFile('notes.md', 'text/markdown'))
    expect(text).toBe('hi')
  })

  it('routes pdf files through the pdf extractor', async () => {
    const readPdf = vi.fn().mockResolvedValue('pdf body')
    const text = await extractKnowledgeText(fakeFile('brief.pdf', 'application/pdf'), { readDocx: vi.fn(), readPdf })
    expect(text).toBe('pdf body')
    expect(readPdf).toHaveBeenCalledOnce()
  })

  it('routes docx files through the docx extractor', async () => {
    const readDocx = vi.fn().mockResolvedValue('docx body')
    const text = await extractKnowledgeText(fakeFile('spec.docx'), { readDocx, readPdf: vi.fn() })
    expect(text).toBe('docx body')
    expect(readDocx).toHaveBeenCalledOnce()
  })

  it('routes images through the image extractor', async () => {
    const readImage = vi.fn().mockResolvedValue('invoice total 42')
    const text = await extractKnowledgeText(fakeFile('screenshot.png', 'image/png'), {
      readDocx: vi.fn(),
      readImage,
      readPdf: vi.fn()
    })
    expect(text).toBe('invoice total 42')
    expect(readImage).toHaveBeenCalledOnce()
  })

  it('throws when an image holds no readable text', async () => {
    const readImage = vi.fn().mockResolvedValue('')
    await expect(
      extractKnowledgeText(fakeFile('photo.png', 'image/png'), { readDocx: vi.fn(), readImage, readPdf: vi.fn() })
    ).rejects.toThrow(/no text/i)
  })

  it('throws UnsupportedKnowledgeFileError for binaries', async () => {
    await expect(extractKnowledgeText(fakeFile('clip.mp4', 'video/mp4'))).rejects.toThrow(/unsupported/i)
  })

  it('throws when an extractor yields nothing usable', async () => {
    const readPdf = vi.fn().mockResolvedValue('   \n  ')
    await expect(
      extractKnowledgeText(fakeFile('scan.pdf', 'application/pdf'), { readDocx: vi.fn(), readPdf })
    ).rejects.toThrow(/no text/i)
  })
})
