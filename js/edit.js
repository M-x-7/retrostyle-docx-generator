// 滑鼠／觸控、網頁內文字輸入框、樣式設定、自訂線型與符號

/* ---------- 指標事件（滑鼠/觸控共用） ---------- */
function cssToImg() { return main.width / ov.getBoundingClientRect().width; }

// 螢幕座標→原圖座標（經過裁切、轉向的顯示矩陣換回去）
function toImg(e) {
  const r = ov.getBoundingClientRect();
  return fromDisp({ x:(e.clientX - r.left) * main.width / r.width, y:(e.clientY - r.top) * main.height / r.height });
}

// 游標是否在選取中符號／文字的把手上：'resize'／'rotate'／null
function handleAt(p) {
  if (sel < 0 || !items[sel] || items[sel].type === 'line') return null;
  const h = itemHandles(items[sel]), tol = 10 * cssToImg();
  return dist(p, h.rotate) < tol ? 'rotate' : dist(p, h.resize) < tol ? 'resize' : null;
}

function hitTest(p, onlyType) {
  const tol = 12 * cssToImg();
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (onlyType && it.type !== onlyType) continue;
    if (it.type === 'text') {
      const b = textBox(it), q = it.angle ? rotPt(p, textCenter(it), -it.angle) : p;   // 轉回文字未旋轉的方向再比
      if (q.x > b.x1 - tol / 2 && q.x < b.x2 + tol / 2 && q.y > b.y1 - tol / 2 && q.y < b.y2 + tol / 2) return i;
    } else if (it.type === 'symbol') {
      if (dist(p, it) < symbolR(it) + tol / 2) return i;
    } else {
      const lim = Math.max(tol, it.width * unit / 2);
      for (let j = 0; j < it.pts.length - 1; j++) if (segDist(p, it.pts[j], it.pts[j + 1]) < lim) return i;
    }
  }
  return -1;
}

let pan = null;   // 中鍵或右鍵拖曳平移中：{id, x, y}

ov.addEventListener('pointerdown', e => {
  if (!img) return;
  if (e.button === 1 || e.button === 2) {   // 中鍵、右鍵：拖曳平移照片（左鍵照舊選取、畫線、放符號）
    e.preventDefault();
    ov.setPointerCapture(e.pointerId);
    pan = { id:e.pointerId, x:e.clientX, y:e.clientY };
    ov.style.cursor = 'grabbing';
    return;
  }
  if (edit) {   // 輸入中點到別處：先確定文字，這一下不做其他動作
    finishEdit(true);
    return;
  }
  if (drag) {   // 第二根手指：取消目前動作，避免誤畫
    drag = null;
    drawOverlay();
    return;
  }
  ov.setPointerCapture(e.pointerId);
  const p = toImg(e);
  if (mode === 'line') {
    drag = { id:e.pointerId, kind:'draw', pts:[p] };
  } else if (mode === 'crop') {
    drag = { id:e.pointerId, kind:'crop', start:p, end:p };
  } else if (mode === 'symbol') {
    if (symbols[curSym]) drag = { id:e.pointerId, kind:'stamp', start:p, angle:-turn };   // 照片轉過也朝畫面右方
    drawOverlay();
  } else if (mode === 'select') {
    const h = handleAt(p);
    if (h) {   // 拖選取中符號／文字的把手：縮放或旋轉
      // 軸心：符號是中心；文字旋轉繞框中心，縮放時文字開頭不動（keepTextStart）
      const it = items[sel], c = it.type === 'text' ? textCenter(it) : it;
      const pivot = it.type === 'text' && h === 'resize' ? rotPt(it, c, it.angle || 0) : c;
      drag = { id:e.pointerId, kind:h, start:p, pivot, size0:it.size, moved:false };
      return;
    }
    sel = hitTest(p);
    if (sel >= 0) drag = { id:e.pointerId, kind:'move', start:p, last:p, moved:false };
    commit();
  } else {
    drag = { id:e.pointerId, kind:'tap', start:p };
  }
});

