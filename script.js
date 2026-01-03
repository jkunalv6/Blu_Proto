// DOM references
const toggle = document.getElementById("toggle");
const sidebar = document.getElementById("sidebar");
const blockPool = document.getElementById("blockPool");
const canvas = document.getElementById("canvas");
const sidebarHeader = document.getElementById("sidebarHeader");
// Accessibility: make toggle focusable and expose expanded state
if (toggle) {
  toggle.setAttribute('role', 'button');
  toggle.setAttribute('tabindex', '0');
  toggle.setAttribute('aria-expanded', String(sidebar && sidebar.classList.contains('open')));
}
function uid() {
  return "id-" + Math.random().toString(36).substr(2, 9);
}

const InterlinkRepo = {
  components: new Map(),
  interlinks: new Map()
};

// Global manufacturing processes list
const MANUFACTURING_PROCESSES = [];
// Global design software list
const DESIGN_SOFTWARES = [];

const BLOCK_TYPES = [
  { id: "system", label: "System Requirement" },
  { id: "component", label: "Component Requirement" },
  { id: "manufacturing", label: "Manufacturing" }
];

// SVG for connections
let connectionsSVG = document.getElementById("connections");
if (!connectionsSVG) {
  connectionsSVG = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  connectionsSVG.id = "connections";
  connectionsSVG.style.position = "absolute";
  connectionsSVG.style.top = "0";
  connectionsSVG.style.left = "0";
  connectionsSVG.style.width = "100%";
  connectionsSVG.style.height = "100%";
  connectionsSVG.style.pointerEvents = "auto";
  canvas.appendChild(connectionsSVG);
}

// ensure defs + glow filter exist for gradient strokes
let svgDefs = connectionsSVG.querySelector('defs');
if (!svgDefs) {
  svgDefs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

  const glow = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  glow.setAttribute('id', 'glow');
  const blur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
  blur.setAttribute('stdDeviation', '6');
  blur.setAttribute('result', 'blur');
  const merge = document.createElementNS('http://www.w3.org/2000/svg', 'feMerge');
  const m1 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
  m1.setAttribute('in', 'blur');
  const m2 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
  m2.setAttribute('in', 'SourceGraphic');
  merge.appendChild(m1);
  merge.appendChild(m2);
  glow.appendChild(blur);
  glow.appendChild(merge);

  svgDefs.appendChild(glow);
  connectionsSVG.appendChild(svgDefs);
}

// State
let draggedBlockPayload = null; // { name, type }
let selectedBlock = null;
let connectionSource = null;
let selectedConnection = null;
let connections = [];
// canvas transform scale (for zoom)
let canvasScale = 1;
// Undo/Redo history
let history = [];
let historyIndex = -1;
let isRestoring = false;
const HISTORY_LIMIT = 200;

function getState() {
  const blocks = Array.from(document.querySelectorAll('.canvas-block')).map(b => ({
    uid: b.dataset.uid,
    name: b.dataset.name || b.querySelector('input')?.value || '',
    type: b.dataset.type || 'system',
    left: b.style.left || '0px',
    top: b.style.top || '0px',
    links: b.dataset.links || '[]',
    interlinks: b.dataset.interlinks || '[]',
    sharedParams: b.dataset.sharedParams || '{}'
  }));

  const conns = connections.map(c => ({ a: c.a.dataset.uid, b: c.b.dataset.uid }));

  return { blocks, conns };
}

function restoreState(state) {
  if (!state) return;
  isRestoring = true;

  // clear current
  connections.forEach(c => c.line.remove());
  connections = [];
  InterlinkRepo.interlinks.clear();
  InterlinkRepo.components.clear();

  // remove canvas blocks
  document.querySelectorAll('.canvas-block').forEach(n => n.remove());

  // recreate blocks
  state.blocks.forEach(b => {
    const block = document.createElement('div');
    block.className = 'block canvas-block';

    const handle = document.createElement('div');
    handle.className = 'handle';
    handle.textContent = '≡ Drag';

    const input = document.createElement('input');
    input.value = b.name || '';

    block.appendChild(handle);
    block.appendChild(input);
    document.getElementById('canvas').appendChild(block);

    block.style.position = 'absolute';
    block.style.left = b.left;
    block.style.top = b.top;

    block.dataset.uid = b.uid;
    block.dataset.name = b.name || '';
    block.dataset.type = b.type || 'system';
    block.dataset.links = b.links || '[]';
    block.dataset.interlinks = b.interlinks || '[]';
    block.dataset.sharedParams = b.sharedParams || '{}';
    block.classList.add(`type-${block.dataset.type}`);

    InterlinkRepo.components.set(block.dataset.uid, block);
    makeBlockMovable(block);
    attachRipple(block);
  });

  // recreate connections
  state.conns.forEach(conn => {
    const a = document.querySelector(`[data-uid="${conn.a}"]`);
    const b = document.querySelector(`[data-uid="${conn.b}"]`);
    if (a && b) drawConnection(a, b);
  });

  refreshConnections();
  isRestoring = false;
}

function pushHistory() {
  if (isRestoring) return;
  const snap = getState();
  historyIndex++;
  history.splice(historyIndex, history.length - historyIndex, snap);
  if (history.length > HISTORY_LIMIT) {
    history.shift();
    historyIndex = history.length - 1;
  }
}

function undo() {
  if (historyIndex <= 0) return;
  historyIndex--;
  restoreState(history[historyIndex]);
}

function redo() {
  if (historyIndex >= history.length - 1) return;
  historyIndex++;
  restoreState(history[historyIndex]);
}

// Ripple helper: creates a JS-driven ripple on pointerdown
function attachRipple(el) {
  if (!el) return;
  el.addEventListener('pointerdown', (e) => {
    // ignore right-click
    if (e.button && e.button !== 0) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const r = document.createElement('span');
    r.className = 'ripple';
    const size = Math.max(rect.width, rect.height) * 1.2;
    r.style.width = r.style.height = size + 'px';
    r.style.left = (x - size/2) + 'px';
    r.style.top = (y - size/2) + 'px';
    // color from type
    const rgb = getComputedStyle(el).getPropertyValue('--type-color-rgb') || '30,90,138';
    r.style.background = `rgba(${rgb.trim()}, 0.18)`;
    r.style.animation = 'ripple-anim 740ms cubic-bezier(.2,.7,.2,1)';
    el.appendChild(r);
    setTimeout(() => { try { r.remove(); } catch (err) {} }, 600);
  });
}

