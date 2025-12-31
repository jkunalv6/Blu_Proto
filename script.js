// DOM references
const toggle = document.getElementById("toggle");
const sidebar = document.getElementById("sidebar");
const blockPool = document.getElementById("blockPool");
const canvas = document.getElementById("canvas");
const sidebarHeader = document.getElementById("sidebarHeader");

// Add an SVG layer for connections
let connectionsSVG = document.getElementById("connections");
if (!connectionsSVG) {
  connectionsSVG = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  connectionsSVG.id = "connections";
  connectionsSVG.style.position = "absolute";
  connectionsSVG.style.top = "0";
  connectionsSVG.style.left = "0";
  connectionsSVG.style.width = "100%";
  connectionsSVG.style.height = "100%";
  connectionsSVG.style.pointerEvents = "none";
  canvas.appendChild(connectionsSVG);
}

// State
let blockId = 0;
let draggedBlockName = null;
let selectedBlock = null;
let connectionSource = null;
let connections = [];

// Sidebar toggle
toggle.addEventListener("click", () => {
  sidebar.classList.toggle("open");
  toggle.classList.toggle("open");
  document.querySelector(".main").classList.toggle("shifted");
  if (!sidebar.classList.contains("open")) restoreSidebarBlocks();
});

// Create a sidebar block
function createSidebarBlock() {
  blockId++;
  const block = document.createElement("div");
  block.className = "block";
  block.draggable = true;

  const handle = document.createElement("div");
  handle.className = "handle";
  handle.textContent = "≡ Drag";

  const input = document.createElement("input");
  input.type = "text";
  input.value = `Block ${blockId}`;
  block.dataset.name = input.value;

  input.addEventListener("input", () => {
    block.dataset.name = input.value;
    if (selectedBlock === block) sidebarHeader.textContent = input.value;
  });

  block.appendChild(handle);
  block.appendChild(input);
  blockPool.appendChild(block);

  block.addEventListener("dragstart", (e) => {
    draggedBlockName = block.dataset.name;
    e.dataTransfer.setData("text/plain", draggedBlockName);
    e.dataTransfer.effectAllowed = "copy";
  });
}

// Initialize 3 sidebar blocks
for (let i = 0; i < 3; i++) createSidebarBlock();

// Make block movable & resizable
function makeBlockMovable(block) {
  const handle = block.querySelector(".handle");
  let isDragging = false;
  let offsetX, offsetY;

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    isDragging = true;
    const rect = block.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    handle.style.cursor = "grabbing";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const canvasRect = canvas.getBoundingClientRect();
    let left = e.clientX - canvasRect.left - offsetX;
    let top = e.clientY - canvasRect.top - offsetY;
    left = Math.max(0, Math.min(left, canvasRect.width - block.offsetWidth));
    top = Math.max(0, Math.min(top, canvasRect.height - block.offsetHeight));
    block.style.left = left + "px";
    block.style.top = top + "px";
    refreshConnections();
  });

  document.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      handle.style.cursor = "grab";
    }
  });

  // Select block / connection logic
  block.addEventListener("click", (e) => {
    e.stopPropagation();

    // Handle selection for sidebar
    if (selectedBlock) selectedBlock.style.boxShadow = "1px 1px 3px rgba(0,0,0,0.2)";
    selectedBlock = block;
    selectedBlock.style.boxShadow = "0 0 10px 2px #4a90e2";
    sidebarHeader.textContent = block.querySelector("input").value;
    showSidebarButtonEditor(selectedBlock);

    // Handle connections
    if (!connectionSource) {
      connectionSource = block;
      block.style.border = "2px dashed #4a90e2";
    } else if (connectionSource && connectionSource !== block) {
      drawConnection(connectionSource, block);
      connectionSource.style.border = "";
      connectionSource = null;
    } else if (connectionSource === block) {
      connectionSource.style.border = "";
      connectionSource = null;
    }
  });
}

// Deselect on canvas click
canvas.addEventListener("click", (e) => {
  if (e.target === canvas) {
    if (selectedBlock) selectedBlock.style.boxShadow = "1px 1px 3px rgba(0,0,0,0.2)";
    selectedBlock = null;
    sidebarHeader.textContent = "Select a block";
    restoreSidebarBlocks();
  }
});

// Delete block
document.addEventListener("keydown", (e) => {
  if (e.key === "Delete" && selectedBlock) {
    removeConnectionsOfBlock(selectedBlock);
    selectedBlock.remove();
    selectedBlock = null;
    sidebarHeader.textContent = "Select a block";
    restoreSidebarBlocks();
  }
});