ov.addEventListener('pointermove', e => {
  if (pan && e.pointerId === pan.id) {
    view.x += e.clientX - pan.x; view.y += e.clientY - pan.y;
    pan.x = e.clientX; pan.y = e.clientY;
    return layout();
  }
  if (poly && !drag) { poly.hover = snapFrom(poly.pts[poly.pts.length - 1], toImg(e)); drawOverlay(); return; }
  if (!drag && mode === 'select') ov.style.cursor = { resize:'nwse-resize', rotate:'grab' }[handleAt(toImg(e))] || 'default';
  if (!drag || e.pointerId !== drag.id) return;
  const p = toImg(e), f = cssToImg();
  if (drag.kind === 'resize' || drag.kind === 'rotate') {
    const it = items[sel];
    if (!drag.moved) { pushUndo(); drag.moved = true; }
    if (drag.kind === 'resize') {   // 依離軸心的距離等比例縮放，範圍同樣式列滑桿
      const S = SLIDERS[it.type], o = drag.pivot;
      setSize(it, Math.max(S.min, Math.min(S.max, Math.round(drag.size0 * dist(p, o) / Math.max(1, dist(drag.start, o))))));
    } else {   // 符號／文字朝向游標；開啟吸附時對齊 45° 倍數（同放置符號時）
      const t = Math.atan2(p.y - drag.pivot.y, p.x - drag.pivot.x), Q = Math.PI / 4;
      it.angle = settings.snap ? Math.round(t / Q) * Q : t;
    }
    return commit();
  }
  if (drag.kind === 'crop') {
    drag.end = p;
    drawOverlay();
  } else if (drag.kind === 'draw') {
    if (dist(p, drag.pts[drag.pts.length - 1]) >= f) { drag.pts.push(p); drawOverlay(); }
  } else if (drag.kind === 'stamp') {
    if (dist(p, drag.start) >= 8 * f) {   // 拖曳決定方向；開啟吸附時對齊 45° 倍數
      const t = Math.atan2(p.y - drag.start.y, p.x - drag.start.x), Q = Math.PI / 4;
      drag.angle = settings.snap ? Math.round(t / Q) * Q : t;
      drawOverlay();
    }
  } else if (drag.kind === 'move') {
    if (!drag.moved) {
      if (dist(p, drag.start) < 4 * f) return;
      pushUndo();
      drag.moved = true;
    }
    moveItem(items[sel], p.x - drag.last.x, p.y - drag.last.y);
    drag.last = p;
    commit();
  }
});

ov.addEventListener('pointerup', e => {
  if (pan && e.pointerId === pan.id) { pan = null; ov.style.cursor = ''; return; }
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag, p = toImg(e), f = cssToImg();
  drag = null;
  if (d.kind === 'crop') return finishCrop(d, f);
  if (d.kind === 'draw') finishStroke(d.pts, f);
  else if (d.kind === 'stamp') placeSymbol(d.start, d.angle);
  else if (d.kind === 'tap' && dist(p, d.start) < 10 * f) textAt(d.start);
  drawOverlay();
});

ov.addEventListener('pointercancel', () => { drag = null; pan = null; ov.style.cursor = ''; drawOverlay(); });
ov.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });   // 中鍵不要啟動瀏覽器的自動捲動
ov.addEventListener('contextmenu', e => e.preventDefault());   // 右鍵是平移，不跳瀏覽器選單
stage.addEventListener('wheel', e => {
  if (!img) return;
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, view.z * (e.deltaY < 0 ? 1.25 : 0.8));
}, { passive:false });
$('sZoom').onclick = resetView;   // 狀態列的縮放比例：點一下回到整張

// 裁切框（原圖座標，夾在照片範圍內、取整數）
function cropRect(d) {
  const x1 = Math.max(0, Math.min(d.start.x, d.end.x)), y1 = Math.max(0, Math.min(d.start.y, d.end.y));
  const x2 = Math.min(photos[cur].w, Math.max(d.start.x, d.end.x)), y2 = Math.min(photos[cur].h, Math.max(d.start.y, d.end.y));
  return { x:Math.round(x1), y:Math.round(y1), w:Math.round(x2 - x1), h:Math.round(y2 - y1) };
}

// 放開滑鼠就套用（框太小當成沒框）；原圖保留，可再框或取消裁切，也能按上一步
function finishCrop(d, f) {
  const r = cropRect(d);
  drawOverlay();
  if (mode !== 'crop' || r.w < 10 * f || r.h < 10 * f) return;   // 拖到一半按了 Esc 就不裁
  cropPhoto(cur, r);
  setMode('select');
}

function finishStroke(pts, f) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  if (len < 15 * f) return addPoint(pts[0]);   // 幾乎沒拖動：當成點一下，放一個折線點
  // 拖曳的一段先拉直，再接到同一條折線後面；放開按鍵才成為一條線
  const s = straighten(pts, (4 + settings.sens * 3) * f, settings.snap);
  if (!poly) poly = { pts:[], hover:null };
  const last = poly.pts[poly.pts.length - 1];
  if (last && dist(s[0], last) < 15 * f) s.shift();   // 從上一點附近開始拖：直接接在上一點，不留小折角
  poly.pts.push(...s);
  poly.hover = null;
}