// Sidebar toggle with sync + keyboard support
function syncToggleState(open) {
  if (!sidebar || !toggle) return;
  sidebar.classList.toggle('open', open);
  toggle.classList.toggle('open', open);
  const main = document.querySelector('.main');
  if (main) main.classList.toggle('shifted', open);
  toggle.setAttribute('aria-expanded', String(open));
  if (!open) restoreSidebarBlocks();
}

toggle.addEventListener('click', () => {
  const opening = !sidebar.classList.contains('open');
  syncToggleState(opening);
});

toggle.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    toggle.click();
  } else if (e.key === 'Escape') {
    syncToggleState(false);
  }
});

// Undo/Redo keyboard support (Ctrl/Cmd+Z, Ctrl+Y or Cmd+Shift+Z)
document.addEventListener('keydown', (e) => {
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  const cmd = isMac ? e.metaKey : e.ctrlKey;

  if (cmd && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    undo();
    return;
  }

  // Redo: Ctrl+Y or Cmd+Shift+Z
  if ((cmd && e.key === 'y') || (isMac && e.metaKey && e.shiftKey && (e.key === 'Z'))) {
    e.preventDefault();
    redo();
    return;
  }
});

// Sidebar blocks: one of each type
const SIDEBAR_BLOCKS = [
  { name: "System Requirement", type: "system" },
  { name: "Component Requirement", type: "component" },
  { name: "Manufacturing Requirement", type: "manufacturing" }
];

function createSidebarBlock(item) {
  const name = typeof item === 'string' ? item : (item.name || 'Block');
  const type = typeof item === 'string' ? 'system' : (item.type || 'system');

  const block = document.createElement("div");
  block.className = "block";
  block.draggable = true;

  const handle = document.createElement("div");
  handle.className = "handle";
  handle.textContent = "≡ Drag";

  const input = document.createElement("input");
  input.value = name;

  block.dataset.name = name;
  block.dataset.type = type;
  block.classList.add(`type-${type}`);

  input.addEventListener("input", () => {
    block.dataset.name = input.value;
  });

  block.appendChild(handle);
  block.appendChild(input);
  blockPool.appendChild(block);

  // attach ripple feedback
  attachRipple(block);

  block.addEventListener("dragstart", (e) => {
    const payload = { name: block.dataset.name, type: block.dataset.type || 'system' };
    draggedBlockPayload = payload;
    try { e.dataTransfer.setData('application/json', JSON.stringify(payload)); } catch (err) { /* fall back */ }
    e.dataTransfer.setData('text/plain', payload.name);
  });
}

function restoreSidebarBlocks() {
  sidebarHeader.textContent = "Select a block";
  blockPool.innerHTML = "";
  SIDEBAR_BLOCKS.forEach(createSidebarBlock);
}

restoreSidebarBlocks();
// capture initial state for undo
pushHistory();

// Make blocks movable
function makeBlockMovable(block) {
  const handle = block.querySelector(".handle");
  // pointer-based dragging with long-press-to-connect for touch
  let dragging = false;
  let offsetX = 0, offsetY = 0;
  let pointerId = null;
  let startX = 0, startY = 0;
  let longPressTimer = null;
  const LONG_PRESS_MS = 450;
  const MOVE_THRESHOLD = 6;

  handle.addEventListener('pointerdown', (e) => {
    // only primary
    if (e.button && e.button !== 0) return;
    e.preventDefault();
    try { handle.setPointerCapture(e.pointerId); } catch (err) {}
    pointerId = e.pointerId;
    startX = e.clientX; startY = e.clientY;
    const rect = block.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    dragging = false;

    // start long-press timer to enter connection mode if no movement
    longPressTimer = setTimeout(() => {
      if (!dragging) {
        // toggle connection source on long-press
        if (!connectionSource) {
          connectionSource = block;
          block.style.border = '2px dashed #4a90e2';
        } else if (connectionSource === block) {
          connectionSource.style.border = '';
          connectionSource = null;
        }
      }
    }, LONG_PRESS_MS);
  });

  document.addEventListener('pointermove', (e) => {
    if (pointerId === null || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) > MOVE_THRESHOLD) {
      dragging = true;
      clearTimeout(longPressTimer);
    }
    if (dragging) {
      const canvasRect = canvas.getBoundingClientRect();
      // account for canvas scale when converting client -> canvas coords
      const localX = (e.clientX - canvasRect.left - offsetX) / canvasScale;
      const localY = (e.clientY - canvasRect.top - offsetY) / canvasScale;
      block.style.left = `${localX}px`;
      block.style.top = `${localY}px`;
      refreshConnections();
    }
  });

  document.addEventListener('pointerup', (e) => {
    if (pointerId === null || e.pointerId !== pointerId) return;
    try { handle.releasePointerCapture(pointerId); } catch (err) {}
    clearTimeout(longPressTimer);
    if (dragging) {
      pushHistory();
    }
    pointerId = null;
    dragging = false;
  });

  document.addEventListener('pointercancel', (e) => {
    if (pointerId === null || e.pointerId !== pointerId) return;
    try { handle.releasePointerCapture(pointerId); } catch (err) {}
    clearTimeout(longPressTimer);
    pointerId = null;
    dragging = false;
  });

  block.addEventListener("click", (e) => {
    e.stopPropagation();

    if (selectedBlock && selectedBlock !== block) {
      selectedBlock.style.boxShadow = "";
    }

    selectedBlock = block;
    block.style.boxShadow = "0 0 10px 2px #4a90e2";
    sidebarHeader.textContent = block.querySelector("input").value;

    showSidebarEditor(block);

    // Connection logic
    if (!connectionSource) {
      connectionSource = block;
      block.style.border = "2px dashed #4a90e2";
    } else if (connectionSource === block) {
      block.style.border = "";
      connectionSource = null;
    } else {
      drawConnection(connectionSource, block);
      connectionSource.style.border = "";
      connectionSource = null;
    }
  });
}

// Canvas deselect
canvas.addEventListener("click", () => clearSelections());

