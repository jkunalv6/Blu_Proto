

// ---------------- DOM ----------------
const toggle = document.getElementById("toggle");
const sidebar = document.getElementById("sidebar");
const blockPool = document.getElementById("blockPool");
const canvas = document.getElementById("canvas");
const sidebarHeader = document.getElementById("sidebarHeader");

// ---------------- SVG ----------------
let connectionsSVG = document.getElementById("connections");
if (!connectionsSVG) {
  connectionsSVG = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  connectionsSVG.id = "connections";
  Object.assign(connectionsSVG.style, {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "auto"
  });
  canvas.appendChild(connectionsSVG);
}

// ---------------- STATE ----------------
let blockId = 0;
let draggedBlockName = null;
let selectedBlock = null;
let connectionSource = null;
let selectedConnection = null;
let connections = [];

// ---------------- UNDO / REDO ----------------
let undoStack = [];
let redoStack = [];

function saveState() {
  const state = {
    blocks: [...canvas.querySelectorAll(".canvas-block")].map(b => ({
      id: b.dataset.id,
      name: b.querySelector("input").value,
      x: b.style.left,
      y: b.style.top,
      w: b.style.width,
      h: b.style.height,
      links: b.dataset.links
    })),
    connections: connections.map(c => ({
      a: c.blockA.dataset.id,
      b: c.blockB.dataset.id
    }))
  };

  undoStack.push(JSON.stringify(state));
  redoStack = [];
}

function restoreState(stateStr) {
  const state = JSON.parse(stateStr);

  canvas.querySelectorAll(".canvas-block").forEach(b => b.remove());
  connectionsSVG.innerHTML = "";
  connections = [];

  const blockMap = {};

  state.blocks.forEach(b => {
    const block = createCanvasBlock(b.name, b.x, b.y);
    block.style.width = b.w;
    block.style.height = b.h;
    block.dataset.id = b.id;
    block.dataset.links = b.links;
    blockMap[b.id] = block;
  });

  state.connections.forEach(c => {
    drawConnection(blockMap[c.a], blockMap[c.b]);
  });

  refreshConnections();
}

document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key === "z") {
    if (!undoStack.length) return;
    redoStack.push(undoStack.pop());
    restoreState(undoStack[undoStack.length - 1]);
  }

  if ((e.ctrlKey || e.metaKey) && e.key === "y") {
    if (!redoStack.length) return;
    const s = redoStack.pop();
    undoStack.push(s);
    restoreState(s);
  }
});

// ---------------- SIDEBAR ----------------
toggle.addEventListener("click", () => {
  sidebar.classList.toggle("open");
  document.querySelector(".main").classList.toggle("shifted");
  if (!sidebar.classList.contains("open")) restoreSidebarBlocks();
});

function createSidebarBlock(label) {
  const block = document.createElement("div");
  block.className = "block";
  block.draggable = true;

  block.innerHTML = `
    <div class="handle">≡ Drag</div>
    <input value="${label}">
  `;

  block.addEventListener("dragstart", e => {
    draggedBlockName = block.querySelector("input").value;
    e.dataTransfer.setData("text/plain", draggedBlockName);
  });

  blockPool.appendChild(block);
}

function restoreSidebarBlocks() {
  sidebarHeader.textContent = "Select a block";
  blockPool.innerHTML = "";
  ["Block A", "Block B", "Block C"].forEach(createSidebarBlock);
}

restoreSidebarBlocks();

// ---------------- CANVAS ----------------
canvas.addEventListener("dragover", e => e.preventDefault());

canvas.addEventListener("drop", e => {
  e.preventDefault();
  if (!draggedBlockName) return;

  const rect = canvas.getBoundingClientRect();
  const block = createCanvasBlock(
    draggedBlockName,
    `${e.clientX - rect.left - 50}px`,
    `${e.clientY - rect.top - 25}px`
  );

  saveState();
  draggedBlockName = null;
});

function createCanvasBlock(name, left, top) {
  const block = document.createElement("div");
  block.className = "block canvas-block";
  block.dataset.id = crypto.randomUUID();
  block.style.position = "absolute";
  block.style.left = left;
  block.style.top = top;

  block.innerHTML = `
    <div class="handle">≡ Drag</div>
    <input value="${name}">
  `;

  block.dataset.links = JSON.stringify([
    { name: "Button 1", url: "" },
    { name: "Button 2", url: "" },
    { name: "Button 3", url: "" },
    { name: "Button 4", url: "" }
  ]);

  canvas.appendChild(block);
  makeBlockMovable(block);
  return block;
}

