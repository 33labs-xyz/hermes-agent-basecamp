import { describe, expect, test } from 'vitest'

import {
  basename,
  collectDrop,
  dataUrlToFile,
  filterImageFiles,
  HERMES_PATHS_MIME,
  isImageFile,
  parseHermesPaths
} from './drop-files'

// 1x1 red-pixel PNG, small enough to inline for a base64 round-trip test.
const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

const PNG_DATA_URL = `data:image/png;base64,${PNG_1X1_BASE64}`

function fakeFile(name: string, type: string): File {
  return new File(['x'], name, { type })
}

function fakeDataTransfer(options: { files?: File[]; hermesPaths?: string; getDataThrows?: boolean }): DataTransfer {
  const { files, hermesPaths, getDataThrows } = options

  return {
    files: files as unknown as FileList,
    getData: (() => {
      if (getDataThrows) {
        return () => {
          throw new Error('getData denied')
        }
      }

      return () => hermesPaths ?? ''
    })()
  } as unknown as DataTransfer
}

describe('parseHermesPaths', () => {
  test('parses a valid JSON array of path entries', () => {
    const raw = JSON.stringify([
      { path: '/a/b.png', isDirectory: false },
      { path: '/a/folder', isDirectory: true }
    ])

    expect(parseHermesPaths(raw)).toEqual([
      { path: '/a/b.png', isDirectory: false },
      { path: '/a/folder', isDirectory: true }
    ])
  })

  test('defaults isDirectory to false when the key is missing', () => {
    const raw = JSON.stringify([{ path: '/a/b.png' }])

    expect(parseHermesPaths(raw)).toEqual([{ path: '/a/b.png', isDirectory: false }])
  })

  test('skips entries without a string path', () => {
    const raw = JSON.stringify([{ isDirectory: false }, { path: 42 }, { path: '/ok.png' }])

    expect(parseHermesPaths(raw)).toEqual([{ path: '/ok.png', isDirectory: false }])
  })

  test('returns [] on malformed JSON', () => {
    expect(parseHermesPaths('{not json')).toEqual([])
  })

  test('returns [] on non-array JSON', () => {
    expect(parseHermesPaths('{"path":"/a.png"}')).toEqual([])
  })

  test('returns [] for null and undefined', () => {
    expect(parseHermesPaths(null)).toEqual([])
    expect(parseHermesPaths(undefined)).toEqual([])
  })
})

describe('collectDrop', () => {
  test('combines OS files with non-directory hermes paths', () => {
    const files = [fakeFile('photo.png', 'image/png')]

    const hermesPaths = JSON.stringify([
      { path: '/tree/img.jpg', isDirectory: false },
      { path: '/tree/folder', isDirectory: true }
    ])

    const result = collectDrop(fakeDataTransfer({ files, hermesPaths }))

    expect(result.osFiles).toEqual(files)
    expect(result.paths).toEqual(['/tree/img.jpg'])
  })

  test('defaults osFiles to [] when dataTransfer.files is nullish', () => {
    const result = collectDrop(fakeDataTransfer({ files: undefined }))

    expect(result.osFiles).toEqual([])
  })

  test('stays safe when getData throws', () => {
    const files = [fakeFile('photo.png', 'image/png')]

    expect(() => collectDrop(fakeDataTransfer({ files, getDataThrows: true }))).not.toThrow()
    expect(collectDrop(fakeDataTransfer({ files, getDataThrows: true }))).toEqual({
      osFiles: files,
      paths: []
    })
  })

  test('uses the hermes-paths MIME constant to read the payload', () => {
    let requestedType = ''

    const dataTransfer = {
      files: [] as unknown as FileList,
      getData: (type: string) => {
        requestedType = type

        return ''
      }
    } as unknown as DataTransfer

    collectDrop(dataTransfer)

    expect(requestedType).toBe(HERMES_PATHS_MIME)
    expect(HERMES_PATHS_MIME).toBe('application/x-hermes-paths')
  })
})

describe('isImageFile', () => {
  test('is true when the MIME type starts with image/', () => {
    expect(isImageFile({ type: 'image/png' })).toBe(true)
  })

  test('is true by extension when type is missing, case-insensitive', () => {
    expect(isImageFile({ name: 'photo.JPG' })).toBe(true)
  })

  test('is false for a non-image type and non-image extension', () => {
    expect(isImageFile({ name: 'notes.txt', type: 'text/plain' })).toBe(false)
  })

  test('is false for an empty input', () => {
    expect(isImageFile({})).toBe(false)
  })
})

describe('filterImageFiles', () => {
  test('keeps only image files, preserving order, without mutating the input', () => {
    const files = [fakeFile('a.png', 'image/png'), fakeFile('b.txt', 'text/plain'), fakeFile('c.gif', 'image/gif')]

    const result = filterImageFiles(files)

    expect(result.map(f => f.name)).toEqual(['a.png', 'c.gif'])
    expect(files).toHaveLength(3)
  })
})

describe('dataUrlToFile', () => {
  test('round-trips a valid base64 PNG data URL to a File', () => {
    const file = dataUrlToFile(PNG_DATA_URL, 'pixel.png')

    expect(file).not.toBeNull()
    expect(file?.name).toBe('pixel.png')
    expect(file?.type).toBe('image/png')
    expect(file?.size).toBeGreaterThan(0)
  })

  test('tolerates a missing MIME type', () => {
    const file = dataUrlToFile(`data:;base64,${PNG_1X1_BASE64}`, 'pixel.png')

    expect(file).not.toBeNull()
    expect(file?.type).toBe('')
  })

  test('returns null for a non-data-url string', () => {
    expect(dataUrlToFile('not-a-data-url', 'x.png')).toBeNull()
  })

  test('returns null for an empty string', () => {
    expect(dataUrlToFile('', 'x.png')).toBeNull()
  })

  test('returns null when the base64 payload is corrupt', () => {
    expect(dataUrlToFile('data:image/png;base64,!!!not-base64!!!', 'x.png')).toBeNull()
  })
})

describe('basename', () => {
  test('returns the last segment of a posix path', () => {
    expect(basename('/Users/x/y/image.png')).toBe('image.png')
  })

  test('returns the last segment of a windows path', () => {
    expect(basename('C:\\Users\\x\\y\\image.png')).toBe('image.png')
  })

  test('returns the input unchanged when there is no separator', () => {
    expect(basename('image.png')).toBe('image.png')
  })
})