// Drag to canvas
canvas.addEventListener("dragover", e => e.preventDefault());
canvas.addEventListener("drop", (e) => {
  e.preventDefault();
  // Try to read payload from dataTransfer then fallback to in-memory payload
  let payload = null;
  try {
    const raw = e.dataTransfer.getData('application/json');
    if (raw) payload = JSON.parse(raw);
  } catch (err) { /* ignore */ }
  if (!payload) payload = draggedBlockPayload;
  if (!payload) return;

  const rect = canvas.getBoundingClientRect();
  const block = document.createElement("div");
  block.className = "block canvas-block";

  const handle = document.createElement("div");
  handle.className = "handle";
  handle.textContent = "≡ Drag";

  const input = document.createElement("input");
  input.value = payload.name;

  block.appendChild(handle);
  block.appendChild(input);
  canvas.appendChild(block);
  // animate placement: scale/fade in
  block.classList.add('placing');
  const onPlaced = () => {
    block.classList.remove('placing');
    block.removeEventListener('animationend', onPlaced);
  };
  block.addEventListener('animationend', onPlaced);

  block.style.position = "absolute";
  // account for canvas scale when placing dropped block
  block.style.left = `${(e.clientX - rect.left - 50) / canvasScale}px`;
  block.style.top = `${(e.clientY - rect.top - 25) / canvasScale}px`;

  block.dataset.type = payload.type || "system";
  // start with no links; user can add as needed
  block.dataset.links = JSON.stringify([]);

  block.classList.add(`type-${block.dataset.type}`);

  makeBlockMovable(block);
  attachRipple(block);
  draggedBlockPayload = null;
  block.dataset.uid = crypto.randomUUID();
  InterlinkRepo.components.set(block.dataset.uid, block);
  block.dataset.type = block.dataset.type || "component";
  block.dataset.interlinks = block.dataset.interlinks || "[]";
  // record state for undo
  pushHistory();

});

// Sidebar editor (TYPE AWARE)
function showSidebarEditor(block) {
  // Clear sidebar
  blockPool.innerHTML = "";
  blockPool.style.overflowY = "auto"; // make scrollable

  /* =========================
     BLOCK TYPE (read-only)
     ========================= */
  const typeRow = document.createElement("div");
  const typeLabel = document.createElement("label");
  typeLabel.textContent = "Block Type";

  const typeValue = document.createElement("div");
  typeValue.textContent = BLOCK_TYPES.find(t => t.id === (block.dataset.type || 'system'))?.label || (block.dataset.type || 'system');
  typeValue.style.fontWeight = '600';
  typeValue.style.marginTop = '6px';

  typeRow.append(typeLabel, typeValue);
  blockPool.appendChild(typeRow);

  /* =========================
     LINKS SECTION
     ========================= */
  const links = JSON.parse(block.dataset.links || "[]");

  const linksTitle = document.createElement("h4");
  linksTitle.textContent = "Links";
  blockPool.appendChild(linksTitle);

  const linksContainer = document.createElement("div");

  function saveLinks() {
    block.dataset.links = JSON.stringify(links);
  }
  function renderLinks() {
    linksContainer.innerHTML = "";
    links.forEach((link, i) => {
      const row = document.createElement("div");
      row.className = 'link-row';

      const btn = document.createElement("button");
      btn.className = 'link-button';
      btn.textContent = link.name || `Button ${i + 1}`;
      btn.onclick = () => {
        if (link.url) window.open(link.url);
      };

      const edit = document.createElement("button");
      edit.className = 'link-edit';
      edit.textContent = '✎';
      edit.title = 'Edit link';
      edit.onclick = () => openEditPopup(i);

      const del = document.createElement("button");
      del.className = 'link-del';
      del.textContent = '−';
      del.title = 'Delete link';
      del.onclick = () => {
        links.splice(i, 1);
        saveLinks();
        renderLinks();
        pushHistory();
      };

      row.append(btn, edit, del);
      linksContainer.appendChild(row);
    });
  }

  function openEditPopup(index) {
    const data = links[index] || { name: `Button ${index + 1}`, url: '' };

    const popup = document.createElement('div');
    popup.className = 'link-popup';

    const title = document.createElement('h4');
    title.textContent = 'Edit Link';

    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Name';
    const nameInput = document.createElement('input');
    nameInput.value = data.name || '';

    const urlLabel = document.createElement('label');
    urlLabel.textContent = 'URL';
    const urlInput = document.createElement('input');
    urlInput.value = data.url || '';

    const actions = document.createElement('div');
    actions.className = 'link-popup-actions';

    const save = document.createElement('button');
    save.textContent = 'Save';
    save.onclick = () => {
      links[index] = { name: nameInput.value || `Button ${index + 1}`, url: urlInput.value || '' };
      saveLinks();
      renderLinks();
      popup.remove();
      pushHistory();
    };

    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.onclick = () => popup.remove();

    actions.append(save, cancel);

    popup.append(title, nameLabel, nameInput, urlLabel, urlInput, actions);
    blockPool.appendChild(popup);
    nameInput.focus();
  }

  // Shared Params modal opener (re-usable)
  function openSharedParamsModal(blockA, blockB) {
    // ensure interlink exists
    if (!getConnection(blockA, blockB) && !findInterlinkEntry(blockA, blockB)) {
      // create connection/interlink if missing
      drawConnection(blockA, blockB);
    }

    // get existing params
    const params = getInterlinkParams(blockA, blockB).slice(); // copy

    // create modal container
    const modal = document.createElement('div');
    modal.className = 'shared-params-modal';

    const title = document.createElement('h4');
    title.textContent = `Shared Parameters: ${blockA.dataset.name} ↔ ${blockB.dataset.name}`;

    const table = document.createElement('div');
    table.className = 'shared-params-table';

    function renderTable() {
      table.innerHTML = '';
      params.forEach((p, i) => {
        const row = document.createElement('div');
        row.className = 'shared-param-row';

        const key = document.createElement('input');
        key.value = p.key || '';
        key.placeholder = 'Parameter';
        const val = document.createElement('input');
        val.value = p.value || '';
        val.placeholder = 'Value';

        key.oninput = () => { params[i].key = key.value; };
        val.oninput = () => { params[i].value = val.value; };

        const del = document.createElement('button');
        del.textContent = '−';
        del.onclick = () => { params.splice(i,1); renderTable(); };

        row.append(key, val, del);
        table.appendChild(row);
      });
    }

    const add = document.createElement('button');
    add.textContent = '+ Add Row';
    add.onclick = () => { params.push({key:'',value:''}); renderTable(); };

    const actions = document.createElement('div');
    actions.className = 'shared-params-actions';
    const save = document.createElement('button');
    save.textContent = 'Save';
    save.onclick = () => {
      // persist to interlink repo
      setInterlinkParams(blockA, blockB, params);
      modal.remove();
    };
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.onclick = () => modal.remove();

    actions.append(save, cancel);

    modal.append(title, table, add, actions);
    blockPool.appendChild(modal);
    renderTable();
  }

// Processes manager modal for manufacturing
function openProcessesManager() {
  const modal = document.createElement('div');
  modal.className = 'processes-modal';

  const title = document.createElement('h4');
  title.textContent = 'Manage Manufacturing Processes';

  const table = document.createElement('div');
  table.className = 'processes-table';

  function renderTable() {
    table.innerHTML = '';
    MANUFACTURING_PROCESSES.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'process-row';

      const input = document.createElement('input');
      input.value = p.name || '';
      input.oninput = () => { p.name = input.value; };

      const del = document.createElement('button');
      del.textContent = '−';
      del.onclick = () => { MANUFACTURING_PROCESSES.splice(i,1); renderTable(); };

      row.append(input, del);
      table.appendChild(row);
    });
  }

  const add = document.createElement('button');
  add.textContent = '+ Add Process';
  add.onclick = () => { MANUFACTURING_PROCESSES.push({ id: uid(), name: 'New Process' }); renderTable(); };

  const actions = document.createElement('div');
  actions.className = 'processes-actions';
  const save = document.createElement('button');
  save.textContent = 'Save';
  save.onclick = () => { renderTable(); pushHistory(); modal.remove(); if (selectedBlock) showSidebarEditor(selectedBlock); };
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  cancel.onclick = () => modal.remove();
  actions.append(save, cancel);

  modal.append(title, table, add, actions);
  blockPool.appendChild(modal);
  renderTable();
}

