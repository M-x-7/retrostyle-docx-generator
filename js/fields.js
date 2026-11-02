// 匯出對話框的欄位系統：{名稱} 展開、範本設定表的欄位規則、常用字串

/* ---------- 欄位值裡的 {名稱}：常用字串、其他欄位、內建日期 ----------
   匯出時才展開，所以「事件說明」裡寫的 {事件地點} 會跟著事件地點一起變。 */
const pad2 = n => String(n).padStart(2, '0');
const rocDate = (d = new Date()) => (d.getFullYear() - 1911) + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate());
const adDate = (d = new Date()) => '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
// 選項用 / 或換行分隔，寫成「標籤=實際文字」，沒有 = 就兩者相同；實際文字裡可以再放 {名稱}。
// 全形的 ／＝ 也認（在 Word 裡用中文輸入法打的）
const parseOpts = s => (s || '').split(/[\/／\n]/).map(x => x.trim()).filter(Boolean).map(x => {
  const i = x.search(/[=＝]/);
  return i < 0 ? { t:x, v:x } : { t:x.slice(0, i).trim(), v:x.slice(i + 1).trim() };
});

/* ---------- 範本設定表的欄位規則（word.js parseSettings 讀出來放在 template.defs） ----------
   {name, type: 文字|多行|數字|月日|流水號|選項|對照, opts, def, req}
   預設值以 = 開頭＝公式：保留 {名稱} 原樣、匯出時才展開，引用的欄位改了會跟著變；
   不是 = 開頭就在開對話框帶入的當下展開成固定文字（例 建立日期 {今天}）。 */
const LIVE = /^[=＝]/;
const FILE_NAME_DEF = '檔名';   // 設定表裡這一列不是欄位：預設值是匯出檔名的公式
const defOf = name => template ? template.defs.find(d => d.name === name) : undefined;
const typeOf = name => (defOf(name) || {}).type || '文字';
const serialLen = name => Math.max(1, parseInt(defOf(name).opts) || 3);   // 流水號：選項欄寫碼數，預設 3

// 對照：預設值（例 {編號}）展開後去比選項的標籤，開頭相符的最長那個勝出（01=北區 → 0123 對到北區）；對不到＝空白
function lookup(d, depth) {
  const src = expand(d.def.replace(LIVE, ''), depth + 1);
  const hit = parseOpts(d.opts).filter(o => src.startsWith(o.t)).sort((a, b) => b.t.length - a.t.length)[0];
  return hit ? expand(hit.v, depth + 1) : '';
}

const BUILTIN = {
  今天:rocDate, 今天西元:adDate,
  今天月日:(d = new Date()) => pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()),
};

// 認不得的 {…} 原樣留著，打錯字不會靜默消失；深度上限同時擋住互相引用造成的無限展開
function expand(text, depth = 0) {
  if (typeof text !== 'string' || depth > 10 || text.indexOf('{') < 0) return text || '';
  // 後面跟著的那一個空白一起抓進來：引用的欄位沒填時連空白一起吃掉，才不會留下「 慶訂：」這種開頭空格
  return text.replace(/\{([^{}]+)\}( ?)/g, (all, name, sp) => {
    const v = resolve(name.trim(), depth);
    if (v === null) return all;
    return v ? v + sp : '';
  });
}

// 展開一個名稱；認不得就回 null（由 expand 把 {…} 原樣留著）
function resolve(name, depth) {
  const cond = name.match(/^([^=＝?？]+)[=＝]([^?？]*)[?？]([^:：]*)[:：](.*)$/);   // {欄位=值?是:否}，在 Word 裡打成全形也認
  if (cond) {
    const now = resolve(cond[1].trim(), depth);
    return now === cond[2].trim() ? cond[3] : cond[4];   // 分支不 trim，才寫得出「 另附說明，」這種前面帶空白的
  }
  if (BUILTIN[name]) return BUILTIN[name]();
  const d = defOf(name);
  if (d && d.type === '對照') return lookup(d, depth);
  const sn = snippets.find(x => x.name === name);
  if (sn) return expand(sn.text, depth + 1);
  if (typeof docFields[name] === 'string') return expand(docFields[name], depth + 1);
  if (allFields().includes(name)) return '';   // 有這個欄位、只是還沒填
  return null;
}

