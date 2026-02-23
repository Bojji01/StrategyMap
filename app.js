/**
 * Strategy Map - Draw & Erase Tool
 */

(function () {
  'use strict';

  const MAP_IMAGE = 'image/MapBackground.jpg';

  // Zoom settings
  const ZOOM_CONFIG = {
    min: 0.5,
    max: 4,
    step: 0.1,
  };

  // DOM
  const wrapperEl = document.querySelector('.canvas-wrap');
  const selectBtn = document.getElementById('selectBtn');
  const drawBtn = document.getElementById('drawBtn');
  const eraseBtn = document.getElementById('eraseBtn');
  const clearBtn = document.getElementById('clearBtn');
  const recenterBtn = document.getElementById('recenterBtn');
  const brushSizeSlider = document.getElementById('brushSize');
  const sizeValueDisplay = document.getElementById('sizeValue');
  const hamburgerBtn = document.getElementById('hamburgerBtn');
  const rightPanel = document.querySelector('.right-panel');
  const championGrid = document.getElementById('championGrid');
  const championSearch = document.getElementById('championSearch');
  const markerSizeSlider = document.getElementById('markerSize');
  const markerSizeValue = document.getElementById('markerSizeValue');

  // Data Dragon config
  const DDRAGON_VERSION = '14.24.1';
  const DDRAGON_BASE = `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}`;

  // Validate
  if (typeof fabric === 'undefined') {
    console.error('Fabric.js not loaded');
    return;
  }

  // State
  let canvas = null;
  let bgImage = null;
  let currentMode = 'select'; // 'select', 'draw', or 'erase'
  let currentBrushSize = 4;
  let markerRadius = 16; // Current marker radius
  let champions = []; // All champions data
  let selectedToolbarMarker = null; // Currently selected marker for champion assignment

  // Calculate canvas size to fill the entire viewport
  function getCanvasSize() {
    return {
      width: wrapperEl.clientWidth,
      height: wrapperEl.clientHeight,
    };
  }

  // Load background and initialize canvas
  function init() {
    const img = new Image();

    img.onload = function () {
      const size = getCanvasSize();

      // Create Fabric canvas - fills entire viewport
      canvas = new fabric.Canvas('strategyCanvas', {
        width: size.width,
        height: size.height,
        isDrawingMode: true,
        perPixelTargetFind: true,  // Better hit detection for paths
        targetFindTolerance: 8,     // Increase tolerance for easier clicking
      });

      // Scale map image to fit nicely in viewport (with some padding)
      const imgScale = Math.min(
        (size.width * 0.9) / img.naturalWidth,
        (size.height * 0.9) / img.naturalHeight,
        1
      );

      // Set background - centered in canvas
      bgImage = new fabric.Image(img, {
        left: (size.width - img.naturalWidth * imgScale) / 2,
        top: (size.height - img.naturalHeight * imgScale) / 2,
        scaleX: imgScale,
        scaleY: imgScale,
        selectable: false,
        evented: false,
      });

      canvas.setBackgroundImage(bgImage, canvas.renderAll.bind(canvas));

      // Configure brush
      canvas.freeDrawingBrush.color = '#ef4444';
      canvas.freeDrawingBrush.width = currentBrushSize;

      // Ensure drawn paths are always detectable for erasing
      canvas.on('path:created', function (opt) {
        opt.path.evented = true;
        opt.path.selectable = false;
      });

      // Set up tools
      setupTools();
      setMode('select');

      console.log('Map ready');
    };

    img.onerror = function () {
      console.error('Failed to load:', MAP_IMAGE);
    };

    img.src = MAP_IMAGE;
  }

  function setMode(mode) {
    currentMode = mode;

    // Update button states
    selectBtn.classList.toggle('active', mode === 'select');
    drawBtn.classList.toggle('active', mode === 'draw');
    eraseBtn.classList.toggle('active', mode === 'erase');

    if (mode === 'select') {
      canvas.isDrawingMode = false;
      canvas.selection = true;
      canvas.defaultCursor = 'default';
      canvas.hoverCursor = 'move';
      // Make all objects (except background) selectable
      canvas.forEachObject(obj => {
        if (obj !== bgImage) {
          obj.selectable = true;
          obj.evented = true;
        }
      });
    } else if (mode === 'draw') {
      canvas.isDrawingMode = true;
      canvas.selection = false;
      canvas.freeDrawingBrush.color = '#ef4444';
      canvas.freeDrawingBrush.width = currentBrushSize;
      canvas.defaultCursor = 'crosshair';
      canvas.hoverCursor = 'crosshair';
    } else if (mode === 'erase') {
      canvas.isDrawingMode = false;
      canvas.selection = false;
      canvas.defaultCursor = 'cell';
      canvas.hoverCursor = 'pointer';
      // Make objects detect mouse events but not selectable
      canvas.forEachObject(obj => {
        if (obj !== bgImage) {
          obj.selectable = false;
          obj.evented = true;
        }
      });
    }
  }

  // Erase objects under mouse when in erase mode
  let isErasing = false;

  function eraseObject(target) {
    if (!target || target === bgImage) return;

    // Restore toolbar marker if this is a champion marker
    if (target.isChampionMarker) {
      restoreToolbarMarker(target);
    }
    // If it's a ward, also remove the linked vision circle
    if (target.isWard && target.visionCircle) {
      canvas.remove(target.visionCircle);
    }
    canvas.remove(target);
    canvas.renderAll();
  }

  function setupEraser() {
    canvas.on('mouse:down', function (opt) {
      if (currentMode !== 'erase') return;
      
      isErasing = true;
      
      // Use Fabric's built-in target detection
      if (opt.target && opt.target !== bgImage) {
        eraseObject(opt.target);
      }
    });

    canvas.on('mouse:move', function (opt) {
      if (!isErasing || currentMode !== 'erase') return;
      
      // Erase objects as we drag over them
      if (opt.target && opt.target !== bgImage) {
        eraseObject(opt.target);
      }
    });

    canvas.on('mouse:up', function () {
      isErasing = false;
    });
  }

  function clearDrawings() {
    // Remove all objects except background
    const objects = canvas.getObjects();
    objects.forEach(obj => {
      // Restore toolbar marker if this is a champion marker
      if (obj.isChampionMarker) {
        restoreToolbarMarker(obj);
      }
      canvas.remove(obj);
    });
    canvas.renderAll();
  }

  function recenterMap() {
    // Reset zoom to 1
    canvas.setZoom(1);

    // Reset viewport transform (pan) to center the map
    const size = getCanvasSize();
    const img = bgImage.getElement();

    const imgScale = Math.min(
      (size.width * 0.9) / img.naturalWidth,
      (size.height * 0.9) / img.naturalHeight,
      1
    );

    // Reset viewport to identity (no pan)
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

    // Re-center background image
    bgImage.set({
      left: (size.width - img.naturalWidth * imgScale) / 2,
      top: (size.height - img.naturalHeight * imgScale) / 2,
      scaleX: imgScale,
      scaleY: imgScale,
    });

    canvas.renderAll();
  }

  function setupTools() {
    selectBtn.addEventListener('click', () => setMode('select'));
    drawBtn.addEventListener('click', () => setMode('draw'));
    eraseBtn.addEventListener('click', () => setMode('erase'));
    clearBtn.addEventListener('click', clearDrawings);
    recenterBtn.addEventListener('click', recenterMap);
    
    // Brush size slider
    brushSizeSlider.addEventListener('input', function () {
      currentBrushSize = parseInt(this.value, 10);
      sizeValueDisplay.textContent = currentBrushSize;
      
      // Update brush width if in draw mode
      if (currentMode === 'draw' && canvas.freeDrawingBrush) {
        canvas.freeDrawingBrush.width = currentBrushSize;
      }
    });
    
    setupEraser();
    setupMarkerDragDrop();
    setupWardDragDrop();
    setupMinionDragDrop();
    setupZoom();
    setupPan();
    setupRightPanel();
    setupKeyboardShortcuts();
    setupShortcutsHint();
  }

  // ─────────────────────────────────────────────────────────────
  // Keyboard Shortcuts
  // ─────────────────────────────────────────────────────────────

  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
      // Ignore if user is typing in an input field
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      
      switch (e.key.toLowerCase()) {
        case 'a':
          setMode('select');
          break;
        case 'd':
          setMode('draw');
          break;
        case 'e':
          setMode('erase');
          break;
      }
    });
  }

  function setupShortcutsHint() {
    const shortcutsHint = document.getElementById('shortcutsHint');
    if (!shortcutsHint) return;
    
    // Hide after 1 minute (60000ms)
    setTimeout(() => {
      shortcutsHint.classList.add('hidden');
    }, 60000);
    
    // Also hide on any keyboard shortcut use
    document.addEventListener('keydown', function(e) {
      if (['a', 'd', 'e'].includes(e.key.toLowerCase())) {
        shortcutsHint.classList.add('hidden');
      }
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Right Panel Toggle
  // ─────────────────────────────────────────────────────────────

  function setupRightPanel() {
    hamburgerBtn.addEventListener('click', () => {
      rightPanel.classList.toggle('open');
    });
    
    loadChampions();
    setupChampionSearch();
    setupMarkerSelection();
    setupMarkerSizeControl();
  }

  // ─────────────────────────────────────────────────────────────
  // Marker Size Control
  // ─────────────────────────────────────────────────────────────

  function setupMarkerSizeControl() {
    markerSizeSlider.addEventListener('input', function() {
      markerRadius = parseInt(this.value, 10);
      markerSizeValue.textContent = markerRadius;
      
      // Resize all existing markers on canvas
      resizeAllMarkers();
    });
  }

  function resizeAllMarkers() {
    const objects = canvas.getObjects();
    const BASE_RADIUS = 16;
    const scale = markerRadius / BASE_RADIUS;
    
    objects.forEach(obj => {
      if (obj.isChampionMarker) {
        obj.set('scaleX', scale);
        obj.set('scaleY', scale);
        obj.setCoords(); // Update bounding box
      }
    });
    
    canvas.renderAll();
  }

  // ─────────────────────────────────────────────────────────────
  // Champion Loading & Selection
  // ─────────────────────────────────────────────────────────────

  async function loadChampions() {
    try {
      const response = await fetch(`${DDRAGON_BASE}/data/en_US/champion.json`);
      const data = await response.json();
      
      champions = Object.values(data.data).sort((a, b) => a.name.localeCompare(b.name));
      renderChampionGrid(champions);
    } catch (error) {
      console.error('Failed to load champions:', error);
      championGrid.innerHTML = '<p style="color: #ef4444; font-size: 12px;">Failed to load champions</p>';
    }
  }

  function renderChampionGrid(champList) {
    championGrid.innerHTML = '';
    
    champList.forEach(champ => {
      const iconUrl = `${DDRAGON_BASE}/img/champion/${champ.id}.png`;
      const div = document.createElement('div');
      div.className = 'champion-icon';
      div.style.backgroundImage = `url(${iconUrl})`;
      div.title = champ.name;
      div.dataset.championId = champ.id;
      div.dataset.championName = champ.name;
      
      div.addEventListener('click', () => selectChampionForMarker(champ.id, champ.name, iconUrl));
      
      championGrid.appendChild(div);
    });
  }

  function setupChampionSearch() {
    championSearch.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      
      if (!query) {
        renderChampionGrid(champions);
        return;
      }
      
      const filtered = champions.filter(champ => 
        champ.name.toLowerCase().includes(query) ||
        champ.id.toLowerCase().includes(query)
      );
      
      renderChampionGrid(filtered);
    });
  }

  function setupMarkerSelection() {
    const markers = document.querySelectorAll('.marker');
    const roleIcons = document.querySelectorAll('.role-icon');
    
    // Toolbar marker click
    markers.forEach(marker => {
      marker.addEventListener('click', (e) => {
        // Don't interfere with drag
        if (e.defaultPrevented) return;
        
        // Toggle selection
        if (selectedToolbarMarker === marker) {
          deselectToolbarMarker();
          return;
        }
        
        // Deselect previous
        deselectToolbarMarker();
        
        // Select this marker
        selectedToolbarMarker = marker;
        marker.classList.add('selecting');
        
        // Also highlight corresponding draft slot
        const team = marker.dataset.team;
        const role = marker.dataset.role;
        highlightDraftSlot(team, role);
        
        // Open panel if not open
        if (!rightPanel.classList.contains('open')) {
          rightPanel.classList.add('open');
        }
      });
    });
    
    // Draft slot click
    roleIcons.forEach(icon => {
      icon.addEventListener('click', () => {
        const team = icon.dataset.team;
        const role = icon.dataset.role;
        
        // Find corresponding toolbar marker
        const marker = document.querySelector(`.marker[data-team="${team}"][data-role="${role}"]`);
        
        if (!marker) return;
        
        // Toggle if same
        if (selectedToolbarMarker === marker) {
          deselectToolbarMarker();
          return;
        }
        
        // Deselect previous
        deselectToolbarMarker();
        
        // Select this marker and highlight slot
        selectedToolbarMarker = marker;
        marker.classList.add('selecting');
        icon.classList.add('selecting');
      });
    });
  }

  function highlightDraftSlot(team, role) {
    // Remove all draft slot highlights
    document.querySelectorAll('.role-icon.selecting').forEach(el => {
      el.classList.remove('selecting');
    });
    
    // Highlight matching slot
    const slot = document.querySelector(`.role-icon[data-team="${team}"][data-role="${role}"]`);
    if (slot) {
      slot.classList.add('selecting');
    }
  }

  function deselectToolbarMarker() {
    if (selectedToolbarMarker) {
      selectedToolbarMarker.classList.remove('selecting');
      selectedToolbarMarker = null;
    }
    // Also clear draft slot selections
    document.querySelectorAll('.role-icon.selecting').forEach(el => {
      el.classList.remove('selecting');
    });
  }

  function selectChampionForMarker(champId, champName, iconUrl) {
    if (!selectedToolbarMarker) {
      // No marker selected, just highlight the champion briefly
      return;
    }
    
    // Apply champion to selected toolbar marker
    selectedToolbarMarker.style.backgroundImage = `url(${iconUrl})`;
    selectedToolbarMarker.classList.add('has-champion');
    selectedToolbarMarker.dataset.championId = champId;
    selectedToolbarMarker.dataset.championName = champName;
    selectedToolbarMarker.title = champName;
    
    // Also update the draft slot icon
    const team = selectedToolbarMarker.dataset.team;
    const role = selectedToolbarMarker.dataset.role;
    const draftSlot = document.querySelector(`.role-icon[data-team="${team}"][data-role="${role}"]`);
    if (draftSlot) {
      draftSlot.style.backgroundImage = `url(${iconUrl})`;
      draftSlot.classList.add('has-champion');
      draftSlot.title = champName;
    }
    
    deselectToolbarMarker();
  }

  // ─────────────────────────────────────────────────────────────
  // Zoom with Mouse Wheel
  // ─────────────────────────────────────────────────────────────

  function setupZoom() {
    canvas.on('mouse:wheel', function (opt) {
      const delta = opt.e.deltaY;
      let zoom = canvas.getZoom();

      // Zoom in or out
      if (delta < 0) {
        zoom = Math.min(zoom + ZOOM_CONFIG.step, ZOOM_CONFIG.max);
      } else {
        zoom = Math.max(zoom - ZOOM_CONFIG.step, ZOOM_CONFIG.min);
      }

      // Zoom to mouse pointer position
      const pointer = canvas.getPointer(opt.e, true);
      const point = new fabric.Point(pointer.x, pointer.y);

      canvas.zoomToPoint(point, zoom);

      // Prevent page scroll
      opt.e.preventDefault();
      opt.e.stopPropagation();
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Pan with Middle Mouse Button (Scroll Click)
  // ─────────────────────────────────────────────────────────────

  function setupPan() {
    let isPanning = false;
    let lastPosX = 0;
    let lastPosY = 0;

    const canvasEl = canvas.upperCanvasEl;

    canvasEl.addEventListener('mousedown', function (e) {
      // Middle mouse button = button 1
      if (e.button === 1) {
        isPanning = true;
        lastPosX = e.clientX;
        lastPosY = e.clientY;
        canvas.defaultCursor = 'grabbing';
        canvasEl.style.cursor = 'grabbing';
        e.preventDefault();
      }
    });

    canvasEl.addEventListener('mousemove', function (e) {
      if (!isPanning) return;

      const vpt = canvas.viewportTransform;

      // Calculate delta movement
      const deltaX = e.clientX - lastPosX;
      const deltaY = e.clientY - lastPosY;

      // Update viewport transform (pan)
      vpt[4] += deltaX;
      vpt[5] += deltaY;

      canvas.requestRenderAll();

      lastPosX = e.clientX;
      lastPosY = e.clientY;
    });

    canvasEl.addEventListener('mouseup', function (e) {
      if (e.button === 1 && isPanning) {
        isPanning = false;
        // Restore cursor based on current mode
        if (currentMode === 'select') {
          canvasEl.style.cursor = 'default';
        } else if (currentMode === 'draw') {
          canvasEl.style.cursor = 'crosshair';
        } else if (currentMode === 'erase') {
          canvasEl.style.cursor = 'cell';
        }
      }
    });

    // Also handle mouse leaving canvas while panning
    canvasEl.addEventListener('mouseleave', function () {
      if (isPanning) {
        isPanning = false;
      }
    });

    // Prevent default middle click behavior (auto-scroll)
    canvasEl.addEventListener('auxclick', function (e) {
      if (e.button === 1) {
        e.preventDefault();
      }
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Champion Marker Drag & Drop
  // ─────────────────────────────────────────────────────────────

  function createChampionMarker(x, y, team, toolbarMarker) {
    const colors = {
      blue: { stroke: '#3b82f6', fill: '#1e3a5f' },
      red: { stroke: '#ef4444', fill: '#5f1e1e' },
    };

    const color = colors[team] || colors.blue;
    const championId = toolbarMarker.dataset.championId;
    
    // Base radius for all markers (used for consistent scaling)
    const BASE_RADIUS = 16;
    const currentScale = markerRadius / BASE_RADIUS;
    
    // Common marker properties
    const markerProps = {
      left: x,
      top: y,
      originX: 'center',
      originY: 'center',
      selectable: true,
      evented: true,
      hasControls: false,
      hasBorders: true,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
      scaleX: currentScale,
      scaleY: currentScale,
    };

    const addMarkerToCanvas = (marker) => {
      marker.team = team;
      marker.isChampionMarker = true;
      marker.toolbarMarker = toolbarMarker;
      marker.championId = championId || null;
      marker.baseRadius = BASE_RADIUS;

      canvas.add(marker);
      canvas.bringToFront(marker);
      canvas.renderAll();
    };

    if (championId) {
      // Load champion image and create image marker
      const imgUrl = `${DDRAGON_BASE}/img/champion/${championId}.png`;
      
      // Load the image first
      const imgEl = new Image();
      imgEl.crossOrigin = 'anonymous';
      imgEl.onload = function() {
        // Use high resolution for quality (Data Dragon images are 120x120)
        const hiResSize = 120;
        const hiResRadius = hiResSize / 2;
        
        // Create a high-res pattern canvas
        const patternCanvas = document.createElement('canvas');
        patternCanvas.width = hiResSize;
        patternCanvas.height = hiResSize;
        const ctx = patternCanvas.getContext('2d');
        
        // Enable high quality rendering
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        // Draw circular clipped image at high resolution
        ctx.beginPath();
        ctx.arc(hiResRadius, hiResRadius, hiResRadius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(imgEl, 0, 0, hiResSize, hiResSize);
        
        // Create fabric image from the clipped canvas
        fabric.Image.fromURL(patternCanvas.toDataURL('image/png'), function(clippedImg) {
          // Scale image to base size (32x32 for radius 16)
          const imgScale = (BASE_RADIUS * 2) / hiResSize;
          clippedImg.set({
            originX: 'center',
            originY: 'center',
            scaleX: imgScale,
            scaleY: imgScale,
          });
          
          // Create border ring at base size
          const border = new fabric.Circle({
            radius: BASE_RADIUS + 1,
            fill: 'transparent',
            stroke: color.stroke,
            strokeWidth: 3,
            originX: 'center',
            originY: 'center',
          });

          // Group image and border (at base size, will be scaled by markerProps)
          const group = new fabric.Group([clippedImg, border], {
            ...markerProps,
          });

          addMarkerToCanvas(group);
        });
      };
      imgEl.onerror = function() {
        // Fallback to simple circle if image fails
        const circle = new fabric.Circle({
          ...markerProps,
          radius: BASE_RADIUS,
          fill: color.fill,
          stroke: color.stroke,
          strokeWidth: 3,
        });
        addMarkerToCanvas(circle);
      };
      imgEl.src = imgUrl;
    } else {
      // No champion - create simple colored circle at base size
      const circle = new fabric.Circle({
        ...markerProps,
        radius: BASE_RADIUS,
        fill: color.fill,
        stroke: color.stroke,
        strokeWidth: 3,
      });

      addMarkerToCanvas(circle);
    }
  }

  function restoreToolbarMarker(canvasObject) {
    if (canvasObject.toolbarMarker) {
      canvasObject.toolbarMarker.style.visibility = 'visible';
      canvasObject.toolbarMarker.style.opacity = '1';
      canvasObject.toolbarMarker.draggable = true;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Ward System
  // ─────────────────────────────────────────────────────────────

  const WARD_VISION_RADIUS = 55;

  function createWardMarker(x, y, wardType, toolbarWard) {
    const colors = {
      green: { fill: '#22c55e', stroke: '#16a34a', visionFill: 'rgba(34, 197, 94, 0.15)' },
      pink: { fill: '#ec4899', stroke: '#db2777', visionFill: 'rgba(236, 72, 153, 0.15)' },
    };

    const color = colors[wardType] || colors.green;

    // Vision circle (outer, semi-transparent) - NOT selectable
    const visionCircle = new fabric.Circle({
      left: x,
      top: y,
      radius: WARD_VISION_RADIUS,
      fill: color.visionFill,
      stroke: color.stroke,
      strokeWidth: 1,
      strokeDashArray: [4, 4],
      originX: 'center',
      originY: 'center',
      opacity: 0.6,
      selectable: false,
      evented: false,
    });

    // Ward center circle - this is the selectable part
    const wardCenter = new fabric.Circle({
      left: x,
      top: y,
      radius: 8,
      fill: color.fill,
      stroke: color.stroke,
      strokeWidth: 2,
      originX: 'center',
      originY: 'center',
      selectable: true,
      evented: true,
      hasControls: false,
      hasBorders: false,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
    });

    wardCenter.isWard = true;
    wardCenter.wardType = wardType;
    wardCenter.toolbarWard = toolbarWard;
    wardCenter.visionCircle = visionCircle; // Link vision to center

    // Make vision circle follow the center when moved
    wardCenter.on('moving', function() {
      visionCircle.set({
        left: wardCenter.left,
        top: wardCenter.top,
      });
      visionCircle.setCoords();
    });

    canvas.add(visionCircle);
    canvas.add(wardCenter);
    canvas.sendToBack(visionCircle);
    // Keep background image at the very back
    if (bgImage) {
      canvas.sendToBack(bgImage);
    }
    canvas.renderAll();
  }

  function setupWardDragDrop() {
    const wards = document.querySelectorAll('.ward');
    const canvasEl = canvas.upperCanvasEl;

    let draggedWardType = null;
    let draggedWard = null;

    wards.forEach(ward => {
      ward.addEventListener('dragstart', function (e) {
        draggedWardType = this.dataset.wardType;
        draggedWard = this;
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', 'ward');
      });

      ward.addEventListener('dragend', function () {
        draggedWardType = null;
        draggedWard = null;
      });
    });

    const canvasContainer = canvasEl.parentElement;

    // Store existing handlers and add ward support
    const originalDragOver = canvasContainer.ondragover;
    const originalDrop = canvasContainer.ondrop;

    canvasContainer.addEventListener('dragover', function (e) {
      if (draggedWardType) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });

    canvasContainer.addEventListener('drop', function (e) {
      if (!draggedWardType || !draggedWard) return;

      e.preventDefault();

      const canvasRect = canvasEl.getBoundingClientRect();
      const screenX = e.clientX - canvasRect.left;
      const screenY = e.clientY - canvasRect.top;

      const vpt = canvas.viewportTransform;
      const zoom = canvas.getZoom();

      const canvasX = (screenX - vpt[4]) / zoom;
      const canvasY = (screenY - vpt[5]) / zoom;

      createWardMarker(canvasX, canvasY, draggedWardType, draggedWard);

      draggedWardType = null;
      draggedWard = null;
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Minion System
  // ─────────────────────────────────────────────────────────────

  function createMinionMarker(x, y, team) {
    const imgPath = team === 'blue' ? 'image/BlueWaveMinion.png' : 'image/RedWaveMinion.png';
    const borderColor = team === 'blue' ? '#3b82f6' : '#ef4444';
    const minionSize = 28;

    const imgEl = new Image();
    imgEl.onload = function() {
      // Create high-res square image
      const hiResSize = 64;
      
      const patternCanvas = document.createElement('canvas');
      patternCanvas.width = hiResSize;
      patternCanvas.height = hiResSize;
      const ctx = patternCanvas.getContext('2d');
      
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      
      // Draw square image (no clipping)
      ctx.drawImage(imgEl, 0, 0, hiResSize, hiResSize);
      
      fabric.Image.fromURL(patternCanvas.toDataURL('image/png'), function(minionImg) {
        const imgScale = minionSize / hiResSize;
        minionImg.set({
          originX: 'center',
          originY: 'center',
          scaleX: imgScale,
          scaleY: imgScale,
        });
        
        // Create square border
        const border = new fabric.Rect({
          width: minionSize + 2,
          height: minionSize + 2,
          fill: 'transparent',
          stroke: borderColor,
          strokeWidth: 3,
          originX: 'center',
          originY: 'center',
          rx: 4,
          ry: 4,
        });

        // Group image and border
        const group = new fabric.Group([minionImg, border], {
          left: x,
          top: y,
          originX: 'center',
          originY: 'center',
          selectable: true,
          evented: true,
          hasControls: false,
          hasBorders: true,
          lockScalingX: true,
          lockScalingY: true,
          lockRotation: true,
        });

        group.isMinion = true;
        group.minionTeam = team;

        canvas.add(group);
        canvas.bringToFront(group);
        canvas.renderAll();
      });
    };
    imgEl.src = imgPath;
  }

  function setupMinionDragDrop() {
    const minions = document.querySelectorAll('.minion');
    const canvasEl = canvas.upperCanvasEl;

    let draggedMinionTeam = null;
    let draggedMinion = null;

    minions.forEach(minion => {
      minion.addEventListener('dragstart', function (e) {
        draggedMinionTeam = this.dataset.minionTeam;
        draggedMinion = this;
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', 'minion');
      });

      minion.addEventListener('dragend', function () {
        draggedMinionTeam = null;
        draggedMinion = null;
      });
    });

    const canvasContainer = canvasEl.parentElement;

    canvasContainer.addEventListener('dragover', function (e) {
      if (draggedMinionTeam) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });

    canvasContainer.addEventListener('drop', function (e) {
      if (!draggedMinionTeam || !draggedMinion) return;

      e.preventDefault();

      const canvasRect = canvasEl.getBoundingClientRect();
      const screenX = e.clientX - canvasRect.left;
      const screenY = e.clientY - canvasRect.top;

      const vpt = canvas.viewportTransform;
      const zoom = canvas.getZoom();

      const canvasX = (screenX - vpt[4]) / zoom;
      const canvasY = (screenY - vpt[5]) / zoom;

      createMinionMarker(canvasX, canvasY, draggedMinionTeam);

      draggedMinionTeam = null;
      draggedMinion = null;
    });
  }

  function setupMarkerDragDrop() {
    const markers = document.querySelectorAll('.marker');
    // Use Fabric's upper canvas element for correct positioning
    const canvasEl = canvas.upperCanvasEl;

    let draggedTeam = null;
    let draggedMarker = null;

    markers.forEach(marker => {
      marker.addEventListener('dragstart', function (e) {
        draggedTeam = this.dataset.team;
        draggedMarker = this;
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', draggedTeam);
      });

      marker.addEventListener('dragend', function () {
        draggedTeam = null;
        draggedMarker = null;
      });
    });

    // Allow drop on canvas container
    const canvasContainer = canvasEl.parentElement;

    canvasContainer.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    canvasContainer.addEventListener('drop', function (e) {
      e.preventDefault();

      if (!draggedTeam || !draggedMarker) return;

      // Get canvas position relative to page
      const canvasRect = canvasEl.getBoundingClientRect();
      const screenX = e.clientX - canvasRect.left;
      const screenY = e.clientY - canvasRect.top;

      // Convert screen coordinates to canvas coordinates (accounting for zoom and pan)
      const vpt = canvas.viewportTransform;
      const zoom = canvas.getZoom();
      
      // Inverse transform: subtract pan offset, then divide by zoom
      const canvasX = (screenX - vpt[4]) / zoom;
      const canvasY = (screenY - vpt[5]) / zoom;

      // Hide the toolbar marker
      draggedMarker.style.visibility = 'hidden';
      draggedMarker.style.opacity = '0';
      draggedMarker.draggable = false;

        createChampionMarker(canvasX, canvasY, draggedTeam, draggedMarker);

      draggedTeam = null;
      draggedMarker = null;
    });
  }

  // Handle window resize
  window.addEventListener('resize', function () {
    if (!bgImage || !canvas) return;

    const size = getCanvasSize();
    const img = bgImage.getElement();

    canvas.setDimensions({ width: size.width, height: size.height });

    // Recalculate map scale and center
    const imgScale = Math.min(
      (size.width * 0.9) / img.naturalWidth,
      (size.height * 0.9) / img.naturalHeight,
      1
    );

    bgImage.set({
      left: (size.width - img.naturalWidth * imgScale) / 2,
      top: (size.height - img.naturalHeight * imgScale) / 2,
      scaleX: imgScale,
      scaleY: imgScale,
    });

    canvas.renderAll();
  });

  // Start
  init();

})();

