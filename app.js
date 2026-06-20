/* e-Gov 法令XML Viewer - local-only browser app
   v2: zip内XSL/XSLTを優先して適用。失敗時のみ簡易レンダラへフォールバック。 */
const fileInput = document.querySelector("#fileInput");
const dropzone = document.querySelector("#dropzone");
const fileList = document.querySelector("#fileList");
const viewer = document.querySelector("#viewer");
const statusEl = document.querySelector("#status");
const tocEl = document.querySelector("#toc");
const printBtn = document.querySelector("#printBtn");
const modeSelect = document.querySelector("#modeSelect");
const xslSelect = document.querySelector("#xslSelect");
const compatSelect = document.querySelector("#compatSelect");

let xmlFiles = [];
let xslFiles = [];
let displayFiles = [];
let allEntries = new Map();
let objectUrls = [];
let activeIndex = -1; // active XML index
let activeDisplayIndex = -1;
let activeDoc = null;

fileInput.addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  if (file) await loadFile(file);
});
["dragenter", "dragover"].forEach((type) =>
  dropzone.addEventListener(type, (ev) => {
    ev.preventDefault();
    dropzone.classList.add("dragover");
  }),
);
["dragleave", "drop"].forEach((type) =>
  dropzone.addEventListener(type, (ev) => {
    ev.preventDefault();
    dropzone.classList.remove("dragover");
  }),
);
dropzone.addEventListener("drop", async (ev) => {
  const file = ev.dataTransfer.files?.[0];
  if (file) await loadFile(file);
});
printBtn.addEventListener("click", () => {
  const frame = document.querySelector("#xsltFrame");
  if (frame?.contentWindow) frame.contentWindow.print();
  else window.print();
});
modeSelect?.addEventListener(
  "change",
  () => activeIndex >= 0 && selectXml(activeIndex),
);
xslSelect?.addEventListener(
  "change",
  () => activeIndex >= 0 && selectXml(activeIndex),
);
compatSelect?.addEventListener(
  "change",
  () => activeIndex >= 0 && selectXml(activeIndex),
);

async function loadFile(file) {
  try {
    resetObjectUrls();
    setStatus(`読み込み中: ${file.name}`);
    viewer.replaceChildren();
    tocEl.textContent = "表示後に生成されます";
    tocEl.className = "toc empty";
    xmlFiles = [];
    xslFiles = [];
    displayFiles = [];
    allEntries = new Map();
    activeIndex = -1;
    activeDisplayIndex = -1;

    if (file.name.toLowerCase().endsWith(".zip")) {
      if (!window.JSZip)
        throw new Error(
          "JSZipを読み込めません。インターネット接続または同梱版を確認してください。",
        );
      const zip = await JSZip.loadAsync(file);
      const entries = Object.values(zip.files).filter((e) => !e.dir);
      for (const e of entries) {
        const lower = e.name.toLowerCase();
        const rec = {
          name: e.name,
          lower,
          zipEntry: e,
          text: null,
          blobUrl: null,
        };
        if (isTextLike(lower))
          rec.text = decodeTextBuffer(await e.async("arraybuffer"), e.name);
        allEntries.set(normalizePath(e.name), rec);
      }
      xmlFiles = [...allEntries.values()].filter((e) =>
        e.lower.endsWith(".xml"),
      );
      xslFiles = [...allEntries.values()].filter(
        (e) => e.lower.endsWith(".xsl") || e.lower.endsWith(".xslt"),
      );
      displayFiles = [...allEntries.values()].filter(
        (e) => !isHiddenSystemFile(e.lower),
      );
      if (!displayFiles.length)
        throw new Error("ZIP内に表示できるファイルが見つかりません。");
    } else {
      const lower = file.name.toLowerCase();
      const rec = {
        name: file.name,
        lower,
        text: null,
        file,
        zipEntry: null,
        blobUrl: null,
      };
      if (isTextLike(lower))
        rec.text = decodeTextBuffer(await file.arrayBuffer(), file.name);
      allEntries.set(normalizePath(file.name), rec);
      if (lower.endsWith(".xml")) xmlFiles = [rec];
      else if (lower.endsWith(".xsl") || lower.endsWith(".xslt"))
        xslFiles = [rec];
      displayFiles = [rec];
    }
    renderFileList();
    renderXslSelect();
    const firstIndex = chooseInitialDisplayIndex();
    await selectDisplayFile(firstIndex);
  } catch (err) {
    showError(err);
  }
}

function isTextLike(lower) {
  return /\.(xml|xsl|xslt|css|html|htm|txt|csv|json|md|dtd|svg)$/i.test(lower);
}
function isHiddenSystemFile(lower) {
  return /(^|\/)__macosx\//i.test(lower) || /(^|\/)\.ds_store$/i.test(lower);
}
function fileKind(entry) {
  const l = entry.lower || "";
  if (/\.xml$/i.test(l)) return "XML";
  if (/\.pdf$/i.test(l)) return "PDF";
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(l)) return "画像";
  if (/\.tiff?$/i.test(l)) return "TIFF";
  if (/\.csv$/i.test(l)) return "CSV";
  if (/\.(html?|xhtml)$/i.test(l)) return "HTML";
  if (/\.(xsl|xslt)$/i.test(l)) return "XSL";
  if (/\.css$/i.test(l)) return "CSS";
  if (/\.js$/i.test(l)) return "JS";
  if (/\.(txt|json|md|dtd)$/i.test(l)) return "TEXT";
  return "FILE";
}

function fileGroup(entry) {
  const kind = fileKind(entry);
  if (kind === "XML" || kind === "PDF") return "forms";
  if (kind === "画像" || kind === "TIFF") return "attachments";
  if (kind === "XSL" || kind === "CSS" || kind === "JS") return "system";
  return "other";
}

function chooseInitialDisplayIndex() {
  const preferredGroups = ["forms", "attachments", "other", "system"];
  for (const group of preferredGroups) {
    const idx = displayFiles.findIndex((f) => fileGroup(f) === group);
    if (idx >= 0) return idx;
  }
  return 0;
}

function renderFileList() {
  fileList.className = "file-list accordion-file-list";
  fileList.replaceChildren();
  if (!displayFiles.length) {
    fileList.className = "file-list empty";
    fileList.textContent = "未読み込み";
    return;
  }

  const groups = [
    { key: "forms", title: "帳票", open: true },
    { key: "attachments", title: "添付資料", open: true },
    { key: "other", title: "その他", open: false },
    { key: "system", title: "システムファイル", open: false },
  ];

  for (const group of groups) {
    const items = displayFiles
      .map((entry, index) => ({ entry, index }))
      .filter((x) => fileGroup(x.entry) === group.key);
    if (!items.length) continue;

    const details = document.createElement("details");
    details.className = `file-group file-group-${group.key}`;
    details.open =
      group.open || items.some((x) => x.index === activeDisplayIndex);

    const summary = document.createElement("summary");
    summary.className = "file-group-summary";
    summary.textContent = `${group.title} (${items.length})`;
    details.append(summary);

    const body = document.createElement("div");
    body.className = "file-group-body";
    for (const { entry, index } of items) {
      const b = document.createElement("button");
      b.type = "button";
      b.className =
        "file-item" + (index === activeDisplayIndex ? " active" : "");
      b.textContent = `${fileIcon(entry)} ${basename(entry.name)}`;
      b.title = entry.name;
      b.addEventListener("click", () => selectDisplayFile(index));
      body.append(b);
    }
    details.append(body);
    fileList.append(details);
  }
}

function fileIcon(entry) {
  const kind = fileKind(entry);
  if (kind === "XML") return "📄";
  if (kind === "PDF") return "📕";
  if (kind === "画像" || kind === "TIFF") return "🖼";
  if (kind === "CSV") return "📊";
  if (kind === "HTML") return "🌐";
  if (kind === "XSL" || kind === "CSS" || kind === "JS") return "⚙";
  return "📎";
}

async function selectDisplayFile(index) {
  try {
    activeDisplayIndex = index;
    renderFileList();
    const entry = displayFiles[index];
    if (!entry) throw new Error("ファイルが見つかりません。");
    const kind = fileKind(entry);
    if (kind === "XML") {
      const xi = xmlFiles.indexOf(entry);
      if (xi >= 0) return await selectXml(xi);
    }
    activeIndex = -1;
    tocEl.textContent = "この形式では目次は生成しません";
    tocEl.className = "toc empty";
    if (kind === "PDF") return await renderPdf(entry);
    if (kind === "画像") return await renderImage(entry);
    if (kind === "TIFF") return await renderTiff(entry);
    if (kind === "CSV") return await renderCsv(entry);
    if (kind === "HTML") return await renderHtmlFile(entry);
    if (["TEXT", "XSL", "CSS", "JS"].includes(kind))
      return await renderTextFile(entry);
    return await renderDownloadOnly(entry);
  } catch (err) {
    showError(err);
  }
}

function renderXslSelect() {
  if (!xslSelect) return;
  xslSelect.replaceChildren(new Option("自動検出", "__auto__"));
  for (const xsl of xslFiles) xslSelect.append(new Option(xsl.name, xsl.name));
  xslSelect.disabled = !xslFiles.length;
}

async function selectXml(index) {
  try {
    activeIndex = index;
    activeDisplayIndex = displayFiles.indexOf(xmlFiles[index]);
    renderFileList();
    const xf = xmlFiles[index];
    const parser = new DOMParser();
    const doc = parser.parseFromString(
      stripDoctype(xf.text),
      "application/xml",
    );
    if (doc.querySelector("parsererror"))
      throw new Error("XMLのパースに失敗しました。");
    activeDoc = doc;

    const mode = modeSelect?.value || "auto";
    if (mode !== "manual") {
      const xsl = chooseXslForXml(doc, xf);
      if (xsl) {
        try {
          await renderWithXslt(doc, xf, xsl);
          return;
        } catch (err) {
          console.warn("XSLT render failed, fallback to manual renderer:", err);
          if (mode === "xslt") throw err;
          setStatus(`XSLT適用に失敗したため簡易表示に切替: ${err.message}`);
        }
      } else if (mode === "xslt") {
        throw new Error(
          "ZIP内またはXMLのxml-stylesheet処理命令にXSL/XSLTが見つかりません。",
        );
      }
    }
    renderLawFallback(doc, xf.name);
  } catch (err) {
    showError(err);
  }
}