const textFields = () => template ? template.fields.filter(n => !isImageField(n) && !n.startsWith('□')) : [];
// 自訂欄位＝設定表裡有、範本內文沒有的欄位：不印進 .docx，只是給 {名稱} 引用
const myFields = () => template ? template.defs.filter(d => d.type !== '對照' && d.name !== FILE_NAME_DEF && !template.fields.includes(d.name)).map(d => d.name) : [];
const allFields = () => [...myFields(), ...textFields()];
const optsOf = name => typeOf(name) === '選項' ? parseOpts(defOf(name).opts) : [];
// 勾選框群組和設定表裡的欄位同名（例 □分區:北區 ↔ 對照欄位「分區」）：依那個欄位的值自動勾，畫面上不顯示
const autoBoxField = name => { const g = name.slice(1).split(':')[0]; return defOf(g) ? g : null; };

function syncAutoBoxes() {
  if (!template) return false;
  let changed = false;
  for (const name of template.fields) {
    if (!name.startsWith('□') || !autoBoxField(name)) continue;
    const v = expand('{' + autoBoxField(name) + '}'), opt = name.split(':')[1];
    const on = opt === undefined ? !!v : v === opt;
    if (docFields[name] !== on) changed = true;
    docFields[name] = on;
  }
  return changed;
}

// 開匯出對話框時把還沒填的欄位帶入預設值；選項欄位沒選過（或選的已不在選項裡）就用第一個
function applyFieldDefaults() {
  let changed = false;
  for (const name of allFields()) {
    const opts = optsOf(name), v = docFields[name], d = defOf(name);
    if (opts.length) {
      if (!opts.some(o => o.v === v)) { docFields[name] = opts[0].v; changed = true; }
    } else if (d && d.def && !v) {
      docFields[name] = LIVE.test(d.def) ? d.def.replace(LIVE, '') : expand(d.def);   // 公式原樣留著，才會跟著被引用的欄位連動
      changed = true;
    }
  }
  if (syncAutoBoxes()) changed = true;
  if (changed && cur >= 0) photos[cur].dirty = true;
}

// 載入範本時檢查設定表：類型看不懂、必填找不到欄位、公式引用了不存在的名稱。打錯字的話規則會靜默失效，要講出來
function templateProblems() {
  const out = [...template.problems];
  const unknown = template.required.filter(n => !allFields().includes(n));
  if (unknown.length) out.push('標成必填，但找不到這些欄位：' + unknown.join('、'));
  const known = n => BUILTIN[n] || defOf(n) || template.fields.includes(n) || snippets.some(x => x.name === n);
  for (const d of template.defs) {
    for (const m of (d.def + '\n' + d.opts).matchAll(/\{([^{}]+)\}/g)) {
      const n = m[1].split(/[=＝]/)[0].trim();
      if (!known(n)) out.push('「' + d.name + '」引用了不存在的 {' + n + '}');
    }
  }
  return [...new Set(out)];
}

// 匯出成功後記住這次填的值，下次可從 ▾ 直接挑；選項欄位只有固定選項，不用記
function rememberFields() {
  for (const name of allFields()) {
    if (optsOf(name).length) continue;
    const v = (docFields[name] || '').trim();
    if (!v) continue;
    fieldHistory[name] = [v, ...(fieldHistory[name] || []).filter(x => x !== v)].slice(0, HISTORY_MAX);
  }
  saveObj(FIELD_HISTORY_STORE, fieldHistory);
}

const halfDigits = s => s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\D/g, '');

// 只留數字（全形數字先轉半形），游標位置跟著往回挪，才不會每打一個字就跳到最後
function onlyDigits(el) {
  const v = halfDigits(el.value);
  if (v === el.value) return;
  const at = Math.max(0, (el.selectionStart ?? v.length) - (el.value.length - v.length));
  el.value = v;
  el.selectionStart = el.selectionEnd = at;
}

// 月日欄位：只收數字、最多 4 碼，第 3 碼起自動補斜線（1231 → 12/31）；游標依「前面有幾個數字」放回去
function dateDigits(el) {
  const before = Math.min(4, halfDigits(el.value.slice(0, el.selectionStart ?? el.value.length)).length);
  const d = halfDigits(el.value).slice(0, 4);
  const v = d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d;
  if (v === el.value) return;
  el.value = v;
  el.selectionStart = el.selectionEnd = before + (before > 2 ? 1 : 0);
}

