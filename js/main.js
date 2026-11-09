// 鍵盤與啟動初始化（必須最後載入）

/* ---------- 鍵盤 ---------- */
// 預設選取；按住線型快捷鍵暫時畫線、按住符號快捷鍵暫時放符號、按住文字快捷鍵（預設 Q）暫時放文字，放開回到選取
const presetFor = k => presets.find(p => p.key && p.key.toLowerCase() === k);
const symbolFor = k => symbols.findIndex(s => s.key && s.key.toLowerCase() === k);
const textFor = k => textStyles.findIndex(s => s.key && s.key.toLowerCase() === k);

document.addEventListener('keydown', e => {
  if (document.querySelector('.modal.show')) {
    if (e.key !== 'Escape') return;
    if (menuFor) return closeFieldMenu();
    const open = [...document.querySelectorAll('.modal.show')];
    open[open.length - 1].classList.remove('show');   // 只關最上層，常用字串視窗關掉時匯出視窗還在
    return;
  }
  if (e.target instanceof Element && e.target.matches(TYPING)) return;
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (ctrl && (k === 'y' || k === 'z')) { e.preventDefault(); redo(); }   // Ctrl+Y 或 Ctrl+Shift+Z
  else if (ctrl && k === 's') { e.preventDefault(); saveProject(); }   // 沒有照片也能存（只有修繕單欄位）
  else if (ctrl && k === 'd') { e.preventDefault(); duplicateSel(); }   // 原地複製一份選取的標註
  else if (ctrl || e.altKey) return;
  else if (k === ' ') e.preventDefault();   // 空白鍵沒有功能（以前能畫線，已拿掉）；擋掉以免捲動頁面或觸發剛點過的按鈕
  else if (presetFor(k) || symbolFor(k) >= 0 || textFor(k) >= 0) {
    if (e.repeat || heldKey) return;
    const si = symbolFor(k), ti = textFor(k);
    if (presetFor(k)) applyPreset(presetFor(k));
    if (si >= 0) curSym = si;
    if (ti >= 0) curText = ti;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    heldKey = k;
    setMode(si >= 0 ? 'symbol' : ti >= 0 ? 'text' : 'line');
  }
  else if (e.key === 'Escape') {
    if (menuFor) closeFieldMenu();   // 照片清單的右鍵選單
    poly = null;   // 點到一半的折線不要了
    setMode('select');
  }
  else if (e.key === 'Delete' || e.key === 'Backspace') deleteSel();
});

function releaseHeld() {
  if (!heldKey) return;
  heldKey = null;
  // 滑鼠還按著也停：線拖到哪就畫到哪、符號用目前拖出來的方向直接放下
  if (drag && drag.kind === 'draw') { finishStroke(drag.pts, cssToImg()); drag = null; }
  if (drag && drag.kind === 'stamp') { placeSymbol(drag.start, drag.angle); drag = null; }
  finishPoly();
  setMode('select');
  if (edit && document.activeElement !== te) { te.focus(); te.select(); }   // 按著文字鍵時放的文字框，放開才開始打字
}
document.addEventListener('keyup', e => {
  if (heldKey && e.key.toLowerCase() === heldKey) { e.preventDefault(); releaseHeld(); }
});
window.addEventListener('blur', releaseHeld);   // 切到其他視窗時可能收不到 keyup

// Ctrl+C 複製選取的標註（寫進系統剪貼簿，換照片後也能貼）
document.addEventListener('copy', e => {
  if (document.querySelector('.modal.show') || (e.target instanceof Element && e.target.matches(TYPING))) return;
  const t = copySel();
  if (!t) return;
  e.preventDefault();
  e.clipboardData.setData('text/plain', t);
  toast('已複製標註，在這張或別張照片按 Ctrl+V 貼上');
});

// Ctrl+V 貼上圖片（截圖、從其他程式複製的圖）＝新增一張照片；複製的標註＝貼到目前照片；輸入框裡貼上照常是貼文字
document.addEventListener('paste', e => {
  if (document.querySelector('.modal.show') || (e.target instanceof Element && e.target.matches(TYPING))) return;
  const list = [...e.clipboardData.files].filter(f => f.type.startsWith('image/'));
  if (!list.length) {
    const t = e.clipboardData.getData('text/plain');
    if (img && t.startsWith(CLIP_TAG)) { e.preventDefault(); pasteItem(t); }
    return;
  }
  e.preventDefault();
  const d = new Date(), stamp = pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  addFiles(list.map((f, i) => new File([f], '貼上_' + stamp + (list.length > 1 ? '_' + (i + 1) : '') + '.' + f.type.slice(6), { type:f.type })));
});

window.addEventListener('beforeunload', e => {
  if (photos.some(p => p.dirty)) { e.preventDefault(); e.returnValue = ''; }
});

loadUI();
syncControls();
setMode('select');
