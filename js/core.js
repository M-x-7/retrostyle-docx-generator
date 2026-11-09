// 常數、全域狀態、localStorage 讀寫、匯入照片、繪製、手繪轉直線、狀態操作

const $ = id => document.getElementById(id);
const main = $('main'), mctx = main.getContext('2d');
const ov = $('overlay'), octx = ov.getContext('2d');
const stage = $('stage'), wrap = $('wrap'), te = $('textEdit');

const FONT = '"Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif';
const COLORS = ['#e53935', '#ffd600', '#1e88e5', '#43a047', '#ffffff', '#000000'];
const PALETTE = [   // 點顏色格時跳出的常用色（兩排各 6 個）；工具列色塊的 COLORS 都在裡面
  '#e53935', '#fb8c00', '#ffd600', '#43a047', '#1e88e5', '#8e24aa',
  '#ec407a', '#6d4c41', '#00acc1', '#9e9e9e', '#ffffff', '#000000',
];
const MAX_PIXELS = 16e6;   // 瀏覽器 canvas 上限約 16.7M 像素
const DEG = Math.PI / 180;
const THUMB_W = 180, THUMB_H = 120;
const DASHES = {   // 以線寬為單位
  solid:[], dash:[3, 2], dot:[0.01, 2.2],
  dashdot:[4, 1.5, 1, 1.5], dashdotdot:[4, 1.5, 1, 1.5, 1, 1.5],
};
const DASH_NAMES = { solid:'實線', dash:'虛線', dot:'點線', dashdot:'一長一短', dashdotdot:'一長二短' };
const ARROW_NAMES = { none:'無', end:'終點', both:'兩端' };
const DEFAULT_PRESETS = [
  { name:'規劃路線', key:'D', color:'#e53935', width:4, dash:'dash', arrow:'none' },
  { name:'紅色箭頭', key:'P', color:'#e53935', width:4, dash:'solid', arrow:'end' },
  { name:'既有線路', key:'E', color:'#1e88e5', width:3, dash:'dot', arrow:'none' },
];
const SHAPE_NAMES = {
  circle:'圓形', half:'半邊異色圓', dot:'圓內小圓', hexagon:'六角形', square:'方形',
  triangle:'三角形', triIn:'三角內小三角',
};
const FRAMED = ['hexagon', 'square'];                    // 外圈是「顏色」的粗框、框內填第二色
const TWO_TONE = ['half', 'dot', 'triIn', ...FRAMED];     // 有「第二色」部分的形狀
const FILL_NAMES = { solid:'實心', outline:'空心' };       // 舊資料還有 white（白底），由 symbolLook() 換算
// size：直徑、strokeW：描邊粗細，單位都同線寬（原圖長邊的 1/1000）；color2：異色部分；stroke：描邊色
const DEFAULT_SYMBOLS = [
  { name:'圓形', key:'1', shape:'circle' }, { name:'半邊異色圓', key:'2', shape:'half' },
  { name:'圓內小圓', key:'3', shape:'dot' }, { name:'六角形', key:'4', shape:'hexagon' },
  { name:'正方形', key:'5', shape:'square' }, { name:'三角內小三角', key:'6', shape:'triIn', size:110 },
].map(s => ({ fill:'solid', color:'#e53935', color2:'#ffffff', stroke:'#e53935', strokeW:3, size:100, label:'', ...s }));
const STROKE_NAMES = { auto:'自動', white:'白邊', black:'黑邊', none:'無' };   // 自動：依字色深淺配黑或白
const BOX_NAMES = { none:'無', white:'白底', black:'黑底', yellow:'黃底' };
const BOX_COLORS = { white:'#ffffff', black:'#000000', yellow:'#ffd600' };
const ALIGN_NAMES = { left:'靠左', center:'置中', right:'靠右' };   // 多行文字每行的對齊；舊資料沒有 align＝靠左
const DEFAULT_TEXT_STYLES = [   // size：字高，單位同線寬
  { name:'一般文字', key:'Q', color:'#e53935', size:28, stroke:'auto', box:'none', align:'left' },
];
const PRESET_STORE = 'cable-photo-annotator.presets';
const SYMBOL_STORE = 'cable-photo-annotator.symbols';
const TEXT_STYLE_STORE = 'cable-photo-annotator.textStyles';
const UI_STORE = 'cable-photo-annotator.ui';   // 工具列設定與照片清單寬度
const SNIPPET_STORE = 'cable-photo-annotator.snippets';          // 常用字串 [{name, text}]
const FIELD_HISTORY_STORE = 'cable-photo-annotator.fieldHistory';    // {欄位名: [填過的值]}
// 以前存自訂欄位、欄位預設值、前兩碼對照的 key（cable-photo-annotator.customFields／fieldDefaults／prefixMap／setupVersion）已不再使用：
// 欄位規則改放在範本的「範本設定」表（word.js parseSettings）
const HISTORY_MAX = 10;
const DEFAULT_SNIPPETS = [];
const HISTORY_MENU_MAX = 3;        // ▾ 選單裡最多列幾筆以前填過的值
const PROJECT_APP = 'cable-photo-annotator';
const TYPING = 'input:not([type]), input[type=text], input[type=number], select, textarea';

/* ---------- localStorage 讀寫（下面初始化狀態時就會用到，所以放在最前面） ---------- */
function loadList(store, defaults) {
  try {
    const s = JSON.parse(localStorage.getItem(store));
    if (Array.isArray(s)) return s;
  } catch (err) { /* 無法讀取時用預設值 */ }
  return defaults.map(p => ({ ...p }));
}

function saveList(store, list) {
  try { localStorage.setItem(store, JSON.stringify(list)); } catch (err) { /* 瀏覽器禁止儲存時只在本次有效 */ }
}

function loadObj(store, defaults = {}) {
  try {
    const s = JSON.parse(localStorage.getItem(store));
    if (s && typeof s === 'object' && !Array.isArray(s)) return s;
  } catch (err) { /* 無法讀取時用預設值 */ }
  return { ...defaults };
}

function saveObj(store, obj) {
  try { localStorage.setItem(store, JSON.stringify(obj)); } catch (err) { /* 瀏覽器禁止儲存時只在本次有效 */ }
}

/* 符號內文以前用空白換行，現在用換行字元（輸入時 Shift+Enter）。舊資料讀進來時轉一次：
   專案檔、設定檔看 version（1＝舊），瀏覽器裡存的符號設定看 LABEL_NL_STORE 有沒有轉過 */
const LABEL_NL_STORE = 'cable-photo-annotator.labelNewline';
const spacesToLines = s => (s || '').trim().split(/\s+/).join('\n');
const oldLabels = list => list.forEach(s => { if (s.label) s.label = spacesToLines(s.label); });