// 必填檢查：月日要完整 4 碼、流水號要 8＋N 碼，其他欄位不是空白即可
function fieldFilled(name) {
  const v = String(docFields[name] || '').trim(), t = typeOf(name);
  if (t === '月日') return /^\d{2}\/\d{2}$/.test(v);
  if (t === '流水號') return new RegExp('^\\d{' + (8 + serialLen(name)) + '}$').test(v);
  return !!v;
}

function closeFieldMenu() {
  $('menu').classList.remove('show');
  menuFor = null;
}

function openFieldMenu(btn, name, el) {
  const m = $('menu');
  m.innerHTML = '';
  const sep = t => {
    const d = document.createElement('div');
    d.className = 'sep'; d.textContent = t;
    m.appendChild(d);
  };
  const item = (label, title, fn) => {
    const b = document.createElement('button');
    b.textContent = label; b.title = title;
    b.onmousedown = ev => ev.preventDefault();   // 不要讓輸入框失焦，插入位置才不會跑掉
    b.onclick = () => { fn(); closeFieldMenu(); };
    m.appendChild(b);
  };
  const fire = () => { el.dispatchEvent(new Event('input')); el.focus(); };
  const insert = t => {   // 插在游標位置
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
    el.value = el.value.slice(0, a) + t + el.value.slice(b);
    el.selectionStart = el.selectionEnd = a + t.length;
    fire();
  };
  const brief = v => v.replace(/\s+/g, ' ').slice(0, 24);
  const ref = (n, v) => item('{' + n + '}　' + brief(v), '插入 {' + n + '}，匯出時換成：' + v, () => insert('{' + n + '}'));
  if (snippets.length) {
    sep('常用字串');
    snippets.forEach(x => ref(x.name, expand(x.text)));
  }
  const hist = (fieldHistory[name] || []).slice(0, HISTORY_MENU_MAX);
  if (hist.length) {
    sep('以前填過（整欄取代）');
    hist.forEach(v => item(brief(v), v, () => { el.value = v; fire(); }));
  }
  sep('內建');
  Object.keys(BUILTIN).forEach(k => ref(k, BUILTIN[k]()));
  template.defs.filter(d => d.type === '對照').forEach(d => ref(d.name, expand('{' + d.name + '}')));   // 對照欄位（例 {公司}）也是自動算的
  const others = allFields().filter(n => n !== name);
  if (others.length) {
    sep('引用其他欄位');
    others.forEach(n => ref(n, expand(docFields[n] || '')));
  }
  sep('');
  item('編輯常用字串…', '', openSnipDialog);
  m.classList.add('show');
  const r = btn.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(r.left, window.innerWidth - m.offsetWidth - 4)) + 'px';
  m.style.top = Math.max(4, Math.min(r.bottom + 2, window.innerHeight - m.offsetHeight - 4)) + 'px';
  menuFor = name;
}

document.addEventListener('pointerdown', e => {
  if (menuFor && !e.target.closest('#menu, .fmenu')) closeFieldMenu();
}, true);

function openSnipDialog() {
  $('snipTable').tBodies[0].innerHTML = '';
  snippets.forEach(x => addRow('snip', x));
  showModal('dlgSnips', true);
}

$('bSnips').onclick = openSnipDialog;
$('sAdd').onclick = () => addRow('snip', { name:'', text:'' });
$('sReset').onclick = () => {
  if (!confirm('把常用字串還原成預設值？\n（你在這台瀏覽器加的會不見）')) return;
  try { localStorage.removeItem(SNIPPET_STORE); } catch (err) { /* 禁止存取時忽略 */ }
  snippets = DEFAULT_SNIPPETS.map(x => ({ ...x }));
  renderFields();
  openSnipDialog();
  toast('已還原成預設值');
};
$('sCancel').onclick = () => showModal('dlgSnips', false);
$('sOk').onclick = () => {
  const named = r => r.name && r.name !== '未命名';   // readRow 會把空名稱補成「未命名」，當成沒填
  snippets = [...$('snipTable').tBodies[0].rows].map(tr => readRow(tr, TABLES.snip.cols)).filter(r => named(r) && r.text);
  saveList(SNIPPET_STORE, snippets);
  showModal('dlgSnips', false);
  renderFields();
};

// 預設檔名：範本設定表的「檔名」列（例 {單號}{編號=?:-}{編號}），沒有就叫「文件」
function docName() {
  const d = defOf(FILE_NAME_DEF);
  return (d && d.def ? expand(d.def.replace(LIVE, '')).trim() : '') || '文件';
}