// 吸附開著時，新的點依前一點對齊水平／垂直／45°（投影到最近的方向上）
function snapFrom(a, p) {
  if (!settings.snap) return p;
  const Q = Math.PI / 4, t = Math.round(Math.atan2(p.y - a.y, p.x - a.x) / Q) * Q;
  const len = (p.x - a.x) * Math.cos(t) + (p.y - a.y) * Math.sin(t);
  return { x:a.x + len * Math.cos(t), y:a.y + len * Math.sin(t) };
}

function addPoint(p) {
  if (!poly) poly = { pts:[], hover:null };
  const last = poly.pts[poly.pts.length - 1];
  if (last) p = snapFrom(last, p);
  if (!last || dist(p, last) >= 4 * cssToImg()) poly.pts.push(p);   // 同一點連點兩下不算轉折
  poly.hover = null;
}

// 放開畫線鍵：按住期間點的、拖的全部合成一條線（至少要兩點）
function finishPoly() {
  const pts = poly ? poly.pts : [];
  poly = null;
  if (pts.length < 2) return drawOverlay();
  pushUndo();
  items.push({ type:'line', pts, color:settings.color, width:settings.width, dash:settings.dash, arrow:settings.arrow });
  commit();
}

function placeSymbol(p, angle) {
  const s = symbols[curSym];
  pushUndo();
  const { name, key, ...look } = s;   // 名稱、快捷鍵以外的設定全部帶進去
  items.push({ type:'symbol', x:p.x, y:p.y, angle, ...look });
  commit();
}

function textAt(p) {
  openEditor(p, hitTest(p, 'text'));
}

// 標註平移 dx, dy（原圖座標）
function moveItem(it, dx, dy) {
  if (it.type === 'line') it.pts.forEach(q => { q.x += dx; q.y += dy; });
  else { it.x += dx; it.y += dy; }
}

/* ---------- 複製標註：Ctrl+C／Ctrl+V（可貼到別張照片）、Ctrl+D 原地複製一份 ----------
   寫進系統剪貼簿的是一段帶開頭標記的文字，貼上時認得出來；剪貼簿裡是圖片時 Ctrl+V 照舊是新增照片 */
const CLIP_TAG = 'cable-photo-annotator/item:';

function copySel() {
  return sel >= 0 ? CLIP_TAG + JSON.stringify({ w:photos[cur].w, h:photos[cur].h, item:items[sel] }) : null;
}

// 位置依兩張照片的大小比例換算（線寬、字級、符號大小本來就跟著照片長邊走）；跟既有的完全重疊時往右下錯開
function pasteItem(text) {
  let d;
  try { d = JSON.parse(text.slice(CLIP_TAG.length)); } catch (err) { return; }
  const it = d.item, sx = photos[cur].w / d.w, sy = photos[cur].h / d.h;
  if (it.type === 'line') it.pts.forEach(q => { q.x *= sx; q.y *= sy; });
  else { it.x *= sx; it.y *= sy; }
  while (items.some(x => JSON.stringify(x) === JSON.stringify(it))) moveItem(it, 20 * unit, 20 * unit);
  pushUndo();
  items.push(it);
  sel = items.length - 1;
  commit();
}

function duplicateSel() {
  const t = copySel();
  if (t) pasteItem(t);
}

ov.addEventListener('dblclick', e => {
  if (!img || mode !== 'select') return;
  const i = hitTest(toImg(e));
  if (i < 0) return;
  if (items[i].type === 'text') openEditor(null, i);
  else if (items[i].type === 'symbol') openLabelEditor(i);
});

// 修改符號內文：輸入框出現在符號下方，Shift+Enter 換行、Enter 確定
function openLabelEditor(idx) {
  const it = items[idx], f = cssToImg(), d = toDisp(it);
  edit = { idx, label:true };
  sel = -1;
  drawOverlay();
  Object.assign(te.style, {
    display:'block', left:(d.x / f - 80) + 'px', top:((d.y + it.size * unit / 2) / f + 4) + 'px',
    fontSize:'16px', color:'#fff', width:'160px', transform:'', textAlign:'center',
  });
  te.value = it.label || '';
  sizeEditor();
  te.focus();
  te.select();
}

