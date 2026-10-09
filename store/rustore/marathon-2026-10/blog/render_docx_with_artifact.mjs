// Render the original DOCX directly through the bundled document layout engine.
// This does not rebuild the document from its text or change the DOCX.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  DocumentFile,
  FileBlob,
  layoutDocumentPages,
  preloadDocumentImageBitmaps,
  drawDocumentToCtx,
} from 'file:///C:/Users/Dima2/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';

const folder = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const input = process.argv[2] || path.join(folder, 'article.docx');
const output = process.argv[3] || path.join(folder, 'render-artifact-tool');
const scale = 2;
const bytes = await fs.readFile(input);
const document = await DocumentFile.importDocx(await FileBlob.load(input));
const measurementCanvas = new OffscreenCanvas(816, 1056);
const pages = layoutDocumentPages(document, measurementCanvas.getContext('2d'));
const imageBitmaps = await preloadDocumentImageBitmaps(document, pages);
if (pages.length === 0) throw new Error('The DOCX produced no layout pages');
if (imageBitmaps.size !== document.images.items.length) {
  throw new Error(`Only ${imageBitmaps.size} of ${document.images.items.length} DOCX images decoded`);
}
await fs.mkdir(output, { recursive: true });
const report = {
  source: path.resolve(input),
  sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  renderer: '@oai/artifact-tool 2.8.59 bundled DocumentFile.importDocx and document layout engine',
  APIEvidence: 'Public exports and implementation in @oai/artifact-tool/dist/artifact_tool.mjs; package docs currently document sheets and slides only',
  originalDocxImported: true,
  sourceDocxChanged: false,
  rebuiltFromText: false,
  embeddedImages: document.images.items.length,
  decodedImageBitmaps: imageBitmaps.size,
  fontFamilies: [...document.fontFamilies],
  scale,
  pages: [],
};
for (let index = 0; index < pages.length; index += 1) {
  const page = pages[index];
  const canvas = new OffscreenCanvas(Math.ceil(page.widthPx * scale), Math.ceil(page.heightPx * scale));
  const context = canvas.getContext('2d');
  context.scale(scale, scale);
  const rendered = drawDocumentToCtx(document, context, { pageIndex: index, imageBitmaps });
  if (rendered.renderedPageIndex !== index) throw new Error(`Incorrect page rendered at index ${index}`);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const filename = `page-${index + 1}.png`;
  await fs.writeFile(path.join(output, filename), Buffer.from(await blob.arrayBuffer()));
  report.pages.push({ page: index + 1, filename, widthPx: page.widthPx * scale, heightPx: page.heightPx * scale });
}
const layout = await document.export({ format: 'layout' });
await fs.writeFile(path.join(output, 'layout.json'), Buffer.from(await layout.arrayBuffer()));
await fs.writeFile(path.join(output, 'render-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Imported and rendered original DOCX: ${pages.length} pages, ${imageBitmaps.size} embedded images`);
console.log(`Source SHA256: ${report.sourceSha256}`);
console.log(`Page images: ${output}`);