function chooseXslForXml(doc, xmlFile) {
  const selected = xslSelect?.value;
  if (selected && selected !== "__auto__")
    return xslFiles.find((x) => x.name === selected) || null;

  const piHref = findStylesheetHref(doc);
  if (piHref) {
    const byPi = findEntryRelative(piHref, xmlFile.name);
    if (byPi) return byPi;
  }
  if (!xslFiles.length) return null;

  // e-GovのZIPはXMLと同階層、または共通のstylesheetを持つことが多い。名前・階層の近さで選ぶ。
  const xmlBase = basename(xmlFile.name)
    .replace(/\.xml$/i, "")
    .toLowerCase();
  const sameBase = xslFiles.find(
    (x) =>
      basename(x.name)
        .replace(/\.xslt?$/i, "")
        .toLowerCase() === xmlBase,
  );
  if (sameBase) return sameBase;
  const sameDir = xslFiles.find(
    (x) => dirname(x.name) === dirname(xmlFile.name),
  );
  return sameDir || xslFiles[0];
}

function findStylesheetHref(doc) {
  for (const n of doc.childNodes) {
    if (
      n.nodeType === Node.PROCESSING_INSTRUCTION_NODE &&
      n.target === "xml-stylesheet"
    ) {
      const m = n.data.match(/href\s*=\s*['"]([^'"]+)['"]/i);
      if (m) return decodeHtml(m[1]);
    }
  }
  return "";
}

async function renderWithXslt(xmlDoc, xmlFile, xslFile) {
  if (!window.XSLTProcessor)
    throw new Error(
      "このブラウザはXSLTProcessorに対応していません。Chrome/Edge/Firefox/Safariで試してください。",
    );
  const xslDoc = await loadResolvedXsl(xslFile);
  const processor = new XSLTProcessor();
  processor.importStylesheet(xslDoc);
  const result = processor.transformToDocument(xmlDoc);
  if (!result || result.querySelector?.("parsererror"))
    throw new Error("XSLT変換結果が不正です。");

  viewer.replaceChildren();
  // XSLT出力は必ず iframe に隔離する。アプリ側CSSが帳票のbody/div/table/a等へ干渉するのを防ぐ。
  viewer.className = "xslt-host";

  let html = serializeXsltResult(result);
  html = await rewriteAssetUrlsInHtml(html, xmlFile.name);
  html = applyIframeCompatMode(html);

  const iframe = document.createElement("iframe");
  iframe.id = "xsltFrame";
  iframe.className = "xslt-frame";
  iframe.setAttribute("sandbox", "allow-same-origin allow-modals");
  iframe.srcdoc = html;
  iframe.addEventListener("load", () => {
    try {
      const doc = iframe.contentDocument;
      applySelectedLayoutStrategy(doc);
      const h = Math.max(
        900,
        doc.documentElement.scrollHeight,
        doc.body?.scrollHeight || 0,
      );
      iframe.style.height = `${Math.min(h + 80, 30000)}px`;
      buildTocFromIframe(doc);
    } catch {
      tocEl.textContent = "XSLT表示では目次を生成できませんでした";
      tocEl.className = "toc empty";
    }
  });
  viewer.append(iframe);
  printBtn.disabled = false;
  setStatus(
    `XSLT iframe表示中: ${xmlFile.name} / stylesheet: ${xslFile.name} / compat: ${compatSelect?.value || "iewrap"}`,
  );
}

function serializeXsltResult(result) {
  const serializer = new XMLSerializer();
  const root = result.documentElement;
  const hasHtmlRoot = root && root.localName?.toLowerCase() === "html";
  // 帳票系XSLは古いIE/MSXMLの quirks mode 前提で作られていることがある。
  // 以前の版は <!doctype html> を強制して standards mode にしていたため、
  // width/position/line-height の解釈が変わって文字重なりが出やすかった。
  if (hasHtmlRoot) return serializer.serializeToString(root);
  if (result.body && result.body.childNodes.length) {
    return (
      '<html><head><meta charset="utf-8"></head><body>' +
      result.body.innerHTML +
      "</body></html>"
    );
  }
  return (
    '<html><head><meta charset="utf-8"></head><body>' +
    serializer.serializeToString(root) +
    "</body></html>"
  );
}

function applyIframeCompatMode(html) {
  const mode = compatSelect?.value || "iewrap";
  const doc = new DOMParser().parseFromString(html, "text/html");

  // 既定は「何もしない」。XSLが吐いたstyleを尊重し、doctypeも付けず quirks mode でiframeに入れる。
  // これが帳票系XSLでは一番崩れにくい。
  if (mode === "quirks") {
    ensureMetaCharset(doc);
    return doc.documentElement.outerHTML;
  }

  if (mode === "standards") {
    ensureMetaCharset(doc);
    return "<!doctype html>\n" + doc.documentElement.outerHTML;
  }

  // 実験用。前版のようにnowrap補正を入れたい場合だけ選ぶ。
  if (mode === "nowrap") {
    const style = doc.createElement("style");
    style.setAttribute("data-egov-viewer-fix", "true");
    style.textContent = `
      html, body { margin: 0 !important; padding: 0 !important; background: white !important; overflow: visible !important; }
      body { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
      [style*="position:absolute"], [style*="position: absolute"] { white-space: nowrap; overflow: visible; max-width: none; }
      img, svg, canvas { max-width: none !important; }
    `;
    (doc.head || doc.documentElement).appendChild(style);
    ensureMetaCharset(doc);
    return doc.documentElement.outerHTML;
  }

  ensureMetaCharset(doc);
  return doc.documentElement.outerHTML;
}

function ensureMetaCharset(doc) {
  let head = doc.head;
  if (!head) {
    head = doc.createElement("head");
    doc.documentElement.insertBefore(head, doc.body || null);
  }
  if (!head.querySelector("meta[charset]")) {
    const meta = doc.createElement("meta");
    meta.setAttribute("charset", "utf-8");
    head.prepend(meta);
  }
}

function applySelectedLayoutStrategy(doc) {
  const mode = compatSelect?.value || "analyzed";
  // raw: XSLT結果そのまま。比較用。
  if (mode === "raw" || mode === "quirks" || mode === "standards") {
    applyPrintScaleOnly(doc, { screenFit: false });
    return;
  }

  // analyzed: 提供XSLを見た結果の補正。
  // このXSLは <pre> に長文を入れているが、CSSは word-wrap だけで white-space を指定していない。
  // pre の既定 white-space: pre のままだとChromeでは折返しされず横突き抜ける。
  // さらに table.Territory の width:640px の後ろにセミコロンがなく、幅指定が無効化される。
  if (mode === "analyzed") {
    applyAnalyzedXslFixes(doc);
    applyPrintScaleOnly(doc, { screenFit: false });
    return;
  }

  // wide: ユーザーが「一番読める」と言っていた方向。
  // 折返しを無理に作らず、入れ子tableの実幅を内側から外へ伝播して重なりを防ぐ。
  // 印刷時だけA4に収まるよう縮小する。
  normalizeXsltTables(doc);
  applyPrintScaleOnly(doc, { screenFit: mode === "screenfit" });
}

function applyAnalyzedXslFixes(doc) {
  if (!doc || !doc.body) return;

  const style = doc.createElement("style");
  style.setAttribute("data-egov-viewer-analyzed-xsl-fix", "true");
  style.textContent = `
    /* provided XSL specific fixes */
    table.Territory {
      width: 640px !important;
      margin-left: 10px !important;
      margin-right: 10px !important;
      table-layout: fixed !important;
    }
    /* Territory is 2 x 320px, but the parent table uses cellpadding=5.
       Old IE effectively wrapped inner text inside the padded cell.
       Chrome lets the nested 320px table push across the center border.
       Keep the inner nested tables inside the cell content box. */
    table.Territory[cellpadding="5"] > tbody > tr > td > table.Lterritory,
    table.Territory[cellpadding="5"] > tbody > tr > td > table.Rterritory {
      width: 310px !important;
      max-width: 310px !important;
      table-layout: fixed !important;
      box-sizing: border-box !important;
    }
    table.Territory[cellpadding="5"] > tbody > tr > td > table.Lterritory {
      margin-left: 0 !important;
      margin-right: 0 !important;
    }
    table.Territory[cellpadding="5"] > tbody > tr > td > table.Rterritory {
      margin-left: 0 !important;
      margin-right: 0 !important;
    }
    table.Lterritory {
      width: 310px !important;
      table-layout: fixed !important;
      margin-left: 0 !important;
    }
    table.Rterritory {
      width: 310px !important;
      table-layout: fixed !important;
      margin-right: 0 !important;
    }
    table.title { width: 640px !important; table-layout: fixed !important; }
    table.outline { width: 640px !important; height: 940px !important; }

    /* The XSL emits long Japanese sentences inside <pre>.
       word-wrap alone does not affect pre's default white-space: pre. */
    pre, pre.normal, pre.oshirase, td.oshirase {
      white-space: pre-wrap !important;
      overflow-wrap: break-word !important;
      word-wrap: break-word !important;
      word-break: break-all !important;
      line-break: strict !important;
      font-family: inherit !important;
      margin: 0 !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
    }
    /* Do not split numeric identifiers such as postal codes.
       Broad break-all fixes Japanese paragraphs, but it is toxic for 123-4567. */
    [data-egov-nowrap-token="1"],
    .egov-nowrap-token,
    td.jgshAddr:first-child,
    td.bigTL2.jgshAddr {
      white-space: nowrap !important;
      word-break: keep-all !important;
      overflow-wrap: normal !important;
      word-wrap: normal !important;
      line-break: auto !important;
    }
    td { box-sizing: border-box !important; }
  `;
  (doc.head || doc.documentElement).appendChild(style);

  protectNonBreakingNumericTokens(doc);
  fixTerritoryNestedColumns(doc);

  // Make table columns explicit where the XSL relied on colgroup width but omitted the table width.
  // Do not propagate child widths upward; that was the cause of the A4 widening.
  for (const table of doc.querySelectorAll("table")) {
    const cls = table.className || "";
    if (/Territory|Lterritory|Rterritory|title|outline/.test(cls)) continue;
    const cols = [...table.querySelectorAll(":scope > colgroup > col")];
    if (cols.length && !table.style.width && !table.getAttribute("width")) {
      const total = cols.reduce(
        (sum, col) =>
          sum +
          (explicitHtmlLength(col.getAttribute("width")) ||
            explicitCssLength(col.style.width) ||
            0),
        0,
      );
      if (total > 0 && total <= 640) {
        table.style.width = `${total}px`;
        table.style.tableLayout = "fixed";
      }
    }
  }
}