function migrateLabelStore() {
  try {
    if (localStorage.getItem(LABEL_NL_STORE) !== null) return;
    if (localStorage.getItem(SYMBOL_STORE) !== null) { oldLabels(symbols); saveList(SYMBOL_STORE, symbols); }
    localStorage.setItem(LABEL_NL_STORE, '1');
  } catch (err) { /* 禁止存取時沒有舊資料可轉 */ }
}

const settings = { color:'#e53935', width:4, dash:'dash', arrow:'none', sens:4, snap:true, siteWrap:'front' };
let presets = loadList(PRESET_STORE, DEFAULT_PRESETS);
let symbols = loadList(SYMBOL_STORE, DEFAULT_SYMBOLS);
migrateLabelStore();
let textStyles = loadList(TEXT_STYLE_STORE, DEFAULT_TEXT_STYLES);
let snippets = loadList(SNIPPET_STORE, DEFAULT_SNIPPETS);
let fieldHistory = loadObj(FIELD_HISTORY_STORE);
let menuFor = null;        // 目前開著 ▾ 選單的欄位名
let curSym = 0;            // 符號模式下要放置的符號
let curText = 0;           // 文字模式下新文字用的樣式
let photos = [];           // {name, file, url, img, w, h, role, items, undo, dirty, el, thumb, cnt, no}
let dragPhoto = null;      // 照片清單拖曳排序中的那一張
let template = null;       // Word 範本 {name, files, fields, required, defs, problems}（templateFields()）
let docFields = {};        // 範本標記的填寫值，隨專案檔儲存
let cur = -1;
// 以下為目前照片的工作狀態，切換照片時存回 photos[cur]
let img = null;
let unit = 1;              // 線寬/字級的單位：原圖長邊的 1/1000，讓螢幕預覽與匯出比例一致
let items = [];            // {type:'line', pts:[{x,y}], color, width, dash, arrow} | {type:'text', x, y, text（可多行）, color, size, stroke, box, align?, angle?}
                           // | {type:'symbol', x, y, angle, shape, fill, color, size, label}
let undoStack = [];
let redoStack = [];         // 上一步退掉的步驟，Ctrl+Y／Ctrl+Shift+Z 下一步；有新的修改就清掉
let fileSeq = 0;           // 照片檔的版本號（全域遞增，每個不同的照片檔都不一樣；自動暫存靠它判斷要不要重存）
let mode = 'select';
let sel = -1;
let drag = null;
let editing = false;       // 調整滑桿時只記一次復原點
let edit = null;           // 網頁內文字輸入框的狀態 {idx, x, y, size, color, stroke, box}
let heldKey = null;        // 按住線型鍵畫線、符號鍵放符號、文字鍵放文字，放開一律回到選取
let poly = null;           // 按住畫線鍵期間點的、拖的累積成的折線 {pts, hover}，放開按鍵才成為一條線

const HINTS = {
  select: '選取：點項目可拖曳、改顏色、Delete 刪除；雙擊文字或符號可修改；選取後拖右下角方塊縮放、拖外側圓點旋轉　｜按住線型鍵畫線、按住符號鍵放符號、按住文字鍵放文字；Ctrl+C／Ctrl+V 複製貼上標註、Ctrl+D 複製一份；Ctrl+V 也能貼上圖片；滾輪縮放、中鍵或右鍵拖曳平移',
  line: '畫線：點一下放點、拖曳手繪（自動拉直），按住期間全部接成同一條線，放開按鍵完成；Esc 取消',
  symbol: '符號：點一下放置；按住滑鼠拖曳可決定方向（三角形指向拖曳方向）；放開按鍵回到選取',
  text: '文字：點一下照片放文字，放開按鍵再打字，Shift+Enter 換行、Enter 確定、Esc 取消；點既有文字可修改（清空即刪除）',
  crop: '裁切：在照片上拖曳框出要留下的範圍，放開滑鼠後確認；Esc 取消',
};

/* ---------- 匯入照片（可多張） ---------- */
$('file').onchange = e => {
  addFiles(e.target.files);
  e.target.value = '';
};
$('projFile').onchange = e => {
  if (e.target.files[0]) openProject(e.target.files[0]);
  e.target.value = '';
};
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault();
  addFiles(e.dataTransfer.files);
});

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob), im = new Image();
    im.onload = () => resolve({ im, url });
    im.onerror = () => { URL.revokeObjectURL(url); reject(); };
    im.src = url;
  });
}

async function addFiles(files) {
  files = [...files];
  const proj = files.find(f => /\.json$/i.test(f.name));
  if (proj) return openProject(proj);
  const list = files.filter(f => f.type.startsWith('image/'));
  const first = photos.length, failed = [];
  for (const f of list) {
    try {
      const { im, url } = await loadImage(f);
      addPhoto(f.name, im, url, f);
    } catch (err) {
      failed.push(f.name);
    }
  }
  if (failed.length) alert('無法讀取：\n' + failed.join('\n'));
  if (photos.length > first) switchTo(first);
}

