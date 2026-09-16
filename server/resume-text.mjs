import { readFile } from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

const MAX_RESUME_TEXT_CHARS = 40000;

function normalizeText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function extractPdf(buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extractDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

export async function extractResumeText(filePath, resume) {
  const extension = path.extname(resume.original_name || filePath).toLowerCase();
  if (extension === ".doc") throw new Error("暂不支持读取旧版 .doc 简历，请另存为 PDF 或 DOCX 后重新上传");
  if (![".pdf", ".docx"].includes(extension)) throw new Error("AI 简历分析目前支持 PDF 和 DOCX 文件");
  const buffer = await readFile(filePath);
  let raw;
  try {
    raw = extension === ".pdf" ? await extractPdf(buffer) : await extractDocx(buffer);
  } catch (error) {
    throw new Error(`无法读取简历内容：${error instanceof Error ? error.message : "文件解析失败"}`);
  }
  const text = normalizeText(raw);
  if (text.length < 80) throw new Error("简历中没有提取到足够文字；如果是扫描版 PDF，请上传可复制文字的 PDF 或 DOCX");
  return {
    text: text.slice(0, MAX_RESUME_TEXT_CHARS),
    truncated: text.length > MAX_RESUME_TEXT_CHARS,
    characters: text.length,
    format: extension.slice(1).toUpperCase(),
  };
}