// Design software manager (global)
function openDesignManager(onSaveCallback) {
  const modal = document.createElement('div');
  modal.className = 'processes-modal';

  const title = document.createElement('h4');
  title.textContent = 'Manage Design Softwares';

  const table = document.createElement('div');
  table.className = 'processes-table';

  function renderTable() {
    table.innerHTML = '';
    DESIGN_SOFTWARES.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'process-row';

      const input = document.createElement('input');
      input.value = p.name || '';
      input.oninput = () => { p.name = input.value; };

      const del = document.createElement('button');
      del.textContent = '−';
      del.onclick = () => { DESIGN_SOFTWARES.splice(i,1); renderTable(); };

      row.append(input, del);
      table.appendChild(row);
    });
  }

  const add = document.createElement('button');
  add.textContent = '+ Add Software';
  add.onclick = () => { DESIGN_SOFTWARES.push({ id: uid(), name: 'New Software' }); renderTable(); };

  const actions = document.createElement('div');
  actions.className = 'processes-actions';
  const save = document.createElement('button');
  save.textContent = 'Save';
  save.onclick = () => { renderTable(); pushHistory(); modal.remove(); if (onSaveCallback) onSaveCallback(); };
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  cancel.onclick = () => modal.remove();
  actions.append(save, cancel);

  modal.append(title, table, add, actions);
  blockPool.appendChild(modal);
  renderTable();
}

  const addLink = document.createElement("button");
  addLink.textContent = "+ Add Link";
  addLink.onclick = () => {
    links.push({ name: `Button ${links.length + 1}`, url: "" });
    saveLinks();
    renderLinks();
    pushHistory();
  };

  renderLinks();
  blockPool.append(linksContainer, addLink);

  /* =========================
     TYPE-SPECIFIC SECTION
     ========================= */
  const divider = document.createElement("hr");
  blockPool.appendChild(divider);

  const type = block.dataset.type || "system";

  /* ---- SYSTEM REQUIREMENT ---- */
  if (type === "system") {
    const title = document.createElement("h4");
    title.textContent = "System Overview";

    const connectedComponents = getConnectedComponents(block);

    const count = document.createElement("div");
    count.textContent = `Connected Components: ${connectedComponents.length}`;

    blockPool.append(title, count);

    // (Component interlink summary removed by user request)

     /* =========================
       SHARED PARAMETERS ACCESS
       ========================= */
    const sharedTitle = document.createElement('h4');
    sharedTitle.textContent = 'Shared Parameters';

    const pairsContainer = document.createElement('div');
    pairsContainer.className = 'shared-pairs';

    const comps = connectedComponents;
    if (comps.length < 2) {
      pairsContainer.textContent = 'No component pairs available.';
    } else {
      for (let i = 0; i < comps.length; i++) {
        for (let j = i + 1; j < comps.length; j++) {
          const a = comps[i];
          const b = comps[j];

          const row = document.createElement('div');
          row.className = 'shared-pair-row';

          const label = document.createElement('span');
          label.textContent = `${a.dataset.name || a.querySelector('input').value} ↔ ${b.dataset.name || b.querySelector('input').value}`;

          const openBtn = document.createElement('button');
          openBtn.textContent = 'Open Params';
          openBtn.onclick = () => openSharedParamsModal(a, b);

          row.append(label, openBtn);
          pairsContainer.appendChild(row);
        }
      }
    }

    blockPool.append(sharedTitle, pairsContainer);

    /* =========================
       DESIGN SOFTWARES (system-level)
       ========================= */
    const designTitle = document.createElement('h4');
    designTitle.textContent = 'Design Softwares';

    const designActions = document.createElement('div');
    designActions.style.display = 'flex';
    designActions.style.gap = '8px';

    const manageSoftBtn = document.createElement('button');
    manageSoftBtn.textContent = 'Manage Softwares';
    manageSoftBtn.onclick = () => openDesignManager(() => { if (selectedBlock) showSidebarEditor(selectedBlock); });

    designActions.append(manageSoftBtn);

    const assignTitle = document.createElement('h4');
    assignTitle.textContent = 'Assign Software to Components';

    const assignContainer = document.createElement('div');

    function renderAssignments() {
      assignContainer.innerHTML = '';
      const comps = getConnectedComponents(block);
      if (!comps.length) { assignContainer.textContent = 'No connected components.'; return; }
      comps.forEach(c => {
        const row = document.createElement('div');
        row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '8px'; row.style.marginBottom = '8px';
        const label = document.createElement('span'); label.textContent = c.dataset.name || c.querySelector('input').value; label.style.flex = '1';
        const picker = document.createElement('select');
        const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'None'; picker.appendChild(empty);
        DESIGN_SOFTWARES.forEach(s => { const opt = document.createElement('option'); opt.value = s.id; opt.textContent = s.name; if (c.dataset.software === s.id) opt.selected = true; picker.appendChild(opt); });
        picker.onchange = () => { if (picker.value) c.dataset.software = picker.value; else delete c.dataset.software; pushHistory(); };
        row.append(label, picker);
        assignContainer.appendChild(row);
      });
    }

    renderAssignments();
    blockPool.append(designTitle, designActions, assignTitle, assignContainer);
  }

  /* ---- COMPONENT REQUIREMENT ---- */
  if (type === "component") {
    const title = document.createElement("h4");
    title.textContent = "Interlinked Components";

    let interlinks = JSON.parse(block.dataset.interlinks || "[]");

    const container = document.createElement("div");

    function saveInterlinks() {
      block.dataset.interlinks = JSON.stringify(interlinks);
    }

    function renderInterlinks() {
      container.innerHTML = "";

      interlinks.forEach(uid => {
        const target = document.querySelector(`[data-uid="${uid}"]`);
        if (!target) return;

        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.justifyContent = "space-between";
        row.style.marginBottom = "8px";

        const label = document.createElement("span");
        label.textContent = target.dataset.name || target.querySelector("input").value;

        // Shared Params button
        const paramsBtn = document.createElement('button');
        paramsBtn.className = 'link-params-btn';
        paramsBtn.textContent = 'Shared Params';
        paramsBtn.onclick = () => openSharedParamsModal(block, target);

        // Remove interlink
        const removeBtn = document.createElement("button");
        removeBtn.textContent = "−";
        removeBtn.onclick = () => {
          interlinks = interlinks.filter(id => id !== uid);
          saveInterlinks();
          removeInterlink(block, target);
          refreshSidebar();
          pushHistory();
        };

        row.append(label, paramsBtn, removeBtn);
        container.appendChild(row);
      });
    }

    const addBtn = document.createElement("button");
    addBtn.textContent = "+ Add Interlink";

    addBtn.onclick = () => {
      const picker = document.createElement("select");

      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "Select Component";
      picker.appendChild(emptyOption);

      document.querySelectorAll(".canvas-block").forEach(b => {
        if (b === block) return;
        if (b.dataset.type !== "component") return;
        if (interlinks.includes(b.dataset.uid)) return;

        const opt = document.createElement("option");
        opt.value = b.dataset.uid;
        opt.textContent = b.dataset.name || b.querySelector("input").value;
        picker.appendChild(opt);
      });

      picker.onchange = () => {
        const target = document.querySelector(`[data-uid="${picker.value}"]`);
        if (!target) return;

        interlinks.push(picker.value);
        saveInterlinks();

        // Ensure line exists
        if (!getConnection(block, target)) drawConnection(block, target);

        renderInterlinks();
        picker.remove();
        pushHistory();
      };

      blockPool.appendChild(picker);
    };

    renderInterlinks();
    blockPool.append(title, container, addBtn);

    /* === SOFTWARE ASSIGNMENT (component) === */
    const softSection = document.createElement('div');
    softSection.style.marginTop = '12px';
    const softLabel = document.createElement('h4'); softLabel.textContent = 'Assigned Software';
    const softPicker = document.createElement('select');
    const noneOpt = document.createElement('option'); noneOpt.value = ''; noneOpt.textContent = 'None'; softPicker.appendChild(noneOpt);
    DESIGN_SOFTWARES.forEach(s => { const opt = document.createElement('option'); opt.value = s.id; opt.textContent = s.name; if (block.dataset.software === s.id) opt.selected = true; softPicker.appendChild(opt); });
    softPicker.onchange = () => { if (softPicker.value) block.dataset.software = softPicker.value; else delete block.dataset.software; pushHistory(); };
    const manageBtn = document.createElement('button'); manageBtn.textContent = 'Manage Softwares'; manageBtn.onclick = () => openDesignManager(() => { if (selectedBlock) showSidebarEditor(selectedBlock); });
    softSection.append(softLabel, softPicker, manageBtn);
    blockPool.appendChild(softSection);
  }

  /* ---- MANUFACTURING ---- */
  if (type === "manufacturing") {
    const title = document.createElement("h4");
    title.textContent = "Manufacturing";

    // Button to manage global processes
    const manageBtn = document.createElement('button');
    manageBtn.textContent = 'Manage Processes';
    manageBtn.onclick = () => openProcessesManager();

    const connectedTitle = document.createElement('h4');
    connectedTitle.textContent = 'Connected Components';
    const connectedContainer = document.createElement('div');
    connectedContainer.className = 'manufacturing-connected-list';

    // load existing assignments mapping (componentUid -> processId)
    let assignments = {};
    try { assignments = JSON.parse(block.dataset.processAssignments || '{}'); } catch (err) { assignments = {}; }

    function renderConnected() {
      connectedContainer.innerHTML = '';
      const comps = getConnectedComponents(block);
      if (!comps.length) {
        connectedContainer.textContent = 'No connected components.';
        return;
      }

      comps.forEach(c => {
        const row = document.createElement('div');
        row.className = 'manufacturing-row';

        const label = document.createElement('span');
        label.textContent = c.dataset.name || c.querySelector('input').value;

        const picker = document.createElement('select');
        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = 'Select Process';
        picker.appendChild(emptyOpt);

        MANUFACTURING_PROCESSES.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = p.name;
          if (assignments[c.dataset.uid] === p.id) opt.selected = true;
          picker.appendChild(opt);
        });

        picker.onchange = () => {
          try { assignments = JSON.parse(block.dataset.processAssignments || '{}'); } catch (err) { assignments = {}; }
          if (picker.value) assignments[c.dataset.uid] = picker.value; else delete assignments[c.dataset.uid];
          block.dataset.processAssignments = JSON.stringify(assignments);
          pushHistory();
        };

        row.append(label, picker);
        connectedContainer.appendChild(row);
      });
    }

    renderConnected();

    blockPool.append(title, manageBtn, connectedTitle, connectedContainer);
  }
}