/* ---------- 網頁內文字輸入框 ---------- */
function openEditor(p, idx) {
  const it = idx >= 0 ? items[idx] : null, st = textStyles[curText];   // 新文字用目前的文字樣式
  const size = it ? it.size : st.size;
  // 新文字：(x, y) 先記「畫面上字的開頭」該在的位置（點的地方往上半個字高），確定時再換成錨點（finishEdit）
  const s0 = it ? it : (d => fromDisp({ x:d.x, y:d.y - size * unit * 0.55 }))(toDisp(p));
  edit = { idx, size, x:s0.x, y:s0.y,
    color: it ? it.color : st.color, stroke:st.stroke, box:st.box, align: (it ? it.align : st.align) || 'left' };
  sel = -1;
  render();
  drawOverlay();
  const f = cssToImg(), a = it && it.angle || 0, at = toDisp(a ? rotPt(it, textCenter(it), a) : edit);   // 輸入框從畫面上的文字開頭開始
  const sa = it ? a + turn : 0;   // 畫面上字的角度：新文字一律是正的
  Object.assign(te.style, {
    display:'block', left:(at.x / f - 3) + 'px', top:(at.y / f - 1) + 'px',
    fontSize:(size * unit / f) + 'px', color:edit.color,
    transform:sa ? 'rotate(' + sa + 'rad)' : '', transformOrigin:'3px 1px', textAlign:edit.align,
  });
  te.value = it ? it.text : '';
  sizeEditor();
  if (heldKey) return;   // 還按著文字鍵時先不給焦點，否則按鍵連發會打進框裡；放開才聚焦（releaseHeld）
  te.focus();
  te.select();
}

function sizeEditor() {
  te.rows = te.value.split('\n').length;   // 符號內文、照片上的文字都可以 Shift+Enter 換行
  if (edit.label) return;
  const px = edit.size * unit;
  mctx.font = 'bold ' + px + 'px ' + FONT;
  const w = Math.max(...(te.value || te.placeholder).split('\n').map(l => mctx.measureText(l).width));
  te.style.width = (w + px) / cssToImg() + 'px';
}

function finishEdit(ok) {
  if (!edit) return;
  // 每行去頭尾空白、丟掉空行（符號內文、照片上的文字都一樣）
  const e = edit, text = te.value.split('\n').map(l => l.trim()).filter(Boolean).join('\n');
  edit = null;
  te.style.display = 'none';
  const it = e.idx >= 0 ? items[e.idx] : null;
  if (e.label) {
    if (ok && text !== (it.label || '')) { pushUndo(); it.label = text; }
  } else if (ok && it && text !== it.text) {
    pushUndo();
    if (text) keepTextStart(it, () => { it.text = text; });
    else items.splice(e.idx, 1);
  } else if (ok && !it && text) {
    pushUndo();
    const t = { type:'text', x:e.x, y:e.y, text, color:e.color, size:e.size, stroke:e.stroke, box:e.box, align:e.align };
    if (turn) {   // 照片轉過：字反向轉回來，並讓畫面上字的開頭留在輸入框的位置（文字以框中心旋轉）
      t.angle = -turn;
      const v = textCenter({ ...t, x:0, y:0 }), rv = rotPt(v, { x:0, y:0 }, t.angle);
      t.x += rv.x - v.x; t.y += rv.y - v.y;
    }
    items.push(t);
  }
  commit();
}

te.addEventListener('input', sizeEditor);
te.addEventListener('blur', () => finishEdit(true));
te.addEventListener('keydown', e => {
  if (e.isComposing || e.keyCode === 229) return;   // 注音/倉頡選字中的 Enter 不算確定
  if (e.key === 'Enter' && e.shiftKey) return;   // Shift+Enter 換行（照樣插入換行，input 事件會調高度）
  if (e.key === 'Enter') { e.preventDefault(); finishEdit(true); }
  else if (e.key === 'Escape') finishEdit(false);
});

/* ---------- 樣式設定（同時套用到選取的項目） ---------- */
function applyToSel(prop, val) {
  if (sel < 0) return;
  const it = items[sel];
  if (['width', 'dash', 'arrow'].includes(prop) && it.type !== 'line') return;
  if (prop === 'align' && it.type !== 'text') return;
  if (!editing) { pushUndo(); editing = true; }
  it[prop] = val;
  commit();
}

