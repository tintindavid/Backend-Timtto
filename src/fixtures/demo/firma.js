import zlib from 'node:zlib';

/** Sample signature image (a hand-drawn-looking stroke), generated in code so no file has to be uploaded. */
const WIDTH = 240;
const HEIGHT = 80;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function signaturePng() {
  const rows = Buffer.alloc((WIDTH + 1) * HEIGHT, 255);
  for (let y = 0; y < HEIGHT; y += 1) rows[y * (WIDTH + 1)] = 0; // filter byte
  const dot = (x, y) => {
    for (let dx = 0; dx < 2; dx += 1) for (let dy = 0; dy < 2; dy += 1) {
      const px = Math.round(x) + dx;
      const py = Math.round(y) + dy;
      if (px >= 0 && px < WIDTH && py >= 0 && py < HEIGHT) rows[py * (WIDTH + 1) + 1 + px] = 30;
    }
  };
  for (let t = 0; t <= 1; t += 0.0008) {
    dot(20 + 200 * t + 14 * Math.sin(t * 40), 42 + 22 * Math.sin(t * 23) * (1 - t * 0.6));
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8; // bit depth; colour type 0 = greyscale
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const DEMO_SIGNATURE = `data:image/png;base64,${signaturePng().toString('base64')}`;