function fixTerritoryNestedColumns(doc) {
  // For yoshiki-style forms: <table class="Territory" cellpadding="5"><col 320><col 320>
  // contains nested Lterritory/Rterritory tables.  The nested table often has
  // colgroup total 330px (320px text + 10px spacer), which was tolerated by
  // IE/MSHTML but overflows the dashed center border in Chrome.  Fit only
  // direct nested territory tables into the 310px content area; do not touch
  // the smaller detail tables whose colgroups already total ~310px.
  if (!doc || !doc.body) return;
  for (const outer of doc.querySelectorAll(
    'table.Territory[cellpadding="5"]',
  )) {
    for (const inner of outer.querySelectorAll(
      ":scope > tbody > tr > td > table.Lterritory, :scope > tbody > tr > td > table.Rterritory",
    )) {
      inner.style.width = "310px";
      inner.style.maxWidth = "310px";
      inner.style.tableLayout = "fixed";
      inner.style.marginLeft = "0px";
      inner.style.marginRight = "0px";

      const cols = [...inner.querySelectorAll(":scope > colgroup > col")];
      if (cols.length) {
        const widths = cols.map(
          (c) =>
            explicitHtmlLength(c.getAttribute("width")) ||
            explicitCssLength(c.style.width) ||
            0,
        );
        const total = widths.reduce((a, b) => a + b, 0);
        if (total > 310) {
          const last = widths[widths.length - 1] || 0;
          const keepLast = last > 0 && last <= 20 ? last : 0;
          const firstTarget = Math.max(0, 310 - keepLast);
          if (keepLast) {
            cols[0].setAttribute("width", `${firstTarget}px`);
            cols[0].style.width = `${firstTarget}px`;
            cols[cols.length - 1].setAttribute("width", `${keepLast}px`);
            cols[cols.length - 1].style.width = `${keepLast}px`;
          } else {
            const scale = 310 / total;
            cols.forEach((col, i) => {
              const w = Math.max(1, Math.floor(widths[i] * scale));
              col.setAttribute("width", `${w}px`);
              col.style.width = `${w}px`;
            });
          }
        }
      }

      for (const pre of inner.querySelectorAll(
        "td.normalTL > pre.normal, pre.normal",
      )) {
        pre.style.width = "100%";
        pre.style.maxWidth = "100%";
        pre.style.boxSizing = "border-box";
        pre.style.whiteSpace = "pre-wrap";
        pre.style.wordBreak = "break-all";
        pre.style.overflowWrap = "break-word";
      }
    }
  }
}

function protectNonBreakingNumericTokens(doc) {
  // Broad Japanese wrapping uses word-break: break-all, but numeric fields must be atomic.
  // This protects postal codes, phone-like numbers, corporate/office numbers, and yen amounts
  // from being split at the last digit in legacy table layouts.
  if (!doc || !doc.body) return;

  normalizeYenBackslashes(doc);

  const tokenRe =
    /(?:〒\s*)?\d{3}-\d{4}|\d{2,5}-\d{1,4}-\d{3,4}|\d{6,13}|[¥￥]?\d{1,3}(?:,\d{3})+(?:\s*円)?/g;
  const skipTags = new Set([
    "SCRIPT",
    "STYLE",
    "TEXTAREA",
    "INPUT",
    "SELECT",
    "OPTION",
  ]);

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || skipTags.has(parent.tagName))
        return NodeFilter.FILTER_REJECT;
      if (parent.closest('[data-egov-nowrap-token="1"]'))
        return NodeFilter.FILTER_REJECT;
      const text = node.nodeValue || "";
      tokenRe.lastIndex = 0;
      return tokenRe.test(text)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });

  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  for (const node of nodes) {
    const text = node.nodeValue || "";
    tokenRe.lastIndex = 0;
    let last = 0;
    let match;
    const frag = doc.createDocumentFragment();
    while ((match = tokenRe.exec(text))) {
      if (match.index > last)
        frag.appendChild(doc.createTextNode(text.slice(last, match.index)));
      const span = doc.createElement("span");
      span.className = "egov-nowrap-token";
      span.dataset.egovNowrapToken = "1";
      span.textContent = match[0];
      frag.appendChild(span);
      last = match.index + match[0].length;
    }
    if (last < text.length)
      frag.appendChild(doc.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }

  // Some XSLs put the postal code alone in a fixed table cell (e.g. class="jgshAddr").
  // Mark the whole cell too so inherited break-all does not split the wrapped span.
  for (const el of doc.querySelectorAll("td,th,span,div,pre")) {
    const t = (el.textContent || "").replace(/\s+/g, "").trim();
    if (/^(?:〒)?\d{3}-\d{4}$/.test(t)) {
      el.dataset.egovNowrapToken = "1";
      el.style.whiteSpace = "nowrap";
      el.style.wordBreak = "keep-all";
      el.style.overflowWrap = "normal";
    }
  }
}

function normalizeYenBackslashes(doc) {
  // Legacy Japanese forms sometimes use U+005C before amounts because old
  // Windows/MS Gothic environments rendered it as a yen mark. Modern Chrome
  // on macOS/Linux renders the same character as a backslash. For amount
  // fields only, normalize it to a real yen sign.
  if (!doc || !doc.body) return;

  const amountBackslashRe = /\\(?=\s*\d{1,3}(?:,\d{3})+(?:\s*円)?)/g;
  const skipTags = new Set(["SCRIPT", "STYLE"]);

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || skipTags.has(parent.tagName))
        return NodeFilter.FILTER_REJECT;
      return amountBackslashRe.test(node.nodeValue || "")
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });

  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    node.nodeValue = (node.nodeValue || "").replace(amountBackslashRe, "¥");
  }

  for (const el of doc.querySelectorAll("input, textarea")) {
    if (typeof el.value === "string" && amountBackslashRe.test(el.value)) {
      el.value = el.value.replace(amountBackslashRe, "¥");
    }
  }
}

function applyPrintScaleOnly(doc, { screenFit = false } = {}) {
  const win = doc.defaultView;
  if (!win || !doc.body) return;

  const A4_PX = Math.round((210 * 96) / 25.4); // CSS px換算のA4幅
  const marginPx = Math.round((10 * 96) / 25.4); // 10mm相当
  const printable = A4_PX - marginPx * 2;

  // レイアウト確定後の実幅を使う。scrollWidthが一番信用できる。
  const contentWidth = Math.max(
    doc.documentElement.scrollWidth || 0,
    doc.body.scrollWidth || 0,
    ...[...doc.querySelectorAll("table")].map(
      (t) => t.scrollWidth || t.getBoundingClientRect().width || 0,
    ),
    printable,
  );
  const scale = Math.min(1, printable / contentWidth);

  doc.documentElement.dataset.egovContentWidth = String(
    Math.ceil(contentWidth),
  );
  doc.documentElement.dataset.egovPrintScale = String(scale.toFixed(4));

  const style = doc.createElement("style");
  style.setAttribute("data-egov-viewer-print-scale", "true");
  style.textContent = `
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: white !important;
      overflow-x: ${screenFit ? "hidden" : "auto"} !important;
    }
    body {
      width: ${Math.ceil(contentWidth)}px !important;
      max-width: none !important;
    }
    @media screen {
      ${screenFit ? `body { transform: scale(${scale}); transform-origin: 0 0; }` : ""}
    }
    @page { size: A4 portrait; margin: 10mm; }
/* 修正箇所：applyPrintScaleOnly 関数内の @media print 部分 */
    @media print {
      @page {
        /* 印刷用紙に合わせ、余白はブラウザの印刷設定に委ねる（もしくは0にする） */
        size: auto;
        margin: 10mm; 
      }
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
      }
      body {
        /* ページ幅いっぱいに広げ、スケールで収める */
        width: 100% !important;
        margin: 0 auto !important;
        /* zoomは不確実なため、transformで中央揃えにする */
        transform-origin: top left;
        transform: scale(1);
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      iframe {
        width: 100% !important;
        height: auto !important;
        border: none !important;
      }
    }
  `;
  (doc.head || doc.documentElement).appendChild(style);
}