// 樣式列的滑桿跟著選取的項目變：線＝線寬、文字＝字級、符號＝大小；沒選取時是畫新線用的線寬
const SLIDERS = {
  line: { label:'線寬', prop:'width', min:1, max:15 },
  text: { label:'字級', prop:'size', min:10, max:80 },
  symbol: { label:'大小', prop:'size', min:10, max:500 },
};

// 工具列的顏色、滑桿、線型、箭頭：有選取時顯示那個項目的值，否則顯示畫新線用的設定（commit() 每次都會呼叫）
function syncStyleBar() {
  const it = sel >= 0 ? items[sel] : null, kind = it ? it.type : 'line', S = SLIDERS[kind];
  // 沒選取時顏色、樣式整區停用：新畫的線一律用線型快捷鍵帶的設定，這時調了也用不到
  ['fsColor', 'fsStyle'].forEach(id => { $(id).disabled = !it; $(id).title = it ? '' : '先選取線、文字或符號才能改'; });
  const v = it ? it[S.prop] : settings.width, color = it ? it.color : settings.color;
  $('widthL').textContent = S.label;
  Object.assign($('width'), { min:S.min, max:S.max, value:v });
  $('widthV').textContent = v;
  $('lineOpts').style.display = kind === 'line' ? '' : 'none';   // 線型、箭頭只對線有意義
  $('textOpts').style.display = kind === 'text' ? '' : 'none';   // 對齊只對文字有意義
  $('align').value = kind === 'text' ? it.align || 'left' : 'left';
  $('dash').value = it ? it.dash : settings.dash;
  $('arrow').value = it ? it.arrow : settings.arrow;
  $('color').value = color;
  document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('on', s.dataset.c === color));
}

// 把 settings 反映到工具列上的各個控制項
function syncControls() {
  syncStyleBar();
  $('sens').value = settings.sens; $('sensV').textContent = settings.sens;
  $('snap').checked = settings.snap;
  renderPresetBar();
  saveUI();
}

function loadUI() {
  try {
    const s = JSON.parse(localStorage.getItem(UI_STORE));
    if (s) applyUI(s);
  } catch (err) { /* 讀不到就用預設值 */ }
}

// s = {settings, sideWidth}（localStorage 與設定檔同格式）；型別不對的值略過
function applyUI(s) {
  for (const k in settings) if (s.settings && typeof s.settings[k] === typeof settings[k]) settings[k] = s.settings[k];
  if (s.sideWidth) $('side').style.width = Math.max(140, Math.min(s.sideWidth, window.innerWidth - 320)) + 'px';
}

function saveUI() {
  try {
    localStorage.setItem(UI_STORE, JSON.stringify({ settings, sideWidth:parseInt($('side').style.width) || null }));
  } catch (err) { /* 瀏覽器禁止儲存時只在本次有效 */ }
}

function setColor(c) {
  settings.color = c;
  applyToSel('color', c);
  syncControls();
}

COLORS.forEach(c => {
  const b = document.createElement('button');
  b.className = 'swatch'; b.dataset.c = c; b.style.background = c; b.title = c;
  b.onclick = () => { editing = false; setColor(c); editing = false; };
  $('swatches').appendChild(b);
});
$('color').oninput = e => setColor(e.target.value);
$('color').onchange = () => { editing = false; };

$('width').oninput = () => {
  const v = +$('width').value, it = sel >= 0 ? items[sel] : null;
  $('widthV').textContent = v;
  if (!it || it.type === 'line') { settings.width = v; renderPresetBar(); }   // 字級、符號大小不影響畫新線的線寬
  if (!it) return;
  if (!editing) { pushUndo(); editing = true; }
  if (it.type === 'line') it.width = v;
  else setSize(it, v);
  commit();
};

// 符號大小／文字字級；旋轉的文字改字級時開頭留在原位
function setSize(it, v) {
  if (it.type === 'text') keepTextStart(it, () => { it.size = v; });
  else it.size = v;
}
$('sens').oninput = () => { settings.sens = +$('sens').value; $('sensV').textContent = settings.sens; };
['width', 'sens'].forEach(k => { $(k).onchange = () => { editing = false; saveUI(); }; });

const options = map => Object.entries(map).map(([v, t]) => '<option value="' + v + '">' + t + '</option>').join('');
$('align').innerHTML = options(ALIGN_NAMES);
$('align').onchange = e => {
  editing = false; applyToSel('align', e.target.value); editing = false;
  e.target.blur();   // 讓快捷鍵立刻可用
};
$('dash').innerHTML = options(DASH_NAMES);
$('arrow').innerHTML = options(ARROW_NAMES);
['dash', 'arrow'].forEach(k => $(k).onchange = e => {
  settings[k] = e.target.value;
  editing = false; applyToSel(k, settings[k]); editing = false;
  e.target.blur();   // 讓快捷鍵立刻可用
  renderPresetBar();
  saveUI();
});
$('snap').onchange = e => { settings.snap = e.target.checked; saveUI(); };