/* ======= HELPERS FOR SHARED PARAMS ======= */
function getInterlinksBetweenComponents(a, b) {
  const aLinks = JSON.parse(a.dataset.interlinks || "[]");
  const bLinks = JSON.parse(b.dataset.interlinks || "[]");
  const sharedParams = JSON.parse(a.dataset.sharedParams || "{}");

  if (!aLinks.includes(b.dataset.uid)) return [];
  return [sharedParams[b.dataset.uid] || ""];
}

function getSharedParam(a, b) {
  const sharedParams = JSON.parse(a.dataset.sharedParams || "{}");
  return sharedParams[b.dataset.uid] || "";
}

function setSharedParam(a, b, value) {
  const sharedA = JSON.parse(a.dataset.sharedParams || "{}");
  const sharedB = JSON.parse(b.dataset.sharedParams || "{}");

  sharedA[b.dataset.uid] = value;
  sharedB[a.dataset.uid] = value;

  a.dataset.sharedParams = JSON.stringify(sharedA);
  b.dataset.sharedParams = JSON.stringify(sharedB);
}



// CONNECTIONS
function drawConnection(a, b) {
  if (!a || !b || a === b) return; // ⬅️ HARD GUARD

  const id = uid();

  // path for Bezier curve
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke-width', '3');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('class', 'connection-path');
  path.style.pointerEvents = 'stroke';
  path.dataset.connId = id;

  // gradient for the path stroke (will be positioned in updateLine)
  const gradId = `grad-${id}`;
  const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
  grad.setAttribute('id', gradId);
  grad.setAttribute('gradientUnits', 'userSpaceOnUse');
  const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  stop1.setAttribute('offset', '0%');
  const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  stop2.setAttribute('offset', '100%');
  grad.appendChild(stop1);
  grad.appendChild(stop2);

  // append gradient to defs so it can be referenced
  let defs = connectionsSVG.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    connectionsSVG.appendChild(defs);
  }
  defs.appendChild(grad);

  // set stroke to the gradient
  path.setAttribute('stroke', `url(#${gradId})`);
  // subtle glow via filter
  path.setAttribute('filter', 'url(#glow)');

  // invisible wider hit area for touch/mouse
  const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  hitPath.setAttribute('fill', 'none');
  hitPath.setAttribute('stroke', 'transparent');
  hitPath.setAttribute('stroke-width', '18');
  hitPath.setAttribute('class', 'connection-hit');
  hitPath.style.pointerEvents = 'stroke';

  // clicking the hitPath selects the visible path
  hitPath.addEventListener('click', (e) => {
    e.stopPropagation();
    clearSelections();
    selectedConnection = path;
    path.setAttribute('data-original-stroke', path.getAttribute('stroke'));
    path.setAttribute('stroke', '#e74c3c');
    path.setAttribute('stroke-width', '5');
    path.removeAttribute('filter');
  });

  // append hitPath after visual path so it captures events but remains invisible
  connectionsSVG.appendChild(path);
  connectionsSVG.appendChild(hitPath);
  path.addEventListener('click', (e) => {
    e.stopPropagation();
    clearSelections();
    selectedConnection = path;
    // visually indicate selection by overriding stroke
    path.setAttribute('data-original-stroke', path.getAttribute('stroke'));
    path.setAttribute('stroke', '#e74c3c');
    path.setAttribute('stroke-width', '4');
    path.removeAttribute('filter');
  });

  const connection = { line: path, hit: hitPath, a, b, id, grad, gradId, originalStroke: path.getAttribute('stroke') };
  connections.push(connection);
  updateLine(connection);
  ensureInterlink(a, b);
  // record state after creating a connection
  pushHistory();

}