function addPhoto(name, im, url, file) {
  let w = im.naturalWidth, h = im.naturalHeight;
  const k = Math.min(1, Math.sqrt(MAX_PIXELS / (w * h)));
  if (k < 1) toast(name + ' 過大，已縮小至 ' + Math.round(w * k) + '×' + Math.round(h * k));
  const p = { name, file, url, img:im, w:Math.round(w * k), h:Math.round(h * k), role:SITE_ROLE, items:[], undo:[], dirty:false,
    id:Date.now().toString(36) + Math.random().toString(36).slice(2, 8), fileVer:++fileSeq };   // id、fileVer：自動暫存用（照片檔換了才重存）

  p.thumb = document.createElement('canvas');
  sizeThumb(p);
  p.thumb.getContext('2d').drawImage(im, 0, 0, p.thumb.width, p.thumb.height);

  p.el = document.createElement('div');
  p.el.className = 'item';
  const nm = document.createElement('div');
  nm.className = 'name'; nm.textContent = name; nm.title = name;
  p.cnt = document.createElement('div');
  p.cnt.className = 'cnt'; p.cnt.textContent = '尚無標註';
  p.no = document.createElement('span');
  p.no.className = 'no';
  p.el.append(p.thumb, p.no, nm, p.cnt);
  // 單擊只選取（Ctrl 加選），雙擊才進入編輯
  p.el.onclick = e => {
    if (e.ctrlKey || e.metaKey) p.el.classList.toggle('sel');
    else photos.forEach(q => q.el.classList.toggle('sel', q === p));
  };
  p.el.ondblclick = () => switchTo(photos.indexOf(p));
  p.el.oncontextmenu = e => {   // 在沒選取的照片上按右鍵：改成只選這張；在已選取的上面：保留多選
    e.preventDefault();
    if (!p.el.classList.contains('sel')) photos.forEach(q => q.el.classList.toggle('sel', q === p));
    openRoleMenu(p, e.clientX, e.clientY);
  };

  // 拖曳排序：滑鼠在這張的左上半就插在前面、右下半就插在後面（單欄、多欄都適用）
  const dropAfter = e => {
    const r = p.el.getBoundingClientRect();
    return (e.clientX - r.left) / r.width + (e.clientY - r.top) / r.height > 1;
  };
  p.el.draggable = true;
  p.el.ondragstart = e => {
    dragPhoto = p;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', p.name);
    p.el.classList.add('dragging');
  };
  p.el.ondragend = () => { dragPhoto = null; p.el.classList.remove('dragging'); clearDropMarks(); };
  p.el.ondragover = e => {
    if (!dragPhoto || dragPhoto === p) return;
    e.preventDefault();
    const after = dropAfter(e);
    clearDropMarks();
    p.el.classList.add(after ? 'drop-after' : 'drop-before');
  };
  p.el.ondrop = e => {
    if (!dragPhoto || dragPhoto === p) return;
    e.preventDefault();
    e.stopPropagation();   // 別讓視窗的「拖檔案進來匯入」接到
    movePhoto(dragPhoto, p, dropAfter(e));
    clearDropMarks();
  };

  $('list').appendChild(p.el);
  photos.push(p);
  renumber();
  return p;
}

// 清單左上角的順序編號：只算「現場照片」，圖資／品質紀錄不編號；只顯示在清單，不會畫進照片或 Word
function renumber() {
  let n = 0;
  photos.forEach(q => { q.no.textContent = q.role === SITE_ROLE ? ++n : ''; });
}

// 把現場照片移到第 n 號（其他用途的照片不佔編號，位置也不動）
function moveToNumber(p, n) {
  const site = photos.filter(q => q.role === SITE_ROLE && q !== p);
  if (!site.length) return;
  n = Math.max(1, Math.min(site.length + 1, Math.round(n) || 1));
  if (n <= site.length) movePhoto(p, site[n - 1], false);
  else movePhoto(p, site[site.length - 1], true);
}

function clearDropMarks() {
  photos.forEach(q => q.el.classList.remove('drop-before', 'drop-after'));
}

// 照片清單拖曳排序：清單順序就是匯出 Word 時照片的順序
function movePhoto(src, target, after) {
  const curP = photos[cur];
  photos.splice(photos.indexOf(src), 1);
  photos.splice(photos.indexOf(target) + (after ? 1 : 0), 0, src);
  photos.forEach(q => $('list').appendChild(q.el));
  cur = photos.indexOf(curP);
  src.dirty = true;
  renumber();
  commit();
}

function saveCur() {
  if (cur >= 0) { photos[cur].items = items; photos[cur].undo = undoStack; photos[cur].redo = redoStack; }
}

function switchTo(i) {
  saveCur();
  cur = i;
  const p = photos[i];
  img = p.img; items = p.items; undoStack = p.undo; redoStack = p.redo || [];
  main.width = p.w; main.height = p.h;
  unit = Math.max(p.w, p.h) / 1000;
  sel = -1; drag = null;
  view = { z:1, x:0, y:0 };   // 換照片回到整張
  photos.forEach((q, j) => q.el.classList.toggle('on', j === i));
  p.el.scrollIntoView({ block:'nearest', inline:'nearest' });
  layout();
  commit();
}

function clearCurrent() {
  img = null; items = []; undoStack = []; redoStack = []; sel = -1;
  commit();
}

// 從清單刪除照片（可多張）；其中有已標註的先問一次
function removePhotos(ps) {
  const marked = ps.filter(p => (p === photos[cur] ? items : p.items).length);
  if (marked.length && !confirm((ps.length > 1 ? '其中 ' + marked.length + ' 張' : '「' + ps[0].name + '」') + '已有標註，確定刪除？')) return;
  const curP = photos[cur];
  // 正在編輯的被刪掉時，改看它後面第一張留下來的，沒有就看前面最近的
  const keep = photos.slice(cur + 1).find(q => !ps.includes(q)) || photos.slice(0, Math.max(cur, 0)).reverse().find(q => !ps.includes(q));
  for (const p of ps) {
    URL.revokeObjectURL(p.url);
    p.el.remove();
    photos.splice(photos.indexOf(p), 1);
  }
  renumber();
  if (!ps.includes(curP)) {
    cur = photos.indexOf(curP);
    commit();
  } else {
    cur = -1;
    if (keep) switchTo(photos.indexOf(keep)); else clearCurrent();
  }
}

function closeAll() {
  photos.forEach(p => { URL.revokeObjectURL(p.url); p.el.remove(); });
  photos = [];
  cur = -1;
  clearCurrent();
}

/* 照片縮放：view.z＝倍率（1＝整張塞進畫面），view.x/y＝從置中位置平移多少（CSS px）。
   滾輪以游標為中心縮放、中鍵或右鍵拖曳平移（edit.js），切換照片回到整張 */
let view = { z:1, x:0, y:0 };
const ZOOM_MAX = 10;
const OV_MAX = 4096;   // 疊加層畫布最長邊上限：放很大時改用較低解析度，免得吃光記憶體

function layout() {
  if (!img) return;
  const r = stage.getBoundingClientRect(), pad = 10;
  const s = Math.min((r.width - pad * 2) / main.width, (r.height - pad * 2) / main.height) * view.z;
  const cw = main.width * s, ch = main.height * s;
  // 照片比畫面大時最多移到邊緣，不會整張跑出畫面；比畫面小時置中
  const mx = Math.max(0, (cw - r.width) / 2), my = Math.max(0, (ch - r.height) / 2);
  view.x = Math.max(-mx, Math.min(mx, view.x));
  view.y = Math.max(-my, Math.min(my, view.y));
  wrap.style.width = cw + 'px';
  wrap.style.height = ch + 'px';
  wrap.style.transform = 'translate(calc(-50% + ' + view.x + 'px), calc(-50% + ' + view.y + 'px))';
  const q = Math.min(window.devicePixelRatio || 1, OV_MAX / Math.max(cw, ch));
  ov.width = Math.round(cw * q);
  ov.height = Math.round(ch * q);
  $('sZoom').textContent = Math.round(view.z * 100) + '%';
  drawOverlay();
}