/* ---------- 自訂線型、符號與快捷鍵 ---------- */
function symbolSample(s, px) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  drawSymbol(cv.getContext('2d'), { ...s, x:px / 2, y:px / 2, angle:0 }, px * 0.4);
  return cv;
}

function renderSymbolBar() {
  const bar = $('symbolBar');
  bar.innerHTML = '';
  symbols.forEach((s, i) => {
    const b = document.createElement('button');
    b.append(symbolSample(s, 24), s.name + (s.key ? '(' + s.key + ')' : ''));
    b.classList.toggle('on', mode === 'symbol' && curSym === i);
    b.title = s.key ? '按住 ' + s.key + ' 點照片放置' : '沒有快捷鍵，到設定裡指定一個才能放';   // 標註只能用快捷鍵放（使用者指定），按鈕只當對照表
    bar.appendChild(b);
  });
}

function textSample(s) {
  const cv = document.createElement('canvas');
  cv.width = 44; cv.height = 24;
  drawText(cv.getContext('2d'), { ...s, text:'文字', x:6, y:3 }, 16);
  return cv;
}

// 點文字樣式：有選取文字就把樣式套上去，否則切到文字模式、用這個樣式放新文字
function renderTextBar() {
  const bar = $('textBar');
  bar.innerHTML = '';
  textStyles.forEach((s, i) => {
    const b = document.createElement('button');
    b.append(textSample(s), s.name + (s.key ? '(' + s.key + ')' : ''));
    b.classList.toggle('on', mode === 'text' && curText === i);
    b.title = (s.key ? '按住 ' + s.key + ' 點照片放文字' : '沒有快捷鍵，到設定裡指定一個才能放') + '；選取文字時點這裡換成這個樣式';
    b.onclick = () => {   // 滑鼠只用來換選取中文字的樣式；放文字一律按住快捷鍵（使用者指定）
      if (sel < 0 || items[sel].type !== 'text') return;
      pushUndo();
      keepTextStart(items[sel], () => ['color', 'size', 'stroke', 'box', 'align'].forEach(k => { items[sel][k] = k === 'align' ? s.align || 'left' : s[k]; }));
      commit();
    };
    bar.appendChild(b);
  });
}

function presetSample(p) {
  const cv = document.createElement('canvas');
  cv.width = 40; cv.height = 14;
  strokeLine(cv.getContext('2d'), [{ x:3, y:7 }, { x:37, y:7 }], p.color, 2.5, p.dash, p.arrow);
  return cv;
}

function renderPresetBar() {
  const bar = $('presetBar');
  bar.innerHTML = '';
  presets.forEach(p => {
    const b = document.createElement('button');
    b.append(presetSample(p), p.name + (p.key ? '(' + p.key + ')' : ''));
    b.classList.toggle('on', mode === 'line' && ['color', 'width', 'dash', 'arrow'].every(k => settings[k] === p[k]));   // 只在畫線中亮
    b.title = (p.key ? '按住 ' + p.key + ' 用這個線型畫線' : '沒有快捷鍵，到設定裡指定一個才能用') + '；選取線時點這裡換成這個線型';
    b.onclick = () => {   // 滑鼠只用來換選取中線的線型；畫線用的線型一律由快捷鍵決定（使用者指定）
      if (sel < 0 || items[sel].type !== 'line') return;
      pushUndo();
      ['color', 'width', 'dash', 'arrow'].forEach(k => { items[sel][k] = p[k]; });
      commit();
    };
    bar.appendChild(b);
  });
}

// 按線型快捷鍵：切換畫新線用的線型
function applyPreset(p) {
  ['color', 'width', 'dash', 'arrow'].forEach(k => { settings[k] = p[k]; });
  syncControls();
}

