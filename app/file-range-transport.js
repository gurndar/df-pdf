// Feeds pdf.js only the byte ranges it asks for, read straight from the File
// on disk. The whole file is never held in memory.
import { PDFDataRangeTransport } from "./vendor/pdf.min.mjs";

const RETRIES = 2;

export class FileRangeTransport extends PDFDataRangeTransport {
  // onReadError(err) is called if a range still can't be read after retries
  // (e.g. the file was moved, or removable storage went away). pdf.js has no
  // error path for range transports, so without it the read would hang forever.
  constructor(file, { onReadError } = {}) {
    super(file.size, null);
    this.file = file;
    this.onReadError = onReadError;
    this.bytesRead = 0;
  }

  requestDataRange(begin, end) {
    this.read(begin, end, 0);
  }

  async read(begin, end, attempt) {
    let buf;
    try {
      buf = await this.file.slice(begin, end).arrayBuffer();
    } catch (err) {
      if (attempt < RETRIES) {
        console.warn(`read ${begin}-${end} failed, retrying`, err);
        setTimeout(() => this.read(begin, end, attempt + 1), 200 * (attempt + 1));
      } else {
        this.onReadError?.(err);
      }
      return;
    }
    this.bytesRead += buf.byteLength;
    this.onDataRange(begin, new Uint8Array(buf));
  }
}
