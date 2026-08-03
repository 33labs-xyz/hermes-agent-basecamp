// Project knowledge is injected into the agent's system prompt as plain text, so
// a file only qualifies if it can be reduced to text. Plain-text and code files
// are read directly; PDF and DOCX go through an extractor; an image goes through
// OCR, which keeps its words and drops the picture itself. Other binaries have
// nothing to inject and are rejected.

export type KnowledgeFileKind = 'docx' | 'image' | 'pdf' | 'text' | 'unsupported'

const TEXT_EXTENSIONS = [
  '.md',
  '.markdown',
  '.mdx',
  '.txt',
  '.text',
  '.log',
  '.csv',
  '.tsv',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.env',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.srt',
  '.vtt',
  '.rst',
  '.tex',
  '.sql',
  '.sh',
  '.bash',
  '.zsh',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.h',
  '.cpp',
  '.cs',
  '.php'
] as const

// The formats tesseract can read. Everything else an image picker might offer
// (heic, svg, gif) either fails to decode or holds no text worth reading.
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp'] as const

/** `accept` attribute for the knowledge file input. */
export const KNOWLEDGE_ACCEPT = [...TEXT_EXTENSIONS, '.pdf', '.docx', ...IMAGE_EXTENSIONS].join(',')

export class UnsupportedKnowledgeFileError extends Error {
  constructor(fileName: string) {
    super(`Unsupported knowledge file: ${fileName}`)
    this.name = 'UnsupportedKnowledgeFileError'
  }
}

export class EmptyKnowledgeFileError extends Error {
  constructor(fileName: string) {
    super(`No text could be read from ${fileName}`)
    this.name = 'EmptyKnowledgeFileError'
  }
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase()
}

export function classifyKnowledgeFile(fileName: string, mimeType = ''): KnowledgeFileKind {
  const extension = extensionOf(fileName)

  if (extension === '.pdf' || mimeType === 'application/pdf') {
    return 'pdf'
  }

  if (extension === '.docx') {
    return 'docx'
  }

  if ((TEXT_EXTENSIONS as readonly string[]).includes(extension)) {
    return 'text'
  }

  if ((IMAGE_EXTENSIONS as readonly string[]).includes(extension) || mimeType.startsWith('image/')) {
    return 'image'
  }

  // An unknown extension is still fine when the browser says it is text.
  if (mimeType.startsWith('text/') || mimeType === 'application/json') {
    return 'text'
  }

  return 'unsupported'
}

export interface KnowledgeExtractors {
  readDocx: (buffer: ArrayBuffer) => Promise<string>
  readImage: (buffer: ArrayBuffer) => Promise<string>
  readPdf: (buffer: ArrayBuffer) => Promise<string>
}

// pdfjs and mammoth are heavy, so they are only pulled in when a matching file
// is actually picked. Tests inject their own extractors instead.
const lazyExtractors: KnowledgeExtractors = {
  async readImage(buffer) {
    // OCR lives in the main process, so this hop is a must. An image the reader
    // found no words in comes back as '', which the caller turns into the
    // "nothing readable" error; every other code is a real failure.
    const ocr = window.hermesDesktop?.knowledgeOcr

    if (!ocr) {
      throw new Error('Reading text from images is not available in this build')
    }

    const result = await ocr(buffer)

    if (result?.error) {
      if (result.error === 'no-text') {
        return ''
      }

      throw new Error(`Could not read the image (${result.error})`)
    }

    return result?.text || ''
  },
  async readDocx(buffer) {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ arrayBuffer: buffer })
    return result.value
  },
  async readPdf(buffer) {
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    const document = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise
    const pages: string[] = []

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push(
        content.items
          .map(item => ('str' in item ? item.str : ''))
          .join(' ')
          .trim()
      )
    }

    return pages.filter(Boolean).join('\n\n')
  }
}

/** Reduce a picked file to the plain text stored as project knowledge. */
export async function extractKnowledgeText(file: File, extractors: Partial<KnowledgeExtractors> = {}): Promise<string> {
  const kind = classifyKnowledgeFile(file.name, file.type)

  if (kind === 'unsupported') {
    throw new UnsupportedKnowledgeFileError(file.name)
  }

  if (kind === 'text') {
    return file.text()
  }

  const readers: KnowledgeExtractors = { ...lazyExtractors, ...extractors }
  const buffer = await file.arrayBuffer()
  const read = kind === 'pdf' ? readers.readPdf : kind === 'image' ? readers.readImage : readers.readDocx
  const extracted = await read(buffer)

  if (!extracted.trim()) {
    throw new EmptyKnowledgeFileError(file.name)
  }

  return extracted
}
