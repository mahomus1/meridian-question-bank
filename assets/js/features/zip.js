/* A minimal ZIP writer.

   Enough of the format to build an Office Open XML package: entries are stored
   uncompressed, which keeps this to a CRC and three record layouts. A .docx is
   a ZIP, so this is all that stands between the app and a real Word file —
   no dependency, nothing to load at runtime. */

const CRC = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const utf8 = (s) => new TextEncoder().encode(s);

/** MS-DOS packed date and time, which is what the format stores. */
function dosStamp(d = new Date()) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

/**
 * Build a ZIP archive.
 * @param {Array<{name:string, data:Uint8Array|string}>} files
 * @returns {Blob}
 */
export function zip(files) {
  const { time, date } = dosStamp();
  const entries = files.map((f) => {
    const data = typeof f.data === 'string' ? utf8(f.data) : f.data;
    return { name: utf8(f.name), data, crc: crc32(data) };
  });

  const localSize = entries.reduce((n, e) => n + 30 + e.name.length + e.data.length, 0);
  const centralSize = entries.reduce((n, e) => n + 46 + e.name.length, 0);
  const buf = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(buf.buffer);
  let at = 0;

  const u32 = (v) => { view.setUint32(at, v, true); at += 4; };
  const u16 = (v) => { view.setUint16(at, v, true); at += 2; };
  const raw = (b) => { buf.set(b, at); at += b.length; };

  for (const e of entries) {
    e.offset = at;
    u32(0x04034b50);            // local file header
    u16(20); u16(0); u16(0);    // version, flags, method (0 = stored)
    u16(time); u16(date);
    u32(e.crc); u32(e.data.length); u32(e.data.length);
    u16(e.name.length); u16(0);
    raw(e.name); raw(e.data);
  }

  const centralAt = at;
  for (const e of entries) {
    u32(0x02014b50);            // central directory header
    u16(20); u16(20); u16(0); u16(0);
    u16(time); u16(date);
    u32(e.crc); u32(e.data.length); u32(e.data.length);
    u16(e.name.length); u16(0); u16(0);
    u16(0); u16(0); u32(0);
    u32(e.offset);
    raw(e.name);
  }

  // Measure the directory before writing the trailer, which itself advances
  // the cursor — reading `at` mid-record would overstate the size.
  const centralSizeActual = at - centralAt;

  u32(0x06054b50);              // end of central directory
  u16(0); u16(0);
  u16(entries.length); u16(entries.length);
  u32(centralSizeActual); u32(centralAt);
  u16(0);

  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
