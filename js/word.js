// 按鈕、專案檔、Word 匯出（簡易版面與套用範本）

/* ---------- 按鈕 ---------- */
$('bUndo').onclick = undo;
$('bDel').onclick = deleteSel;
$('bClear').onclick = () => {
  if (!items.length || !confirm('確定清除這張照片的所有線條與文字？（可用復原找回）')) return;
  pushUndo();
  items = []; sel = -1;
  commit();
};

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

const baseName = name => name.replace(/\.[^.]+$/, '');

function downloadCurrent() {
  return new Promise(resolve => main.toBlob(blob => {
    downloadBlob(blob, baseName(photos[cur].name) + '_標註.png');
    resolve();
  }, 'image/png'));
}

$('bSaveAll').onclick = async () => {
  const back = cur;
  for (let i = 0; i < photos.length; i++) {
    switchTo(i);
    await downloadCurrent();
    await new Promise(r => setTimeout(r, 300));   // 連續下載間隔，避免瀏覽器漏掉
  }
  switchTo(back);
  toast('已匯出 ' + photos.length + ' 張（瀏覽器若詢問「下載多個檔案」請按允許）');
};

$('bCopy').onclick = async () => {
  try {
    if (!navigator.clipboard || !window.ClipboardItem) throw new Error('unsupported');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Promise(r => main.toBlob(r, 'image/png')) })]);
    toast('已複製，可在 Word 直接 Ctrl+V 貼上');
  } catch (err) {
    alert('此瀏覽器無法直接複製圖片，請改用「全部 PNG」後插入 Word。');
  }
};

/* ---------- 專案檔（照片原檔 + 標註 + 說明，存成一個 .json） ---------- */
function blobToDataURL(blob) {
  return new Promise(resolve => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.readAsDataURL(blob);
  });
}

async function saveProject() {
  saveCur();
  const data = { app:PROJECT_APP, version:1, fields:docFields, photos:[] };   // 舊專案檔還有 title（簡易版面的標題，已移除），讀的時候忽略
  for (const p of photos) data.photos.push({ name:p.name, role:p.role, items:p.items, image:await blobToDataURL(p.file) });
  const fname = docName() + '_專案.json';
  downloadBlob(new Blob([JSON.stringify(data)], { type:'application/json' }), fname);
  photos.forEach(p => { p.dirty = false; });
  toast('已儲存專案：' + fname);
}

async function openProject(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
    if (data.app !== PROJECT_APP || !Array.isArray(data.photos)) throw new Error('format');
  } catch (err) {
    return alert('不是這個工具的專案檔：' + file.name);
  }
  if (photos.length && !confirm('開啟專案會關閉目前所有照片，確定嗎？')) return;
  closeAll();
  docFields = data.fields || {};
  for (const d of data.photos) {
    const blob = await (await fetch(d.image)).blob();
    const { im, url } = await loadImage(blob);
    const p = addPhoto(d.name, im, url, blob);
    p.items = d.items || [];
    p.role = d.role || SITE_ROLE;   // 舊專案檔裡的 desc（照片說明，已移除的功能）直接忽略
  }
  renumber();   // 用途是加進清單後才設的，編號要重算
  for (let i = photos.length - 1; i >= 0; i--) switchTo(i);   // 每張都切過一次，更新縮圖與標註數，最後停在第 1 張
  toast('已開啟專案：' + file.name + '（' + photos.length + ' 張照片）');
}

$('bSaveProj').onclick = saveProject;

/* ---------- 設定檔（線型、符號、文字樣式、工具列設定；換電腦或瀏覽器時帶著走） ---------- */
const CONFIG_APP = PROJECT_APP + '.config';

$('bExportCfg').onclick = () => {
  const data = { app:CONFIG_APP, version:1, presets, symbols, textStyles, settings, sideWidth:parseInt($('side').style.width) || null };
  downloadBlob(new Blob([JSON.stringify(data, null, 1)], { type:'application/json' }), '復古風DOCX生成工具_設定.json');
  toast('已匯出設定檔');
};