// 以螢幕上的 (cx, cy) 為中心縮放到 z 倍：游標底下那一點縮放後還在游標底下
function zoomAt(cx, cy, z) {
  z = Math.max(1, Math.min(ZOOM_MAX, z));
  if (!img || z === view.z) return;
  const r = stage.getBoundingClientRect(), f = z / view.z;
  const sx = r.left + r.width / 2, sy = r.top + r.height / 2;   // 照片置中時的中心
  const wx = sx + view.x, wy = sy + view.y;                      // 目前照片中心
  view.x = cx - (cx - wx) * f - sx;
  view.y = cy - (cy - wy) * f - sy;
  view.z = z;
  layout();
}

function resetView() {
  view = { z:1, x:0, y:0 };
  layout();
}

// 一個螢幕像素等於多少原圖單位：選取框、把手、點選範圍用它，大小才不受縮放與疊加層解析度影響
function devPx() {
  return cssToImg() / (window.devicePixelRatio || 1);
}
new ResizeObserver(layout).observe(stage);

// 拖曳分隔條調整照片清單寬度（畫布至少保留 300px）
$('split').addEventListener('pointerdown', e => {
  const split = e.currentTarget, side = $('side');
  split.setPointerCapture(e.pointerId);
  split.classList.add('on');
  const left = side.getBoundingClientRect().left;
  const max = split.parentElement.getBoundingClientRect().width - 300;
  split.onpointermove = ev => {
    side.style.width = Math.max(140, Math.min(max, ev.clientX - left)) + 'px';
  };
  split.onpointerup = split.onpointercancel = () => {
    split.onpointermove = split.onpointerup = split.onpointercancel = null;
    split.classList.remove('on');
    saveUI();
  };
});

/* ---------- 繪製 ---------- */
function isLight(hex) {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150;
}

// 畫折線；有箭頭時把線端縮短，避免線穿出箭頭尖端
function strokeLine(c, pts, color, lw, dash = 'dash', arrow = 'none') {
  const v = pts.map(p => ({ x:p.x, y:p.y })), n = v.length, hl = lw * 4, heads = [];
  const addHead = (from, i) => {
    const tip = { x:v[i].x, y:v[i].y }, t = Math.atan2(tip.y - from.y, tip.x - from.x);
    const cut = Math.min(hl * 0.8, dist(from, tip));
    heads.push({ tip, t });
    v[i] = { x:tip.x - Math.cos(t) * cut, y:tip.y - Math.sin(t) * cut };
  };
  if (arrow !== 'none') addHead(pts[n - 2], n - 1);
  if (arrow === 'both') addHead(pts[1], 0);
  c.save();
  c.strokeStyle = c.fillStyle = color; c.lineWidth = lw;
  c.lineJoin = 'round'; c.lineCap = dash === 'dot' ? 'round' : 'butt';
  c.setLineDash(DASHES[dash].map(d => d * lw));
  c.beginPath();
  v.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y));
  c.stroke();
  heads.forEach(({ tip, t }) => {
    const bx = tip.x - hl * Math.cos(t), by = tip.y - hl * Math.sin(t), w = hl * 0.45;
    c.beginPath();
    c.moveTo(tip.x, tip.y);
    c.lineTo(bx + w * Math.sin(t), by - w * Math.cos(t));
    c.lineTo(bx - w * Math.sin(t), by + w * Math.cos(t));
    c.closePath();
    c.fill();
  });
  c.restore();
}

// 符號以 (x, y) 為中心、r 為外接圓半徑；三角形預設指向右方，angle 為旋轉角
// 外形路徑：以中心為原點、角度 0 時三角形尖端朝右（放置時拖曳的方向）；fresh＝false 時接在目前路徑後面
function symbolPath(c, shape, r, fresh = true) {
  if (fresh) c.beginPath();
  if (shape === 'triangle' || shape === 'triIn') {
    c.moveTo(r, 0);
    c.lineTo(-r / 2, r * 0.866);
    c.lineTo(-r / 2, -r * 0.866);
    c.closePath();
  } else if (shape === 'square') {
    c.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
  } else if (shape === 'hexagon') {
    for (let i = 0; i < 6; i++) c.lineTo(r * Math.cos(i * Math.PI / 3), r * Math.sin(i * Math.PI / 3));
    c.closePath();
  } else {
    c.arc(0, 0, r, 0, Math.PI * 2);
  }
}

// 符號的填色與描邊：body＝外形填色（空心為 null），lw＝描邊寬（畫布像素）。
// 描邊一律畫在外形外面（往外擴張，不蓋到圖形）。舊資料沒有 strokeW：照舊的空心／實心／白底換算，描邊寬依大小比例
function symbolLook(s, r) {
  if (s.strokeW !== undefined) return { body:s.fill === 'outline' ? null : s.color, stroke:s.stroke, lw:s.strokeW * 2 * r / s.size };
  if (s.fill === 'outline') return { body:null, stroke:s.color, lw:r * 0.14 };
  if (s.fill === 'white') return { body:'#ffffff', stroke:s.color, lw:r * 0.22 };
  return { body:s.color, stroke:s.color, lw:TWO_TONE.includes(s.shape) ? r * 0.08 : 0 };
}

