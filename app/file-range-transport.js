// Feeds pdf.js only the byte ranges it asks for, read straight from the File
// on disk. The whole file is never held in memory.
import { PDFDataRangeTransport } from "./vendor/pdf.min.mjs";

export class FileRangeTransport extends PDFDataRangeTransport {
  constructor(file) {
    super(file.size, null);
    this.file = file;
    this.bytesRead = 0;
  }

  requestDataRange(begin, end) {
    this.file.slice(begin, end).arrayBuffer().then((buf) => {
      this.bytesRead += buf.byteLength;
      this.onDataRange(begin, new Uint8Array(buf));
    });
  }
}