function updateLine(c) {
  if (!c.a || !c.b) return;

  const r1 = c.a.getBoundingClientRect();
  const r2 = c.b.getBoundingClientRect();
  const cr = canvas.getBoundingClientRect();

  if (!r1 || !r2) return;

  // Convert screen coords back into canvas local coordinates (pre-transform)
  const x1 = (r1.left + r1.width / 2 - cr.left) / canvasScale;
  const y1 = (r1.top + r1.height / 2 - cr.top) / canvasScale;
  const x2 = (r2.left + r2.width / 2 - cr.left) / canvasScale;
  const y2 = (r2.top + r2.height / 2 - cr.top) / canvasScale;

  // compute bezier control points (smooth horizontal curve)
  const dx = x2 - x1;
  const curvature = Math.min(160, Math.max(40, Math.abs(dx) * 0.25));
  const cx1 = x1 + (dx > 0 ? curvature : -curvature);
  const cy1 = y1;
  const cx2 = x2 - (dx > 0 ? curvature : -curvature);
  const cy2 = y2;

  const d = `M ${x1} ${y1} C ${cx1} ${cy1} ${cx2} ${cy2} ${x2} ${y2}`;
  c.line.setAttribute('d', d);
  // update invisible hit area if present
  try { if (c.hit) c.hit.setAttribute('d', d); } catch (err) {}

  // update gradient vector and stops to match endpoint colors
  try {
    const grad = c.grad;
    if (grad) {
      grad.setAttribute('x1', x1);
      grad.setAttribute('y1', y1);
      grad.setAttribute('x2', x2);
      grad.setAttribute('y2', y2);

      const colorA = (getComputedStyle(c.a).getPropertyValue('--type-color') || '#4a90e2').trim();
      const colorB = (getComputedStyle(c.b).getPropertyValue('--type-color') || '#2ecc71').trim();
      const stopElems = grad.querySelectorAll('stop');
      if (stopElems[0]) stopElems[0].setAttribute('stop-color', colorA);
      if (stopElems[1]) stopElems[1].setAttribute('stop-color', colorB);
    }
  } catch (err) {}
}


function refreshConnections() {
  pruneConnections();
  connections.forEach(updateLine);
}