function normalizeFormLikeTextBlocks(doc) {
  // e-Gov/帳票系XSLの一部は、印字テキストを textarea/input に入れて
  // MSXML/IE系のフォーム部品の折返し・行高に依存していることがある。
  // Chrome等のtextareaは既定フォント・内側padding・改行処理が違うため、
  // 文字が横にはみ出して隣の絶対配置ブロックへ重なる。
  // 表示専用ビューアではフォームとして扱う必要がないので、同じstyleを持つ
  // div/spanに置換して、通常テキストとして改行・折返しさせる。
  const textareas = [...doc.querySelectorAll("textarea")];
  for (const ta of textareas) {
    const cs = doc.defaultView.getComputedStyle(ta);
    const div = doc.createElement("div");
    copyAttributesForPrintBlock(ta, div);
    div.textContent = ta.value || ta.textContent || "";
    div.style.cssText = ta.getAttribute("style") || "";
    div.style.display =
      cs.display === "inline" ? "inline-block" : cs.display || "block";
    div.style.boxSizing = cs.boxSizing || "border-box";
    div.style.whiteSpace = "pre-wrap";
    div.style.overflow = "hidden";
    div.style.wordBreak = "normal";
    div.style.overflowWrap = "normal";
    div.style.lineBreak = "strict";
    div.style.resize = "none";
    div.style.border = cs.borderStyle === "none" ? "none" : cs.border;
    div.style.padding = cs.padding;
    div.style.font = cs.font;
    div.style.lineHeight = cs.lineHeight;
    div.style.letterSpacing = cs.letterSpacing;
    div.style.textAlign = cs.textAlign;
    div.style.verticalAlign = cs.verticalAlign;
    if (!div.style.width && cs.width && cs.width !== "auto")
      div.style.width = cs.width;
    if (!div.style.height && cs.height && cs.height !== "auto")
      div.style.height = cs.height;
    ta.replaceWith(div);
  }

  const inputs = [...doc.querySelectorAll("input")].filter((input) => {
    const type = (input.getAttribute("type") || "text").toLowerCase();
    return ["text", "search", "tel", "url", "email", "number", ""].includes(
      type,
    );
  });
  for (const input of inputs) {
    const cs = doc.defaultView.getComputedStyle(input);
    const span = doc.createElement("span");
    copyAttributesForPrintBlock(input, span);
    span.textContent = input.value || input.getAttribute("value") || "";
    span.style.cssText = input.getAttribute("style") || "";
    span.style.display = cs.display === "block" ? "block" : "inline-block";
    span.style.boxSizing = cs.boxSizing || "border-box";
    span.style.whiteSpace = "pre";
    span.style.overflow = "hidden";
    span.style.font = cs.font;
    span.style.lineHeight = cs.lineHeight;
    span.style.letterSpacing = cs.letterSpacing;
    span.style.textAlign = cs.textAlign;
    span.style.verticalAlign = cs.verticalAlign;
    span.style.padding = cs.padding;
    span.style.border = cs.borderStyle === "none" ? "none" : cs.border;
    if (!span.style.width && cs.width && cs.width !== "auto")
      span.style.width = cs.width;
    if (!span.style.height && cs.height && cs.height !== "auto")
      span.style.height = cs.height;
    input.replaceWith(span);
  }
}

function normalizeXsltTables(doc) {
  // Nested-table first renderer fix.
  // Some e-Gov/legacy XSLs build the whole A4 form with deeply nested tables.
  // The inner tables/controls often have widths, while parent td/table elements do not.
  // Chrome then shrink-wraps outer tables differently from IE/MSXML, so wrapping and
  // positioning drift.  Instead of sizing parent tables from the outside, walk from the
  // deepest tables upward and propagate measured/declared widths to parent cells/tables.
  const win = doc.defaultView;
  if (!win || !doc.body) return;

  const style = doc.createElement("style");
  style.setAttribute("data-egov-viewer-nested-table-fix", "true");
  style.textContent = `
    table[data-egov-nested-sized="1"] {
      box-sizing: border-box !important;
      table-layout: auto !important;
      border-spacing: 0;
    }
    table[data-egov-nested-sized="1"] > tbody > tr > td,
    table[data-egov-nested-sized="1"] > tr > td,
    table[data-egov-nested-sized="1"] th {
      box-sizing: border-box !important;
      vertical-align: top;
    }
    table[data-egov-nested-sized="1"] textarea,
    table[data-egov-nested-sized="1"] input[type="text"] {
      box-sizing: border-box !important;
    }
  `;
  (doc.head || doc.documentElement).appendChild(style);

  const tables = [...doc.querySelectorAll("table")];
  tables.sort((a, b) => tableDepth(b) - tableDepth(a));

  for (const table of tables) {
    const width = measureNestedTableWidth(table, win);
    if (width > 0) {
      const px = Math.ceil(width);
      // Do not make a clearly wider explicit table smaller, but make implicit tables definite.
      const explicit =
        explicitCssLength(table.style.width) ||
        explicitHtmlLength(table.getAttribute("width"));
      const finalWidth = Math.max(px, explicit || 0);
      table.style.width = `${finalWidth}px`;
      table.style.minWidth = `${finalWidth}px`;
      table.dataset.egovNestedSized = "1";
      table.dataset.egovMeasuredWidth = String(finalWidth);

      const parentCell = table.parentElement?.closest?.("td,th");
      if (parentCell) {
        const need = finalWidth + horizontalExtras(parentCell, win);
        const current =
          explicitCssLength(parentCell.style.width) ||
          explicitHtmlLength(parentCell.getAttribute("width")) ||
          parseFloat(win.getComputedStyle(parentCell).width || "0") ||
          0;
        if (need > current + 1) {
          parentCell.style.width = `${Math.ceil(need)}px`;
          parentCell.style.minWidth = `${Math.ceil(need)}px`;
        }
      }
    }
  }

  // Outermost form tables should at least occupy A4 printable width if the XSL omitted it.
  // This prevents the whole form from collapsing to the first nested table's width.
  const A4_PX = Math.round((210 * 96) / 25.4); // 794px at CSS 96dpi
  for (const table of tables.filter(
    (t) => !t.parentElement?.closest?.("table"),
  )) {
    const explicit =
      explicitCssLength(table.style.width) ||
      explicitHtmlLength(table.getAttribute("width"));
    const measured = Number(table.dataset.egovMeasuredWidth || 0);
    const rectWidth = table.getBoundingClientRect().width || 0;
    const target = Math.max(
      explicit || 0,
      measured || 0,
      rectWidth || 0,
      A4_PX,
    );
    if (target > 0) {
      table.style.width = `${Math.ceil(target)}px`;
      table.style.minWidth = `${Math.ceil(target)}px`;
      table.dataset.egovNestedSized = "1";
    }
  }
}

function applyA4WrapConstraint(doc) {
  // Width-capping pass for nested-table forms.
  // Previous nested-table fix propagated inner widths upward, which prevents overlap but can
  // widen the whole page.  This pass does the opposite at the outer page boundary: keep the
  // form inside A4 CSS width and force text boxes/cells to wrap instead of growing parents.
  const win = doc.defaultView;
  if (!win || !doc.body) return;

  const A4_PX = Math.round((210 * 96) / 25.4); // 794px at CSS 96dpi
  const printable = findPrintableWidth(doc, win, A4_PX);

  const style = doc.createElement("style");
  style.setAttribute("data-egov-viewer-a4-wrap-fix", "true");
  style.textContent = `
    html, body { max-width: ${printable}px !important; overflow-x: hidden !important; }
    table[data-egov-a4-capped="1"] {
      table-layout: fixed !important;
      max-width: ${printable}px !important;
      min-width: 0 !important;
      box-sizing: border-box !important;
    }
    table[data-egov-a4-capped="1"] td,
    table[data-egov-a4-capped="1"] th {
      min-width: 0 !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
      overflow: visible !important;
      white-space: normal !important;
      word-break: break-all !important;
      overflow-wrap: anywhere !important;
      line-break: strict !important;
    }
    table[data-egov-a4-capped="1"] div,
    table[data-egov-a4-capped="1"] span,
    table[data-egov-a4-capped="1"] p,
    table[data-egov-a4-capped="1"] font,
    table[data-egov-a4-capped="1"] textarea,
    table[data-egov-a4-capped="1"] input[type="text"] {
      max-width: 100% !important;
      box-sizing: border-box !important;
      white-space: pre-wrap !important;
      word-break: break-all !important;
      overflow-wrap: anywhere !important;
      line-break: strict !important;
    }
  `;
  (doc.head || doc.documentElement).appendChild(style);

  const outerTables = [...doc.querySelectorAll("table")].filter(
    (t) => !t.parentElement?.closest?.("table"),
  );
  for (const table of outerTables) {
    capTableTree(table, printable, win);
  }

  // Also cap any absolutely positioned text boxes that are not inside the main table tree.
  for (const el of [
    ...doc.body.querySelectorAll("div,span,p,font,textarea,input"),
  ]) {
    if (el.closest("table")) continue;
    capTextElementToAvailableWidth(el, printable, win);
  }
}

function relaxClippingAfterWrap(doc) {
  // A4幅で折り返したあと、旧帳票の固定height/overflow:hiddenが残ると
  // 文字が「折り返されずに途切れた」ように見える。
  // 横方向はA4内に抑えたまま、縦方向だけ伸びる表示専用レイアウトにする。
  const style = doc.createElement("style");
  style.setAttribute("data-egov-viewer-no-clip", "true");
  style.textContent = `
    td, th, div, span, p, font, textarea, input[type="text"] {
      overflow-y: visible !important;
      text-overflow: clip !important;
    }
    table[data-egov-a4-capped="1"] td,
    table[data-egov-a4-capped="1"] th {
      height: auto !important;
    }
    table[data-egov-a4-capped="1"] div,
    table[data-egov-a4-capped="1"] span,
    table[data-egov-a4-capped="1"] p,
    table[data-egov-a4-capped="1"] font,
    table[data-egov-a4-capped="1"] textarea,
    table[data-egov-a4-capped="1"] input[type="text"] {
      height: auto !important;
      min-height: 1em;
      white-space: pre-wrap !important;
      overflow-wrap: anywhere !important;
      word-break: break-all !important;
    }
  `;
  (doc.head || doc.documentElement).appendChild(style);

  const win = doc.defaultView;
  if (!win) return;
  for (const el of doc.querySelectorAll(
    "td,th,div,span,p,font,textarea,input",
  )) {
    const cs = win.getComputedStyle(el);
    const h =
      parseFloat(cs.height || "0") || explicitCssLength(el.style?.height) || 0;
    if (h > 0) el.style.minHeight = `${Math.ceil(h)}px`;
    if (/hidden/i.test(cs.overflowY) || /hidden/i.test(cs.overflow))
      el.style.overflowY = "visible";
  }
}

