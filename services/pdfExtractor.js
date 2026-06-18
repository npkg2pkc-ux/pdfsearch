// =====================================================================
// pdfExtractor.js
// Ekstrak semua anotasi (sticky note, highlight comment, free text, dll)
// dari file PDF menggunakan pdfjs-dist legacy build.
// Output: [{ content, page, type, author, totalPages }, ...]
// =====================================================================
const fs = require("fs");
const path = require("path");

// pdfjs-dist v4+ adalah ESM. Kita pakai dynamic import.
let pdfjsLib = null;
async function loadPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  // Pakai legacy build: tanpa kebutuhan DOM (aman untuk Node.js)
  pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsLib;
}

// Tipe anotasi yang akan kita simpan (yang biasanya punya konten teks)
const ALLOWED_TYPES = new Set([
  "Text",       // Sticky note
  "FreeText",   // Text box langsung di halaman
  "Highlight",  // Highlight dengan komentar
  "Underline",
  "StrikeOut",
  "Squiggly",
  "Square",
  "Circle",
  "Line",
  "Polygon",
  "PolyLine",
  "Ink",
  "Caret",
  "Stamp",
  "FileAttachment",
  "Note",
  "Redact",
]);

// Tipe yang SELALU kita skip karena tidak menyimpan komentar user
const SKIP_TYPES = new Set(["Link", "Popup"]);

// Polyfill minimal untuk Node (kadang pdfjs butuh simbol-simbol ini).
function ensurePolyfills() {
  if (typeof globalThis.DOMMatrix === "undefined") {
    // Polyfill sederhana: kalau pdfjs butuh DOMMatrix, ini cukup untuk kasus read-only.
    globalThis.DOMMatrix = class DOMMatrix {
      constructor(init) {
        this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
        if (Array.isArray(init) && init.length === 6) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = init;
        }
      }
    };
  }
  if (typeof globalThis.Path2D === "undefined") {
    globalThis.Path2D = class Path2D { constructor() {} addPath() {} };
  }
}

/**
 * Ambil string konten dari annotation.
 * Bisa dari `contents` (string biasa) atau `contentsObj` (rich text).
 */
function readContent(ann) {
  // 1) Rich text: contentsObj adalah object { str: "...", ... }
  if (ann.contentsObj) {
    if (typeof ann.contentsObj.str === "string") {
      return ann.contentsObj.str;
    }
    if (typeof ann.contentsObj === "string") {
      return ann.contentsObj;
    }
  }
  // 2) Plain string
  if (typeof ann.contents === "string" && ann.contents.length > 0) {
    return ann.contents;
  }
  // 3) Rich text dalam format PDF stream array
  //    pdfjs kadang kembalikan { richText: [...] }.
  if (Array.isArray(ann.richText)) {
    const text = ann.richText
      .map((rt) => {
        if (typeof rt?.str === "string") return rt.str;
        if (typeof rt?.text === "string") return rt.text;
        return "";
      })
      .join("");
    if (text) return text;
  }
  return null;
}

/**
 * Decode stream string PDF (jaga-jaga kalau ada karakter encoded).
 * Membersihkan escape sequence umum: \r, \n, \t, octal, dsb.
 */
function decodeStream(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

/**
 * Fungsi utama: ekstrak semua anotasi dari file PDF.
 * @param {string} filePath path absolut ke file PDF
 * @returns {Promise<Array<{content:string, page:number, type:string, author:string|null, totalPages:number}>>}
 */
async function extractPdfAnnotations(filePath) {
  ensurePolyfills();
  const pdfjs = await loadPdfjs();

  // 1) Baca file jadi Uint8Array
  const buf = await fs.promises.readFile(filePath);
  const data = new Uint8Array(buf);

  // 2) Parse PDF
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data,
      // Mode aman untuk Node: tanpa eval & tanpa render font
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: 0,
    }).promise;
  } catch (err) {
    // PDF ter-encrypt, korup, atau tidak valid → return kosong.
    console.warn(`[pdfExtractor] Gagal muat PDF ${path.basename(filePath)}: ${err.message}`);
    return [];
  }

  const totalPages = doc.numPages || 0;
  const results = [];

  // 3) Loop setiap halaman
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    let page;
    try {
      page = await doc.getPage(pageNum);
    } catch (err) {
      console.warn(`[pdfExtractor] Gagal buka halaman ${pageNum}: ${err.message}`);
      continue;
    }

    // 4) Ambil anotasi
    let annotations = [];
    try {
      const annList = await page.getAnnotations({ fields: ["T", "Contents", "ContentsObj"] });
      annotations = Array.isArray(annList) ? annList : [];
    } catch (err) {
      console.warn(`[pdfExtractor] getAnnotations gagal di halaman ${pageNum}: ${err.message}`);
      continue;
    }

    // 5) Proses setiap anotasi
    for (const ann of annotations) {
      // Normalisasi tipe
      const type = (ann.subtype || ann.annotationType || "Unknown").toString();

      // Skip tipe yang tidak relevan
      if (SKIP_TYPES.has(type)) continue;
      if (!ALLOWED_TYPES.has(type) && !type) continue;

      const rawContent = readContent(ann);
      const content = rawContent ? decodeStream(rawContent).trim() : "";

      // Skip kalau konten kosong (highlight tanpa komentar, dll.)
      if (!content) continue;

      // Author: bisa di field T (title) atau di titleObj
      let author = null;
      if (typeof ann.title === "string" && ann.title.trim()) {
        author = ann.title.trim();
      } else if (ann.titleObj?.str) {
        author = String(ann.titleObj.str).trim();
      }

      results.push({
        content,
        page: pageNum,
        type,
        author,
        // Sisipkan totalPages di elemen pertama saja (untuk disimpan ke tabel files)
        totalPages: pageNum === 1 ? totalPages : undefined,
      });
    }
  }

  // Bersihkan: hanya elemen pertama yang boleh punya totalPages
  // (filter undefined supaya tidak masuk DB tag)
  return results.map((r, i) => {
    if (i === 0) return r;
    const { totalPages, ...rest } = r;
    return rest;
  });
}

module.exports = { extractPdfAnnotations };