function renderFields() {
  const box = $('wFields');
  box.innerHTML = '';
  if (!template) return;
  const groups = {}, boxes = [], prevs = [];
  const markDirty = () => { if (cur >= 0) photos[cur].dirty = true; };
  const row = (label, cls) => {
    const l = document.createElement('div');
    l.className = cls || ('lbl' + (template.required.includes(label) ? ' req' : ''));
    l.textContent = label;
    box.appendChild(l);
  };

  // 欄位改過之後重算：連動的勾選框、公式欄位的展開預覽、檔名
  const refresh = () => {
    if (syncAutoBoxes()) boxes.forEach(b => { b.cb.checked = !!docFields[b.name]; });
    prevs.forEach(p => {
      const live = p.el.value.indexOf('{') >= 0;
      p.prev.style.display = live ? '' : 'none';
      if (live) p.prev.textContent = '→ ' + expand(p.el.value);
    });
    if (!$('wFileName').dataset.edited) $('wFileName').value = docName();
  };

  // 選項欄位排成一列選鈕（選項多半只有兩個，比下拉少點一次）
  let grp = 0;
  const optionField = (name, opts) => {
    row(name);
    const wrap = document.createElement('div');
    wrap.className = 'boxes';
    grp++;
    if (!opts.some(o => o.v === docFields[name])) docFields[name] = opts[0].v;
    opts.forEach(o => {
      const l = document.createElement('label'), rb = document.createElement('input');
      l.className = 'opt';
      rb.type = 'radio'; rb.name = 'cfopt' + grp;
      rb.checked = docFields[name] === o.v;
      rb.title = o.t === o.v ? '' : '實際填入：' + o.v;
      rb.onchange = () => { docFields[name] = o.v; markDirty(); refresh(); };
      l.append(rb, o.t);
      wrap.appendChild(l);
    });
    box.appendChild(wrap);
  };

  // 流水號＝日期 8 碼＋流水號 N 碼（設定表選項欄的碼數）。流水號可用 ▲▼ 或上下鍵加減 1，兩格都只收數字
  const serialField = name => {
    const len = serialLen(name);
    row(name);
    const cell = document.createElement('div'), line = document.createElement('div');
    cell.className = 'fcell'; line.className = 'row';
    const digits = (docFields[name] || '').replace(/\D/g, '');
    const head = document.createElement('input'), tail = document.createElement('input');
    head.type = tail.type = 'text';
    head.className = 'c-head'; head.maxLength = 8;
    tail.className = 'c-tail'; tail.maxLength = len;
    head.value = digits.slice(0, 8) || adDate();
    tail.value = (digits.slice(8) || '1').padStart(len, '0');
    head.title = '日期（西元 8 碼）';
    tail.title = '流水號（▲▼ 或鍵盤上下鍵加減 1）';
    const push = () => { docFields[name] = head.value + tail.value; markDirty(); refresh(); };
    head.oninput = () => { onlyDigits(head); push(); };
    tail.oninput = () => { onlyDigits(tail); push(); };
    const bump = d => {
      tail.value = String(Math.min(10 ** len - 1, Math.max(1, (+tail.value || 0) + d))).padStart(len, '0');
      push();
    };
    tail.onblur = () => bump(0);   // 離開時補滿碼數
    tail.onkeydown = e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      bump(e.key === 'ArrowUp' ? 1 : -1);
    };
    const spin = (label, d, title) => {
      const b = document.createElement('button');
      b.className = 'spin'; b.textContent = label; b.title = title;
      b.onclick = () => bump(d);
      return b;
    };
    line.append(head, tail, spin('▲', 1, '流水號 +1'), spin('▼', -1, '流水號 −1'));
    cell.appendChild(line);
    box.appendChild(cell);
    docFields[name] = head.value + tail.value;   // 把拆開的兩格合回去，不動 dirty
  };

  const textField = name => {
    const opts = optsOf(name), type = typeOf(name);
    if (opts.length) return optionField(name, opts);
    if (type === '流水號') return serialField(name);
    row(name);
    const cell = document.createElement('div'), line = document.createElement('div');
    cell.className = 'fcell'; line.className = 'row';
    const el = document.createElement(type === '多行' ? 'textarea' : 'input');
    if (el.tagName === 'TEXTAREA') el.rows = 3; else el.type = 'text';
    el.value = docFields[name] || '';
    const isDate = type === '月日';
    const changed = () => {
      if (isDate) dateDigits(el);
      else if (type === '數字') onlyDigits(el);
      docFields[name] = el.value;
      markDirty();
      refresh();
    };
    el.oninput = changed;
    el.onchange = changed;
    if (isDate) {   // 月日欄位沒有 ▾：選單插入的 {名稱} 會被數字過濾掉
      el.maxLength = 5;
      el.inputMode = 'numeric';
      el.placeholder = '月日 4 碼，例如 1231';
      el.onkeydown = e => {   // 游標在斜線後面按退格：連前一個數字一起刪，不然斜線刪了又自動補回來
        const p = el.selectionStart;
        if (e.key === 'Backspace' && p === el.selectionEnd && el.value[p - 1] === '/') el.selectionStart = el.selectionEnd = p - 1;
      };
      line.append(el);
    } else {
      const more = document.createElement('button');
      more.className = 'fmenu'; more.textContent = '▾';
      more.title = '常用字串、引用其他欄位、以前填過的值';
      more.onclick = () => menuFor === name ? closeFieldMenu() : openFieldMenu(more, name, el);
      line.append(el, more);
    }
    const prev = document.createElement('div');
    prev.className = 'fprev';
    cell.append(line, prev);
    box.appendChild(cell);
    prevs.push({ el, prev });
  };

  const mine = myFields();
  if (mine.length) {
    row('自訂欄位（不印出來，供 {名稱} 引用）', 'sect');
    mine.forEach(textField);
    row('範本欄位', 'sect');
  }
  for (const name of template.fields) {
    if (isImageField(name)) continue;
    if (name.startsWith('□') && autoBoxField(name)) continue;   // 跟設定表欄位連動的勾選框（例 公司）自動勾，不顯示也不給改
    if (name.startsWith('□')) {   // 勾選框依群組排在同一列
      const [g, opt] = name.slice(1).split(':');
      if (!groups[g]) {
        row(g);
        groups[g] = document.createElement('div');
        groups[g].className = 'boxes';
        box.appendChild(groups[g]);
      }
      const l = document.createElement('label'), cb = document.createElement('input');
      l.className = 'opt';
      cb.type = 'checkbox';
      cb.checked = !!docFields[name];
      cb.onchange = () => { docFields[name] = cb.checked; markDirty(); };
      l.append(cb, opt ?? g);
      groups[g].appendChild(l);
      boxes.push({ name, cb });
      continue;
    }
    textField(name);
  }
  refresh();
}