// Remove connections whose endpoints no longer exist and clean up interlink records
function pruneConnections() {
  // iterate over a copy since we may remove items
  const copy = connections.slice();
  for (let c of copy) {
    const aExists = c.a && document.contains(c.a);
    const bExists = c.b && document.contains(c.b);
    if (!aExists || !bExists) {
      // remove SVG line if present
      try { if (c.line && c.line.parentNode) c.line.remove(); } catch (err) {}

      // remove gradient defs if present
      try { if (c.grad && c.grad.parentNode) c.grad.parentNode.removeChild(c.grad); } catch (err) {}

  // also prune duplicate connections between the same pair (keep first seen)
  try {
    const groups = new Map();
    for (let c of connections.slice()) {
      const aId = c.a?.dataset?.uid;
      const bId = c.b?.dataset?.uid;
      if (!aId || !bId) continue;
      const key = aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }

    for (let [key, arr] of groups) {
      if (arr.length <= 1) continue;
      // keep the first, remove others
      for (let i = 1; i < arr.length; i++) {
        const dup = arr[i];
        try { if (dup.line && dup.line.parentNode) dup.line.parentNode.removeChild(dup.line); } catch (err) {}
        try { if (dup.hit && dup.hit.parentNode) dup.hit.parentNode.removeChild(dup.hit); } catch (err) {}
        try { if (dup.grad && dup.grad.parentNode) dup.grad.parentNode.removeChild(dup.grad); } catch (err) {}
        connections = connections.filter(x => x !== dup);
      }
      // ensure only one interlink entry exists in repo for this pair
      try {
        const [aId, bId] = key.split('|');
        const matches = Array.from(InterlinkRepo.interlinks.entries()).filter(([id, link]) => {
          return (link.a === aId && link.b === bId) || (link.a === bId && link.b === aId);
        });
        if (matches.length > 1) {
          // keep first, delete rest
          for (let j = 1; j < matches.length; j++) InterlinkRepo.interlinks.delete(matches[j][0]);
        }
      } catch (err) {}
    }
  } catch (err) {}
      // remove hit path if present
      try { if (c.hit && c.hit.parentNode) c.hit.parentNode.removeChild(c.hit); } catch (err) {}

      // remove from connections array
      connections = connections.filter(x => x !== c);

      // remove corresponding interlink entries in repo if both uids exist
      try {
        const uidA = c.a?.dataset?.uid;
        const uidB = c.b?.dataset?.uid;
        for (let [id, link] of Array.from(InterlinkRepo.interlinks)) {
          if (uidA && uidB && ((link.a === uidA && link.b === uidB) || (link.a === uidB && link.b === uidA))) {
            InterlinkRepo.interlinks.delete(id);
          }
        }
      } catch (err) {}
    }
  }
}

// CLEAR
function clearSelections() {
  if (selectedBlock) selectedBlock.style.boxShadow = "";
  if (connectionSource) connectionSource.style.border = "";
  if (selectedConnection) {
    try {
      const conn = connections.find(c => c.line === selectedConnection);
      if (conn) {
        // restore original gradient stroke and filter
        if (conn.originalStroke) selectedConnection.setAttribute('stroke', conn.originalStroke);
        else selectedConnection.setAttribute('stroke', '#4a90e2');
        selectedConnection.setAttribute('stroke-width', '2');
        selectedConnection.setAttribute('filter', 'url(#glow)');
      } else {
        selectedConnection.setAttribute('stroke', '#4a90e2');
        selectedConnection.setAttribute('stroke-width', '2');
        selectedConnection.setAttribute('filter', 'url(#glow)');
      }
    } catch (err) {}
  }

  selectedBlock = null;
  connectionSource = null;
  selectedConnection = null;

  sidebarHeader.textContent = "Select a block";
  restoreSidebarBlocks();
}

// DELETE + ESC
document.addEventListener("keydown", (e) => {
  const tag = document.activeElement.tagName;

  // ❗ Allow normal typing inside inputs & textareas
  if (tag === "INPUT" || tag === "TEXTAREA") return;

  // Escape: clear selection or exit connection mode
  if (e.key === "Escape") {
    e.preventDefault();
    clearSelections();
    return;
  }

  if (e.key === "Backspace" || e.key === "Delete") {
    e.preventDefault();

    // ---- Delete selected connection ----
    if (selectedConnection) {
      const conn = connections.find(c => c.line === selectedConnection);
      if (conn) {
        removeInterlink(conn.a, conn.b);
        // remove gradient definition if present
        try { if (conn.grad && conn.grad.parentNode) conn.grad.parentNode.removeChild(conn.grad); } catch (err) {}
        // remove hit path
        try { if (conn.hit && conn.hit.parentNode) conn.hit.parentNode.removeChild(conn.hit); } catch (err) {}
      }

      connections = connections.filter(c => c.line !== selectedConnection);
      try { selectedConnection.remove(); } catch (err) {}
      selectedConnection = null;
      pushHistory();
      return;
    }

    // ---- Delete selected block ----
    if (selectedBlock) {
      connections
        .filter(c => c.a === selectedBlock || c.b === selectedBlock)
        .forEach(c => {
          removeInterlink(c.a, c.b);
          c.line.remove();
        });

      connections = connections.filter(
        c => c.a !== selectedBlock && c.b !== selectedBlock
      );

      selectedBlock.remove();
      selectedBlock = null;
      blockPool.innerHTML = "";
      pushHistory();
    }
  }
});


function getConnection(a, b) {
  return connections.find(
    c =>
      (c.a === a && c.b === b) ||
      (c.a === b && c.b === a)
  );
}

function ensureInterlink(blockA, blockB) {
  if (blockA.dataset.type !== "component") return;
  if (blockB.dataset.type !== "component") return;

  // Prevent duplicates
  for (let link of InterlinkRepo.interlinks.values()) {
    if (
      (link.a === blockA.dataset.uid && link.b === blockB.dataset.uid) ||
      (link.a === blockB.dataset.uid && link.b === blockA.dataset.uid)
    ) return;
  }

  const id = uid();

  InterlinkRepo.interlinks.set(id, {
    id,
    a: blockA.dataset.uid,
    b: blockB.dataset.uid,
    params: [] // array of { key, value }
  });
  // Ensure each block's dataset.interlinks includes the other
  try {
    const aLinks = JSON.parse(blockA.dataset.interlinks || "[]");
    const bLinks = JSON.parse(blockB.dataset.interlinks || "[]");
    if (!aLinks.includes(blockB.dataset.uid)) aLinks.push(blockB.dataset.uid);
    if (!bLinks.includes(blockA.dataset.uid)) bLinks.push(blockA.dataset.uid);
    blockA.dataset.interlinks = JSON.stringify(aLinks);
    blockB.dataset.interlinks = JSON.stringify(bLinks);
  } catch (err) {
    // ignore
  }

  // If either block is currently open in the sidebar, refresh its editor
  if (selectedBlock === blockA || selectedBlock === blockB) {
    showSidebarEditor(selectedBlock);
  }
}

// Find interlink repo entry between two blocks (a and b can be DOM nodes)
function findInterlinkEntry(a, b) {
  if (!a || !b) return null;
  const uidA = a.dataset?.uid;
  const uidB = b.dataset?.uid;
  for (let link of InterlinkRepo.interlinks.values()) {
    if ((link.a === uidA && link.b === uidB) || (link.a === uidB && link.b === uidA)) return link;
  }
  return null;
}

