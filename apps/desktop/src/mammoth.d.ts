// mammoth ships no type declarations. Only the raw-text extraction used by
// knowledge-files.ts is declared here.
declare module 'mammoth' {
  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>
}
