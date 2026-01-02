// DOM references
const toggle = document.getElementById("toggle");
const sidebar = document.getElementById("sidebar");
const blockPool = document.getElementById("blockPool");
const canvas = document.getElementById("canvas");
const sidebarHeader = document.getElementById("sidebarHeader");

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

// State
let draggedBlockName = null;
let selectedBlock = null;
let connectionSource = null;
let selectedConnection = null;
let connections = [];

// Sidebar toggle
toggle.addEventListener("click", () => {
  sidebar.classList.toggle("open");
  toggle.classList.toggle("open");
  document.querySelector(".main").classList.toggle("shifted");
  if (!sidebar.classList.contains("open")) restoreSidebarBlocks();
});

// Sidebar blocks (static names)
const SIDEBAR_BLOCKS = ["Block A", "Block B", "Block C"];

function createSidebarBlock(name) {
  const block = document.createElement("div");
  block.className = "block";
  block.draggable = true;

  const handle = document.createElement("div");
  handle.className = "handle";
  handle.textContent = "≡ Drag";

  const input = document.createElement("input");
  input.value = name;

  block.dataset.name = name;

  input.addEventListener("input", () => {
    block.dataset.name = input.value;
  });

  block.appendChild(handle);
  block.appendChild(input);
  blockPool.appendChild(block);

  block.addEventListener("dragstart", (e) => {
    draggedBlockName = block.dataset.name;
    e.dataTransfer.setData("text/plain", draggedBlockName);
  });
}

function restoreSidebarBlocks() {
  sidebarHeader.textContent = "Select a block";
  blockPool.innerHTML = "";
  SIDEBAR_BLOCKS.forEach(createSidebarBlock);
}

// Init sidebar
restoreSidebarBlocks();

// Make blocks movable
function makeBlockMovable(block) {
  const handle = block.querySelector(".handle");
  let dragging = false;
  let offsetX, offsetY;

  handle.addEventListener("mousedown", (e) => {
    dragging = true;
    const rect = block.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
  });

  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const canvasRect = canvas.getBoundingClientRect();
    block.style.left = `${e.clientX - canvasRect.left - offsetX}px`;
    block.style.top = `${e.clientY - canvasRect.top - offsetY}px`;
    refreshConnections();
  });

  document.addEventListener("mouseup", () => dragging = false);

 block.addEventListener("click", (e) => {
  e.stopPropagation();

  // ---- SIDEBAR SELECTION (independent of connections) ----
  if (selectedBlock && selectedBlock !== block) {
    selectedBlock.style.boxShadow = "";
  }

  selectedBlock = block;
  block.style.boxShadow = "0 0 10px 2px #4a90e2";
  sidebarHeader.textContent = block.querySelector("input").value;
  showSidebarButtonEditor(block);

  // ---- CONNECTION LOGIC ----
  if (!connectionSource) {
    // First click → arm connection
    connectionSource = block;
    block.style.border = "2px dashed #4a90e2";
  } else if (connectionSource === block) {
    // Clicking same block cancels connection
    block.style.border = "";
    connectionSource = null;
  } else {
    // Second block → create connection
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
  if (!draggedBlockName) return;

  const rect = canvas.getBoundingClientRect();
  const block = document.createElement("div");
  block.className = "block canvas-block";

  const handle = document.createElement("div");
  handle.className = "handle";
  handle.textContent = "≡ Drag";

  const input = document.createElement("input");
  input.value = draggedBlockName;

  block.appendChild(handle);
  block.appendChild(input);
  canvas.appendChild(block);

  block.style.position = "absolute";
  block.style.left = `${e.clientX - rect.left - 50}px`;
  block.style.top = `${e.clientY - rect.top - 25}px`;

  block.dataset.links = JSON.stringify([
    { name: "Button 1", url: "" },
    { name: "Button 2", url: "" },
    { name: "Button 3", url: "" },
    { name: "Button 4", url: "" }
  ]);

  makeBlockMovable(block);
  draggedBlockName = null;
});

// Sidebar editor
function showSidebarButtonEditor(block) {
  const links = JSON.parse(block.dataset.links);
  blockPool.innerHTML = "";

  links.forEach((link, i) => {
    const row = document.createElement("div");

    const name = document.createElement("input");
    name.value = link.name;

    const url = document.createElement("input");
    url.value = link.url;

    const btn = document.createElement("button");
    btn.textContent = link.name || "Open Link";
    btn.onclick = () => link.url && window.open(link.url);

    name.oninput = e => {
      link.name = e.target.value;
      btn.textContent = e.target.value;
      block.dataset.links = JSON.stringify(links);
    };

    url.oninput = e => {
      link.url = e.target.value;
      block.dataset.links = JSON.stringify(links);
    };

    row.append(name, url, btn);
    blockPool.appendChild(row);
  });
}

// CONNECTIONS
function drawConnection(a, b) {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("stroke", "#4a90e2");
  line.setAttribute("stroke-width", "2");
  line.style.pointerEvents = "stroke";

  line.addEventListener("click", (e) => {
    e.stopPropagation();
    clearSelections();
    selectedConnection = line;
    line.setAttribute("stroke", "#e74c3c");
  });

  connectionsSVG.appendChild(line);
  connections.push({ line, a, b });
  updateLine({ line, a, b });
}

function updateLine(c) {
  const r1 = c.a.getBoundingClientRect();
  const r2 = c.b.getBoundingClientRect();
  const cr = canvas.getBoundingClientRect();

  c.line.setAttribute("x1", r1.left + r1.width / 2 - cr.left);
  c.line.setAttribute("y1", r1.top + r1.height / 2 - cr.top);
  c.line.setAttribute("x2", r2.left + r2.width / 2 - cr.left);
  c.line.setAttribute("y2", r2.top + r2.height / 2 - cr.top);
}

function refreshConnections() {
  connections.forEach(updateLine);
}

// CLEAR STATE
function clearSelections() {
  if (selectedBlock) selectedBlock.style.boxShadow = "";
  if (connectionSource) connectionSource.style.border = "";
  if (selectedConnection) selectedConnection.setAttribute("stroke", "#4a90e2");

  selectedBlock = null;
  connectionSource = null;
  selectedConnection = null;

  sidebarHeader.textContent = "Select a block";
  restoreSidebarBlocks();
}

// DELETE + ESC SUPPORT (macOS safe)
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    clearSelections();
  }

  if ((e.key === "Delete" || e.key === "Backspace")) {
    if (selectedConnection) {
      connections = connections.filter(c => c.line !== selectedConnection);
      selectedConnection.remove();
      selectedConnection = null;
    }

    if (selectedBlock) {
      connections = connections.filter(c => {
        if (c.a === selectedBlock || c.b === selectedBlock) {
          c.line.remove();
          return false;
        }
        return true;
      });
      selectedBlock.remove();
      selectedBlock = null;
      restoreSidebarBlocks();
    }
  }
});