function hardWrapCappedTableText(doc) {
  // Last-resort legacy form fix: if the XSL uses nested tables as text boxes,
  // CSS wrapping can still lose against table intrinsic sizing / nowrap attrs.
  // After the A4 cap is applied, insert real line breaks based on the rendered
  // content width.  This is intentionally limited to capped tables.
  const win = doc.defaultView;
  if (!win || !doc.body) return;

  const style = doc.createElement("style");
  style.setAttribute("data-egov-viewer-hard-wrap", "true");
  style.textContent = `
    table[data-egov-a4-capped="1"] [nowrap],
    table[data-egov-a4-capped="1"] .nowrap { white-space: normal !important; }
    table[data-egov-a4-capped="1"] textarea,
    table[data-egov-a4-capped="1"] input[type="text"],
    table[data-egov-a4-capped="1"] div,
    table[data-egov-a4-capped="1"] span,
    table[data-egov-a4-capped="1"] p,
    table[data-egov-a4-capped="1"] font,
    table[data-egov-a4-capped="1"] td,
    table[data-egov-a4-capped="1"] th {
      white-space: pre-wrap !important;
      word-break: break-all !important;
      overflow-wrap: anywhere !important;
      line-break: strict !important;
      overflow: visible !important;
    }
  `;
  (doc.head || doc.documentElement).appendChild(style);

  // Remove HTML nowrap attributes that often come from old IE-oriented XSL.
  for (const el of doc.querySelectorAll(
    'table[data-egov-a4-capped="1"] [nowrap]',
  )) {
    el.removeAttribute("nowrap");
  }

  const canvas = doc.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const candidates = [];
  for (const table of doc.querySelectorAll('table[data-egov-a4-capped="1"]')) {
    candidates.push(
      ...table.querySelectorAll("textarea,input,div,span,p,font,td,th"),
    );
  }

  for (const el of candidates) {
    if (!isHardWrapLeaf(el)) continue;
    const text = getPrintableText(el);
    if (!text || text.trim().length < 2) continue;

    const cs = win.getComputedStyle(el);
    let width = contentWidth(el, cs);
    if (!Number.isFinite(width) || width < 12) {
      const cell = el.closest("td,th");
      if (cell)
        width = Math.max(12, contentWidth(cell, win.getComputedStyle(cell)));
    }
    if (!Number.isFinite(width) || width < 12) continue;

    // Only touch things that are actually overflowing or likely to become a single long run.
    const plain = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const longestRun = Math.max(
      ...plain.split(/\s|\n/).map((x) => [...x].length),
      0,
    );
    const overflows = (el.scrollWidth || 0) > (el.clientWidth || width) + 1;
    if (!overflows && longestRun < 8) continue;

    ctx.font = computedCanvasFont(cs);
    const wrapped = wrapTextByCanvas(plain, Math.max(8, width - 1), ctx);
    if (!wrapped || wrapped === plain) continue;

    setPrintableText(el, wrapped, cs);
  }
}

function isHardWrapLeaf(el) {
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "INPUT") return true;
  if (!["DIV", "SPAN", "P", "FONT", "TD", "TH"].includes(tag)) return false;
  // Do not collapse structural containers.  Leaf text boxes only.
  const elementChildren = [...el.children].filter(
    (ch) => !["BR", "WBR"].includes(ch.tagName),
  );
  if (elementChildren.length > 0) return false;
  return true;
}

function setPrintableText(el, text, cs) {
  if (el.tagName === "TEXTAREA") {
    el.value = text;
    el.textContent = text;
    el.setAttribute("wrap", "soft");
  } else if (el.tagName === "INPUT") {
    // input cannot render multiple lines; replace it with a span.
    const span = el.ownerDocument.createElement("span");
    copyAttributesForPrintBlock(el, span);
    span.textContent = text;
    span.style.cssText = el.getAttribute("style") || "";
    span.style.display = "inline-block";
    span.style.width = cs.width;
    span.style.minHeight = cs.height;
    span.style.font = cs.font;
    span.style.lineHeight = cs.lineHeight;
    span.style.letterSpacing = cs.letterSpacing;
    span.style.textAlign = cs.textAlign;
    span.style.whiteSpace = "pre-wrap";
    span.style.wordBreak = "break-all";
    span.style.overflowWrap = "anywhere";
    span.style.overflow = "visible";
    el.replaceWith(span);
  } else {
    el.textContent = text;
    el.style.whiteSpace = "pre-wrap";
    el.style.wordBreak = "break-all";
    el.style.overflowWrap = "anywhere";
    el.style.overflow = "visible";
    if (["SPAN", "FONT"].includes(el.tagName))
      el.style.display = "inline-block";
  }
}

function findPrintableWidth(doc, win, fallback) {
  // Prefer an explicit page/form width if it is <= A4; otherwise A4.
  let best = fallback;
  for (const el of [
    doc.body,
    ...doc.querySelectorAll("body > table, body > div"),
  ]) {
    const w =
      explicitCssLength(el.style?.width) ||
      explicitHtmlLength(el.getAttribute?.("width")) ||
      parseFloat(win.getComputedStyle(el).width || "0") ||
      0;
    if (w > 300 && w <= fallback) best = Math.min(best, w);
  }
  return Math.floor(best || fallback);
}

function capTableTree(table, available, win) {
  if (!table || available <= 0) return;
  const extras = horizontalExtras(table, win);
  const cap = Math.max(120, available - extras);
  const current =
    table.getBoundingClientRect().width ||
    Number(table.dataset.egovMeasuredWidth || 0) ||
    table.scrollWidth ||
    0;

  table.dataset.egovA4Capped = "1";
  table.style.width = `${Math.ceil(Math.min(current || cap, cap))}px`;
  table.style.maxWidth = `${Math.ceil(cap)}px`;
  table.style.minWidth = "0px";
  table.style.tableLayout = "fixed";

  for (const row of [...table.rows]) {
    const cells = [...row.cells];
    if (!cells.length) continue;
    const declared = cells.map(
      (cell) =>
        explicitCssLength(cell.style.width) ||
        explicitHtmlLength(cell.getAttribute("width")) ||
        0,
    );
    const sumDeclared = declared.reduce((a, b) => a + b, 0);
    const equal =
      cap /
      cells.reduce(
        (a, c) => a + Math.max(1, Number(c.getAttribute("colspan") || 1)),
        0,
      );

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const span = Math.max(1, Number(cell.getAttribute("colspan") || 1));
      let cw = declared[i] || equal * span;
      if (sumDeclared > cap && declared[i])
        cw = (declared[i] * cap) / sumDeclared;
      cw = Math.max(24, Math.min(cw, cap));

      cell.style.width = `${Math.floor(cw)}px`;
      cell.style.maxWidth = `${Math.floor(cw)}px`;
      cell.style.minWidth = "0px";

      for (const childTable of [...cell.children].filter(
        (ch) => ch.tagName === "TABLE",
      )) {
        capTableTree(childTable, cw - horizontalExtras(cell, win), win);
      }
      for (const el of [
        ...cell.querySelectorAll("div,span,p,font,textarea,input"),
      ]) {
        if (
          el.closest("table") &&
          el.closest("table") !== table &&
          !cell.contains(el.closest("table"))
        )
          continue;
        capTextElementToAvailableWidth(
          el,
          cw - horizontalExtras(cell, win),
          win,
        );
      }
    }
  }
}

function capTextElementToAvailableWidth(el, available, win) {
  if (!el || available <= 0) return;
  const cap = Math.max(16, available - horizontalExtras(el, win));
  const own =
    explicitCssLength(el.style?.width) ||
    explicitHtmlLength(el.getAttribute?.("width")) ||
    0;
  const rect = el.getBoundingClientRect?.();
  const current = Math.max(own || 0, rect?.width || 0, el.scrollWidth || 0);
  if (current > cap + 1 || own > cap + 1) {
    el.style.width = `${Math.floor(cap)}px`;
  }
  el.style.maxWidth = `${Math.floor(cap)}px`;
  el.style.minWidth = "0px";
  el.style.whiteSpace = "pre-wrap";
  el.style.wordBreak = "break-all";
  el.style.overflowWrap = "anywhere";
  el.style.lineBreak = "strict";
  el.style.overflow = "visible";
  // 固定高のフォーム部品由来だと折返し後に下が切れるため、表示専用では縦方向を伸ばす。
  const h =
    explicitCssLength(el.style?.height) ||
    parseFloat(win.getComputedStyle(el).height || "0") ||
    0;
  if (h > 0) {
    el.style.minHeight = `${Math.ceil(h)}px`;
    el.style.height = "auto";
  }
  if (el.tagName === "TEXTAREA") {
    el.setAttribute("wrap", "soft");
    el.style.height = "auto";
  }
}

function tableDepth(table) {
  let d = 0;
  let p = table.parentElement;
  while (p) {
    if (p.tagName === "TABLE") d++;
    p = p.parentElement;
  }
  return d;
}

function measureNestedTableWidth(table, win) {
  const explicit =
    explicitCssLength(table.style.width) ||
    explicitHtmlLength(table.getAttribute("width"));
  const cs = win.getComputedStyle(table);
  const computed = parseFloat(cs.width || "0") || 0;
  const rect = table.getBoundingClientRect();
  const scroll = table.scrollWidth || 0;

  let rowMax = 0;
  for (const row of [...table.rows]) {
    let rowWidth = 0;
    for (const cell of [...row.cells])
      rowWidth += measureNestedCellWidth(cell, win);
    rowMax = Math.max(rowMax, rowWidth);
  }

  return Math.max(
    explicit || 0,
    rowMax || 0,
    scroll || 0,
    rect.width || 0,
    computed || 0,
  );
}