function drawSymbol(c, s, r) {
  const look = symbolLook(s, r);
  c.save();
  c.translate(s.x, s.y);
  c.rotate(s.angle || 0);
  c.lineJoin = 'round';
  // 描邊往外擴張：線寬加倍，內側那一半不能露出來。實心時先描邊、再用填色蓋掉內側（交界不會透出底色）；
  // 空心沒有東西可以蓋，改成裁掉外形裡面再描
  const strokeOut = clip => {
    c.save();
    if (clip) {
      const R = r + look.lw * 2;
      c.beginPath();
      c.rect(-R, -R, R * 2, R * 2);
      symbolPath(c, s.shape, r, false);
      c.clip('evenodd');
    }
    symbolPath(c, s.shape, r);
    c.lineWidth = look.lw * 2; c.strokeStyle = look.stroke; c.stroke();
    c.restore();
  };
  if (look.lw > 0 && look.body) strokeOut(false);
  if (look.body) {
    symbolPath(c, s.shape, r);
    c.fillStyle = look.body; c.fill();
    // 第二色的部分都在拖曳方向那一側：右半邊／貼著右緣、直徑 1/3 的小圓／
    // 邊長 1/3、同向、底邊貼在大三角底邊正中的小三角（尖端剛好落在大三角重心）；六角、方形是框內整塊
    if (TWO_TONE.includes(s.shape)) {
      c.beginPath();
      if (s.shape === 'half') c.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
      else if (s.shape === 'dot') c.arc(r * 2 / 3, 0, r / 3, 0, Math.PI * 2);
      else if (s.shape === 'triIn') { c.moveTo(0, 0); c.lineTo(-r / 2, r * 0.866 / 3); c.lineTo(-r / 2, -r * 0.866 / 3); c.closePath(); }
      else symbolPath(c, s.shape, r * 0.72);
      c.fillStyle = s.color2 || '#ffffff';
      c.fill();
    }
  }
  if (look.lw > 0 && !look.body) strokeOut(true);
  const label = (s.label || '').trim();
  if (label) {
    c.rotate(-(s.angle || 0));   // 內文保持水平
    const lines = label.split('\n').map(l => l.trim());   // 輸入時 Shift+Enter 換行；空白就是空白
    const box = r * (s.shape === 'triangle' || s.shape === 'triIn' ? 0.9 : 1.4);   // 圖形內可放字的寬高
    c.font = 'bold 100px ' + FONT;
    const widest = Math.max(...lines.map(l => c.measureText(l).width)) / 100;
    const px = Math.min(r * 0.9, box / widest, box / (lines.length * 1.15));
    c.font = 'bold ' + px + 'px ' + FONT;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const bg = look.body && (FRAMED.includes(s.shape) ? s.color2 || '#ffffff' : look.body);   // 字底下的顏色
    lines.forEach((l, i) => {
      const y = (i - (lines.length - 1) / 2) * px * 1.15 + px * 0.05;
      if (!bg) {   // 空心時加描邊，字在照片上才清楚
        c.lineWidth = px * 0.18;
        c.strokeStyle = isLight(s.color) ? '#000' : '#fff';
        c.strokeText(l, 0, y);
      }
      c.fillStyle = bg ? (isLight(bg) ? '#000' : '#fff') : s.color;
      c.fillText(l, 0, y);
    });
  }
  c.restore();
}

function drawItem(c, it) {
  if (it.type === 'line') return strokeLine(c, it.pts, it.color, it.width * unit, it.dash, it.arrow);
  if (it.type === 'symbol') return drawSymbol(c, it, it.size * unit / 2);
  drawText(c, it, it.size * unit);
}

// 文字：底色框 → 描邊 → 字；px 是畫布上的字高，設定視窗與工具列的預覽也用這支。舊資料沒有 stroke/box 時＝自動描邊、無底色
function drawText(c, it, px) {
  c.save();
  c.font = 'bold ' + px + 'px ' + FONT;
  c.textBaseline = 'top'; c.lineJoin = 'round';
  const { lines, widths, w, lh } = textLines(c, it, px), h = lh * lines.length;
  if (it.angle) {   // 以文字框中心旋轉（同 textCenter）
    const cx = it.x + w / 2, cy = it.y + h / 2;
    c.translate(cx, cy); c.rotate(it.angle); c.translate(-cx, -cy);
  }
  if (BOX_COLORS[it.box]) {
    const pad = px * 0.2;
    c.fillStyle = BOX_COLORS[it.box];
    c.fillRect(it.x - pad, it.y - pad / 2, w + pad * 2, h + pad);
  }
  const at = i => ({ x:it.x + ({ center:(w - widths[i]) / 2, right:w - widths[i] }[it.align] || 0), y:it.y + i * lh });   // 每行在整段寬度裡對齊
  const stroke = { auto:isLight(it.color) ? '#000' : '#fff', white:'#fff', black:'#000' }[it.stroke || 'auto'];
  if (stroke) {   // 描邊讓字在照片上清楚；全部描完再填字，下一行的描邊才不會蓋到上一行的字
    c.lineWidth = px * 0.18;
    c.strokeStyle = stroke;
    lines.forEach((l, i) => c.strokeText(l, at(i).x, at(i).y));
  }
  c.fillStyle = it.color;
  lines.forEach((l, i) => c.fillText(l, at(i).x, at(i).y));
  c.restore();
}

// 文字可以多行（輸入時 Shift+Enter）；呼叫前要先設好 c.font。(x, y) 是整段未旋轉時的左上角
function textLines(c, it, px) {
  const lines = String(it.text).split('\n'), widths = lines.map(l => c.measureText(l).width);
  return { lines, widths, w:Math.max(...widths), lh:px * 1.15 };
}

function render() {
  if (!img) return;
  mctx.drawImage(img, 0, 0, main.width, main.height);
  items.forEach((it, i) => { if (!edit || i !== edit.idx || edit.label) drawItem(mctx, it); });   // 編輯中的文字由輸入框顯示
}

// 疊加層：繪製中的草稿線與選取框，不會進入匯出圖
function drawOverlay() {
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, ov.width, ov.height);
  if (!img) return;
  const k = ov.width / main.width, u = devPx();   // k：疊加層畫布的比例；u：一個螢幕像素＝多少原圖單位（選取框、把手的大小）
  octx.setTransform(k, 0, 0, k, 0, 0);
  const draft = pts => {
    octx.strokeStyle = settings.color; octx.globalAlpha = 0.6;
    octx.lineWidth = settings.width * unit; octx.lineJoin = octx.lineCap = 'round';
    octx.beginPath();
    pts.forEach((p, i) => i ? octx.lineTo(p.x, p.y) : octx.moveTo(p.x, p.y));
    octx.stroke();
    if (pts.length === 1) { octx.beginPath(); octx.arc(pts[0].x, pts[0].y, settings.width * unit, 0, Math.PI * 2); octx.fill(); }
    octx.globalAlpha = 1;
  };
  if (poly) { octx.fillStyle = settings.color; draft(poly.hover ? [...poly.pts, poly.hover] : poly.pts); }   // 最後一點拉到游標的預覽線
  if (drag && drag.kind === 'draw') draft(drag.pts);
  if (drag && drag.kind === 'crop') {   // 裁切框：框外變暗
    const r = cropRect(drag);
    octx.fillStyle = 'rgba(0,0,0,0.55)';
    octx.beginPath();
    octx.rect(0, 0, main.width, main.height);
    octx.rect(r.x, r.y, r.w, r.h);
    octx.fill('evenodd');
    octx.strokeStyle = '#ffb000'; octx.lineWidth = 2 * u;
    octx.setLineDash([6 * u, 4 * u]);
    octx.strokeRect(r.x, r.y, r.w, r.h);
    octx.setLineDash([]);
  }
  if (drag && drag.kind === 'stamp') {
    const s = symbols[curSym];
    octx.globalAlpha = 0.6;
    drawSymbol(octx, { ...s, x:drag.start.x, y:drag.start.y, angle:drag.angle }, s.size * unit / 2);
    octx.globalAlpha = 1;
  }
  if (sel >= 0) {
    const it = items[sel], b = bbox(it), pad = 6 * u;
    octx.save();
    if (it.type === 'text' && it.angle) { const c = textCenter(it); octx.translate(c.x, c.y); octx.rotate(it.angle); octx.translate(-c.x, -c.y); }
    octx.strokeStyle = '#ffb000'; octx.lineWidth = 2 * u;
    octx.setLineDash([4 * u, 4 * u]);
    octx.strokeRect(b.x1 - pad, b.y1 - pad, b.x2 - b.x1 + pad * 2, b.y2 - b.y1 + pad * 2);
    octx.restore();
    if (it.type !== 'line') {   // 縮放（右下角方塊）與旋轉（朝向那一側外面的圓點）把手
      const h = itemHandles(it);
      octx.fillStyle = '#ffb000'; octx.strokeStyle = '#000'; octx.lineWidth = 1 * u;
      octx.save(); octx.translate(h.resize.x, h.resize.y); octx.rotate(h.angle);   // 方塊跟著文字轉
      octx.fillRect(-5 * u, -5 * u, 10 * u, 10 * u);
      octx.strokeRect(-5 * u, -5 * u, 10 * u, 10 * u);
      octx.restore();
      octx.strokeStyle = '#ffb000'; octx.lineWidth = 2 * u;
      octx.beginPath(); octx.moveTo(h.edge.x, h.edge.y); octx.lineTo(h.rotate.x, h.rotate.y); octx.stroke();
      octx.beginPath(); octx.arc(h.rotate.x, h.rotate.y, 6 * u, 0, Math.PI * 2); octx.fill();
      octx.strokeStyle = '#000'; octx.lineWidth = 1 * u; octx.stroke();
    }
  }
}