// 整份取代（使用者指定），不合併
$('cfgFile').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = '';   // 同一個檔案再選一次也要觸發
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
    if (data.app !== CONFIG_APP || ![data.presets, data.symbols, data.textStyles].every(Array.isArray) || !data.textStyles.length) throw new Error('format');
  } catch (err) {
    return alert('不是這個工具的設定檔：' + file.name);
  }
  if (!confirm('匯入會取代目前的線型、符號、文字樣式與工具列設定，確定嗎？')) return;
  setStyles(data.presets, data.symbols, data.textStyles);
  applyUI(data);
  syncControls();   // 工具列反映新設定，並存進瀏覽器
  toast('已匯入設定檔：' + file.name);
};

/* ---------- Word 匯出（.docx = zip 包 XML，自行產生，不靠外部套件） ---------- */
const WORD_MAX_PX = 2000;                            // Word 內照片長邊上限，A4 列印約 300dpi
const PAGE = { w:11906, h:16838, margin:1134 };      // A4，邊界 2 cm（單位 twip）
const EMU_PER_TWIP = 635;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// 不壓縮（STORE）的 zip；照片本身已是 JPEG，壓縮也省不了多少
function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data), size = data.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
    h.setUint16(12, 0x21, true);   // 日期 1980-01-01
    h.setUint32(14, crc, true); h.setUint32(18, size, true); h.setUint32(22, size, true);
    h.setUint16(26, name.length, true);
    parts.push(h, name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true);
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(c, name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((s, p) => s + p.byteLength, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, e], { type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

const xmlEsc = s => s.replace(/[<>&"]/g, c => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;' }[c]));

// 內嵌圖片的 run；id 在整份文件內不可重複，rid 對應 document.xml.rels
/* wrap：'inline' 與文字排列（<wp:inline>）／'behind' 圖在文字後面／'front' 圖蓋在文字上面。
   注意繁中 Word 的名稱是從「文字」的角度講的：behind＝「文字在前」、front＝「文字在後」，跟直覺相反。
   後兩種都是浮動圖（<wp:anchor> ＋ <wp:wrapNone/>），**差別只有 behindDoc**：
   behind=1、front=0。這是比對使用者在 Word 裡手動改好的那張圖得到的——Word 只翻了這一個屬性，
   relativeHeight 等等它原封不動，所以兩種共用同一套數值。
   其餘屬性照抄 Word 自己寫的浮動圖（取樣自使用者在 Word 裡手動改好的檔案）：
   distL/distR=114300、locked=0、layoutInCell=1、allowOverlap=1、wp14:anchorId/editId，run 裡有 w:noProof。
   layoutInCell=1 代表位置相對於儲存格，所以 offX 只要做格內置中。
   段落那邊用 w:spacing lineRule=exact 撐出圖高，版面才跟 inline 一樣。 */
const hex8 = v => (v >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(-8);
function wDrawing(id, rid, cx, cy, wrap, offX = 0) {
  const frame = wrap && wrap !== 'inline'
    ? '<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0"' +
      ' relativeHeight="' + (251650044 + (id % 1000) * 2) + '"' +
      ' behindDoc="' + (wrap === 'behind' ? 1 : 0) + '" locked="0" layoutInCell="1" allowOverlap="1"' +
      ' wp14:anchorId="' + hex8(0x5013230D + id) + '" wp14:editId="' + hex8(0x09394E0B + id) + '">' +
      '<wp:simplePos x="0" y="0"/>' +
      '<wp:positionH relativeFrom="column"><wp:posOffset>' + offX + '</wp:posOffset></wp:positionH>' +
      '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
      '<wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
      '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>'
    : '<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/>';
  return '<w:r><w:rPr><w:noProof/></w:rPr><w:drawing>' + frame +
    '<wp:docPr id="' + id + '" name="照片 ' + id + '"/>' +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
    '<pic:nvPicPr><pic:cNvPr id="' + id + '" name="image' + id + '.jpg"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic>' +
    (wrap && wrap !== 'inline' ? '</wp:anchor>' : '</wp:inline>') + '</w:drawing></w:r>';
}

function currentJpeg() {
  const k = Math.min(1, WORD_MAX_PX / Math.max(main.width, main.height));
  const c = document.createElement('canvas');
  c.width = Math.round(main.width * k);
  c.height = Math.round(main.height * k);
  c.getContext('2d').drawImage(main, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(b => b.arrayBuffer().then(a => r(new Uint8Array(a))), 'image/jpeg', 0.9));
}

/* ---------- Word 範本：docx 內放 {{標記}}，匯出時只替換標記，其餘格式原樣保留 ----------
   {{名稱}}        文字欄位
   {{□群組:選項}}  勾選框，勾選填 ■、否則 □
   {{圖:名稱}}     單獨一段時換成「用途」為該名稱的照片
   {{現場照片}}    單獨一段時換成用途為「現場照片」的所有照片（每列 2 張）；{{現場照片:3}}＝每列 3 張
   第一列只寫「範本設定」的表格＝欄位規則（parseSettings），匯出時整張刪掉
   {{名稱*}}       名稱後面加 *（或全形＊）：這欄必填
   {{必填:甲,乙}}  範本上沒有的欄位（自訂欄位）也要必填；只給工具看，匯出時刪掉 */
const NS = {
  w:'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r:'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  wp:'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  wp14:'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing',   // anchor 的 anchorId/editId 要用
  a:'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic:'http://schemas.openxmlformats.org/drawingml/2006/picture',
};
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const PH = /\{\{(.+?)\}\}/g;
const REQ_MARK = /\s*[*＊]$/, REQ_DECL = /^必填[:：]/;
const phName = raw => raw.replace(REQ_MARK, '');   // 標記去掉必填記號才是欄位名
const SITE_PH = new RegExp('^' + SITE_ROLE + '(?:[:：](\\d+))?$');   // {{現場照片}}／{{現場照片:3}}（每列張數）
const isImageField = name => name.startsWith('圖:') || SITE_PH.test(name);
const TPL_IMG_MAX_H = 10000, SITE_IMG_MAX_H = 7000;   // 圖片高度上限（twip）

// 讀取 zip：Word 存檔用 DEFLATE 壓縮，用瀏覽器內建的 DecompressionStream 解壓
async function readZip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf), dec = new TextDecoder();
  let eocd = u8.length - 22;
  while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('不是有效的 .docx 檔');
  const files = [];
  for (let i = 0, p = dv.getUint32(eocd + 16, true); i < dv.getUint16(eocd + 10, true); i++) {
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true), off = dv.getUint32(p + 42, true);
    const nlen = dv.getUint16(p + 28, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    let data = u8.slice(start, start + size);
    if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    files.push({ name, data });
    p += 46 + nlen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return files;
}

function paraTexts(doc) {
  return [...doc.getElementsByTagNameNS(NS.w, 'p')].map(p => {
    const nodes = [...p.getElementsByTagNameNS(NS.w, 't')];
    return { p, nodes, text:nodes.map(n => n.textContent).join('') };
  });
}

/* ---------- 範本設定表：第一列只寫「範本設定」，第二列是欄名（欄位、類型、選項、預設值、必填，順序不拘），之後一列一個欄位 ---------- */
const SETTINGS_TITLE = '範本設定';
const FIELD_TYPES = ['文字', '多行', '數字', '月日', '流水號', '選項', '對照'];
const childrenOf = (el, tag) => [...el.children].filter(n => n.localName === tag);
const cellText = tc => [...tc.getElementsByTagNameNS(NS.w, 'p')]
  .map(p => [...p.getElementsByTagNameNS(NS.w, 't')].map(t => t.textContent).join('')).join('\n').trim();

function settingsTable(doc) {
  return [...doc.getElementsByTagNameNS(NS.w, 'tbl')].find(t => {
    const tr = childrenOf(t, 'tr')[0];
    return tr && childrenOf(tr, 'tc').map(cellText).join('') === SETTINGS_TITLE;
  });
}

// 回傳 {defs, problems}；類型空白時有選項＝選項、沒有＝文字；看不懂的類型當文字並記下來；同名出現兩次用後面那列
function parseSettings(tbl) {
  const rows = childrenOf(tbl, 'tr').map(tr => childrenOf(tr, 'tc').map(cellText));
  const head = rows[1] || [], col = key => head.findIndex(h => h.includes(key));
  const at = (r, key) => col(key) >= 0 ? (r[col(key)] || '') : '';
  const defs = [], problems = [];
  for (const r of rows.slice(2)) {
    const d = { name:at(r, '欄位'), type:at(r, '類型'), opts:at(r, '選項'), def:at(r, '預設'), req:!!at(r, '必填') };
    if (!d.name) continue;
    if (!d.type) d.type = d.opts ? '選項' : '文字';
    else if (!FIELD_TYPES.includes(d.type)) {
      problems.push('「' + d.name + '」的類型「' + d.type + '」看不懂，當成文字（可用：' + FIELD_TYPES.join('、') + '）');
      d.type = '文字';
    }
    const old = defs.findIndex(x => x.name === d.name);
    if (old >= 0) { problems.push('「' + d.name + '」在範本設定表裡出現兩次，用後面那一列'); defs.splice(old, 1); }
    defs.push(d);
  }
  return { defs, problems };
}

// 注意：會把設定表從 doc 移掉（設定表裡的字不算範本標記）
function templateFields(doc) {
  const fields = [], required = [];
  const add = (list, n) => { if (n && !list.includes(n)) list.push(n); };
  const tbl = settingsTable(doc), { defs, problems } = tbl ? parseSettings(tbl) : { defs:[], problems:[] };
  if (tbl) tbl.remove();
  for (const { text } of paraTexts(doc)) for (const m of text.matchAll(PH)) {
    if (REQ_DECL.test(m[1])) { m[1].replace(REQ_DECL, '').split(/[,，、]/).forEach(n => add(required, n.trim())); continue; }
    const name = phName(m[1]);
    add(fields, name);
    if (name !== m[1]) add(required, name);
  }
  defs.forEach(d => { if (d.req) add(required, d.name); });
  return { fields, required, defs, problems };
}

// 寫入 <w:t>；值裡的換行轉成 <w:br/>
function setRunText(t, s) {
  const lines = s.split('\n');
  t.textContent = lines[0];
  t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  let ref = t;
  for (const line of lines.slice(1)) {
    const br = t.ownerDocument.createElementNS(NS.w, 'w:br'), nt = t.ownerDocument.createElementNS(NS.w, 'w:t');
    nt.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    nt.textContent = line;
    ref.after(br, nt);
    ref = nt;
  }
}

// 標記常被 Word 拆在好幾個 <w:t>：依字元位置找出起訖節點，值放進第一個節點、其餘部分清掉
function replaceInPara({ nodes }, valueOf) {
  const text = nodes.map(n => n.textContent).join('');
  for (const m of [...text.matchAll(PH)].reverse()) {   // 從後往前換，前面的位置不受影響
    const val = valueOf(m[1]);
    if (val === null) continue;
    let off = 0;
    const at = nodes.map(n => { const s = off; off += n.textContent.length; return s; });
    const end = m.index + m[0].length;
    const si = nodes.findIndex((n, i) => at[i] + n.textContent.length > m.index);
    let ei = si;
    while (at[ei] + nodes[ei].textContent.length < end) ei++;
    const before = nodes[si].textContent.slice(0, m.index - at[si]);
    const after = nodes[ei].textContent.slice(end - at[ei]);
    for (let i = si + 1; i <= ei; i++) nodes[i].textContent = '';
    if (si === ei) setRunText(nodes[si], before + val + after);
    else { setRunText(nodes[si], before + val); nodes[ei].textContent = after; }
  }
}

function fragment(doc, xml) {
  const wrap = '<x' + Object.entries(NS).map(([k, v]) => ' xmlns:' + k + '="' + v + '"').join('') + '>' + xml + '</x>';
  return [...new DOMParser().parseFromString(wrap, 'application/xml').documentElement.childNodes].map(n => doc.importNode(n, true));
}

// 段落可用寬度（twip）：在表格儲存格內取儲存格寬，否則取版面寬
function availWidth(p, doc) {
  for (let n = p.parentNode; n; n = n.parentNode) {
    if (n.localName !== 'tc') continue;
    const w = n.getElementsByTagNameNS(NS.w, 'tcW')[0];
    if (w && w.getAttributeNS(NS.w, 'type') === 'dxa') return +w.getAttributeNS(NS.w, 'w') - 216;
    break;
  }
  const g = (tag, attr) => +(doc.getElementsByTagNameNS(NS.w, tag)[0]?.getAttributeNS(NS.w, attr) || 0);
  return (g('pgSz', 'w') || PAGE.w) - g('pgMar', 'left') - g('pgMar', 'right');
}

async function buildFromTemplate() {
  saveCur();
  const back = cur, dec = new TextDecoder();
  const files = template.files.map(f => ({ ...f }));
  const file = name => files.find(f => f.name === name);
  const doc = new DOMParser().parseFromString(dec.decode(file('word/document.xml').data), 'application/xml');

  // 0. 範本設定表整張刪掉；{{必填:…}} 單獨一段就整段刪掉（儲存格裡至少要留一段），其餘情況由下一步換成空字串
  const tbl = settingsTable(doc);
  if (tbl) tbl.remove();
  for (const { p, text } of paraTexts(doc)) {
    const m = text.trim().match(/^\{\{([^{}]+)\}\}$/), tc = p.parentNode;
    if (m && REQ_DECL.test(m[1]) && !(tc.localName === 'tc' && tc.getElementsByTagNameNS(NS.w, 'p').length === 1)) p.remove();
  }

  // 1. 文字與勾選框
  for (const pt of paraTexts(doc)) {
    replaceInPara(pt, raw => {
      const name = phName(raw);
      return REQ_DECL.test(raw) ? ''
        : isImageField(name) ? null
        : name.startsWith('□') ? (docFields[name] ? '■' : '□')
        : expand(docFields[name] || '');
    });
  }

  // 2. 圖片：照片轉 JPEG 放進 word/media，並登記關聯
  const media = [], rels = [];
  const addImage = async i => {
    switchTo(i);
    const n = media.length + 1;
    media.push({ name:'word/media/cpa_' + n + '.jpg', data:await currentJpeg() });
    rels.push('<Relationship Id="rIdCpa' + n + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/cpa_' + n + '.jpg"/>');
    return { id:90000 + n, rid:'rIdCpa' + n, w:photos[i].w, h:photos[i].h };
  };
  // 回傳 {xml, w, h}：w/h 是縮放後的 twip，現場照片要用 h 去撐段落高度
  // boxW 是這張圖可用的寬度（儲存格內寬），浮動圖靠它算格內置中的水平位移
  const drawing = (im, maxW, maxH, wrap, boxW = 0) => {
    const s = Math.min(maxW / im.w, maxH / im.h);
    const w = Math.round(im.w * s), h = Math.round(im.h * s);
    const float = wrap && wrap !== 'inline';
    const offX = float ? Math.round(Math.max(0, (boxW - w) / 2) * EMU_PER_TWIP) : 0;
    return { xml:wDrawing(im.id, im.rid, w * EMU_PER_TWIP, h * EMU_PER_TWIP, wrap, offX), w, h };
  };
  for (const { p, text } of paraTexts(doc)) {
    const m = text.trim().match(/^\{\{(.+)\}\}$/), name = m && phName(m[1]);
    if (!m || !isImageField(name)) continue;
    const avail = availWidth(p, doc);
    [...p.childNodes].forEach(n => { if (n.localName !== 'pPr') n.remove(); });
    const site = name.match(SITE_PH);
    if (!site) {
      const same = photos.map((q, i) => i).filter(i => photos[i].role === name.slice(2));
      const maxH = TPL_IMG_MAX_H / Math.max(1, same.length);   // 同一個用途有多張時平分高度，避免擠出版面
      for (const [k, i] of same.entries()) {
        if (k) p.append(...fragment(doc, '<w:r><w:br/></w:r>'));
        p.append(...fragment(doc, drawing(await addImage(i), avail, maxH).xml));   // 圖資／品質紀錄維持與文字排列
      }
      continue;
    }
    // 現場照片：無框線表格，每列 N 張（{{現場照片:N}}，預設 2），依照片清單的順序
    const list = photos.map((q, i) => i).filter(i => photos[i].role === SITE_ROLE);
    if (!list.length) continue;
    const COLS = Math.max(1, +site[1] || 2), pad = 57, colW = Math.floor(avail / COLS);
    let rows = '';
    for (let r = 0; r < list.length; r += COLS) {
      let cells = '';
      for (let c = 0; c < COLS; c++) {
        const i = list[r + c];
        let inner = '<w:p/>';
        if (i !== undefined) {
          const inW = colW - pad * 2, wrap = settings.siteWrap, float = wrap !== 'inline';
          const d = drawing(await addImage(i), inW, SITE_IMG_MAX_H, wrap, inW);
          inner = float
            ? '<w:p><w:pPr><w:spacing w:line="' + d.h + '" w:lineRule="exact"/></w:pPr>' + d.xml + '</w:p>'
            : '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' + d.xml + '</w:p>';
        }
        cells += '<w:tc><w:tcPr><w:tcW w:w="' + colW + '" w:type="dxa"/></w:tcPr>' + inner + '</w:tc>';
      }
      rows += '<w:tr><w:trPr><w:cantSplit/></w:trPr>' + cells + '</w:tr>';
    }
    p.before(...fragment(doc, '<w:tbl><w:tblPr><w:tblW w:w="' + colW * COLS + '" w:type="dxa"/><w:jc w:val="center"/>' +
      '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="' + pad + '" w:type="dxa"/><w:right w:w="' + pad + '" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid>' + ('<w:gridCol w:w="' + colW + '"/>').repeat(COLS) + '</w:tblGrid>' + rows + '</w:tbl>'));
  }
  if (back >= 0) switchTo(back);   // 沒有照片時 back 是 -1

  const relFile = file('word/_rels/document.xml.rels');
  relFile.data = dec.decode(relFile.data).replace('</Relationships>', rels.join('') + '</Relationships>');
  const types = file('[Content_Types].xml');
  types.data = dec.decode(types.data);
  if (!/Extension="jpg"/i.test(types.data)) types.data = types.data.replace('</Types>', '<Default Extension="jpg" ContentType="image/jpeg"/></Types>');
  file('word/document.xml').data = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
    new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, '');
  return makeZip([...files, ...media]);
}

/* 範本存在瀏覽器的 IndexedDB（檔案可能超過 localStorage 上限），下次開啟自動載入 */
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PROJECT_APP, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', mode), r = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(r.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}

async function setTemplate(name, buf) {
  const files = await readZip(buf);
  const main = files.find(f => f.name === 'word/document.xml');
  if (!main) throw new Error('找不到 word/document.xml');
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(main.data), 'application/xml');
  template = { name, files, ...templateFields(doc) };
}

$('tplFile').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const buf = await f.arrayBuffer();
    await setTemplate(f.name, buf);
    try { await idb('readwrite', s => s.put({ name:f.name, data:buf }, 'template')); } catch (err) { /* 無法保存時只在本次有效 */ }
    renderWordDialog();
    if (!template.fields.length) alert('這份範本裡沒有 {{標記}}，匯出時只會原樣複製。');
    const problems = templateProblems();
    if (problems.length) alert('範本設定有問題：\n・' + problems.join('\n・') + '\n\n（範本上沒有的欄位，要在範本最後的「範本設定」表加一列）');
  } catch (err) {
    alert('無法讀取範本：' + f.name + '\n' + err.message);
  }
};

idb('readonly', s => s.get('template'))
  .then(t => t && setTemplate(t.name, t.data))
  .catch(() => { /* 沒有保存的範本 */ });