function getInterlinkParams(a, b) {
  const entry = findInterlinkEntry(a, b);
  return entry ? (entry.params || []) : [];
}

function setInterlinkParams(a, b, params) {
  const entry = findInterlinkEntry(a, b);
  if (!entry) return;
  entry.params = Array.isArray(params) ? params : [];
  // refresh sidebars if open
  if (selectedBlock) showSidebarEditor(selectedBlock);
  pushHistory();
}



function removeInterlink(blockA, blockB) {
  for (let [id, link] of InterlinkRepo.interlinks) {
    if (
      (link.a === blockA.dataset.uid && link.b === blockB.dataset.uid) ||
      (link.a === blockB.dataset.uid && link.b === blockA.dataset.uid)
    ) {
      InterlinkRepo.interlinks.delete(id);
    }
  }
  // Also remove from each block's dataset.interlinks
  try {
    const aLinks = JSON.parse(blockA.dataset.interlinks || "[]");
    const bLinks = JSON.parse(blockB.dataset.interlinks || "[]");
    blockA.dataset.interlinks = JSON.stringify(aLinks.filter(id => id !== blockB.dataset.uid));
    blockB.dataset.interlinks = JSON.stringify(bLinks.filter(id => id !== blockA.dataset.uid));
  } catch (err) {}
  if (selectedBlock === blockA || selectedBlock === blockB) showSidebarEditor(selectedBlock);
  pushHistory();
}




function getConnectedComponents(systemBlock) {
  return connections
    .filter(c =>
      (c.a === systemBlock && c.b.dataset.type === "component") ||
      (c.b === systemBlock && c.a.dataset.type === "component")
    )
    .map(c => (c.a === systemBlock ? c.b : c.a));
}
function getInterlinksBetween(a, b) {
  const aLinks = JSON.parse(a.dataset.interlinks || "[]");
  return aLinks.filter(l => l.targetId === b.dataset.id);
}
function generateSystemSummary(systemBlock) {
  const components = getConnectedComponents(systemBlock);
  const summary = [];

  for (let i = 0; i < components.length; i++) {
    for (let j = i + 1; j < components.length; j++) {
      const a = components[i];
      const b = components[j];

      const linksAB = getInterlinksBetween(a, b);
      const linksBA = getInterlinksBetween(b, a);

      [...linksAB, ...linksBA].forEach(link => {
        summary.push({
          from: a.dataset.name || a.innerText,
          to: b.dataset.name || b.innerText,
          type: link.type
        });
      });
    }
  }

  return summary;
}

// Refresh control — fixed and styled via CSS
const refreshBtn = document.createElement("button");
refreshBtn.className = 'refresh-btn';
refreshBtn.setAttribute('aria-label', 'Refresh connections');
refreshBtn.textContent = '⟳';
document.body.appendChild(refreshBtn);

refreshBtn.addEventListener('click', () => {
  refreshConnections();
  if (selectedBlock) showSidebarEditor(selectedBlock);
});

// --- Zoom (wheel + pinch) ---
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// wheel-to-zoom (with Ctrl/Cmd)
canvas.addEventListener('wheel', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  const delta = -e.deltaY;
  const factor = delta > 0 ? 1.08 : 0.92;
  canvasScale = clamp(canvasScale * factor, 0.4, 3);
  canvas.style.transform = `scale(${canvasScale})`;
  refreshConnections();
});

// pinch-to-zoom (track two touch pointers)
const activePointers = new Map();
let pinchState = null;
function dist(a, b) { const dx = a.x - b.x; const dy = a.y - b.y; return Math.hypot(dx, dy); }

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (activePointers.size === 2) {
    const pts = Array.from(activePointers.values());
    pinchState = { startDist: dist(pts[0], pts[1]), startScale: canvasScale };
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'touch') return;
  if (!activePointers.has(e.pointerId)) return;
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinchState && activePointers.size === 2) {
    const pts = Array.from(activePointers.values());
    const cur = dist(pts[0], pts[1]);
    const ratio = cur / Math.max(1, pinchState.startDist);
    canvasScale = clamp(pinchState.startScale * ratio, 0.4, 3);
    canvas.style.transform = `scale(${canvasScale})`;
    refreshConnections();
  }
});

function removePointer(id) {
  activePointers.delete(id);
  if (activePointers.size < 2) pinchState = null;
}

canvas.addEventListener('pointerup', (e) => { if (e.pointerType === 'touch') removePointer(e.pointerId); });
canvas.addEventListener('pointercancel', (e) => { if (e.pointerType === 'touch') removePointer(e.pointerId); });

// All-Clear control — fixed and styled via CSS (bottom-right)
const clearBtn = document.createElement('button');
clearBtn.className = 'clear-btn';
clearBtn.setAttribute('aria-label', 'Clear all blocks and connections');
clearBtn.textContent = '✖';
document.body.appendChild(clearBtn);

clearBtn.addEventListener('click', () => {
  // show confirmation modal before clearing
  showClearConfirm();
});

// wire confirm button in modal (if present)
document.addEventListener('DOMContentLoaded', () => {
  const confirmBtn = document.getElementById('confirmClearBtn');
  if (confirmBtn) confirmBtn.addEventListener('click', confirmClear);

  // escape to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.querySelector('.confirm-overlay');
      if (modal && modal.classList.contains('visible')) modal.classList.remove('visible');
    }
  });
});

// Confirmation modal logic
function showClearConfirm() {
  const modal = document.querySelector('.confirm-overlay');
  if (modal) modal.classList.add('visible');
}

function hideClearConfirm() {
  const modal = document.querySelector('.confirm-overlay');
  if (modal) modal.classList.remove('visible');
}

function confirmClear() {
  // snapshot before clearing for undo
  pushHistory();

  // remove connections
  connections.forEach(c => c.line.remove());
  connections = [];

  // remove canvas blocks
  document.querySelectorAll('.canvas-block').forEach(b => b.remove());

  // clear repos and selections
  InterlinkRepo.interlinks.clear();
  InterlinkRepo.components.clear();
  selectedBlock = null;
  selectedConnection = null;
  connectionSource = null;

  // reset sidebar and header
  sidebarHeader.textContent = 'Select a block';
  restoreSidebarBlocks();

  hideClearConfirm();
}