// 選取中符號／文字的把手位置（原圖座標）：縮放在選取框右下角，旋轉在朝向那一側的外面；edge 是連到旋轉把手的線的起點
function itemHandles(it) {
  const u = devPx(), a = it.angle || 0;
  if (it.type === 'symbol') {
    const r = symbolR(it), d = r + 28 * u;
    return { angle:0, resize:{ x:it.x + r + 6 * u, y:it.y + r + 6 * u },
      edge:{ x:it.x + Math.cos(a) * r, y:it.y + Math.sin(a) * r }, rotate:{ x:it.x + Math.cos(a) * d, y:it.y + Math.sin(a) * d } };
  }
  const b = textBox(it), c = textCenter(it), hw = (b.x2 - b.x1) / 2, hh = (b.y2 - b.y1) / 2;
  const at = (dx, dy) => rotPt({ x:c.x + dx, y:c.y + dy }, c, a);
  return { angle:a, resize:at(hw + 6 * u, hh + 6 * u), edge:at(hw, 0), rotate:at(hw + 28 * u, 0) };
}

// 文字框（未旋轉時的範圍）；旋轉的文字以框中心為軸
function textBox(it) {
  const px = it.size * unit, pad = BOX_COLORS[it.box] ? px * 0.2 : 0;   // 有底色框時範圍含框（同 drawText）
  mctx.font = 'bold ' + px + 'px ' + FONT;
  const { lines, w, lh } = textLines(mctx, it, px);
  return { x1:it.x - pad, y1:it.y - pad / 2, x2:it.x + w + pad, y2:it.y + lh * lines.length + pad / 2 };
}

function textCenter(it) {
  const b = textBox(it);
  return { x:(b.x1 + b.x2) / 2, y:(b.y1 + b.y2) / 2 };
}

// p 繞 c 轉 a 弧度
function rotPt(p, c, a) {
  const cos = Math.cos(a), sin = Math.sin(a), dx = p.x - c.x, dy = p.y - c.y;
  return { x:c.x + dx * cos - dy * sin, y:c.y + dx * sin + dy * cos };
}

// 改字級或內容會讓框中心移動；旋轉中的文字要把開頭留在畫面上原位（沒旋轉時 x, y 本來就不動）
function keepTextStart(it, change) {
  const a = it.angle || 0, s0 = rotPt(it, textCenter(it), a);
  change();
  const s1 = rotPt(it, textCenter(it), a);
  it.x += s0.x - s1.x; it.y += s0.y - s1.y;
}

// 符號含描邊的外緣半徑（原圖座標）：選取框、點選範圍、把手都用它
function symbolR(it) {
  const r = it.size * unit / 2;
  return r + symbolLook(it, r).lw;
}

function bbox(it) {
  if (it.type === 'text') return textBox(it);
  if (it.type === 'symbol') {
    const r = symbolR(it);
    return { x1:it.x - r, y1:it.y - r, x2:it.x + r, y2:it.y + r };
  }
  const xs = it.pts.map(p => p.x), ys = it.pts.map(p => p.y), m = it.width * unit * 2;
  return { x1:Math.min(...xs) - m, y1:Math.min(...ys) - m, x2:Math.max(...xs) + m, y2:Math.max(...ys) + m };
}

/* ---------- 手繪轉直線 ---------- */
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

// Ramer–Douglas–Peucker：把抖動的軌跡簡化成少數轉折點
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const a = pts[0], b = pts[pts.length - 1];
  let idx = -1, max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], a, b);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [a, b];
  return rdp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(pts.slice(idx), eps));
}

function turnAngle(a, b, c) {
  const d = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x);
  return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
}

// 去掉起筆/收筆的小勾、過短的中間段、幾乎共線的轉折
function tidy(v, eps) {
  v = v.slice();
  let changed = true;
  while (changed && v.length > 2) {
    changed = false;
    const n = v.length - 1;
    if (dist(v[0], v[1]) < eps * 1.5) { v.splice(1, 1); changed = true; continue; }
    if (dist(v[n - 1], v[n]) < eps * 1.5) { v.splice(n - 1, 1); changed = true; continue; }
    for (let i = 1; i < n - 1; i++) {
      if (dist(v[i], v[i + 1]) < eps) {
        v.splice(i, 2, { x:(v[i].x + v[i + 1].x) / 2, y:(v[i].y + v[i + 1].y) / 2 });
        changed = true; break;
      }
    }
    if (changed) continue;
    for (let i = 1; i < v.length - 1; i++) {
      if (turnAngle(v[i - 1], v[i], v[i + 1]) < 15 * DEG) { v.splice(i, 1); changed = true; break; }
    }
  }
  return v;
}