// 設定視窗的欄位定義：線型與符號共用同一套表格產生/讀取程式
const LINE_COLS = [
  { k:'name', t:'text', max:12 }, { k:'key', t:'key' }, { k:'color', t:'color' },
  { k:'width', t:'number', min:1, max:15 }, { k:'dash', t:'select', opts:DASH_NAMES }, { k:'arrow', t:'select', opts:ARROW_NAMES },
];
const SYMBOL_COLS = [
  { k:'name', t:'text', max:12 }, { k:'key', t:'key' }, { k:'shape', t:'select', opts:SHAPE_NAMES },
  { k:'fill', t:'select', opts:FILL_NAMES }, { k:'color', t:'color' }, { k:'color2', t:'color' },
  { k:'stroke', t:'color' }, { k:'strokeW', t:'number', min:0, max:30 }, { k:'size', t:'number', min:10, max:500 },
  { k:'label', t:'lines', max:30 },
];
const TSTYLE_COLS = [
  { k:'name', t:'text', max:12 }, { k:'key', t:'key' }, { k:'color', t:'color' }, { k:'size', t:'number', min:10, max:80 },
  { k:'stroke', t:'select', opts:STROKE_NAMES }, { k:'box', t:'select', opts:BOX_NAMES }, { k:'align', t:'select', opts:ALIGN_NAMES },
];
const TEXT_COLS = [{ k:'name', t:'text', max:20 }, { k:'text', t:'text', max:200 }];
function prevCell(text) {
  const d = document.createElement('div');
  d.className = 'prev';
  d.textContent = text;
  return d;
}
const textPreview = o => prevCell(expand(o.text));                          // 常用字串的「展開後」
const TABLES = {
  line: { table:'lineTable', cols:LINE_COLS, sample:p => presetSample(p) },
  symbol: { table:'symTable', cols:SYMBOL_COLS, sample:s => symbolSample(s, 30) },
  tstyle: { table:'tstyleTable', cols:TSTYLE_COLS, sample:textSample },
  snip: { table:'snipTable', cols:TEXT_COLS, sample:textPreview },
};

function readRow(tr, cols) {
  const o = {};
  cols.forEach(c => {
    const v = tr.querySelector('.c-' + c.k).value;
    o[c.k] = c.t === 'number' ? Math.max(c.min, Math.min(c.max, Math.round(+v) || c.min))
      : c.t === 'key' ? v.trim().toUpperCase()
      : c.t === 'text' ? v.trim()
      : c.t === 'lines' ? v.split('\n').map(l => l.trim()).filter(Boolean).join('\n') : v;
  });
  if (!o.name) o.name = '未命名';
  return o;
}

function addRow(kind, obj) {
  const { table, cols, sample } = TABLES[kind];
  const tr = document.createElement('tr'), preview = document.createElement('td');
  tr.appendChild(preview);
  cols.forEach(c => {
    const el = document.createElement(c.t === 'select' ? 'select' : c.t === 'lines' ? 'textarea' : 'input');
    if (c.t === 'select') el.innerHTML = options(c.opts);
    else if (c.t === 'lines') {   // 多行：Shift+Enter 換行，單按 Enter 不換行（跟照片上改內文一樣）
      el.addEventListener('input', () => { el.rows = el.value.split('\n').length; });
      el.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) e.preventDefault(); });
    }
    else el.type = c.t === 'key' ? 'text' : c.t;
    if (c.max && (c.t === 'text' || c.t === 'lines')) el.maxLength = c.max;
    if (c.t === 'number') { el.min = c.min; el.max = c.max; }
    if (c.t === 'key') el.oninput = () => { el.value = el.value.slice(-1).toUpperCase(); };
    el.className = 'c-' + c.k;
    el.value = obj[c.k];
    if (c.t === 'lines') el.rows = el.value.split('\n').length;
    const td = document.createElement('td');
    td.appendChild(el);
    tr.appendChild(td);
  });
  const del = document.createElement('button'), td = document.createElement('td');
  del.textContent = '×'; del.title = '刪除';
  del.onclick = () => tr.remove();
  td.appendChild(del);
  tr.appendChild(td);
  const redraw = () => preview.replaceChildren(sample(readRow(tr, cols)));   // 即時預覽
  tr.addEventListener('input', redraw);
  tr.addEventListener('change', redraw);
  redraw();
  $(table).tBodies[0].appendChild(tr);
}

// 顏色格（設定視窗、工具列）：點下去先出常用色，「其他顏色…」才開系統調色盤
document.addEventListener('click', e => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement) || el.type !== 'color') return;
  e.preventDefault();   // 擋掉系統調色盤
  openPalette(el);
});