function measureNestedCellWidth(cell, win) {
  const own =
    explicitCssLength(cell.style.width) ||
    explicitHtmlLength(cell.getAttribute("width"));
  const cs = win.getComputedStyle(cell);
  const computed = parseFloat(cs.width || "0") || 0;
  let inner = 0;

  for (const child of [...cell.children]) {
    if (child.tagName === "TABLE") {
      inner = Math.max(
        inner,
        Number(child.dataset.egovMeasuredWidth || 0),
        measureNestedTableWidth(child, win),
      );
      continue;
    }
    inner = Math.max(inner, measureElementWidth(child, win));
  }

  // Text-only cells still need their rendered nowrap/pre width, otherwise parent collapses.
  if (!cell.children.length && cell.textContent?.trim()) {
    inner = Math.max(
      inner,
      cell.scrollWidth || 0,
      cell.getBoundingClientRect().width || 0,
    );
  }

  return Math.max(own || 0, computed || 0, inner + horizontalExtras(cell, win));
}

function measureElementWidth(el, win) {
  const own =
    explicitCssLength(el.style?.width) ||
    explicitHtmlLength(el.getAttribute?.("width"));
  const cs = win.getComputedStyle(el);
  const computed = parseFloat(cs.width || "0") || 0;
  const rect = el.getBoundingClientRect?.();
  const scroll = el.scrollWidth || 0;
  return Math.max(own || 0, computed || 0, rect?.width || 0, scroll || 0);
}

function horizontalExtras(el, win) {
  const cs = win.getComputedStyle(el);
  return (
    (parseFloat(cs.paddingLeft) || 0) +
    (parseFloat(cs.paddingRight) || 0) +
    (parseFloat(cs.borderLeftWidth) || 0) +
    (parseFloat(cs.borderRightWidth) || 0)
  );
}

function inferTableColumnWidths(table, win) {
  const widths = [];
  const rows = [...table.rows];
  for (const row of rows) {
    let col = 0;
    for (const cell of [...row.cells]) {
      const span = Math.max(1, Number(cell.getAttribute("colspan") || 1));
      const w = inferCellWidth(cell, win);
      if (w > 0) {
        const per = w / span;
        for (let i = 0; i < span; i++)
          widths[col + i] = Math.max(widths[col + i] || 0, per);
      }
      col += span;
    }
  }
  return widths.map((w) => Math.round(w || 0));
}

function inferCellWidth(cell, win) {
  const own =
    explicitCssLength(cell.style.width) ||
    explicitHtmlLength(cell.getAttribute("width"));
  if (own) return own;
  const cs = win.getComputedStyle(cell);
  const computed = parseFloat(cs.width || "0");
  // computed widthが中身なしで出ている場合は信用しすぎない。
  if (Number.isFinite(computed) && computed > 8 && cell.children.length === 0)
    return computed;

  let max = 0;
  for (const child of [...cell.children]) {
    const cstyle = child.style || {};
    const cw =
      explicitCssLength(cstyle.width) ||
      explicitHtmlLength(child.getAttribute?.("width"));
    if (cw) max = Math.max(max, cw);
    const ccs = win.getComputedStyle(child);
    const rect = child.getBoundingClientRect();
    const bw = rect.width || parseFloat(ccs.width || "0");
    if (Number.isFinite(bw) && bw > 8) max = Math.max(max, bw);
  }
  if (max > 0) {
    const pl = parseFloat(cs.paddingLeft || "0") || 0;
    const pr = parseFloat(cs.paddingRight || "0") || 0;
    const bl = parseFloat(cs.borderLeftWidth || "0") || 0;
    const br = parseFloat(cs.borderRightWidth || "0") || 0;
    return max + pl + pr + bl + br;
  }
  return 0;
}

function applyTableWidth(table, colWidths, total, doc) {
  table.style.width = `${Math.ceil(total)}px`;
  table.style.tableLayout = "fixed";
  table.dataset.egovTableSized = "1";

  let colgroup = table.querySelector(":scope > colgroup");
  if (!colgroup) {
    colgroup = doc.createElement("colgroup");
    table.insertBefore(colgroup, table.firstChild);
  }
  colgroup.replaceChildren(
    ...colWidths.map((w) => {
      const col = doc.createElement("col");
      if (w > 0) col.style.width = `${Math.ceil(w)}px`;
      return col;
    }),
  );
}

function explicitCssLength(v) {
  if (!v) return 0;
  const m = String(v)
    .trim()
    .match(/^([0-9.]+)\s*(px|pt|mm|cm|in)?$/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const unit = (m[2] || "px").toLowerCase();
  if (unit === "px") return n;
  if (unit === "pt") return (n * 96) / 72;
  if (unit === "mm") return (n * 96) / 25.4;
  if (unit === "cm") return (n * 96) / 2.54;
  if (unit === "in") return n * 96;
  return 0;
}

function explicitHtmlLength(v) {
  if (!v) return 0;
  const s = String(v).trim();
  if (s.endsWith("%")) return 0;
  return explicitCssLength(s);
}

function applyIeLikeWrapEmulation(doc) {
  const mode = compatSelect?.value || "iewrap";
  if (mode !== "iewrap") return;
  const win = doc.defaultView;
  if (!win) return;

  const style = doc.createElement("style");
  style.setAttribute("data-egov-viewer-ie-wrap", "true");
  style.textContent = `
    textarea, .egov-viewer-formtext, [data-egov-force-wrap="1"] {
      box-sizing: border-box !important;
      overflow: visible !important;
      white-space: pre-wrap !important;
      word-break: break-all !important;
      overflow-wrap: anywhere !important;
      line-break: strict !important;
    }
  `;
  (doc.head || doc.documentElement).appendChild(style);

  const canvas = doc.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const candidates = [
    ...doc.body.querySelectorAll("textarea,input,div,span,p"),
  ].filter((el) => isWrapCandidate(el, win));

  for (const el of candidates) {
    const cs = win.getComputedStyle(el);
    const rawText = getPrintableText(el);
    if (!rawText || rawText.trim().length < 8) continue;

    const width = contentWidth(el, cs);
    if (!Number.isFinite(width) || width < 20) continue;

    ctx.font = computedCanvasFont(cs);
    const wrapped = wrapTextByCanvas(rawText, width, ctx);
    if (!wrapped || wrapped === rawText) continue;

    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const div = doc.createElement(el.tagName === "INPUT" ? "span" : "div");
      copyAttributesForPrintBlock(el, div);
      div.style.cssText = el.getAttribute("style") || "";
      div.textContent = wrapped;
      div.dataset.egovForceWrap = "1";
      div.style.display =
        cs.display === "inline" ? "inline-block" : cs.display || "block";
      div.style.position = cs.position;
      div.style.left = cs.left;
      div.style.top = cs.top;
      div.style.width = cs.width;
      div.style.height = cs.height;
      div.style.font = cs.font;
      div.style.lineHeight = cs.lineHeight;
      div.style.letterSpacing = cs.letterSpacing;
      div.style.textAlign = cs.textAlign;
      div.style.padding = cs.padding;
      div.style.border = cs.borderStyle === "none" ? "none" : cs.border;
      el.replaceWith(div);
    } else {
      el.dataset.egovForceWrap = "1";
      el.textContent = wrapped;
    }
  }
}

function isWrapCandidate(el, win) {
  if (!el || (!el.textContent && !("value" in el))) return false;
  const tag = el.tagName;
  if (!["TEXTAREA", "INPUT", "DIV", "SPAN", "P"].includes(tag)) return false;
  if (tag === "INPUT") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (!["text", "search", "tel", "url", "email", "number", ""].includes(type))
      return false;
  }
  const cs = win.getComputedStyle(el);
  const pos = cs.position;
  const width = parseFloat(cs.width);
  const text = getPrintableText(el).replace(/\s+/g, "");
  if (text.length < 8) return false;
  // 帳票XSLは絶対配置 + 固定幅の小箱にテキストを流し込むことが多い。
  // それ以外まで触ると通常の法令本文が壊れるので、候補を絞る。
  if (!Number.isFinite(width) || width <= 0) return false;
  if (
    pos !== "absolute" &&
    pos !== "fixed" &&
    tag !== "TEXTAREA" &&
    tag !== "INPUT"
  )
    return false;
  if (el.children.length > 0 && tag !== "TEXTAREA") return false;
  return true;
}

function getPrintableText(el) {
  if (el.tagName === "TEXTAREA") return el.value || el.textContent || "";
  if (el.tagName === "INPUT") return el.value || el.getAttribute("value") || "";
  return el.textContent || "";
}

function contentWidth(el, cs) {
  const w = parseFloat(cs.width || "0");
  const pl = parseFloat(cs.paddingLeft || "0") || 0;
  const pr = parseFloat(cs.paddingRight || "0") || 0;
  const bl = parseFloat(cs.borderLeftWidth || "0") || 0;
  const br = parseFloat(cs.borderRightWidth || "0") || 0;
  if (cs.boxSizing === "border-box") return Math.max(1, w - pl - pr - bl - br);
  return Math.max(1, w);
}

function computedCanvasFont(cs) {
  // CSS font shorthandが空になるケースに備える。
  return cs.font && cs.font !== ""
    ? cs.font
    : `${cs.fontStyle} ${cs.fontVariant} ${cs.fontWeight} ${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily}`;
}

