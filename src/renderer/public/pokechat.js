/* PokeChat —— 组件选择反馈对话（零依赖，原生 JS）
 * 与 Vibe-Astock 项目版 100% 对齐的功能 + 玻璃风 UI
 *
 * 用法：<script src="pokechat.js"></script>
 *       PokeChat.init({ endpoint: "http://127.0.0.1:8123" });  // 可选：配后端后发送给 AI 并轮询回复
 *
 * 功能（对齐项目版）：
 *   1. 🎯 选择模式：悬停层级高亮（上级虚线 / 最内层实线）→ 点击 → 备注弹窗
 *   2. 备注弹窗：Enter 加入队列 / Shift+Enter 换行 / Ctrl+Enter 直接发送 /
 *      Home-End 行级 / Ctrl+Home-End 文档级 / IME 输入法保护
 *   3. 队列：常驻悬浮（localStorage 持久化），条目可编辑，批量发送
 *   4. 对话面板：IM（左 AI 回复/右用户消息 + 状态标签），左侧索引（直接/组件分组），
 *      底部直接发消息，自动滚动到最新，完整回复展示
 *   5. 任务状态：发送后 等待调度/处理中/已完成 三态
 */
(function (global) {
  'use strict';

  var DEFAULT_ENDPOINT = '';
  var QUEUE_KEY = 'pokechat-queue';
  var STATUS_KEY = 'pokechat-status';

  var cfg = { endpoint: DEFAULT_ENDPOINT };
  var queue = [];
  var picking = false;
  var picked = null;
  var note = '';
  var directMsg = '';
  var status = { pending: [], processing: [], done: [] };
  var qOpen = false; // 队列面板（大弹窗）
  var editing = null; // 正在编辑的队列条目
  var selectedEl = null;
  var sub = {};

  /* ================= 工具 ================= */
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function loadQueue() {
    try {
      queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') || [];
    } catch (e) {
      queue = [];
    }
  }
  function saveQueue() {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }
  function post(url, body, cb) {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json();
      })
      .then(cb)
      .catch(function () {});
  }

  /* ================= 玻璃风样式（100% 对齐项目 index.css token，2026-08-22） ================= */
  // 项目暗色主题：背景 hsl(222 47% 6%)、卡 hsl(222 40% 9%)、主色暖橙红 hsl(15 89% 56%)≈#F35D2B、
  // glass 渐变 + 发丝边框 + 内高光 + blur(14px) + 圆角 1rem
  var GLASS_CSS = [
    ':root { --pc-bg:hsl(222 47% 6%); --pc-card:hsl(222 40% 9%); --pc-card-2:rgba(255,255,255,.06);',
    '  --pc-border:rgba(255,232,214,.10); --pc-primary:hsl(15 89% 56%);',
    '  --pc-text:hsl(210 30% 92%); --pc-muted:hsl(215 18% 62%); --pc-muted-2:hsla(215,18%,62%,.5);',
    '  --pc-danger:hsl(0 74% 60%); --pc-warn:hsl(38 92% 55%); --pc-green:hsl(152 55% 46%);',
    '  --pc-hi:rgba(255,255,255,.06); --pc-radius:1rem; }',
    '[data-pokechat] { font-family: system-ui, sans-serif; color: var(--pc-text); }',
    '[data-pokechat] .pc-glass { background-image: linear-gradient(162deg, rgba(255,255,255,.055), rgba(255,255,255,.012));',
    '  border:1px solid var(--pc-border); border-radius:var(--pc-radius);',
    '  box-shadow: 0 12px 30px rgba(0,0,0,.35), inset 0 1px 0 var(--pc-hi);',
    '  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }',
    '[data-pokechat] .pc-btn { background: var(--pc-card-2); color: var(--pc-text); border:1px solid var(--pc-border);',
    '  border-radius:9px; padding:6px 12px; cursor:pointer; font-size:13px; transition: all .15s; }',
    '[data-pokechat] .pc-btn:hover { background: rgba(255,255,255,.10); }',
    '[data-pokechat] .pc-btn-primary { background: var(--pc-primary); color:hsl(222 47% 6%); font-weight:600; border-color:transparent; }',
    '[data-pokechat] .pc-btn-primary:hover { opacity:.9; }',
    '[data-pokechat] .pc-input, [data-pokechat] .pc-textarea { background: rgba(255,255,255,.04); color: var(--pc-text);',
    '  border:1px solid var(--pc-border); border-radius:9px; padding:8px 10px; font-size:13px; width:100%;',
    '  box-sizing:border-box; outline:none; }',
    '[data-pokechat] .pc-input:focus, [data-pokechat] .pc-textarea:focus { border-color: var(--pc-primary); }',
    '[data-pokechat] .pc-modal { position:fixed; inset:0; z-index:2147483000; background:rgba(0,0,0,.55);',
    '  display:flex; align-items:center; justify-content:center; padding:20px; }',
    '[data-pokechat] .hidden { display:none !important; }',
    '[data-pokechat] .pc-badge { border-radius:6px; padding:1px 6px; font-size:10px; font-weight:700; }',
    '[data-pokechat] .pc-badge-done { background:rgba(52,211,153,.15); color:var(--pc-green); }',
    '[data-pokechat] .pc-badge-proc { background:rgba(251,191,36,.15); color:var(--pc-warn); }',
    '[data-pokechat] .pc-badge-wait { background:rgba(148,163,184,.15); color:var(--pc-muted); }',
    '.pokechat-picking, .pokechat-picking * { cursor: crosshair !important; }',
    '.pokechat-picking *:hover { outline:1px dashed hsl(15 89% 56% / .55) !important; outline-offset:1px; }',
    '.pokechat-picking *:hover:not(:has(*:hover)) { outline:2px solid var(--pc-primary) !important; outline-offset:1px; }',
  ].join('\n');

  /* ================= 选择模式（层级高亮） ================= */
  function pickInfo(node) {
    var cls = Array.prototype.slice
      .call(node.classList || [])
      .slice(0, 3)
      .join('.');
    var txt = (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    return {
      tag: node.tagName.toLowerCase(),
      selector:
        node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') + (cls ? '.' + cls : ''),
      text: txt,
    };
  }
  function clearOutline() {
    if (selectedEl) {
      selectedEl.style.outline = '';
      selectedEl = null;
    }
  }
  function startPicking() {
    if (picking) return;
    picking = true;
    document.body.classList.add('pokechat-picking');
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('contextmenu', onCtx, true);
    document.addEventListener('keydown', onPickKey, true);
  }
  function stopPicking() {
    if (!picking) return;
    picking = false;
    document.body.classList.remove('pokechat-picking');
    document.removeEventListener('mouseover', onOver, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('contextmenu', onCtx, true);
    document.removeEventListener('keydown', onPickKey, true);
    clearOutline();
    renderFloating();
  }
  function onOver(e) {
    var t = e.target;
    if (!t || t.closest('[data-pokechat]')) return;
    clearOutline();
    selectedEl = t;
    t.style.outline = '2px solid #22c55e';
    t.style.outlineOffset = '1px';
  }
  function onClick(e) {
    var t = e.target;
    if (!t || t.closest('[data-pokechat]')) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    var info = pickInfo(t);
    stopPicking();
    selectedEl = t;
    t.style.outline = '2px solid #22c55e';
    openNoteDialog(info);
  }
  function onCtx(e) {
    e.preventDefault();
    stopPicking();
  }
  function onPickKey(e) {
    if (e.key === 'Escape') stopPicking();
    else if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      picking ? stopPicking() : startPicking();
    }
  }

  /* ================= 备注弹窗（对齐项目版） ================= */
  function openNoteDialog(info) {
    picked = info;
    note = '';
    var m = $("[data-pokechat='note']");
    $('[data-pc-path]', m).textContent = location.pathname + location.search;
    $('[data-pc-sel]', m).textContent = info.selector;
    $('[data-pc-txt]', m).textContent = info.text || '（无文本）';
    var ta = $('[data-pc-note]', m);
    ta.value = '';
    m.classList.remove('hidden');
    ta.focus();
  }
  function closeNoteDialog() {
    $("[data-pokechat='note']").classList.add('hidden');
    picked = null;
    clearOutline();
  }
  function addToQueue() {
    if (!picked || !note.trim()) return;
    queue.push({
      path: location.pathname + location.search,
      selector: picked.selector,
      text: picked.text,
      note: note,
      ts: Date.now(),
    });
    saveQueue();
    renderFloating();
    closeNoteDialog();
    toast('已加入反馈队列（共 ' + queue.length + ' 条），Ctrl+F 可再次选择');
  }
  function sendDirectFromDialog() {
    if (!picked || !note.trim()) return;
    sendFeedback([
      {
        path: location.pathname + location.search,
        selector: picked.selector,
        text: picked.text,
        note: note,
      },
    ]);
    closeNoteDialog();
  }
  function sendFeedback(items) {
    if (cfg.endpoint) {
      post(cfg.endpoint + '/api/feedback', { items: items }, function () {
        refreshStatus();
        toast('已发送给 AI，等待处理');
      });
    } else {
      items.forEach(function (it) {
        queue.push({
          path: it.path,
          selector: it.selector,
          text: it.text,
          note: it.note,
          ts: Date.now(),
          local: true,
        });
      });
      saveQueue();
      renderFloating();
      toast('本地模式：已记录在 localStorage');
    }
  }

  /* ================= 队列编辑 ================= */
  function openEdit(it) {
    editing = it;
    note = it.note;
    var m = $("[data-pokechat='edit']");
    $('[data-pc-path]', m).textContent = it.path;
    $('[data-pc-sel]', m).textContent = it.selector;
    $('[data-pc-txt]', m).textContent = it.text || '';
    $('[data-pc-note]', m).value = it.note;
    m.classList.remove('hidden');
  }
  function closeEdit() {
    $("[data-pokechat='edit']").classList.add('hidden');
    editing = null;
  }
  function saveEdit() {
    if (!editing) return;
    queue = queue.map(function (x) {
      return x.ts === editing.ts ? Object.assign({}, x, { note: note }) : x;
    });
    saveQueue();
    renderFloating();
    closeEdit();
  }
  function removeQueueItem(ts) {
    queue = queue.filter(function (x) {
      return x.ts !== ts;
    });
    saveQueue();
    renderFloating();
  }
  function clearQueue() {
    queue = [];
    saveQueue();
    renderFloating();
  }
  function sendQueue() {
    if (!queue.length) return;
    var items = queue.map(function (q) {
      return { path: q.path, selector: q.selector, text: q.text, note: q.note };
    });
    if (cfg.endpoint) {
      post(cfg.endpoint + '/api/feedback', { items: items }, function () {
        queue = [];
        saveQueue();
        renderFloating();
        qOpen = false;
        refreshStatus();
        toast('已发送 ' + items.length + ' 条反馈，等待 AI 处理');
      });
    } else {
      toast('本地模式：未配置 endpoint，队列保留在 localStorage');
      qOpen = false;
      renderQueueDialog();
    }
  }

  /* ================= 状态轮询 ================= */
  function refreshStatus() {
    if (!cfg.endpoint) return;
    fetch(cfg.endpoint + '/api/feedback/status')
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        status = d;
        renderQueueDialog();
      })
      .catch(function () {});
  }

  /* ================= UI：悬浮区（任务上 / 队列+🎯 下，对齐项目版） ================= */
  function buildUI() {
    var css = document.createElement('style');
    css.textContent = GLASS_CSS;
    document.head.appendChild(css);

    var wrap = el('div', null);
    wrap.setAttribute('data-pokechat', '');
    wrap.style.cssText =
      'position:fixed;bottom:80px;left:16px;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-start;gap:8px;';

    // 任务按钮（上）——轮询时显示
    var taskBtn = el('button', 'pc-btn pc-glass hidden', '任务（0）');
    taskBtn.style.cssText = 'color:#0b1220;font-weight:700;';
    wrap.appendChild(taskBtn);

    // 队列 + 🎯（下）
    var row = el('div', null);
    row.style.cssText = 'display:flex;align-items:center;gap:8px;';
    var queueBtn = el('button', 'pc-btn pc-btn-primary pc-glass', '反馈队列');
    queueBtn.style.cssText =
      'background:var(--pc-primary);color:#fff;border-radius:999px;padding:8px 14px;font-weight:700;';
    queueBtn.onclick = function () {
      qOpen = !qOpen;
      renderQueueDialog();
    };
    var pickBtn = el('button', 'pc-btn pc-glass', '🎯');
    pickBtn.style.cssText =
      'width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:12px;font-size:16px;';
    pickBtn.title = '选择组件（Ctrl+F）';
    pickBtn.onclick = function () {
      picking ? stopPicking() : startPicking();
    };
    row.appendChild(queueBtn);
    row.appendChild(pickBtn);
    wrap.appendChild(row);
    document.body.appendChild(wrap);

    // 任务提示条（右下角，任务进行中提示）
    var taskBar = el('div', 'pc-glass hidden');
    taskBar.setAttribute('data-pokechat', 'taskbar');
    taskBar.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:99989;padding:8px 14px;font-size:12px;color:#fbbf24;display:flex;align-items:center;gap:8px;';
    taskBar.innerHTML =
      '<span class="pc-spin" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(251,191,36,.3);border-top-color:#fbbf24;border-radius:50%;animation:pc-spin 1s linear infinite;"></span><span data-pc-task-text>任务处理中…</span>';
    document.body.appendChild(taskBar);
    if (!document.getElementById('pc-spin-kf')) {
      var kf = document.createElement('style');
      kf.id = 'pc-spin-kf';
      kf.textContent = '@keyframes pc-spin { to { transform: rotate(360deg); } }';
      document.head.appendChild(kf);
    }

    // 备注弹窗
    buildNoteDialog();
    // 编辑弹窗
    buildEditDialog();
    // 队列对话大弹窗
    buildQueueDialog();
  }

  function buildNoteDialog() {
    var m = el('div', 'pc-modal hidden');
    m.setAttribute('data-pokechat', 'note');
    m.onclick = function (e) {
      if (e.target === m) closeNoteDialog();
    };
    m.innerHTML =
      '<div class="pc-glass" style="width:640px;max-width:94vw;padding:18px;">' +
      '  <div style="font-weight:700;font-size:15px;margin-bottom:10px;">组件反馈</div>' +
      '  <div style="font-size:11px;color:var(--pc-muted);background:rgba(30,41,59,.5);border-radius:9px;padding:8px 10px;margin-bottom:10px;">' +
      '    页面：<b style="color:var(--pc-text)" data-pc-path></b><br>组件：<b style="color:var(--pc-text)" data-pc-sel></b><br>内容：<span data-pc-txt></span>' +
      '  </div>' +
      '  <textarea class="pc-textarea" data-pc-note rows="5" placeholder="备注：想怎么改？Enter 加入队列 · Shift+Enter 换行 · Ctrl+Enter 直接发送"></textarea>' +
      '  <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px;">' +
      '    <button class="pc-btn" data-pc-cancel>取消</button>' +
      '    <button class="pc-btn" data-pc-sendd style="border-color:var(--pc-primary);color:var(--pc-primary);" title="Ctrl+Enter">直接发送（Ctrl+Enter）</button>' +
      '    <button class="pc-btn pc-btn-primary" data-pc-add title="Enter">加入队列（Enter）</button>' +
      '  </div>' +
      '</div>';
    $('[data-pc-cancel]', m).onclick = closeNoteDialog;
    $('[data-pc-add]', m).onclick = addToQueue;
    $('[data-pc-sendd]', m).onclick = sendDirectFromDialog;
    var ta = $('[data-pc-note]', m);
    ta.addEventListener('keydown', function (e) {
      if (e.nativeEvent && e.nativeEvent.isComposing) return;
      if (e.keyCode === 229) return;
      var elNode = ta;
      if (e.key === 'Home') {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) elNode.selectionStart = elNode.selectionEnd = 0;
        else {
          var ls = elNode.value.lastIndexOf('\n', elNode.selectionStart - 1) + 1;
          elNode.selectionStart = elNode.selectionEnd = ls;
        }
      } else if (e.key === 'End') {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey)
          elNode.selectionStart = elNode.selectionEnd = elNode.value.length;
        else {
          var nl = elNode.value.indexOf('\n', elNode.selectionStart);
          elNode.selectionStart = elNode.selectionEnd = nl === -1 ? elNode.value.length : nl;
        }
      } else if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        sendDirectFromDialog();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        addToQueue();
      }
    });
    ta.addEventListener('input', function (e) {
      note = e.target.value;
    });
    document.body.appendChild(m);
  }

  function buildEditDialog() {
    var m = el('div', 'pc-modal hidden');
    m.setAttribute('data-pokechat', 'edit');
    m.onclick = function (e) {
      if (e.target === m) closeEdit();
    };
    m.innerHTML =
      '<div class="pc-glass" style="width:640px;max-width:94vw;padding:18px;">' +
      '  <div style="font-weight:700;font-size:15px;margin-bottom:10px;">编辑队列条目</div>' +
      '  <div style="font-size:11px;color:var(--pc-muted);background:rgba(30,41,59,.5);border-radius:9px;padding:8px 10px;margin-bottom:10px;">' +
      '    页面：<b style="color:var(--pc-text)" data-pc-path></b><br>组件：<b style="color:var(--pc-text)" data-pc-sel></b><br>内容：<span data-pc-txt></span>' +
      '  </div>' +
      '  <textarea class="pc-textarea" data-pc-note rows="5" placeholder="备注：想怎么改？Enter 保存 · Shift+Enter 换行"></textarea>' +
      '  <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px;">' +
      '    <button class="pc-btn" data-pc-cancel>取消</button>' +
      '    <button class="pc-btn pc-btn-primary" data-pc-save title="Enter">保存（Enter）</button>' +
      '  </div>' +
      '</div>';
    $('[data-pc-cancel]', m).onclick = closeEdit;
    $('[data-pc-save]', m).onclick = saveEdit;
    $('[data-pc-note]', m).addEventListener('keydown', function (e) {
      if (e.nativeEvent && e.nativeEvent.isComposing) return;
      if (e.keyCode === 229) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        saveEdit();
      }
    });
    $('[data-pc-note]', m).addEventListener('input', function (e) {
      note = e.target.value;
    });
    document.body.appendChild(m);
  }

  function buildQueueDialog() {
    var d = el('div', 'pc-modal hidden');
    d.setAttribute('data-pokechat', 'queue');
    d.onclick = function (e) {
      if (e.target === d) {
        qOpen = false;
        d.classList.add('hidden');
      }
    };
    d.innerHTML =
      '<div class="pc-glass" style="width:960px;max-width:96vw;height:72vh;display:flex;flex-direction:column;overflow:hidden;">' +
      '  <div style="padding:10px 14px;border-bottom:1px solid var(--pc-border);display:flex;justify-content:space-between;align-items:center;">' +
      '    <b>反馈对话</b>' +
      '    <div style="font-size:12px;color:var(--pc-muted);display:flex;gap:14px;align-items:center;">' +
      '      <span>等待 <b data-pc-n-pending style="color:var(--pc-warn)">0</b></span>' +
      '      <span>处理中 <b data-pc-n-processing style="color:var(--pc-amber)">0</b></span>' +
      '      <span>已完成 <b data-pc-n-done style="color:var(--pc-green)">0</b></span>' +
      '      <button class="pc-btn" data-pc-dlg-close style="padding:2px 8px;">✕</button>' +
      '    </div>' +
      '  </div>' +
      '  <div style="display:flex;flex:1;min-height:0;">' +
      '    <div data-pc-index style="width:180px;border-right:1px solid var(--pc-border);overflow-y:auto;padding:10px;"></div>' +
      '    <div style="flex:1;display:flex;flex-direction:column;min-width:0;">' +
      '      <div data-pc-body style="flex:1;overflow-y:auto;padding:12px 14px;"></div>' +
      '      <div style="padding:10px 14px;border-top:1px solid var(--pc-border);display:flex;gap:8px;">' +
      '        <input class="pc-input" data-pc-dmsg placeholder="直接发消息给 AI（Enter 发送）">' +
      '        <button class="pc-btn pc-btn-primary" data-pc-send>发送</button>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '</div>';
    $('[data-pc-dlg-close]', d).onclick = function () {
      qOpen = false;
      d.classList.add('hidden');
    };
    $('[data-pc-send]', d).onclick = function () {
      sendDirectMsg();
    };
    $('[data-pc-dmsg]', d).addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendDirectMsg();
      }
    });
    $('[data-pc-dmsg]', d).addEventListener('input', function (e) {
      directMsg = e.target.value;
    });
    document.body.appendChild(d);
  }

  function sendDirectMsg() {
    var m = directMsg.trim();
    if (!m) return;
    sendFeedback([{ path: location.pathname + location.search, selector: '', text: '', note: m }]);
    directMsg = '';
    $('[data-pc-dmsg]').value = '';
  }

  function renderFloating() {
    var qb = document.querySelector('[data-pokechat] .pc-btn-primary');
    if (qb) qb.textContent = queue.length ? '反馈队列（' + queue.length + '）' : '反馈队列';
  }

  function renderQueueDialog() {
    var d = document.querySelector("[data-pokechat='queue']");
    if (!d) return;
    if (!qOpen) {
      d.classList.add('hidden');
      return;
    }
    d.classList.remove('hidden');
    var p = status.pending.length,
      pr = status.processing.length,
      dn = status.done.length;
    $('[data-pc-n-pending]', d).textContent = p;
    $('[data-pc-n-processing]', d).textContent = pr;
    $('[data-pc-n-done]', d).textContent = dn;

    // 索引（直接对话 / 组件对话，新在上）
    var idx = $('[data-pc-index]', d);
    idx.innerHTML = '';
    var convo = status.done.concat(status.processing, status.pending).sort(function (a, b) {
      return String(b.ts).localeCompare(String(a.ts));
    });
    var direct = convo.filter(function (x) {
      return !x.selector;
    });
    var comp = convo.filter(function (x) {
      return !!x.selector;
    });
    function renderIdx(title, list) {
      idx.appendChild(
        el(
          'div',
          null,
          "<div style='font-size:10px;font-weight:700;color:var(--pc-muted);margin:8px 0 4px;text-transform:uppercase;'>" +
            title +
            '</div>'
        )
      );
      if (!list.length)
        idx.appendChild(
          el('p', null, "<span style='font-size:11px;color:rgba(148,163,184,.4)'>无</span>")
        );
      list.forEach(function (it) {
        var b = el('button', 'pc-btn', null);
        b.style.cssText =
          'display:block;width:100%;text-align:left;font-size:11px;padding:5px 8px;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        var st = it.conclusion
          ? 'done'
          : status.processing.indexOf(it) >= 0
            ? 'processing'
            : 'pending';
        b.innerHTML =
          "<span style='display:inline-block;width:6px;height:6px;border-radius:50%;background:" +
          (st === 'done'
            ? 'var(--pc-green)'
            : st === 'processing'
              ? 'var(--pc-amber)'
              : 'var(--pc-muted)') +
          ";margin-right:5px;'></span>" +
          esc(it.note || it.text || it.selector || it.path);
        b.onclick = function () {
          var bd = $('[data-pc-body]', d);
          var t = bd.querySelector('[data-msg="' + it.ts + '"]');
          if (t) t.scrollIntoView({ behavior: 'smooth', block: 'center' });
        };
        idx.appendChild(b);
      });
    }
    renderIdx('直接对话', direct);
    renderIdx('组件对话', comp);

    // 对话体（用户右 / AI 左，自动滚底）
    var body = $('[data-pc-body]', d);
    body.innerHTML = '';
    var convo2 = status.done.concat(status.processing, status.pending).sort(function (a, b) {
      return String(a.ts).localeCompare(String(b.ts));
    });
    if (!convo2.length && !queue.length) {
      body.innerHTML =
        "<p style='text-align:center;color:var(--pc-muted);padding:50px 0;font-size:13px'>暂无记录，点 🎯 选个组件试试</p>";
    }
    if (queue.length) {
      body.appendChild(
        el(
          'div',
          null,
          "<div style='font-size:11px;font-weight:700;color:var(--pc-muted);margin-bottom:6px;'>待发送（" +
            queue.length +
            '）' +
            " <button class='pc-btn' data-pc-clear style='float:right;font-size:10px;padding:1px 8px;'>清空</button>" +
            " <button class='pc-btn pc-btn-primary' data-pc-sendq style='float:right;margin-right:6px;font-size:10px;padding:1px 8px;'>发送" +
            (cfg.endpoint ? '给 AI' : '（本地）') +
            '</button></div>'
        )
      );
      queue.forEach(function (q) {
        var it = el('div', null);
        it.style.cssText =
          'background:rgba(30,41,59,.5);border-radius:9px;padding:6px 10px;margin-bottom:5px;font-size:12px;cursor:pointer;';
        it.innerHTML =
          "<div style='color:var(--pc-text);'>" +
          esc(q.note) +
          '</div>' +
          "<div style='color:var(--pc-muted);font-size:10px;'>" +
          esc(q.selector || q.path) +
          '</div>';
        it.onclick = function () {
          openEdit(q);
        };
        body.appendChild(it);
      });
      $('[data-pc-clear]', body).onclick = clearQueue;
      $('[data-pc-sendq]', body).onclick = sendQueue;
    }
    convo2.forEach(function (it) {
      var st = it.conclusion
        ? 'done'
        : status.processing.indexOf(it) >= 0
          ? 'processing'
          : 'pending';
      var wrap = el('div', null);
      wrap.setAttribute('data-msg', it.ts);
      wrap.style.marginBottom = '10px';
      var stLabel = st === 'done' ? '已完成' : st === 'processing' ? '处理中' : '等待';
      var stCls =
        st === 'done' ? 'pc-badge-done' : st === 'processing' ? 'pc-badge-proc' : 'pc-badge-wait';
      // 用户（右，玻璃白）
      wrap.innerHTML =
        "<div style='display:flex;justify-content:flex-end;'>" +
        "  <div style='max-width:72%;background:rgba(255,255,255,.06);border:1px solid var(--pc-border);border-radius:var(--pc-radius) var(--pc-radius) 2px var(--pc-radius);padding:8px 11px;font-size:12px;'>" +
        "    <div style='font-weight:600;'>" +
        esc(it.text || it.selector) +
        '</div>' +
        "    <div style='margin-top:2px;color:var(--pc-text);'>" +
        esc(it.note) +
        '</div>' +
        "    <span class='pc-badge " +
        stCls +
        "' style='margin-top:5px;display:inline-block;'>" +
        stLabel +
        '</span>' +
        '  </div>' +
        '</div>' +
        // AI（左，主色淡橙）
        "<div style='display:flex;justify-content:flex-start;margin-top:5px;'>" +
        "  <div style='max-width:72%;background:hsl(15 89% 56% / .12);border:1px solid hsl(15 89% 56% / .25);border-radius:var(--pc-radius) var(--pc-radius) var(--pc-radius) 2px;padding:8px 11px;font-size:12px;color:var(--pc-text);white-space:pre-wrap;word-break:break-word;'>" +
        "    <b style='font-size:10px;color:var(--pc-primary);'>AI</b> " +
        (st === 'done'
          ? esc(it.conclusion || '已处理完成')
          : st === 'processing'
            ? '处理中…'
            : '等待调度，1 分钟内开始处理') +
        '  </div>' +
        '</div>';
      body.appendChild(wrap);
    });
    body.scrollTop = body.scrollHeight;
  }

  function toast(msg) {
    var t = el('div', 'pc-glass', null);
    t.setAttribute('data-pokechat', '');
    t.style.cssText =
      'position:fixed;bottom:140px;left:50%;transform:translateX(-50%);z-index:2147483000;padding:8px 16px;font-size:13px;background:rgba(17,28,46,.92);';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () {
      t.remove();
    }, 2500);
  }

  /* ================= 任务提示（轮询后端时显示） ================= */
  var taskTimer = null;
  function startTaskPolling() {
    if (!cfg.endpoint || taskTimer) return;
    taskTimer = setInterval(function () {
      fetch(cfg.endpoint + '/api/feedback/status')
        .then(function (r) {
          return r.json();
        })
        .then(function (d) {
          var running = d.pending.length + d.processing.length;
          var bar = document.querySelector("[data-pokechat='taskbar']");
          if (bar) {
            if (running > 0) {
              bar.classList.remove('hidden');
              $('[data-pc-task-text]', bar).textContent =
                '任务处理中（等待 ' + d.pending.length + ' · 处理中 ' + d.processing.length + '）';
            } else bar.classList.add('hidden');
          }
          if (JSON.stringify(d) !== JSON.stringify(status)) {
            status = d;
            renderQueueDialog();
          }
        })
        .catch(function () {});
    }, 5000);
  }

  /* ================= 初始化（兼容第三方项目：DOM 未就绪时等待，2026-08-22） ================= */
  function doInit(config) {
    cfg = Object.assign({ endpoint: DEFAULT_ENDPOINT }, config || {});
    loadQueue();
    buildUI();
    renderFloating();
    refreshStatus();
    startTaskPolling();
    setInterval(function () {
      refreshStatus();
    }, 10000);
  }
  global.PokeChat = {
    init: function (config) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
          doInit(config);
        });
      } else {
        doInit(config);
      }
    },
    open: function () {
      qOpen = true;
      renderQueueDialog();
    },
  };
})(window);