// 每段視為一條無限直線（可吸附到 45° 倍數），轉角取相鄰兩直線交點，使轉角精準相接
function alignCorners(v, eps, snap) {
  const Q = Math.PI / 4, SNAP = 10 * DEG;
  let lines;
  for (;;) {
    lines = [];
    for (let i = 0; i < v.length - 1; i++) {
      const a = v[i], b = v[i + 1];
      let t = Math.atan2(b.y - a.y, b.x - a.x);
      const q = Math.round(t / Q) * Q;
      if (snap && Math.abs(t - q) < SNAP) t = q;
      lines.push({ x:(a.x + b.x) / 2, y:(a.y + b.y) / 2, dx:Math.cos(t), dy:Math.sin(t) });
    }
    // 吸附後若相鄰兩段同方向，合併成一段再算一次
    const i = lines.findIndex((l, i) => i > 0 &&
      Math.abs(l.dx * lines[i - 1].dy - l.dy * lines[i - 1].dx) < 1e-6 &&
      l.dx * lines[i - 1].dx + l.dy * lines[i - 1].dy > 0);
    if (i < 0) break;
    v.splice(i, 1);
  }
  const project = (p, l) => {
    const s = (p.x - l.x) * l.dx + (p.y - l.y) * l.dy;
    return { x:l.x + s * l.dx, y:l.y + s * l.dy };
  };
  const intersect = (l1, l2) => {
    const cr = l1.dx * l2.dy - l1.dy * l2.dx;
    if (Math.abs(cr) < 1e-3) return null;
    const s = ((l2.x - l1.x) * l2.dy - (l2.y - l1.y) * l2.dx) / cr;
    return { x:l1.x + s * l1.dx, y:l1.y + s * l1.dy };
  };
  const out = [project(v[0], lines[0])];
  for (let i = 1; i < lines.length; i++) {
    const P = intersect(lines[i - 1], lines[i]);
    out.push(P && dist(P, v[i]) < eps * 3 ? P : v[i]);
  }
  out.push(project(v[v.length - 1], lines[lines.length - 1]));
  return out;
}

function straighten(pts, eps, snap) {
  const v = tidy(rdp(pts, eps), eps);
  return alignCorners(v, eps, snap).map(p => ({ x:Math.round(p.x * 10) / 10, y:Math.round(p.y * 10) / 10 }));
}

/* ---------- 狀態操作 ---------- */
function pushUndo() {
  undoStack.push(JSON.stringify(items));
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
  photos[cur].dirty = true;
}

function commit() {
  render();
  drawOverlay();
  syncStyleBar();
  $('empty').style.display = img ? 'none' : '';
  wrap.style.display = img ? 'block' : 'none';
  $('bUndo').disabled = !undoStack.length;
  $('bRedo').disabled = !redoStack.length;
  $('bDel').disabled = sel < 0;
  ['bClear', 'bCopy'].forEach(id => $(id).disabled = !img);   // 匯出 Word、儲存專案沒有照片也能用
  $('bSaveAll').disabled = !photos.length;   // 單張的「匯出 PNG」已移除，只有一張時也要能用

  const p = photos[cur];
  const count = t => items.filter(it => it.type === t).length;
  const counts = [['線', count('line')], ['字', count('text')], ['符號', count('symbol')]];
  $('title').textContent = p ? '復古風DOCX生成工具 - ' + p.name : '復古風DOCX生成工具';
  $('sPhoto').textContent = p ? '照片 ' + (cur + 1) + ' / ' + photos.length : '無照片';
  $('sSize').textContent = p ? p.w + '×' + p.h : '';
  if (!p) $('sZoom').textContent = '';
  $('sCount').textContent = p ? counts.map(([n, c]) => n + ' ' + c).join('　') : '';
  if (p) {
    p.thumb.getContext('2d').drawImage(main, 0, 0, p.thumb.width, p.thumb.height);
    p.cnt.textContent = cntText(p, items);
  }
}

// 清單上每張照片的小字：非現場照片先標用途，再列標註數
function cntText(p, list) {
  const count = t => list.filter(it => it.type === t).length;
  return (p.role !== SITE_ROLE ? '【' + p.role + '】' : '') +
    ([['線', count('line')], ['字', count('text')], ['符號', count('symbol')]]
      .filter(([, c]) => c).map(([n, c]) => n + ' ' + c).join('、') || '尚無標註');
}

/* 上一步／下一步的紀錄：一般是標註的 JSON 字串；裁切、旋轉時是 {items, img, url, file, w, h, fileVer}，
   連照片本身一起記，退回去時照片跟著換回來，更早的紀錄座標也就對得上 */
const photoState = p => ({ items:JSON.stringify(items), img:p.img, url:p.url, file:p.file, w:p.w, h:p.h, fileVer:p.fileVer });
const snapshotLike = e => typeof e === 'string' ? JSON.stringify(items) : photoState(photos[cur]);

function restoreStep(e) {
  if (typeof e === 'string') items = JSON.parse(e);
  else {
    const p = photos[cur];
    Object.assign(p, { img:e.img, url:e.url, file:e.file, w:e.w, h:e.h, fileVer:e.fileVer });
    img = p.img; main.width = p.w; main.height = p.h; unit = Math.max(p.w, p.h) / 1000;
    sizeThumb(p);
    items = JSON.parse(e.items);
    layout();
  }
  photos[cur].dirty = true;
  sel = -1;
  commit();
}

function undo() {
  if (!undoStack.length) return;
  const e = undoStack.pop();
  redoStack.push(snapshotLike(e));
  restoreStep(e);
}
function redo() {
  if (!redoStack.length) return;
  const e = redoStack.pop();
  undoStack.push(snapshotLike(e));
  restoreStep(e);
}

function deleteSel() {
  if (sel < 0) return;
  pushUndo();
  items.splice(sel, 1);
  sel = -1;
  commit();
}

function setMode(m) {
  mode = m;
  sel = -1;
  ov.style.cursor = { line:'crosshair', text:'text', select:'default', symbol:'crosshair', crop:'crosshair' }[m];
  $('hint').textContent = HINTS[m];
  renderSymbolBar();
  renderTextBar();
  renderPresetBar();
  commit();
}

// 照片用途：現場照片，或範本裡的圖片標記（{{圖:圖資}} → 圖資）
const SITE_ROLE = '現場照片';
function imageRoles() {
  return template ? template.fields.filter(n => n.startsWith('圖:')).map(n => n.slice(2)) : [];
}

// 現場照片以外的用途（圖資、品質紀錄…）每種最多一張：設給這張時，原本那張改回現場照片
function setRole(p, r) {
  if (p.role === r) return;
  const old = r !== SITE_ROLE && photos.find(q => q !== p && q.role === r);
  if (old) {
    old.role = SITE_ROLE;
    old.dirty = true;
    old.cnt.textContent = cntText(old, old === photos[cur] ? items : old.items);
    toast('「' + r + '」只能有一張，「' + old.name + '」已改回現場照片');
  }
  p.role = r;
  p.dirty = true;
  p.cnt.textContent = cntText(p, p === photos[cur] ? items : p.items);
  renumber();
}