function renderWordDialog() {
  $('wTplName').textContent = template ? '目前範本：' + template.name : '尚未選擇範本（請選擇 .docx 範本檔）';
  document.querySelectorAll('[name=wWrap]').forEach(r => { r.checked = r.value === settings.siteWrap; });
  applyFieldDefaults();
  renderFields();
  delete $('wFileName').dataset.edited;
  $('wFileName').value = docName();
}

$('bWord').onclick = $('bWordStart').onclick = () => {
  renderWordDialog();
  showModal('dlgWord', true);
};
document.querySelectorAll('[name=wWrap]').forEach(r => r.onchange = () => { settings.siteWrap = r.value; saveUI(); });
$('wFileName').oninput = e => { e.target.dataset.edited = '1'; };
$('wCancel').onclick = () => showModal('dlgWord', false);
$('wOk').onclick = async () => {
  if (!template) return alert('請先選擇 Word 範本（.docx）。');
  const miss = template.required.filter(f => allFields().includes(f) && !fieldFilled(f));   // 必填由範本決定（{{名稱*}}、{{必填:…}}、設定表的必填欄）
  if (miss.length) return missingField(miss);
  const name = ($('wFileName').value.trim() || docName()) + '.docx';
  showModal('dlgWord', false);
  rememberFields();
  downloadBlob(await buildFromTemplate(), name);
  toast('已匯出 Word：' + name);
};

// 必填欄位沒填：講清楚是哪一個，並把游標移過去
function missingField(miss) {
  const hint = n => typeOf(n) === '月日' ? '（月日 4 碼，例如 1231）'
    : typeOf(n) === '流水號' ? '（日期 8 碼＋流水號 ' + serialLen(n) + ' 碼）' : '';
  alert('請先填寫' + miss.map(n => '「' + n + '」' + hint(n)).join('、') + '。');
  const lbl = [...document.querySelectorAll('#wFields .lbl')].find(l => l.textContent === miss[0]);
  const el = lbl && lbl.nextElementSibling.querySelector('input, textarea');
  if (el) el.focus();
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}