// ---------------- BLOCK MOVE ----------------
function makeBlockMovable(block) {
  const handle = block.querySelector(".handle");
  let dragging = false, ox = 0, oy = 0;

  handle.addEventListener("mousedown", e => {
    dragging = true;
    const r = block.getBoundingClientRect();
    const c = canvas.getBoundingClientRect();
    ox = e.clientX - r.left;
    oy = e.clientY - r.top;
  });

  document.addEventListener("mousemove", e => {
    if (!dragging) return;
    const c = canvas.getBoundingClientRect();
    block.style.left = `${e.clientX - c.left - ox}px`;
    block.style.top = `${e.clientY - c.top - oy}px`;
    refreshConnections();
  });

  document.addEventListener("mouseup", () => {
    if (dragging) {
      dragging = false;
      saveState();
    }
  });

  block.addEventListener("click", e => {
    e.stopPropagation();

    if (selectedBlock)
      selectedBlock.style.boxShadow = "1px 1px 3px rgba(0,0,0,0.2)";

    selectedBlock = block;
    block.style.boxShadow = "0 0 10px 2px #4a90e2";

    sidebarHeader.textContent = block.querySelector("input").value;
    showSidebarButtonEditor(block);

    if (!connectionSource) {
      connectionSource = block;
      block.style.border = "2px dashed #4a90e2";
    } else if (connectionSource !== block) {
      drawConnection(connectionSource, block);
      connectionSource.style.border = "";
      connectionSource = null;
      saveState();
    }
  });
}

// ---------------- DELETE ----------------
document.addEventListener("keydown", e => {
  if (e.key !== "Delete") return;

  if (selectedBlock) {
    removeConnectionsOfBlock(selectedBlock);
    selectedBlock.remove();
    selectedBlock = null;
    saveState();
    restoreSidebarBlocks();
  } else if (selectedConnection) {
    selectedConnection.line.remove();
    connections = connections.filter(c => c !== selectedConnection);
    selectedConnection = null;
    saveState();
  }
});

// ---------------- CONNECTIONS ----------------
function drawConnection(a, b) {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("stroke", "#4a90e2");
  line.setAttribute("stroke-width", "2");
  line.style.pointerEvents = "stroke";
  line.style.cursor = "pointer";

  connectionsSVG.appendChild(line);

  const conn = { line, blockA: a, blockB: b };
  connections.push(conn);
  updateLinePosition(conn);

  line.addEventListener("click", e => {
    e.stopPropagation();
    if (selectedConnection)
      selectedConnection.line.setAttribute("stroke", "#4a90e2");
    selectedConnection = conn;
    line.setAttribute("stroke", "#ff4d4d");
  });
}

function updateLinePosition(c) {
  const rA = c.blockA.getBoundingClientRect();
  const rB = c.blockB.getBoundingClientRect();
  const cr = canvas.getBoundingClientRect();

  c.line.setAttribute("x1", rA.left + rA.width / 2 - cr.left);
  c.line.setAttribute("y1", rA.top + rA.height / 2 - cr.top);
  c.line.setAttribute("x2", rB.left + rB.width / 2 - cr.left);
  c.line.setAttribute("y2", rB.top + rB.height / 2 - cr.top);
}

function refreshConnections() {
  connections.forEach(updateLinePosition);
}

function removeConnectionsOfBlock(block) {
  connections = connections.filter(c => {
    if (c.blockA === block || c.blockB === block) {
      c.line.remove();
      return false;
    }
    return true;
  });
}

// ---------------- SIDEBAR EDITOR ----------------
function showSidebarButtonEditor(block) {
  const links = JSON.parse(block.dataset.links || "[]");
  blockPool.innerHTML = "";

  links.forEach((l, i) => {
    const n = document.createElement("input");
    n.value = l.name;
    n.onchange = () => {
      links[i].name = n.value;
      block.dataset.links = JSON.stringify(links);
      saveState();
    };

    const u = document.createElement("input");
    u.value = l.url;
    u.onchange = () => {
      links[i].url = u.value;
      block.dataset.links = JSON.stringify(links);
      saveState();
    };

    blockPool.append(n, u);
  });
}
// Save initial empty canvas state for undo baseline
saveState();
if (undoStack.length > 1) {
  redoStack.push(undoStack.pop());
  restoreState(undoStack[undoStack.length - 1]);
}