// 照片清單按右鍵：設定用途、直接改編號。借用欄位 ▾ 的 #menu，點別處或 Esc 就關（closeFieldMenu）
function openRoleMenu(p, x, y) {
  const m = $('menu');
  m.innerHTML = '';
  const sep = text => {
    const d = document.createElement('div');
    d.className = 'sep'; d.textContent = text;
    m.appendChild(d);
  };
  const del = document.createElement('button'), picked = photos.filter(q => q.el.classList.contains('sel'));
  del.onclick = () => { closeFieldMenu(); removePhotos(picked); };
  const show = () => {
    m.classList.add('show');
    m.style.left = Math.max(4, Math.min(x, window.innerWidth - m.offsetWidth - 4)) + 'px';
    m.style.top = Math.max(4, Math.min(y, window.innerHeight - m.offsetHeight - 4)) + 'px';
    menuFor = '#role';
  };
  if (picked.length > 1) {   // 多選時只能一起刪除；用途有「每種只能一張」的限制，不給一起改
    sep('已選取 ' + picked.length + ' 張');
    del.textContent = '刪除 ' + picked.length + ' 張照片';
    m.appendChild(del);
    return show();
  }
  sep('用途：' + p.name);
  const roles = [SITE_ROLE, ...imageRoles()];
  if (!roles.includes(p.role)) roles.push(p.role);   // 換了範本也保留原本的設定
  roles.forEach(r => {
    const b = document.createElement('button');
    b.textContent = (r === p.role ? '● ' : '　 ') + r;
    b.onclick = () => { closeFieldMenu(); setRole(p, r); };
    m.appendChild(b);
  });
  const total = photos.filter(q => q.role === SITE_ROLE).length;
  let num = null;
  if (p.role === SITE_ROLE && total > 1) {   // 只有現場照片有編號
    sep('編號（現場照片 1–' + total + '）');
    const row = document.createElement('div'), go = document.createElement('button');
    num = document.createElement('input');
    row.className = 'mrow';
    num.type = 'number'; num.min = 1; num.max = total; num.value = p.no.textContent;
    go.textContent = '移動';
    const apply = () => { closeFieldMenu(); moveToNumber(p, +num.value); };
    go.onclick = apply;
    num.onkeydown = e => {   // 輸入框裡的按鍵不會走到全域快捷鍵，Esc 要自己處理
      if (e.key === 'Enter') { e.preventDefault(); apply(); }
      else if (e.key === 'Escape') closeFieldMenu();
    };
    row.append(num, go);
    m.appendChild(row);
  }
  sep('照片');
  const act = (label, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => { closeFieldMenu(); fn(); };
    m.appendChild(b);
  };
  act('向左轉 90°', () => rotatePhoto(photos.indexOf(p), -1));
  act('向右轉 90°', () => rotatePhoto(photos.indexOf(p), 1));
  act('裁切…', () => { switchTo(photos.indexOf(p)); setMode('crop'); });
  sep('');
  del.textContent = '刪除';
  m.appendChild(del);
  show();
  if (num) { num.focus(); num.select(); }   // 右鍵後可以直接打數字按 Enter
}

function sizeThumb(p) {
  const k = Math.min(THUMB_W / p.w, THUMB_H / p.h);
  p.thumb.width = Math.round(p.w * k);
  p.thumb.height = Math.round(p.h * k);
}

/* ---------- 照片旋轉、裁切 ----------
   換掉照片本身（存成 JPEG），標註換算到新座標：位置用 mapPt 換、角度加 dA；
   線寬、字級、符號大小的單位是照片長邊的 1/1000，長邊變了就乘 k，看起來才跟原本一樣大。
   換之前的照片＋標註整份記進上一步（photoState），可以退回去。 */
let lastReshape = null;   // 測試用：等照片換好

function reshapePhoto(i, cv, mapPt, dA, keepIt = () => true) {
  return lastReshape = (async () => {
    switchTo(i);   // 文字的中心要用這張照片的 unit 算
    const p = photos[i], k = unit / (Math.max(cv.width, cv.height) / 1000), before = photoState(p);
    items = items.filter(keepIt).map(it => {
      if (it.type === 'line') return { ...it, pts:it.pts.map(mapPt), width:it.width * k };
      if (it.type === 'symbol') {
        const c = mapPt(it);
        return { ...it, x:c.x, y:c.y, angle:(it.angle || 0) + dA, size:it.size * k, ...(it.strokeW !== undefined && { strokeW:it.strokeW * k }) };
      }
      const c = textCenter(it), nc = mapPt(c);   // 文字以框中心換算，框在畫面上的大小不變
      return { ...it, x:nc.x - (c.x - it.x), y:nc.y - (c.y - it.y), angle:(it.angle || 0) + dA, size:it.size * k };
    });
    undoStack.push(before);   // 舊照片的網址不撤銷：上一步還要用
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
    saveCur();
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.92));
    const { im, url } = await loadImage(blob);
    Object.assign(p, { img:im, url, file:new File([blob], p.name, { type:'image/jpeg' }), w:cv.width, h:cv.height, dirty:true, fileVer:++fileSeq });
    sizeThumb(p);
    switchTo(i);
  })();
}

// dir：1＝向右（順時針）、-1＝向左
function rotatePhoto(i, dir) {
  const p = photos[i], w = p.w, h = p.h, cv = document.createElement('canvas');
  cv.width = h; cv.height = w;
  const g = cv.getContext('2d');
  g.translate(dir > 0 ? h : 0, dir > 0 ? 0 : w);
  g.rotate(dir * Math.PI / 2);
  g.drawImage(p.img, 0, 0, w, h);
  return reshapePhoto(i, cv, dir > 0 ? q => ({ x:h - q.y, y:q.x }) : q => ({ x:q.y, y:w - q.x }), dir * Math.PI / 2);
}

// r：要留下的範圍（原圖座標）；完全在框外的標註刪掉
function cropPhoto(i, r) {
  const p = photos[i], cv = document.createElement('canvas'), sx = p.img.naturalWidth / p.w, sy = p.img.naturalHeight / p.h;
  cv.width = r.w; cv.height = r.h;
  cv.getContext('2d').drawImage(p.img, r.x * sx, r.y * sy, r.w * sx, r.h * sy, 0, 0, r.w, r.h);
  const inside = it => { const b = bbox(it); return b.x2 > r.x && b.x1 < r.x + r.w && b.y2 > r.y && b.y1 < r.y + r.h; };
  return reshapePhoto(i, cv, q => ({ x:q.x - r.x, y:q.y - r.y }), 0, inside);
}