function openPalette(el) {
  const m = $('menu'), grid = document.createElement('div'), more = document.createElement('button');
  const pick = c => {
    closeFieldMenu();
    el.value = c;
    el.dispatchEvent(new Event('input', { bubbles:true }));
    el.dispatchEvent(new Event('change', { bubbles:true }));
  };
  m.innerHTML = '';
  grid.className = 'palette';
  PALETTE.forEach(c => {
    const b = document.createElement('button');
    b.className = 'swatch'; b.style.background = c; b.title = c;
    b.classList.toggle('on', el.value === c);
    b.onclick = () => pick(c);
    grid.appendChild(b);
  });
  more.textContent = '其他顏色…';
  more.onclick = () => { closeFieldMenu(); el.showPicker(); };
  m.append(grid, more);
  m.classList.add('show');
  const r = el.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(r.left, window.innerWidth - m.offsetWidth - 4)) + 'px';
  m.style.top = Math.max(4, Math.min(r.bottom + 2, window.innerHeight - m.offsetHeight - 4)) + 'px';
  menuFor = '#palette';
}

// 舊格式的符號（沒有第二色、描邊欄位，樣式有「白底」）換成表格欄位，外觀同 symbolLook()：白底＝實心白色＋原顏色描邊
function symbolRow(s) {
  if (s.strokeW !== undefined) return { color2:'#ffffff', ...s };
  const lw = { outline:0.07, white:0.11 }[s.fill] || (TWO_TONE.includes(s.shape) ? 0.04 : 0);   // 舊的描邊寬是大小的比例
  return { color2:'#ffffff', ...s, fill:s.fill === 'outline' ? 'outline' : 'solid', color:s.fill === 'white' ? '#ffffff' : s.color,
    stroke:s.color, strokeW:Math.round(s.size * lw) };
}

function fillTables(lines, syms, texts) {
  ['lineTable', 'symTable', 'tstyleTable'].forEach(t => { $(t).tBodies[0].innerHTML = ''; });
  lines.forEach(p => addRow('line', p));
  syms.forEach(s => addRow('symbol', symbolRow(s)));
  texts.forEach(s => addRow('tstyle', { align:'left', ...s }));   // 舊的文字樣式沒有對齊＝靠左
}

document.querySelectorAll('.openPresets').forEach(b => b.onclick = () => {
  fillTables(presets, symbols, textStyles);
  showModal('dlgPresets', true);
});
$('pAddLine').onclick = () => addRow('line', { name:'新線型', key:'', color:settings.color, width:settings.width, dash:settings.dash, arrow:settings.arrow });
$('pAddSym').onclick = () => addRow('symbol', { name:'新符號', key:'', shape:'circle', fill:'solid', color:settings.color, color2:'#ffffff',
  stroke:settings.color, strokeW:3, size:120, label:'' });
$('pAddText').onclick = () => addRow('tstyle', { name:'新文字', key:'', color:settings.color, size:28, stroke:'auto', box:'none', align:'left' });
$('pReset').onclick = () => fillTables(DEFAULT_PRESETS, DEFAULT_SYMBOLS, DEFAULT_TEXT_STYLES);
$('pCancel').onclick = () => showModal('dlgPresets', false);
$('pOk').onclick = () => {
  const rows = kind => [...$(TABLES[kind].table).tBodies[0].rows].map(tr => readRow(tr, TABLES[kind].cols));
  const lines = rows('line'), syms = rows('symbol'), texts = rows('tstyle');
  if (!texts.length) return alert('文字樣式至少要留一個，不然沒辦法新增文字。');
  const keys = [...lines, ...syms, ...texts].map(r => r.key).filter(Boolean);
  const bad = keys.find(k => !/^[A-Z0-9]$/.test(k));
  if (bad) return alert('快捷鍵「' + bad + '」不能使用：只能是英文字母或數字。');
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dup) return alert('快捷鍵「' + dup + '」重複了（線型、符號、文字不能共用同一個鍵）。');
  setStyles(lines, syms, texts);
  showModal('dlgPresets', false);
};

// 換掉線型、符號、文字樣式並存起來（設定視窗按確定、匯入設定檔都走這裡）
function setStyles(lines, syms, texts) {
  presets = lines;
  symbols = syms;
  textStyles = texts;
  curSym = Math.min(curSym, Math.max(0, symbols.length - 1));
  curText = Math.min(curText, textStyles.length - 1);
  saveList(PRESET_STORE, presets);
  saveList(SYMBOL_STORE, symbols);
  saveList(TEXT_STYLE_STORE, textStyles);
  renderPresetBar();
  renderSymbolBar();
  renderTextBar();
}

function showModal(id, on) {
  if (!on) closeFieldMenu();
  $(id).classList.toggle('show', on);
}