function wrapTextByCanvas(text, maxWidth, ctx) {
  const paragraphs = String(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  const out = [];
  for (const para of paragraphs) {
    let line = "";
    for (const ch of [...para]) {
      // IE風に、禁則よりも「箱から出さない」ことを優先する。
      const next = line + ch;
      if (line && ctx.measureText(next).width > maxWidth) {
        out.push(line);
        line = ch;
      } else {
        line = next;
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

function copyAttributesForPrintBlock(from, to) {
  for (const attr of from.attributes) {
    if (
      ["value", "type", "rows", "cols", "name"].includes(
        attr.name.toLowerCase(),
      )
    )
      continue;
    to.setAttribute(attr.name, attr.value);
  }
  to.classList.add("egov-viewer-formtext");
}

async function rewriteAssetUrlsInHtml(html, basePath) {
  // ZIP内に画像等がある場合だけ相対URLをblob化。CSS無しの帳票でも副作用はほぼない。
  const doc = new DOMParser().parseFromString(html, "text/html");
  await rewriteAssetUrls(doc, basePath);
  return doc.documentElement.outerHTML;
}

async function loadResolvedXsl(xslFile, seen = new Set()) {
  const key = normalizePath(xslFile.name);
  if (seen.has(key))
    throw new Error(`XSL include/importが循環しています: ${xslFile.name}`);
  seen.add(key);
  const parser = new DOMParser();
  const doc = parser.parseFromString(
    stripDoctype(xslFile.text || ""),
    "application/xml",
  );
  if (doc.querySelector("parsererror"))
    throw new Error(`XSLのパースに失敗: ${xslFile.name}`);

  const nodes = [...doc.querySelectorAll("include, import")].filter(
    (n) =>
      /stylesheet|transform/.test(n.parentElement?.localName || "") ||
      n.namespaceURI?.includes("XSL"),
  );
  for (const node of nodes) {
    const href = node.getAttribute("href");
    if (!href) continue;
    const inc = findEntryRelative(href, xslFile.name);
    if (!inc)
      throw new Error(`XSL参照ファイルがZIP内に見つかりません: ${href}`);
    const incDoc = await loadResolvedXsl(inc, new Set(seen));
    const imported = [...incDoc.documentElement.childNodes].map((ch) =>
      doc.importNode(ch, true),
    );
    node.replaceWith(...imported);
  }
  return doc;
}

async function injectLinkedCss(sourceBody, basePath) {
  const links = [
    ...(sourceBody.querySelectorAll?.('link[rel~="stylesheet"][href]') || []),
  ];
  for (const link of links) {
    const href = link.getAttribute("href");
    const css = findEntryRelative(href, basePath);
    if (css?.text) {
      const style = document.createElement("style");
      style.textContent = css.text;
      viewer.prepend(style);
    }
  }
}

async function rewriteAssetUrls(root, basePath) {
  const attrs = ["src", "href"];
  const els = [...root.querySelectorAll("*")];
  for (const el of els) {
    for (const attr of attrs) {
      const value = el.getAttribute(attr);
      if (!value || /^(https?:|data:|blob:|#|mailto:|javascript:)/i.test(value))
        continue;
      const entry = findEntryRelative(value, basePath);
      if (!entry || isTextLike(entry.lower)) continue;
      if (!entry.blobUrl) {
        const blob = await entry.zipEntry.async("blob");
        entry.blobUrl = URL.createObjectURL(blob);
        objectUrls.push(entry.blobUrl);
      }
      el.setAttribute(attr, entry.blobUrl);
    }
  }
}

function findEntryRelative(href, basePath) {
  const clean = normalizePath(href.split("#")[0].split("?")[0]);
  return (
    allEntries.get(clean) ||
    allEntries.get(normalizePath(dirname(basePath) + "/" + clean)) ||
    allEntries.get(normalizePath("/" + clean)) ||
    null
  );
}

async function entryBlob(entry, type = "") {
  // ZIP内ファイルのBlobはMIME typeが空になりやすく、PDFがバイナリ文字列として
  // 表示されるブラウザがあるので、指定typeで包み直す。
  if (entry.zipEntry) {
    const buffer = await entry.zipEntry.async("arraybuffer");
    return new Blob([buffer], { type: type || guessMimeType(entry.name) });
  }
  if (entry.file) {
    if (!type || entry.file.type === type) return entry.file;
    return new Blob([await entry.file.arrayBuffer()], { type });
  }
  return new Blob([entry.text || ""], { type });
}

function guessMimeType(name = "") {
  const n = String(name).toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".gif")) return "image/gif";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".svg")) return "image/svg+xml";
  if (n.endsWith(".html") || n.endsWith(".htm"))
    return "text/html; charset=utf-8";
  if (n.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (n.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}
async function entryArrayBuffer(entry) {
  if (entry.zipEntry) return await entry.zipEntry.async("arraybuffer");
  if (entry.file) return await entry.file.arrayBuffer();
  return new TextEncoder().encode(entry.text || "").buffer;
}

async function entryText(entry) {
  if (entry.text != null) return entry.text;
  const buffer = await entryArrayBuffer(entry);
  return decodeTextBuffer(buffer, entry.name || "");
}

function decodeTextBuffer(buffer, name = "") {
  const bytes = new Uint8Array(buffer);
  // UTF-8 BOM
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  // UTF-16 BOMs
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }

  // XML/HTMLのencoding宣言があれば優先
  const head = new TextDecoder("ascii").decode(
    bytes.subarray(0, Math.min(bytes.length, 512)),
  );
  const m =
    head.match(/encoding\s*=\s*["']([^"']+)["']/i) ||
    head.match(/charset\s*=\s*["']?([a-z0-9_\-]+)/i);
  if (m) {
    const enc = normalizeEncoding(m[1]);
    try {
      return new TextDecoder(enc).decode(bytes);
    } catch (_) {}
  }

  // CSV/TXTは役所系でShift_JIS/CP932が多い。UTF-8として厳格に読めなければShift_JISへ。
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (_) {
    try {
      return new TextDecoder("shift_jis").decode(bytes);
    } catch (__) {}
    try {
      return new TextDecoder("windows-31j").decode(bytes);
    } catch (__) {}
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function normalizeEncoding(enc) {
  const e = String(enc || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (
    [
      "shift-jis",
      "shift_jis",
      "sjis",
      "ms-kanji",
      "cp932",
      "windows-31j",
    ].includes(e)
  )
    return "shift_jis";
  if (["utf8", "utf-8"].includes(e)) return "utf-8";
  if (["utf16", "utf-16", "utf-16le"].includes(e)) return "utf-16le";
  if (e === "utf-16be") return "utf-16be";
  return e;
}

async function entryObjectUrl(entry, type = "") {
  if (!entry.blobUrl) {
    const blob = await entryBlob(entry, type);
    entry.blobUrl = URL.createObjectURL(blob);
    objectUrls.push(entry.blobUrl);
  }
  return entry.blobUrl;
}

async function renderPdf(entry) {
  viewer.replaceChildren();
  viewer.className = "xslt-host generic-viewer-host";
  const url = await entryObjectUrl(entry, "application/pdf");

  const wrap = document.createElement("div");
  wrap.className = "pdf-wrap";

  const frame = document.createElement("iframe");
  frame.id = "xsltFrame";
  frame.className = "file-frame pdf-frame";
  frame.src = url + "#toolbar=1&navpanes=0&view=FitH";

  const fallback = document.createElement("div");
  fallback.className = "pdf-fallback";
  fallback.innerHTML = `PDFがブラウザ内で表示されない場合は <a href="${url}" target="_blank" rel="noopener">別タブで開く</a> / <a href="${url}" download="${escapeAttr(entry.name)}">保存</a>`;

  wrap.append(frame, fallback);
  viewer.append(wrap);
  printBtn.disabled = false;
  setStatus(`PDF表示中: ${entry.name}`);
}

async function renderImage(entry) {
  viewer.replaceChildren();
  viewer.className = "file-preview";
  const url = await entryObjectUrl(entry);
  const img = document.createElement("img");
  img.className = "image-preview";
  img.src = url;
  img.alt = entry.name;
  viewer.append(img);
  printBtn.disabled = false;
  setStatus(`画像表示中: ${entry.name}`);
}

async function renderHtmlFile(entry) {
  viewer.replaceChildren();
  viewer.className = "xslt-host generic-viewer-host";
  let html = await entryText(entry);
  html = await rewriteAssetUrlsInHtml(html, entry.name);
  const frame = document.createElement("iframe");
  frame.id = "xsltFrame";
  frame.className = "file-frame html-frame";
  frame.setAttribute("sandbox", "allow-same-origin allow-modals");
  frame.srcdoc = html;
  viewer.append(frame);
  printBtn.disabled = false;
  setStatus(`HTML表示中: ${entry.name}`);
}

async function renderTextFile(entry) {
  viewer.replaceChildren();
  viewer.className = "text-preview";
  const pre = document.createElement("pre");
  pre.className = "source-preview";
  pre.textContent = await entryText(entry);
  viewer.append(pre);
  printBtn.disabled = false;
  setStatus(`テキスト表示中: ${entry.name}`);
}

async function renderCsv(entry) {
  viewer.replaceChildren();
  viewer.className = "csv-preview";
  const text = await entryText(entry);
  const rows = parseCsv(text).slice(0, 5000);
  const table = document.createElement("table");
  table.className = "csv-table";
  const frag = document.createDocumentFragment();
  rows.forEach((row, ri) => {
    const tr = document.createElement("tr");
    row.forEach((cell) => {
      const c = document.createElement(ri === 0 ? "th" : "td");
      c.textContent = cell;
      tr.append(c);
    });
    frag.append(tr);
  });
  table.append(frag);
  viewer.append(table);
  printBtn.disabled = false;
  setStatus(
    `CSV表示中: ${entry.name}${rows.length >= 5000 ? "（先頭5000行）" : ""}`,
  );
}

function parseCsv(text) {
  const rows = [];
  let row = [],
    field = "",
    q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') q = false;
      else field += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (ch !== "\r") field += ch;
    }
  }
  row.push(field);
  rows.push(row);
  return rows;
}

async function renderTiff(entry) {
  viewer.replaceChildren();
  viewer.className = "tiff-preview file-preview";
  await ensureUtif();
  const buffer = await entryArrayBuffer(entry);
  if (!window.UTIF) throw new Error("TIFFデコーダを読み込めませんでした。");
  const ifds = UTIF.decode(buffer);
  if (!ifds.length) throw new Error("TIFFページが見つかりません。");
  UTIF.decodeImages(buffer, ifds);
  ifds.forEach((ifd, i) => {
    const rgba = UTIF.toRGBA8(ifd);
    const canvas = document.createElement("canvas");
    canvas.width = ifd.width;
    canvas.height = ifd.height;
    const ctx = canvas.getContext("2d");
    const imageData = ctx.createImageData(ifd.width, ifd.height);
    imageData.data.set(rgba);
    ctx.putImageData(imageData, 0, 0);
    const wrap = document.createElement("figure");
    wrap.className = "tiff-page";
    const cap = document.createElement("figcaption");
    cap.textContent = `TIFF page ${i + 1} / ${ifds.length}`;
    wrap.append(cap, canvas);
    viewer.append(wrap);
  });
  printBtn.disabled = false;
  setStatus(`TIFF表示中: ${entry.name}`);
}

function ensureUtif() {
  if (window.UTIF) return Promise.resolve();
  if (window.__egovUtifLoading) return window.__egovUtifLoading;
  window.__egovUtifLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.min.js";
    script.onload = resolve;
    script.onerror = () =>
      reject(
        new Error(
          "UTIF.jsの読み込みに失敗しました。TIFF表示にはインターネット接続が必要です。",
        ),
      );
    document.head.append(script);
  });
  return window.__egovUtifLoading;
}

async function renderDownloadOnly(entry) {
  viewer.replaceChildren();
  viewer.className = "file-preview";
  const box = document.createElement("div");
  box.className = "download-card";
  const name = document.createElement("strong");
  name.textContent = entry.name;
  const p = document.createElement("p");
  p.textContent =
    "この形式は内蔵ビューア対象外です。必要なら保存して外部アプリで開いてください。";
  const a = document.createElement("a");
  a.href = await entryObjectUrl(entry);
  a.download = basename(entry.name);
  a.textContent = "ダウンロード";
  box.append(name, p, a);
  viewer.append(box);
  printBtn.disabled = true;
  setStatus(`未対応形式: ${entry.name}`);
}

// --- fallback renderer: rough but useful when no XSL is available ---
function renderLawFallback(doc, name) {
  viewer.replaceChildren();
  viewer.className = "law-document fallback-document";
  const root = doc.documentElement;
  const title = textOfFirst(root, "LawTitle") || name;
  viewer.append(el("h1", "law-title", title));
  const num = root.getAttribute("LawNum") || textOfFirst(root, "LawNum");
  if (num) viewer.append(el("div", "law-meta", num));
  appendFallback(viewer, firstElement(root, "LawBody") || root);
  buildToc();
  printBtn.disabled = false;
  setStatus(`簡易表示中: ${name}`);
}

function appendFallback(parent, node) {
  for (const child of node.childNodes) {
    const rendered = renderFallbackNode(child);
    if (rendered) parent.append(rendered);
  }
}
function renderFallbackNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.textContent.replace(/\s+/g, " ");
    return t.trim() ? document.createTextNode(t) : null;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const tag = node.localName;
  if (tag === "LawTitle" || tag === "LawNum") return null;
  if (tag === "Article") return blockFallback(node, "article");
  if (/Title$/.test(tag) || /Label$/.test(tag) || tag === "ArticleCaption")
    return blockFallback(
      node,
      tag === "ArticleTitle" ? "article-title" : "section-title",
    );
  if (tag === "Paragraph") return paragraphFallback(node);
  if (tag === "Item" || /^Subitem\d+$/.test(tag)) return itemFallback(node);
  if (tag === "Sentence") return inlineFallback(node, "span", "sentence");
  if (tag === "Ruby") return rubyFallback(node);
  if (tag === "Sup") return inlineFallback(node, "sup");
  if (tag === "Sub") return inlineFallback(node, "sub");
  if (tag === "TableStruct" || tag === "Table") return tableFallback(node);
  if (
    /^(Law|LawBody|MainProvision|Part|Chapter|Section|Subsection|Division|ParagraphSentence|ItemSentence|Column|TableColumn|TableHeaderRow|TableHeaderColumn)$/.test(
      tag,
    )
  ) {
    const f = document.createDocumentFragment();
    appendFallback(f, node);
    return f;
  }
  return blockFallback(node, "generic-block");
}
function paragraphFallback(node) {
  const row = el("div", "paragraph");
  const num =
    textOfFirst(node, "ParagraphNum") || node.getAttribute("Num") || "";
  row.append(
    el("div", "paragraph-number" + (num ? "" : " empty-num"), num || "1"),
  );
  const body = el("div", "paragraph-body");
  for (const ch of node.childNodes)
    if (!(ch.nodeType === 1 && ch.localName === "ParagraphNum")) {
      const r = renderFallbackNode(ch);
      if (r) body.append(r);
    }
  row.append(body);
  return row;
}
function itemFallback(node) {
  const row = el("div", "item");
  const title = [...node.children].find((c) => /Title$/.test(c.localName));
  row.append(el("div", "item-title", title ? textOf(title) : ""));
  const body = el("div", "item-body");
  for (const ch of node.childNodes)
    if (ch !== title) {
      const r = renderFallbackNode(ch);
      if (r) body.append(r);
    }
  row.append(body);
  return row;
}
function tableFallback(node) {
  const table = document.createElement("table");
  table.className = "law-table";
  const rows = [...node.getElementsByTagName("TableRow")];
  for (const rowNode of rows) {
    const tr = document.createElement("tr");
    const cells = [...rowNode.children].filter(
      (c) => /Column$/.test(c.localName) || c.localName === "TableColumn",
    );
    for (const cell of cells) {
      const td = document.createElement("td");
      appendFallback(td, cell);
      tr.append(td);
    }
    table.append(tr);
  }
  return rows.length ? table : blockFallback(node, "generic-block");
}
function rubyFallback(node) {
  const ruby = document.createElement("ruby");
  const base = firstElement(node, "RubyBase");
  const rt = firstElement(node, "Rt");
  if (base) ruby.append(textOf(base));
  if (rt) ruby.append(el("rt", "", textOf(rt)));
  return ruby;
}
function inlineFallback(node, tag = "span", cls = "") {
  const out = el(tag, cls);
  appendFallback(out, node);
  return out;
}
function blockFallback(node, cls) {
  const out = el("div", cls);
  appendFallback(out, node);
  return out;
}

function buildToc() {
  const heads = [
    ...viewer.querySelectorAll(
      "h1,h2,h3,h4,.part-title,.chapter-title,.section-title,.article-title",
    ),
  ]
    .filter((h) => h.textContent.trim())
    .slice(0, 200);
  if (!heads.length) {
    tocEl.textContent = "目次を生成できませんでした";
    tocEl.className = "toc empty";
    return;
  }
  tocEl.className = "toc";
  tocEl.replaceChildren(
    ...heads.map((h, i) => {
      if (!h.id) h.id = "toc-" + i;
      const a = document.createElement("a");
      a.href = "#" + h.id;
      a.textContent = h.textContent.trim().slice(0, 80);
      const tag = h.tagName.toLowerCase();
      a.style.setProperty(
        "--indent",
        tag === "h1" ? "0px" : tag === "h2" ? "10px" : "18px",
      );
      return a;
    }),
  );
}

function buildTocFromIframe(doc) {
  const heads = [
    ...doc.querySelectorAll(
      "h1,h2,h3,h4,.part-title,.chapter-title,.section-title,.article-title,[id]",
    ),
  ]
    .filter((h) => h.textContent.trim())
    .slice(0, 200);
  if (!heads.length) {
    tocEl.textContent = "XSLT表示では目次を生成できませんでした";
    tocEl.className = "toc empty";
    return;
  }
  tocEl.className = "toc";
  tocEl.replaceChildren(
    ...heads.map((h, i) => {
      if (!h.id) h.id = "toc-" + i;
      const a = document.createElement("a");
      a.href = "#";
      a.textContent = h.textContent.trim().replace(/\s+/g, " ").slice(0, 80);
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        document
          .querySelector("#xsltFrame")
          ?.contentDocument?.getElementById(h.id)
          ?.scrollIntoView({ block: "start" });
      });
      return a;
    }),
  );
}

function firstElement(root, tag) {
  return [...root.getElementsByTagName(tag)][0] || null;
}
function textOfFirst(root, tag) {
  const n = firstElement(root, tag);
  return n ? textOf(n) : "";
}
function textOf(node) {
  return node.textContent.replace(/\s+/g, " ").trim();
}
function el(tag, cls = "", text = "") {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}
function setStatus(msg) {
  statusEl.textContent = msg;
  statusEl.className = "status";
}
function showError(err) {
  console.error(err);
  viewer.replaceChildren();
  printBtn.disabled = true;
  statusEl.className = "status error";
  statusEl.textContent = err?.message || String(err);
}
function normalizePath(p) {
  return p
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/")
    .replace(/^\//, "");
}
function dirname(p) {
  const n = normalizePath(p);
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(0, i) : "";
}
function basename(p) {
  const n = normalizePath(p);
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) : n;
}
function stripDoctype(s) {
  return s.replace(/<!DOCTYPE[\s\S]*?>/i, "");
}
function escapeAttr(s) {
  return String(s).replace(
    /[&\"<>]/g,
    (c) => ({ "&": "&amp;", '\"': "&quot;", "<": "&lt;", ">": "&gt;" })[c],
  );
}

function decodeHtml(s) {
  const t = document.createElement("textarea");
  t.innerHTML = s;
  return t.value;
}
function resetObjectUrls() {
  for (const u of objectUrls) URL.revokeObjectURL(u);
  objectUrls = [];
}