// Drag & drop to canvas
canvas.addEventListener("dragover", (e) => e.preventDefault());
canvas.addEventListener("drop", (e) => {
  e.preventDefault();
  if (!draggedBlockName) return;

  const rect = canvas.getBoundingClientRect();
  const canvasBlock = document.createElement("div");
  canvasBlock.className = "block canvas-block";

  const handle = document.createElement("div");
  handle.className = "handle";
  handle.textContent = "≡ Drag";

  const input = document.createElement("input");
  input.type = "text";
  input.value = draggedBlockName;

  canvasBlock.appendChild(handle);
  canvasBlock.appendChild(input);
  canvas.appendChild(canvasBlock);

  canvasBlock.style.position = "absolute";
  canvasBlock.style.left = `${e.clientX - rect.left - 50}px`;
  canvasBlock.style.top = `${e.clientY - rect.top - 25}px`;

  canvasBlock.dataset.links = JSON.stringify([
    { name: "Button 1", url: "" },
    { name: "Button 2", url: "" },
    { name: "Button 3", url: "" },
    { name: "Button 4", url: "" }
  ]);

  makeBlockMovable(canvasBlock);
  draggedBlockName = null;
});

// Sidebar button editor
function showSidebarButtonEditor(block) {
  const links = JSON.parse(block.dataset.links || '[]');
  blockPool.innerHTML = "";
  blockPool.style.display = "flex";
  blockPool.style.flexDirection = "column";
  blockPool.style.justifyContent = "space-around";
  blockPool.style.height = "100%";
  blockPool.style.padding = "10px";

  links.forEach((linkObj, index) => {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.flexDirection = "column";
    row.style.marginBottom = "10px";

    const nameInput = document.createElement("input");
    nameInput.value = linkObj.name;
    nameInput.placeholder = `Button ${index + 1} Name`;
    nameInput.addEventListener("input", (e) => {
      links[index].name = e.target.value;
      block.dataset.links = JSON.stringify(links);
    });

    const urlInput = document.createElement("input");
    urlInput.value = linkObj.url;
    urlInput.placeholder = `Button ${index + 1} URL`;
    urlInput.addEventListener("input", (e) => {
      links[index].url = e.target.value;
      block.dataset.links = JSON.stringify(links);
    });

    const openBtn = document.createElement("button");
    openBtn.textContent = "Open Link";
    openBtn.style.marginTop = "5px";
    openBtn.addEventListener("click", () => {
      if (links[index].url) window.open(links[index].url, "_blank");
    });

    row.appendChild(nameInput);
    row.appendChild(urlInput);
    row.appendChild(openBtn);
    blockPool.appendChild(row);
  });
}

// Restore sidebar blocks
function restoreSidebarBlocks() {
  sidebarHeader.textContent = "Select a block";
  blockPool.innerHTML = "";
  blockPool.style.flexDirection = "column";
  blockPool.style.justifyContent = "flex-start";
  blockPool.style.height = "auto";
  for (let i = 0; i < 3; i++) createSidebarBlock();
}

// --------- CONNECTIONS LOGIC ----------
function drawConnection(blockA, blockB) {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("stroke", "#4a90e2");
  line.setAttribute("stroke-width", "2");
  line.setAttribute("marker-end", "url(#arrow)");

  // Add arrow marker if not exists
  if (!connectionsSVG.querySelector("defs")) {
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
    marker.setAttribute("id", "arrow");
    marker.setAttribute("markerWidth", "10");
    marker.setAttribute("markerHeight", "10");
    marker.setAttribute("refX", "10");
    marker.setAttribute("refY", "3");
    marker.setAttribute("orient", "auto");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M0,0 L0,6 L9,3 z");
    path.setAttribute("fill", "#4a90e2");
    marker.appendChild(path);
    defs.appendChild(marker);
    connectionsSVG.appendChild(defs);
  }

  connectionsSVG.appendChild(line);
  const connection = { line, blockA, blockB };
  connections.push(connection);
  updateLinePosition(connection);
}

// Update a line
function updateLinePosition(connection) {
  const { line, blockA, blockB } = connection;
  const rectA = blockA.getBoundingClientRect();
  const rectB = blockB.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();

  const x1 = rectA.left + rectA.width / 2 - canvasRect.left;
  const y1 = rectA.top + rectA.height / 2 - canvasRect.top;
  const x2 = rectB.left + rectB.width / 2 - canvasRect.left;
  const y2 = rectB.top + rectB.height / 2 - canvasRect.top;

  line.setAttribute("x1", x1);
  line.setAttribute("y1", y1);
  line.setAttribute("x2", x2);
  line.setAttribute("y2", y2);
}

// Refresh all lines
function refreshConnections() {
  connections.forEach(updateLinePosition);
}

// Remove connections of deleted block
function removeConnectionsOfBlock(block) {
  connections = connections.filter(conn => {
    if (conn.blockA === block || conn.blockB === block) {
      conn.line.remove();
      return false;
    }
    return true;
  });
}
