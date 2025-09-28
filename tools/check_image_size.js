const https = require("https");
const http = require("http");
const url = require("url");

function get(urlStr) {
  return new Promise((resolve, reject) => {
    const opts = url.parse(urlStr);
    const lib = opts.protocol === "https:" ? https : http;
    const req = lib.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.end();
  });
}

function probePNG(buf) {
  // PNG signature 8 bytes, then IHDR chunk: length(4) 'IHDR' (4) then data 13 bytes (width/height)
  if (buf.length < 24) return null;
  const sig = buf.slice(0, 8);
  if (
    !sig.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return null;
  // IHDR should start at offset 8+4
  const ihdrName = buf.slice(12, 16).toString("ascii");
  if (ihdrName !== "IHDR") return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height, type: "png" };
}

function probeJpeg(buf) {
  // JPEG: look for 0xFFD8 then scan for SOF0/2 markers (0xFFC0 or 0xFFC2). Very small parser.
  if (buf.length < 4) return null;
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < buf.length) {
    if (buf[offset] !== 0xff) return null;
    const marker = buf[offset + 1];
    const len = buf.readUInt16BE(offset + 2);
    if (marker === 0xc0 || marker === 0xc2) {
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return { width, height, type: "jpeg" };
    }
    offset += 2 + len;
  }
  return null;
}

async function probe(urlStr) {
  try {
    const buf = await get(urlStr);
    const p = probePNG(buf) || probeJpeg(buf);
    if (p) return p;
    return { type: "unknown", size: buf.length };
  } catch (e) {
    return { error: String(e) };
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: node check_image_size.js <url> [<url> ...]");
    process.exit(2);
  }
  for (const u of args) {
    process.stdout.write(u + " -> ");
    const res = await probe(u);
    console.log(JSON.stringify(res));
  }
}

main();
