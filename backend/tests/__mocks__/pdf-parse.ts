export class PDFParse {
  private data: Uint8Array;

  constructor(opts: { data: Uint8Array }) {
    this.data = opts.data;
  }

  async getText(): Promise<{ text: string; total: number }> {
    const text = Buffer.from(this.data).toString('utf-8');
    return { text, total: 1 };
  }

  async destroy(): Promise<void> {}
}
