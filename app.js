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
  const colorPicker = document.getElementById('colorPicker');
  const colorOptions = document.querySelectorAll('.color-option');
  const colorIndicator = document.getElementById('colorIndicator');
  const toggleTowersBtn = document.getElementById('toggleTowersBtn');
  const toggleMonstersBtn = document.getElementById('toggleMonstersBtn');

  // Data Dragon config — version resolved dynamically from server at startup
  let DDRAGON_VERSION = '16.6.1'; // fallback
  let DDRAGON_BASE = `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}`;

  async function initDDragonVersion() {
    try {
      const resp = await fetch('/api/ddragon-version');
      const { version } = await resp.json();
      DDRAGON_VERSION = version;
      DDRAGON_BASE = `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}`;
    } catch { /* keep fallback */ }
  }
  const versionReady = initDDragonVersion();

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
  let currentBrushColor = '#ef4444'; // Default red
  let drawSubMode = 'pen'; // 'pen' or 'arrow'
  let markerRadius = 16; // Current marker radius
  let champions = []; // All champions data
  let selectedToolbarMarker = null; // Currently selected marker for champion assignment
  let towersVisible = true; // Track tower visibility
  let monstersVisible = true; // Track monster (Baron/Elder) visibility

  // Champion image cache (championId → clipped dataURL)
  const championImageCache = {};

  function preloadChampionImage(championId) {
    if (!championId || championImageCache[championId]) return;
    const imgUrl = `${DDRAGON_BASE}/img/champion/${championId}.png`;
    const imgEl = new Image();
    imgEl.crossOrigin = 'anonymous';
    imgEl.onload = function() {
      const hiResSize = 120;
      const hiResRadius = hiResSize / 2;
      const patternCanvas = document.createElement('canvas');
      patternCanvas.width = hiResSize;
      patternCanvas.height = hiResSize;
      const ctx = patternCanvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.beginPath();
      ctx.arc(hiResRadius, hiResRadius, hiResRadius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(imgEl, 0, 0, hiResSize, hiResSize);
      championImageCache[championId] = patternCanvas.toDataURL('image/png');
    };
    imgEl.src = imgUrl;
  }

  // Undo history state
  const MAX_UNDO_HISTORY = 10;
  let undoHistory = [];
  let isUndoing = false; // Flag to prevent saving state during undo operation

  // Reference resolution where tower coordinates were captured
  // This is used to convert absolute coordinates to relative positions
  const REFERENCE_BG_LEFT = 0;
  const REFERENCE_BG_TOP = 0;
  const REFERENCE_BG_SCALE = 1;
  
  // Tower positions relative to the background image
  // These adapt to different screen sizes automatically
  const BLUE_TOWERS = [
    { x: 99, y: 417 },    // Blue 1
    { x: 543, y: 783 },   // Blue 2
    { x: 974, y: 1282 },  // Blue 3
    { x: 149, y: 758 },   // Blue 4
    { x: 472, y: 931 },   // Blue 5
    { x: 645, y: 1239 },  // Blue 6
    { x: 119, y: 974 },   // Blue 7
    { x: 346, y: 1031 },  // Blue 8
    { x: 403, y: 1256 },  // Blue 9
    { x: 172, y: 1165 },  // Blue 10
    { x: 209, y: 1208 },  // Blue 11
  ];
  
  const RED_TOWERS = [
    { x: 406, y: 95 },    // Red 1
    { x: 832, y: 592 },   // Red 2
    { x: 1284, y: 959 },  // Red 3
    { x: 738, y: 142 },   // Red 4
    { x: 908, y: 446 },   // Red 5
    { x: 1234, y: 618 },  // Red 6
    { x: 971, y: 119 },   // Red 7
    { x: 1031, y: 346 },  // Red 8
    { x: 1261, y: 405 },  // Red 9
    { x: 1169, y: 174 },  // Red 10
    { x: 1208, y: 216 },  // Red 11
  ];

  // Objective positions relative to the background image
  const OBJECTIVES = {
    baron: { x: 465, y: 418, image: 'image/BaronNashorico.png' },
    elder: { x: 915, y: 973, image: 'image/ElderDragonico.png' }
  };

  // Jungle camp positions (blue side)
  const JUNGLE_CAMPS = [
    { x: 208, y: 604, image: 'image/Gromp.png', name: 'gromp' },
    { x: 360, y: 651, image: 'image/Blue.png', name: 'blue' },
    { x: 352, y: 786, image: 'image/Wolf.png', name: 'wolf' },
    { x: 650, y: 881, image: 'image/Raptor.png', name: 'raptor' },
    { x: 721, y: 1010, image: 'image/Red.png', name: 'red' },
    { x: 783, y: 1134, image: 'image/Krug.png', name: 'krug' },
    // Red side
    { x: 1167, y: 783, image: 'image/Gromp.png', name: 'gromp' },
    { x: 1023, y: 737, image: 'image/Blue.png', name: 'blue' },
    { x: 1025, y: 607, image: 'image/Wolf.png', name: 'wolf' },
    { x: 730, y: 495, image: 'image/Raptor.png', name: 'raptor' },
    { x: 657, y: 383, image: 'image/Red.png', name: 'red' },
    { x: 600, y: 252, image: 'image/Krug.png', name: 'krug' }
  ];

  // ─────────────────────────────────────────────────────────────
  // Firebase Collaboration System
  // ─────────────────────────────────────────────────────────────

  // Firebase configuration
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCE3kow9B2xhB46RZnRQGXh9SmfjhfBbio",
    authDomain: "strategygg-30ea8.firebaseapp.com",
    databaseURL: "https://strategygg-30ea8-default-rtdb.firebaseio.com",
    projectId: "strategygg-30ea8",
    storageBucket: "strategygg-30ea8.firebasestorage.app",
    messagingSenderId: "1077423109757",
    appId: "1:1077423109757:web:519858fb03fcec20bde314",
    measurementId: "G-M3WPHJLR6E"
  };

  // Collaboration state
  let firebaseApp = null;
  let database = null;
  let roomRef = null;
  let currentRoomId = null;
  let isRemoteUpdate = false; // Prevent sync loops
  let connectedUsers = 0;
  let userId = null;
  let syncDebounceTimer = null;
  const SYNC_DEBOUNCE_MS = 100;
  
  // Champion assignments state: { 'blue_top': 'Ahri', 'red_jg': 'LeeSin', ... }
  let championAssignments = {};

  // Collaboration UI elements
  const collabPanel = document.getElementById('collabPanel');
  const shareBtn = document.getElementById('shareBtn');
  const shareModal = document.getElementById('shareModal');
  const closeShareModal = document.getElementById('closeShareModal');
  const shareLinkInput = document.getElementById('shareLink');
  const copyLinkBtn = document.getElementById('copyLinkBtn');
  const copySuccess = document.getElementById('copySuccess');
  const newRoomBtn = document.getElementById('newRoomBtn');
  const connectionStatus = document.getElementById('connectionStatus');
  const statusText = connectionStatus?.querySelector('.status-text');
  const usersOnline = document.getElementById('usersOnline');
  const userCountEl = document.getElementById('userCount');

  /**
   * Initialize Firebase and collaboration system
   */
  function initCollaboration() {
    if (typeof firebase === 'undefined') {
      console.warn('Firebase SDK not loaded - collaboration disabled');
      if (collabPanel) collabPanel.style.display = 'none';
      return;
    }

    try {
      // Initialize Firebase
      firebaseApp = firebase.initializeApp(FIREBASE_CONFIG);
      database = firebase.database();
      userId = generateUserId();

      // Check for room ID in URL
      const urlParams = new URLSearchParams(window.location.search);
      const roomFromUrl = urlParams.get('room');

      // Validate room ID format (only alphanumeric, 8-16 chars)
      const isValidRoomId = (id) => /^[A-Za-z0-9]{6,16}$/.test(id);

      if (roomFromUrl && isValidRoomId(roomFromUrl)) {
        joinRoom(roomFromUrl);
      } else {
        // Create a new room automatically
        createNewRoom();
      }

      // Setup collaboration UI events
      setupCollaborationUI();

      console.log('Collaboration system initialized');
    } catch (error) {
      console.error('Failed to initialize Firebase:', error);
      setConnectionStatus('offline');
    }
  }

  /**
   * Generate a unique user ID for this session
   */
  function generateUserId() {
    return 'user_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
  }

  /**
   * Generate a random room ID (12 chars for better security)
   */
  function generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let result = '';
    // Use crypto API if available for better randomness
    if (window.crypto && window.crypto.getRandomValues) {
      const array = new Uint32Array(12);
      window.crypto.getRandomValues(array);
      for (let i = 0; i < 12; i++) {
        result += chars.charAt(array[i] % chars.length);
      }
    } else {
      for (let i = 0; i < 12; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    }
    return result;
  }

  /**
   * Create a new collaboration room
   */
  function createNewRoom() {
    const roomId = generateRoomId();
    joinRoom(roomId);
    
    // Update URL without reloading
    const newUrl = `${window.location.pathname}?room=${roomId}`;
    window.history.pushState({ roomId }, '', newUrl);
  }

  /**
   * Join an existing room or create if it doesn't exist
   */
  function joinRoom(roomId) {
    if (roomRef) {
      // Leave current room
      leaveRoom();
    }

    currentRoomId = roomId;
    setConnectionStatus('connecting');

    roomRef = database.ref('rooms/' + roomId);

    // Track presence
    const presenceRef = roomRef.child('presence').child(userId);
    presenceRef.set(true);
    presenceRef.onDisconnect().remove();

    // Listen for presence changes
    roomRef.child('presence').on('value', (snapshot) => {
      const users = snapshot.val();
      connectedUsers = users ? Object.keys(users).length : 1;
      updateUsersOnlineUI();
    });

    // Listen for canvas state changes
    roomRef.child('canvasState').on('value', (snapshot) => {
      const state = snapshot.val();
      if (state && state.lastUpdatedBy !== userId) {
        applyRemoteState(state);
      }
    });

    // Listen for tower states
    roomRef.child('towers').on('value', (snapshot) => {
      const towers = snapshot.val();
      if (towers) {
        applyRemoteTowerStates(towers);
      }
    });

    // Listen for objective states
    roomRef.child('objectives').on('value', (snapshot) => {
      const objectives = snapshot.val();
      if (objectives) {
        applyRemoteObjectiveStates(objectives);
      }
    });

    // Listen for champion assignments
    roomRef.child('championAssignments').on('value', (snapshot) => {
      const assignments = snapshot.val();
      if (assignments) {
        applyRemoteChampionAssignments(assignments);
      } else {
        // No assignments yet, clear local state
        championAssignments = {};
        updateChampionGridAvailability();
      }
    });

    // Connection state
    database.ref('.info/connected').on('value', (snapshot) => {
      if (snapshot.val() === true) {
        setConnectionStatus('online');
      } else {
        setConnectionStatus('offline');
      }
    });

    updateShareLink();
    console.log('Joined room:', roomId);
  }

  /**
   * Leave the current room
   */
  function leaveRoom() {
    if (roomRef) {
      roomRef.child('presence').child(userId).remove();
      roomRef.off();
      roomRef = null;
    }
    currentRoomId = null;
  }

  /**
   * Set connection status UI
   */
  function setConnectionStatus(status) {
    if (!connectionStatus) return;
    
    connectionStatus.className = 'connection-status ' + status;
    
    if (statusText) {
      switch (status) {
        case 'online':
          statusText.textContent = 'Connected';
          break;
        case 'connecting':
          statusText.textContent = 'Connecting...';
          break;
        case 'offline':
          statusText.textContent = 'Offline';
          break;
      }
    }
  }

  /**
   * Update users online UI
   */
  function updateUsersOnlineUI() {
    if (!usersOnline || !userCountEl) return;
    
    if (connectedUsers > 1) {
      usersOnline.style.display = 'flex';
      userCountEl.textContent = connectedUsers;
    } else {
      usersOnline.style.display = 'none';
    }
  }

  /**
   * Update share link input with current room URL
   */
  function updateShareLink() {
    if (!shareLinkInput || !currentRoomId) return;
    
    const shareUrl = `${window.location.origin}${window.location.pathname}?room=${currentRoomId}`;
    shareLinkInput.value = shareUrl;
  }

  /**
   * Setup collaboration UI event listeners
   */
  function setupCollaborationUI() {
    if (shareBtn) {
      shareBtn.addEventListener('click', () => {
        if (shareModal) {
          updateShareLink();
          shareModal.style.display = 'flex';
        }
      });
    }

    if (closeShareModal) {
      closeShareModal.addEventListener('click', () => {
        if (shareModal) shareModal.style.display = 'none';
      });
    }

    if (shareModal) {
      shareModal.addEventListener('click', (e) => {
        if (e.target === shareModal) {
          shareModal.style.display = 'none';
        }
      });
    }

    if (copyLinkBtn) {
      copyLinkBtn.addEventListener('click', () => {
        if (shareLinkInput) {
          shareLinkInput.select();
          navigator.clipboard.writeText(shareLinkInput.value).then(() => {
            if (copySuccess) {
              copySuccess.style.display = 'block';
              setTimeout(() => {
                copySuccess.style.display = 'none';
              }, 2000);
            }
          });
        }
      });
    }

    if (newRoomBtn) {
      newRoomBtn.addEventListener('click', () => {
        createNewRoom();
        if (shareModal) shareModal.style.display = 'none';
        // Clear canvas and reset
        if (canvas) {
          clearDrawings();
          resetAllTowers();
          resetAllObjectives();
          resetChampionAssignments();
        }
      });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Coordinate Normalization (for cross-resolution sync)
  // ─────────────────────────────────────────────────────────────

  /**
   * Convert canvas absolute coordinates to normalized (0-1) coordinates
   * relative to the background image
   */
  function toNormalizedCoords(canvasX, canvasY) {
    if (!bgImage) return { x: 0, y: 0 };
    
    const bgLeft = bgImage.left;
    const bgTop = bgImage.top;
    const bgWidth = bgImage.width * bgImage.scaleX;
    const bgHeight = bgImage.height * bgImage.scaleY;
    
    return {
      x: (canvasX - bgLeft) / bgWidth,
      y: (canvasY - bgTop) / bgHeight
    };
  }

  /**
   * Convert normalized (0-1) coordinates back to canvas absolute coordinates
   */
  function fromNormalizedCoords(normX, normY) {
    if (!bgImage) return { x: 0, y: 0 };
    
    const bgLeft = bgImage.left;
    const bgTop = bgImage.top;
    const bgWidth = bgImage.width * bgImage.scaleX;
    const bgHeight = bgImage.height * bgImage.scaleY;
    
    return {
      x: bgLeft + (normX * bgWidth),
      y: bgTop + (normY * bgHeight)
    };
  }

  /**
   * Normalize a path's points for cross-resolution sync
   */
  function normalizePathData(pathArray) {
    if (!bgImage || !pathArray) return pathArray;
    
    return pathArray.map(cmd => {
      if (!Array.isArray(cmd)) return cmd;
      
      const newCmd = [cmd[0]]; // Keep the command letter (M, L, Q, C, etc.)
      
      // Process pairs of coordinates
      for (let i = 1; i < cmd.length; i += 2) {
        if (i + 1 < cmd.length) {
          const norm = toNormalizedCoords(cmd[i], cmd[i + 1]);
          newCmd.push(norm.x, norm.y);
        } else {
          newCmd.push(cmd[i]); // Odd remaining value
        }
      }
      
      return newCmd;
    });
  }

  /**
   * Denormalize a path's points from normalized to canvas coordinates
   */
  function denormalizePathData(pathArray) {
    if (!bgImage || !pathArray) return pathArray;
    
    return pathArray.map(cmd => {
      if (!Array.isArray(cmd)) return cmd;
      
      const newCmd = [cmd[0]]; // Keep the command letter
      
      // Process pairs of coordinates
      for (let i = 1; i < cmd.length; i += 2) {
        if (i + 1 < cmd.length) {
          const abs = fromNormalizedCoords(cmd[i], cmd[i + 1]);
          newCmd.push(abs.x, abs.y);
        } else {
          newCmd.push(cmd[i]); // Odd remaining value
        }
      }
      
      return newCmd;
    });
  }

  /**
   * Serialize canvas state for syncing
   * Coordinates are normalized (0-1) relative to background image for cross-resolution support
   */
  function serializeCanvasState() {
    if (!canvas || !bgImage) return null;

    const objects = canvas.getObjects().filter(obj => {
      // Only sync user-created objects (not towers, objectives, or background)
      return !obj.isTower && !obj.isObjective && obj !== bgImage;
    });

    const serialized = objects.map(obj => {
      // Normalize position relative to background image
      const normPos = toNormalizedCoords(obj.left, obj.top);
      
      const base = {
        type: obj.type,
        // Use normalized coordinates
        normX: normPos.x,
        normY: normPos.y,
        scaleX: obj.scaleX,
        scaleY: obj.scaleY,
        angle: obj.angle || 0,
      };

      if (obj.type === 'path') {
        // Normalize path data
        base.path = normalizePathData(obj.path);
        base.stroke = obj.stroke;
        base.strokeWidth = obj.strokeWidth;
        base.fill = obj.fill;
      } else if (obj.type === 'group') {
        if (obj.isChampionMarker) {
          base.isChampionMarker = true;
          base.championId = obj.championId;
          base.team = obj.team;
          base.baseRadius = obj.baseRadius;
        } else if (obj.isMinion) {
          base.isMinion = true;
          base.minionTeam = obj.minionTeam;
        } else if (obj.isWard) {
          base.isWard = true;
          base.wardType = obj.wardType;
        } else if (obj.isArrow) {
          base.isArrow = true;
          // For arrows, store the normalized path data
          const arrowObjs = obj.getObjects();
          if (arrowObjs.length > 0 && arrowObjs[0].path) {
            base.arrowPath = normalizePathData(arrowObjs[0].path);
            base.arrowStroke = arrowObjs[0].stroke;
            base.arrowStrokeWidth = arrowObjs[0].strokeWidth;
          }
        }
      } else if (obj.type === 'circle') {
        if (obj.isChampionMarker) {
          base.isChampionMarker = true;
          base.team = obj.team;
          base.fill = obj.fill;
          base.stroke = obj.stroke;
          base.strokeWidth = obj.strokeWidth;
          base.radius = obj.radius;
        }
      }

      return base;
    });

    return {
      objects: serialized,
      timestamp: Date.now(),
      lastUpdatedBy: userId
    };
  }

  /**
   * Debounced sync to Firebase
   */
  function syncCanvasToFirebase() {
    if (!roomRef || isRemoteUpdate) return;

    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(() => {
      const state = serializeCanvasState();
      if (state) {
        roomRef.child('canvasState').set(state);
      }
    }, SYNC_DEBOUNCE_MS);
  }

  /**
   * Sync tower state to Firebase
   */
  function syncTowerState(towerIndex, team, isDestroyed) {
    if (!roomRef || isRemoteUpdate) return;
    
    const key = `${team}_${towerIndex}`;
    roomRef.child('towers').child(key).set({
      isDestroyed,
      timestamp: Date.now(),
      updatedBy: userId
    });
  }

  /**
   * Sync objective state to Firebase
   */
  function syncObjectiveState(objectiveType, isDestroyed) {
    if (!roomRef || isRemoteUpdate) return;
    
    roomRef.child('objectives').child(objectiveType).set({
      isDestroyed,
      timestamp: Date.now(),
      updatedBy: userId
    });
  }

  /**
   * Apply remote canvas state
   */
  function applyRemoteState(state) {
    if (!canvas || !state || !state.objects) return;
    
    isRemoteUpdate = true;

    // Clear current user objects (keep towers, objectives)
    const toRemove = canvas.getObjects().filter(obj => 
      !obj.isTower && !obj.isObjective && obj !== bgImage
    );
    toRemove.forEach(obj => {
      if (obj.isChampionMarker) {
        restoreToolbarMarker(obj);
      }
      canvas.remove(obj);
    });

    // Recreate objects from state
    state.objects.forEach(objData => {
      recreateObject(objData);
    });

    canvas.renderAll();
    isRemoteUpdate = false;
  }

  /**
   * Recreate a canvas object from serialized data
   * Converts normalized coordinates back to absolute canvas coordinates
   */
  function recreateObject(objData) {
    if (!objData || !bgImage) return;

    // Convert normalized coordinates to absolute
    const absPos = fromNormalizedCoords(objData.normX || 0, objData.normY || 0);

    if (objData.type === 'path') {
      // Denormalize path data - the path coordinates are already absolute after denormalization
      const denormalizedPath = denormalizePathData(objData.path);
      const path = new fabric.Path(denormalizedPath, {
        stroke: objData.stroke,
        strokeWidth: objData.strokeWidth,
        fill: objData.fill || 'transparent',
        selectable: false,
        evented: true
      });
      canvas.add(path);
    } else if (objData.isChampionMarker) {
      // Recreate champion marker with converted coordinates
      createChampionMarkerFromData({
        ...objData,
        left: absPos.x,
        top: absPos.y
      });
    } else if (objData.isMinion) {
      createMinionMarker(absPos.x, absPos.y, objData.minionTeam);
    } else if (objData.isWard) {
      createWardFromData({
        ...objData,
        left: absPos.x,
        top: absPos.y
      });
    } else if (objData.isArrow && objData.arrowPath) {
      // Recreate arrow from normalized path
      const denormalizedPath = denormalizePathData(objData.arrowPath);
      recreateArrowFromPath(denormalizedPath, objData.arrowStroke, objData.arrowStrokeWidth);
    }
  }

  /**
   * Recreate an arrow from denormalized path data
   */
  function recreateArrowFromPath(pathData, stroke, strokeWidth) {
    if (!pathData || pathData.length < 2) return;
    
    // Extract points from path
    const points = [];
    pathData.forEach(cmd => {
      if (Array.isArray(cmd) && cmd.length >= 3) {
        // Get the last coordinate pair in each command
        const x = cmd[cmd.length - 2];
        const y = cmd[cmd.length - 1];
        if (typeof x === 'number' && typeof y === 'number') {
          points.push({ x, y });
        }
      }
    });
    
    if (points.length < 2) return;

    // Build path string
    let pathStr = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      pathStr += ` L ${points[i].x} ${points[i].y}`;
    }

    const pathObj = new fabric.Path(pathStr, {
      fill: 'transparent',
      stroke: stroke || currentBrushColor,
      strokeWidth: strokeWidth || currentBrushSize,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
      selectable: false,
      evented: false,
    });

    // Add arrowhead
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
    const headLen = Math.max(10, (strokeWidth || currentBrushSize) * 4);
    const headAngle = Math.PI / 6;

    const x1 = last.x - headLen * Math.cos(angle - headAngle);
    const y1 = last.y - headLen * Math.sin(angle - headAngle);
    const x2 = last.x - headLen * Math.cos(angle + headAngle);
    const y2 = last.y - headLen * Math.sin(angle + headAngle);

    const headPath = new fabric.Path(
      `M ${x1} ${y1} L ${last.x} ${last.y} L ${x2} ${y2}`,
      {
        fill: 'transparent',
        stroke: stroke || currentBrushColor,
        strokeWidth: strokeWidth || currentBrushSize,
        strokeLineCap: 'round',
        strokeLineJoin: 'round',
        selectable: false,
        evented: false,
      }
    );

    const group = new fabric.Group([pathObj, headPath], {
      selectable: false,
      evented: true,
    });
    group.isArrow = true;

    canvas.add(group);
  }

  /**
   * Create champion marker from sync data
   */
  function createChampionMarkerFromData(data) {
    const colors = {
      blue: { stroke: '#3b82f6', fill: '#1e3a5f' },
      red: { stroke: '#ef4444', fill: '#5f1e1e' },
    };
    const color = colors[data.team] || colors.blue;
    const BASE_RADIUS = data.baseRadius || 16;

    const markerProps = {
      left: data.left,
      top: data.top,
      originX: 'center',
      originY: 'center',
      selectable: true,
      evented: true,
      hasControls: false,
      hasBorders: true,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
      scaleX: data.scaleX || 1,
      scaleY: data.scaleY || 1,
    };

    const addMarker = (marker) => {
      marker.team = data.team;
      marker.isChampionMarker = true;
      marker.championId = data.championId || null;
      marker.baseRadius = BASE_RADIUS;
      marker.isRemoteMarker = true; // Mark as remote so we don't hide toolbar markers
      canvas.add(marker);
    };

    if (data.championId && championImageCache[data.championId]) {
      fabric.Image.fromURL(championImageCache[data.championId], function(clippedImg) {
        const imgScale = (BASE_RADIUS * 2) / 120;
        clippedImg.set({
          originX: 'center',
          originY: 'center',
          scaleX: imgScale,
          scaleY: imgScale,
        });
        const border = new fabric.Circle({
          radius: BASE_RADIUS + 1,
          fill: 'transparent',
          stroke: color.stroke,
          strokeWidth: 3,
          originX: 'center',
          originY: 'center',
        });
        const group = new fabric.Group([clippedImg, border], markerProps);
        addMarker(group);
      });
    } else {
      const circle = new fabric.Circle({
        ...markerProps,
        radius: BASE_RADIUS,
        fill: color.fill,
        stroke: color.stroke,
        strokeWidth: 3,
      });
      addMarker(circle);
    }
  }

  /**
   * Create ward from sync data
   */
  function createWardFromData(data) {
    const wardType = data.wardType || 'green';
    const radius = 6;
    const wardColor = wardType === 'green' ? '#22c55e' : '#ec4899';
    
    const ward = new fabric.Circle({
      left: data.left,
      top: data.top,
      radius: radius,
      fill: wardColor,
      stroke: '#ffffff',
      strokeWidth: 2,
      originX: 'center',
      originY: 'center',
      selectable: true,
      evented: true,
      scaleX: data.scaleX || 1,
      scaleY: data.scaleY || 1,
    });
    
    ward.isWard = true;
    ward.wardType = wardType;
    canvas.add(ward);
  }

  /**
   * Apply remote tower states
   */
  function applyRemoteTowerStates(towers) {
    if (!canvas) return;
    
    isRemoteUpdate = true;
    
    canvas.getObjects().forEach(obj => {
      if (obj.isTower) {
        const key = `${obj.towerTeam}_${obj.towerIndex}`;
        const towerState = towers[key];
        
        if (towerState && towerState.updatedBy !== userId) {
          obj.isDestroyed = towerState.isDestroyed;
          const objects = obj.getObjects();
          const redX = objects[2];
          if (redX) {
            redX.set('visible', obj.isDestroyed);
          }
        }
      }
    });
    
    canvas.renderAll();
    isRemoteUpdate = false;
  }

  /**
   * Apply remote objective states
   */
  function applyRemoteObjectiveStates(objectives) {
    if (!canvas) return;
    
    isRemoteUpdate = true;
    
    canvas.getObjects().forEach(obj => {
      if (obj.isObjective) {
        const objState = objectives[obj.objectiveType];
        
        if (objState && objState.updatedBy !== userId) {
          obj.isDestroyed = objState.isDestroyed;
          const objects = obj.getObjects();
          const redX = objects[2];
          if (redX) {
            redX.set('visible', obj.isDestroyed);
          }
        }
      }
    });
    
    canvas.renderAll();
    isRemoteUpdate = false;
  }

  /**
   * Reset all towers (for new room)
   */
  function resetAllTowers() {
    if (!canvas) return;
    
    canvas.getObjects().forEach(obj => {
      if (obj.isTower) {
        obj.isDestroyed = false;
        const objects = obj.getObjects();
        const redX = objects[2];
        if (redX) {
          redX.set('visible', false);
        }
      }
    });
    
    canvas.renderAll();
  }

  /**
   * Reset all objectives (for new room)
   */
  function resetAllObjectives() {
    if (!canvas) return;
    
    canvas.getObjects().forEach(obj => {
      if (obj.isObjective) {
        obj.isDestroyed = false;
        const objects = obj.getObjects();
        const redX = objects[2];
        if (redX) {
          redX.set('visible', false);
        }
      }
    });
    
    canvas.renderAll();
  }

  /**
   * Sync champion assignment to Firebase
   */
  function syncChampionAssignment(team, role, championId) {
    if (!roomRef || isRemoteUpdate) return;
    
    const key = `${team}_${role}`;
    
    if (championId) {
      roomRef.child('championAssignments').child(key).set({
        championId,
        timestamp: Date.now(),
        updatedBy: userId
      });
    } else {
      // Remove assignment
      roomRef.child('championAssignments').child(key).remove();
    }
  }

  /**
   * Apply remote champion assignments
   */
  function applyRemoteChampionAssignments(assignments) {
    isRemoteUpdate = true;
    
    // Build new assignments map
    const newAssignments = {};
    
    Object.keys(assignments).forEach(key => {
      const data = assignments[key];
      if (data && data.championId) {
        newAssignments[key] = data.championId;
        
        // Apply to UI if not from this user
        if (data.updatedBy !== userId) {
          const [team, role] = key.split('_');
          applyChampionToMarkerUI(team, role, data.championId);
        }
      }
    });
    
    championAssignments = newAssignments;
    updateChampionGridAvailability();
    
    isRemoteUpdate = false;
  }

  /**
   * Apply champion to marker UI elements (toolbar + draft slot)
   */
  function applyChampionToMarkerUI(team, role, championId) {
    const iconUrl = `${DDRAGON_BASE}/img/champion/${championId}.png`;
    const champData = champions.find(c => c.id === championId);
    const champName = champData ? champData.name : championId;
    
    // Update toolbar marker
    const marker = document.querySelector(`.marker[data-team="${team}"][data-role="${role}"]`);
    if (marker) {
      marker.style.backgroundImage = `url(${iconUrl})`;
      marker.classList.add('has-champion');
      marker.dataset.championId = championId;
      marker.dataset.championName = champName;
      marker.title = champName;
    }
    
    // Update draft slot
    const draftSlot = document.querySelector(`.role-icon[data-team="${team}"][data-role="${role}"]`);
    if (draftSlot) {
      draftSlot.style.backgroundImage = `url(${iconUrl})`;
      draftSlot.classList.add('has-champion');
      draftSlot.title = champName;
    }
    
    // Preload champion image for canvas
    preloadChampionImage(championId);
  }

  /**
   * Check if a champion is already assigned to any marker
   */
  function isChampionAssigned(championId) {
    return Object.values(championAssignments).includes(championId);
  }

  /**
   * Get which marker a champion is assigned to
   */
  function getChampionAssignment(championId) {
    for (const [key, champId] of Object.entries(championAssignments)) {
      if (champId === championId) {
        return key; // e.g., 'blue_top'
      }
    }
    return null;
  }

  /**
   * Update champion grid to show which champions are taken
   */
  function updateChampionGridAvailability() {
    if (!championGrid) return;
    
    const icons = championGrid.querySelectorAll('.champion-icon');
    icons.forEach(icon => {
      const champId = icon.dataset.championId;
      const assignment = getChampionAssignment(champId);
      
      if (assignment) {
        icon.classList.add('taken');
        const [team, role] = assignment.split('_');
        icon.dataset.assignedTo = `${team.toUpperCase()} ${role.toUpperCase()}`;
      } else {
        icon.classList.remove('taken');
        delete icon.dataset.assignedTo;
      }
    });
  }

  /**
   * Reset all champion assignments (for new room)
   */
  function resetChampionAssignments() {
    championAssignments = {};
    
    // Clear UI
    document.querySelectorAll('.marker.has-champion').forEach(marker => {
      marker.style.backgroundImage = '';
      marker.classList.remove('has-champion');
      delete marker.dataset.championId;
      delete marker.dataset.championName;
      marker.title = marker.dataset.team + ' ' + marker.dataset.role;
    });
    
    document.querySelectorAll('.role-icon.has-champion').forEach(slot => {
      slot.style.backgroundImage = '';
      slot.classList.remove('has-champion');
      slot.title = '';
    });
    
    updateChampionGridAvailability();
  }

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

      canvas.setBackgroundImage(bgImage, function() {
        canvas.renderAll();
        
        // Create static towers on the map after background is set
        createStaticTowers();
        
        // Create objective markers (Baron, Elder)
        createObjectiveMarkers();
      });

      // Configure brush
      canvas.freeDrawingBrush.color = '#ef4444';
      canvas.freeDrawingBrush.width = currentBrushSize;

      // Ensure drawn paths are always detectable for erasing and save for undo
      canvas.on('path:created', function (opt) {
        opt.path.evented = true;
        opt.path.selectable = false;
        // Save the path for undo (undo will remove it)
        saveStateForAdd(opt.path);
        // Sync to Firebase
        syncCanvasToFirebase();
      });

      // Sync on object modifications
      canvas.on('object:modified', function () {
        syncCanvasToFirebase();
      });

      canvas.on('object:removed', function () {
        if (!isRemoteUpdate) {
          syncCanvasToFirebase();
        }
      });

      // Set up tools
      setupTools();
      setMode('select');
      
      // Initialize color indicator
      if (colorIndicator) {
        colorIndicator.style.background = currentBrushColor;
      }

      // Initialize collaboration after canvas is ready
      initCollaboration();

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
      // Make all objects (except background, towers, and objectives) selectable
      canvas.forEachObject(obj => {
        if (obj !== bgImage && !obj.isTower && !obj.isObjective) {
          obj.selectable = true;
          obj.evented = true;
        }
      });
    } else if (mode === 'draw') {
      canvas.selection = false;
      canvas.defaultCursor = 'crosshair';
      canvas.hoverCursor = 'crosshair';
      if (drawSubMode === 'arrow') {
        canvas.isDrawingMode = false;
        // Disable object interaction so markers/toggles can't be clicked
        canvas.forEachObject(obj => {
          if (obj !== bgImage) {
            obj.selectable = false;
            obj.evented = false;
          }
        });
      } else {
        canvas.isDrawingMode = true;
        canvas.freeDrawingBrush.color = currentBrushColor;
        canvas.freeDrawingBrush.width = currentBrushSize;
      }
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
  let erasedObjectsInStroke = []; // Collect all erased objects in current stroke

  function eraseObject(target) {
    if (!target || target === bgImage) return;
    
    // Don't erase static elements (towers, objectives)
    if (target.isTower || target.isObjective) return;

    // Collect erased object for undo
    erasedObjectsInStroke.push(target);
    
    // If it's a ward, also collect the vision circle
    if (target.isWard && target.visionCircle) {
      erasedObjectsInStroke.push(target.visionCircle);
      canvas.remove(target.visionCircle);
    }

    // Restore toolbar marker if this is a champion marker
    if (target.isChampionMarker) {
      restoreToolbarMarker(target);
    }
    
    canvas.remove(target);
    canvas.renderAll();
  }

  function setupEraser() {
    canvas.on('mouse:down', function (opt) {
      if (currentMode !== 'erase') return;
      
      isErasing = true;
      erasedObjectsInStroke = []; // Reset for new stroke
      
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
      if (isErasing && erasedObjectsInStroke.length > 0) {
        // Save all erased objects for undo (undo will add them back)
        saveStateForRemove(erasedObjectsInStroke);
        // Sync to Firebase
        syncCanvasToFirebase();
      }
      isErasing = false;
      erasedObjectsInStroke = [];
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Arrow Drawing Tool
  // ─────────────────────────────────────────────────────────────

  let isDrawingArrow = false;
  let arrowPoints = [];
  let arrowPreviewLine = null;

  function setupArrowDrawing() {
    canvas.on('mouse:down', function (opt) {
      if (currentMode !== 'draw' || drawSubMode !== 'arrow') return;
      if (opt.e.button !== 0) return; // left click only

      isDrawingArrow = true;
      const pointer = canvas.getPointer(opt.e);
      arrowPoints = [{ x: pointer.x, y: pointer.y }];

      // Remove any existing preview
      if (arrowPreviewLine) {
        canvas.remove(arrowPreviewLine);
        arrowPreviewLine = null;
      }
    });

    canvas.on('mouse:move', function (opt) {
      if (!isDrawingArrow || currentMode !== 'draw' || drawSubMode !== 'arrow') return;

      const pointer = canvas.getPointer(opt.e);
      const last = arrowPoints[arrowPoints.length - 1];
      const dx = pointer.x - last.x;
      const dy = pointer.y - last.y;
      // Only add point if moved enough (skip tiny jitter)
      if (dx * dx + dy * dy > 9) {
        arrowPoints.push({ x: pointer.x, y: pointer.y });
      }

      // Update live preview
      if (arrowPreviewLine) {
        canvas.remove(arrowPreviewLine);
      }
      if (arrowPoints.length >= 2) {
        arrowPreviewLine = buildArrowPath(arrowPoints, false);
        if (arrowPreviewLine) {
          arrowPreviewLine.selectable = false;
          arrowPreviewLine.evented = false;
          canvas.add(arrowPreviewLine);
          canvas.renderAll();
        }
      }
    });

    canvas.on('mouse:up', function () {
      if (!isDrawingArrow) return;
      isDrawingArrow = false;

      // Remove preview
      if (arrowPreviewLine) {
        canvas.remove(arrowPreviewLine);
        arrowPreviewLine = null;
      }

      if (arrowPoints.length < 2) {
        arrowPoints = [];
        return;
      }

      // Simplify path to reduce jaggedness
      const simplified = simplifyPoints(arrowPoints, 2);

      // Build final arrow with arrowhead
      const arrow = buildArrowPath(simplified, true);
      if (arrow) {
        arrow.selectable = false;
        arrow.evented = true;
        arrow.isArrow = true;
        canvas.add(arrow);
        canvas.renderAll();
        saveStateForAdd(arrow);
        // Sync to Firebase
        syncCanvasToFirebase();
      }

      arrowPoints = [];
    });
  }

  /**
   * Simplify points using Ramer-Douglas-Peucker algorithm
   */
  function simplifyPoints(points, tolerance) {
    if (points.length <= 2) return points;

    // Find the point with the maximum distance from the line between first and last
    let maxDist = 0;
    let maxIdx = 0;
    const first = points[0];
    const last = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
      const d = perpendicularDist(points[i], first, last);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }

    if (maxDist > tolerance) {
      const left = simplifyPoints(points.slice(0, maxIdx + 1), tolerance);
      const right = simplifyPoints(points.slice(maxIdx), tolerance);
      return left.slice(0, -1).concat(right);
    }
    return [first, last];
  }

  function perpendicularDist(point, lineStart, lineEnd) {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);
    const t = Math.max(0, Math.min(1, ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lenSq));
    const projX = lineStart.x + t * dx;
    const projY = lineStart.y + t * dy;
    return Math.hypot(point.x - projX, point.y - projY);
  }

  /**
   * Build a fabric Group containing the curved path and optional arrowhead
   */
  function buildArrowPath(points, withHead) {
    if (points.length < 2) return null;

    // Build SVG path string with smooth quadratic curves
    let pathStr = `M ${points[0].x} ${points[0].y}`;

    if (points.length === 2) {
      pathStr += ` L ${points[1].x} ${points[1].y}`;
    } else {
      // Use quadratic bezier through midpoints for smooth curves
      for (let i = 0; i < points.length - 1; i++) {
        const curr = points[i];
        const next = points[i + 1];
        if (i === 0) {
          const midX = (curr.x + next.x) / 2;
          const midY = (curr.y + next.y) / 2;
          pathStr += ` L ${midX} ${midY}`;
        } else if (i === points.length - 2) {
          pathStr += ` Q ${curr.x} ${curr.y} ${next.x} ${next.y}`;
        } else {
          const midX = (curr.x + next.x) / 2;
          const midY = (curr.y + next.y) / 2;
          pathStr += ` Q ${curr.x} ${curr.y} ${midX} ${midY}`;
        }
      }
    }

    const strokeW = currentBrushSize;

    const pathObj = new fabric.Path(pathStr, {
      fill: 'transparent',
      stroke: currentBrushColor,
      strokeWidth: strokeW,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
      selectable: false,
      evented: false,
      originX: 'center',
      originY: 'center',
    });

    if (!withHead) return pathObj;

    // Compute arrowhead at the end
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
    const headLen = Math.max(10, strokeW * 4);
    const headAngle = Math.PI / 6; // 30 degrees

    const x1 = last.x - headLen * Math.cos(angle - headAngle);
    const y1 = last.y - headLen * Math.sin(angle - headAngle);
    const x2 = last.x - headLen * Math.cos(angle + headAngle);
    const y2 = last.y - headLen * Math.sin(angle + headAngle);

    const headPath = new fabric.Path(
      `M ${x1} ${y1} L ${last.x} ${last.y} L ${x2} ${y2}`,
      {
        fill: 'transparent',
        stroke: currentBrushColor,
        strokeWidth: strokeW,
        strokeLineCap: 'round',
        strokeLineJoin: 'round',
        selectable: false,
        evented: false,
        originX: 'center',
        originY: 'center',
      }
    );

    const group = new fabric.Group([pathObj, headPath], {
      selectable: false,
      evented: true,
      originX: 'center',
      originY: 'center',
    });

    return group;
  }

  function clearDrawings() {
    // Collect all objects to be removed (for undo)
    const objectsToRemove = canvas.getObjects().filter(obj => {
      return !obj.isTower && !obj.isObjective;
    });
    
    if (objectsToRemove.length === 0) return;

    // Save for undo before removing
    saveStateForRemove(objectsToRemove);

    // Remove all objects except static elements
    objectsToRemove.forEach(obj => {
      // Restore toolbar marker if this is a champion marker
      if (obj.isChampionMarker) {
        restoreToolbarMarker(obj);
      }
      canvas.remove(obj);
    });
    canvas.renderAll();
    
    // Sync to Firebase
    syncCanvasToFirebase();
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
    selectBtn.addEventListener('click', () => {
      hideColorPicker();
      setMode('select');
    });
    
    // Draw button: toggle color picker if already in draw mode
    drawBtn.addEventListener('click', () => {
      if (currentMode === 'draw') {
        toggleColorPicker();
      } else {
        hideColorPicker();
        setMode('draw');
      }
    });
    
    eraseBtn.addEventListener('click', () => {
      hideColorPicker();
      setMode('erase');
    });
    clearBtn.addEventListener('click', clearDrawings);
    recenterBtn.addEventListener('click', recenterMap);
    
    // Color picker options
    colorOptions.forEach(option => {
      const color = option.getAttribute('data-color');
      // Set initial selected state
      if (color === currentBrushColor) {
        option.classList.add('selected');
      }
      
      option.addEventListener('click', (e) => {
        e.stopPropagation();
        setBrushColor(color);
        hideColorPicker();
      });
    });
    
    // Close color picker when clicking elsewhere
    document.addEventListener('click', (e) => {
      if (!colorPicker.contains(e.target) && e.target !== drawBtn && !drawBtn.contains(e.target)) {
        hideColorPicker();
      }
    });

    // Draw sub-mode toggle (pen / arrow)
    document.querySelectorAll('.draw-mode-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        setDrawSubMode(btn.dataset.submode);
      });
    });
    
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
    setupArrowDrawing();
    setupMarkerDragDrop();
    setupWardDragDrop();
    setupMinionDragDrop();
    setupTowerClickToggle();
    setupTowerVisibilityToggle();
    setupMonstersVisibilityToggle();
    setupZoom();
    setupPan();
    setupRightPanel();
    setupKeyboardShortcuts();
    setupShortcutsHint();
  }
  
  // ─────────────────────────────────────────────────────────────
  // Color Picker Functions
  // ─────────────────────────────────────────────────────────────
  
  function toggleColorPicker() {
    const isVisible = colorPicker.classList.toggle('visible');
    
    if (isVisible) {
      // Position the color picker next to the draw button
      const btnRect = drawBtn.getBoundingClientRect();
      colorPicker.style.left = (btnRect.right + 8) + 'px';
      colorPicker.style.top = btnRect.top + 'px';
    }
  }
  
  function hideColorPicker() {
    colorPicker.classList.remove('visible');
  }
  
  function setBrushColor(color) {
    currentBrushColor = color;
    
    // Update selected state on color options
    colorOptions.forEach(option => {
      option.classList.toggle('selected', option.getAttribute('data-color') === color);
    });
    
    // Update color indicator
    if (colorIndicator) {
      colorIndicator.style.background = color;
    }
    
    // Update brush color if in draw mode
    if (currentMode === 'draw' && canvas.freeDrawingBrush) {
      canvas.freeDrawingBrush.color = color;
    }
  }

  function setDrawSubMode(subMode) {
    drawSubMode = subMode;
    document.querySelectorAll('.draw-mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.submode === subMode);
    });
    // Update the draw button icon to match selected sub-mode
    const penIcon = document.getElementById('drawBtnIconPen');
    const arrowIcon = document.getElementById('drawBtnIconArrow');
    if (penIcon && arrowIcon) {
      penIcon.classList.toggle('active', subMode === 'pen');
      arrowIcon.classList.toggle('active', subMode === 'arrow');
    }
    if (currentMode === 'draw') {
      setMode('draw');
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Undo System (Action-based)
  // ─────────────────────────────────────────────────────────────

  // Helper to check if an object is a static element (tower or objective)
  function isStaticElement(obj) {
    return obj.isTower || obj.isObjective;
  }

  // Store actions that can be undone
  // Each action: { type: 'add'|'remove'|'draw', objects: [...], toolbarInfo: [...] }
  
  function saveStateForAdd(objectsToAdd) {
    if (isUndoing || !canvas) return;
    
    // When adding objects, save an action that can be undone by removing them
    const action = {
      type: 'add',
      objects: Array.isArray(objectsToAdd) ? objectsToAdd : [objectsToAdd],
      toolbarInfo: []
    };
    
    // Store toolbar info for champion markers
    action.objects.forEach(obj => {
      if (obj.isChampionMarker && obj.toolbarMarker) {
        action.toolbarInfo.push({
          championId: obj.championId,
          team: obj.team,
          toolbarMarker: obj.toolbarMarker
        });
      }
    });
    
    undoHistory.push(action);
    if (undoHistory.length > MAX_UNDO_HISTORY) {
      undoHistory.shift();
    }
  }

  function saveStateForRemove(objectsToRemove) {
    if (isUndoing || !canvas) return;
    
    // When removing objects, save them so they can be restored
    const action = {
      type: 'remove',
      objects: Array.isArray(objectsToRemove) ? objectsToRemove.slice() : [objectsToRemove],
      toolbarInfo: []
    };
    
    // Store toolbar info for champion markers
    action.objects.forEach(obj => {
      if (obj.isChampionMarker && obj.toolbarMarker) {
        action.toolbarInfo.push({
          championId: obj.championId,
          team: obj.team,
          toolbarMarker: obj.toolbarMarker
        });
      }
    });
    
    undoHistory.push(action);
    if (undoHistory.length > MAX_UNDO_HISTORY) {
      undoHistory.shift();
    }
  }

  // Legacy function for compatibility - called before draw
  function saveState() {
    // For drawing, we'll save state after path is created
    // This function is kept for compatibility but does nothing for draws
  }

  function undo() {
    if (undoHistory.length === 0 || !canvas) {
      console.log('Nothing to undo');
      return;
    }
    
    isUndoing = true;
    
    const action = undoHistory.pop();
    
    if (action.type === 'add') {
      // Undo add = remove the objects
      action.objects.forEach(obj => {
        if (obj.isChampionMarker) {
          restoreToolbarMarker(obj);
        }
        if (obj.isWard && obj.visionCircle) {
          canvas.remove(obj.visionCircle);
        }
        canvas.remove(obj);
      });
    } else if (action.type === 'remove') {
      // Undo remove = add the objects back
      action.objects.forEach(obj => {
        canvas.add(obj);
        
        // Re-link champion markers to their toolbar elements
        if (obj.isChampionMarker && obj.championId) {
          const team = obj.team || 'blue';
          const selector = `.marker-drop-zone[data-team="${team}"] .champion-marker[data-champion-id="${obj.championId}"]`;
          const toolbarMarker = document.querySelector(selector);
          if (toolbarMarker) {
            obj.toolbarMarker = toolbarMarker;
            toolbarMarker.style.visibility = 'hidden';
            toolbarMarker.style.opacity = '0';
            toolbarMarker.draggable = false;
          }
        }
      });
    }
    
    canvas.renderAll();
    isUndoing = false;
    
    // Sync to Firebase
    syncCanvasToFirebase();
  }

  function restoreAllToolbarMarkers() {
    // Restore all champion markers in toolbar
    document.querySelectorAll('.champion-marker').forEach(marker => {
      marker.style.visibility = 'visible';
      marker.style.opacity = '1';
      marker.draggable = true;
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Keyboard Shortcuts
  // ─────────────────────────────────────────────────────────────

  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
      // Ignore if user is typing in an input field
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      
      // Ctrl+Z for undo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
        return;
      }
      
      switch (e.key.toLowerCase()) {
        case 'a':
          hideColorPicker();
          setMode('select');
          break;
        case 'd':
          if (currentMode === 'draw') {
            toggleColorPicker();
          } else {
            hideColorPicker();
            setMode('draw');
          }
          break;
        case 'e':
          hideColorPicker();
          setMode('erase');
          break;
        case 't':
          toggleTowersVisibility();
          break;
        case 'm':
          toggleMonstersVisibility();
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
      if (['a', 'd', 'e'].includes(e.key.toLowerCase()) || 
          ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')) {
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
      if (obj.isChampionMarker || obj.isMinion) {
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
      await versionReady;
      const response = await fetch(`${DDRAGON_BASE}/data/en_US/champion.json`);
      const data = await response.json();
      
      champions = Object.values(data.data).sort((a, b) => a.name.localeCompare(b.name));
      renderChampionGrid(champions);
      
      // Preload all champion images for faster display
      preloadAllChampionImages(champions);
    } catch (error) {
      console.error('Failed to load champions:', error);
      championGrid.innerHTML = '<p style="color: #ef4444; font-size: 12px;">Failed to load champions</p>';
    }
  }

  function preloadAllChampionImages(champList) {
    champList.forEach(champ => {
      const img = new Image();
      img.src = `${DDRAGON_BASE}/img/champion/${champ.id}.png`;
    });
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
    
    // Update availability to show taken champions
    updateChampionGridAvailability();
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
    
    // Check if this champion is already assigned to another marker
    if (isChampionAssigned(champId)) {
      const assignment = getChampionAssignment(champId);
      const team = selectedToolbarMarker.dataset.team;
      const role = selectedToolbarMarker.dataset.role;
      const currentKey = `${team}_${role}`;
      
      // Only block if assigned to a DIFFERENT marker
      if (assignment !== currentKey) {
        // Champion is taken, show feedback
        console.log(`Champion ${champName} is already assigned`);
        return;
      }
    }
    
    // Get previous champion assigned to this marker (to free it up)
    const team = selectedToolbarMarker.dataset.team;
    const role = selectedToolbarMarker.dataset.role;
    const key = `${team}_${role}`;
    const previousChampId = championAssignments[key];
    
    // Update local assignment state
    championAssignments[key] = champId;
    
    // Preload the champion image for instant canvas rendering
    preloadChampionImage(champId);

    // Apply champion to selected toolbar marker
    selectedToolbarMarker.style.backgroundImage = `url(${iconUrl})`;
    selectedToolbarMarker.classList.add('has-champion');
    selectedToolbarMarker.dataset.championId = champId;
    selectedToolbarMarker.dataset.championName = champName;
    selectedToolbarMarker.title = champName;
    
    // Also update the draft slot icon
    const draftSlot = document.querySelector(`.role-icon[data-team="${team}"][data-role="${role}"]`);
    if (draftSlot) {
      draftSlot.style.backgroundImage = `url(${iconUrl})`;
      draftSlot.classList.add('has-champion');
      draftSlot.title = champName;
    }
    
    // Update any existing canvas marker linked to this toolbar marker
    updateCanvasMarkerChampion(selectedToolbarMarker, champId, team);
    
    // Sync to Firebase
    syncChampionAssignment(team, role, champId);
    
    // Update champion grid to show new availability
    updateChampionGridAvailability();
    
    deselectToolbarMarker();
  }

  /**
   * If a marker from the toolbar is already on the canvas, re-create it
   * with the newly assigned champion image.
   */
  function updateCanvasMarkerChampion(toolbarMarkerEl, newChampionId, team) {
    if (!canvas) return;
    
    // Find the canvas object linked to this toolbar marker
    const existingMarker = canvas.getObjects().find(obj => 
      obj.isChampionMarker && obj.toolbarMarker === toolbarMarkerEl
    );
    
    if (!existingMarker) return; // Marker not on the canvas yet
    
    // Save old champion info for undo
    const oldChampionId = existingMarker.championId;
    const oldChampionName = toolbarMarkerEl.dataset.championName || '';
    
    // Remember position and scale
    const pos = { left: existingMarker.left, top: existingMarker.top };
    const scale = { scaleX: existingMarker.scaleX, scaleY: existingMarker.scaleY };
    const baseRadius = existingMarker.baseRadius || 16;
    
    // Remove the old marker from canvas (keep reference for undo)
    canvas.remove(existingMarker);
    
    const colors = {
      blue: { stroke: '#3b82f6', fill: '#1e3a5f' },
      red: { stroke: '#ef4444', fill: '#5f1e1e' },
    };
    const color = colors[team] || colors.blue;
    const BASE_RADIUS = baseRadius;
    
    const markerProps = {
      left: pos.left,
      top: pos.top,
      originX: 'center',
      originY: 'center',
      selectable: true,
      evented: true,
      hasControls: false,
      hasBorders: true,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
      scaleX: scale.scaleX,
      scaleY: scale.scaleY,
    };
    
    const addUpdatedMarker = (marker) => {
      marker.team = team;
      marker.isChampionMarker = true;
      marker.toolbarMarker = toolbarMarkerEl;
      marker.championId = newChampionId || null;
      marker.baseRadius = BASE_RADIUS;
      
      canvas.add(marker);
      canvas.bringToFront(marker);
      canvas.renderAll();
      
      // Update any previous undo entries that reference the old marker
      // so they point to the new one instead
      undoHistory.forEach(action => {
        if (action.type === 'add' && action.objects) {
          const idx = action.objects.indexOf(existingMarker);
          if (idx !== -1) {
            action.objects[idx] = marker;
          }
        }
      });
    };
    
    if (newChampionId) {
      const buildUpdatedFromDataURL = (dataURL) => {
        fabric.Image.fromURL(dataURL, function(clippedImg) {
          const imgScale = (BASE_RADIUS * 2) / 120;
          clippedImg.set({
            originX: 'center',
            originY: 'center',
            scaleX: imgScale,
            scaleY: imgScale,
          });
          const border = new fabric.Circle({
            radius: BASE_RADIUS + 1,
            fill: 'transparent',
            stroke: color.stroke,
            strokeWidth: 3,
            originX: 'center',
            originY: 'center',
          });
          const group = new fabric.Group([clippedImg, border], {
            ...markerProps,
          });
          addUpdatedMarker(group);
        });
      };

      if (championImageCache[newChampionId]) {
        buildUpdatedFromDataURL(championImageCache[newChampionId]);
      } else {
        const imgUrl = `${DDRAGON_BASE}/img/champion/${newChampionId}.png`;
        const imgEl = new Image();
        imgEl.crossOrigin = 'anonymous';
        imgEl.onload = function() {
          const hiResSize = 120;
          const hiResRadius = hiResSize / 2;
          const patternCanvas = document.createElement('canvas');
          patternCanvas.width = hiResSize;
          patternCanvas.height = hiResSize;
          const ctx = patternCanvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.beginPath();
          ctx.arc(hiResRadius, hiResRadius, hiResRadius, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(imgEl, 0, 0, hiResSize, hiResSize);
          const dataURL = patternCanvas.toDataURL('image/png');
          championImageCache[newChampionId] = dataURL;
          buildUpdatedFromDataURL(dataURL);
        };
        imgEl.onerror = function() {
          const circle = new fabric.Circle({
            ...markerProps,
            radius: BASE_RADIUS,
            fill: color.fill,
            stroke: color.stroke,
            strokeWidth: 3,
          });
          addUpdatedMarker(circle);
        };
        imgEl.src = imgUrl;
      }
    } else {
      const circle = new fabric.Circle({
        ...markerProps,
        radius: BASE_RADIUS,
        fill: color.fill,
        stroke: color.stroke,
        strokeWidth: 3,
      });
      addUpdatedMarker(circle);
    }
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
    
    // Setup pinch-to-zoom for mobile
    setupPinchZoom();
  }

  // ─────────────────────────────────────────────────────────────
  // Pinch-to-Zoom for Mobile
  // ─────────────────────────────────────────────────────────────

  function setupPinchZoom() {
    const canvasEl = canvas.upperCanvasEl;
    
    let initialDistance = 0;
    let initialZoom = 1;
    let isPinching = false;
    let lastTouchCenter = null;

    // Calculate distance between two touch points
    function getDistance(touch1, touch2) {
      const dx = touch1.clientX - touch2.clientX;
      const dy = touch1.clientY - touch2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    // Get center point between two touches
    function getTouchCenter(touch1, touch2) {
      return {
        x: (touch1.clientX + touch2.clientX) / 2,
        y: (touch1.clientY + touch2.clientY) / 2
      };
    }

    canvasEl.addEventListener('touchstart', function(e) {
      if (e.touches.length === 2) {
        isPinching = true;
        initialDistance = getDistance(e.touches[0], e.touches[1]);
        initialZoom = canvas.getZoom();
        lastTouchCenter = getTouchCenter(e.touches[0], e.touches[1]);
        e.preventDefault();
      }
    }, { passive: false });

    canvasEl.addEventListener('touchmove', function(e) {
      if (isPinching && e.touches.length === 2) {
        const currentDistance = getDistance(e.touches[0], e.touches[1]);
        const currentCenter = getTouchCenter(e.touches[0], e.touches[1]);
        
        // Calculate zoom scale
        const scale = currentDistance / initialDistance;
        let newZoom = initialZoom * scale;
        
        // Clamp zoom to limits
        newZoom = Math.max(ZOOM_CONFIG.min, Math.min(ZOOM_CONFIG.max, newZoom));
        
        // Get canvas position for zoom point
        const canvasRect = canvasEl.getBoundingClientRect();
        const zoomPointX = currentCenter.x - canvasRect.left;
        const zoomPointY = currentCenter.y - canvasRect.top;
        
        // Zoom to center point between fingers
        const point = new fabric.Point(zoomPointX, zoomPointY);
        canvas.zoomToPoint(point, newZoom);
        
        // Handle panning while pinching
        if (lastTouchCenter) {
          const deltaX = currentCenter.x - lastTouchCenter.x;
          const deltaY = currentCenter.y - lastTouchCenter.y;
          
          const vpt = canvas.viewportTransform.slice();
          vpt[4] += deltaX;
          vpt[5] += deltaY;
          canvas.setViewportTransform(vpt);
        }
        
        lastTouchCenter = currentCenter;
        e.preventDefault();
      }
    }, { passive: false });

    canvasEl.addEventListener('touchend', function(e) {
      if (e.touches.length < 2) {
        isPinching = false;
        initialDistance = 0;
        lastTouchCenter = null;
        canvas.calcOffset();
      }
    });

    canvasEl.addEventListener('touchcancel', function() {
      isPinching = false;
      initialDistance = 0;
      lastTouchCenter = null;
      canvas.calcOffset();
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
        e.stopPropagation();
      }
    });

    canvasEl.addEventListener('mousemove', function (e) {
      if (!isPanning) return;

      const vpt = canvas.viewportTransform.slice(); // Clone the array

      // Calculate delta movement
      const deltaX = e.clientX - lastPosX;
      const deltaY = e.clientY - lastPosY;

      // Update viewport transform (pan)
      vpt[4] += deltaX;
      vpt[5] += deltaY;

      // Use setViewportTransform to properly update canvas state
      canvas.setViewportTransform(vpt);

      lastPosX = e.clientX;
      lastPosY = e.clientY;
    });

    canvasEl.addEventListener('mouseup', function (e) {
      if (e.button === 1 && isPanning) {
        isPanning = false;
        // Restore cursor based on current mode
        if (currentMode === 'select') {
          canvas.defaultCursor = 'default';
          canvasEl.style.cursor = 'default';
        } else if (currentMode === 'draw') {
          canvas.defaultCursor = 'crosshair';
          canvasEl.style.cursor = 'crosshair';
        } else if (currentMode === 'erase') {
          canvas.defaultCursor = 'cell';
          canvasEl.style.cursor = 'cell';
        }
        // Recalculate object coordinates after panning
        canvas.calcOffset();
        canvas.renderAll();
      }
    });

    // Also handle mouse leaving canvas while panning
    canvasEl.addEventListener('mouseleave', function () {
      if (isPanning) {
        isPanning = false;
        // Restore cursor based on current mode
        if (currentMode === 'select') {
          canvas.defaultCursor = 'default';
          canvasEl.style.cursor = 'default';
        } else if (currentMode === 'draw') {
          canvas.defaultCursor = 'crosshair';
          canvasEl.style.cursor = 'crosshair';
        } else if (currentMode === 'erase') {
          canvas.defaultCursor = 'cell';
          canvasEl.style.cursor = 'cell';
        }
        canvas.calcOffset();
        canvas.renderAll();
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
      
      // Save for undo (undo will remove it)
      saveStateForAdd(marker);
    };

    if (championId) {
      const buildMarkerFromDataURL = (dataURL) => {
        fabric.Image.fromURL(dataURL, function(clippedImg) {
          const imgScale = (BASE_RADIUS * 2) / 120;
          clippedImg.set({
            originX: 'center',
            originY: 'center',
            scaleX: imgScale,
            scaleY: imgScale,
          });
          const border = new fabric.Circle({
            radius: BASE_RADIUS + 1,
            fill: 'transparent',
            stroke: color.stroke,
            strokeWidth: 3,
            originX: 'center',
            originY: 'center',
          });
          const group = new fabric.Group([clippedImg, border], {
            ...markerProps,
          });
          addMarkerToCanvas(group);
        });
      };

      if (championImageCache[championId]) {
        buildMarkerFromDataURL(championImageCache[championId]);
      } else {
        const imgUrl = `${DDRAGON_BASE}/img/champion/${championId}.png`;
        const imgEl = new Image();
        imgEl.crossOrigin = 'anonymous';
        imgEl.onload = function() {
          const hiResSize = 120;
          const hiResRadius = hiResSize / 2;
          const patternCanvas = document.createElement('canvas');
          patternCanvas.width = hiResSize;
          patternCanvas.height = hiResSize;
          const ctx = patternCanvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.beginPath();
          ctx.arc(hiResRadius, hiResRadius, hiResRadius, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(imgEl, 0, 0, hiResSize, hiResSize);
          const dataURL = patternCanvas.toDataURL('image/png');
          championImageCache[championId] = dataURL;
          buildMarkerFromDataURL(dataURL);
        };
        imgEl.onerror = function() {
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
      }
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

  const WARD_VISION_RADIUS = 43;

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
    
    // Save for undo (undo will remove both ward center and vision circle)
    saveStateForAdd([visionCircle, wardCenter]);
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

      hideColorPicker();
      setMode('select');
      
      // Sync to Firebase
      syncCanvasToFirebase();
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Minion System
  // ─────────────────────────────────────────────────────────────

  function createMinionMarker(x, y, team) {
    const imgPath = team === 'blue' ? 'image/BlueWaveMinion.png' : 'image/RedWaveMinion.png';
    const borderColor = team === 'blue' ? '#3b82f6' : '#ef4444';
    const BASE_MINION_SIZE = 28;
    const BASE_RADIUS = 16;
    const scale = markerRadius / BASE_RADIUS;

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
        const imgScale = BASE_MINION_SIZE / hiResSize;
        minionImg.set({
          originX: 'center',
          originY: 'center',
          scaleX: imgScale,
          scaleY: imgScale,
        });
        
        // Create square border
        const border = new fabric.Rect({
          width: BASE_MINION_SIZE + 2,
          height: BASE_MINION_SIZE + 2,
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
          scaleX: scale,
          scaleY: scale,
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
        
        // Save for undo (undo will remove it)
        saveStateForAdd(group);
      });
    };
    imgEl.src = imgPath;
  }

  function setupMinionDragDrop() {
    const activeMinion = document.getElementById('activeMinion');
    const minionPicker = document.getElementById('minionPicker');
    const minionOptions = document.querySelectorAll('.minion-option');
    const canvasEl = canvas.upperCanvasEl;

    let draggedMinionTeam = null;

    // Set initial selected state
    minionOptions.forEach(opt => {
      if (opt.dataset.minionTeam === activeMinion.dataset.minionTeam) {
        opt.classList.add('selected');
      }
    });

    // Click to toggle picker
    activeMinion.addEventListener('click', function (e) {
      // Don't open picker if drag just happened
      if (e.detail === 0) return;
      const isVisible = minionPicker.classList.toggle('visible');
      if (isVisible) {
        const btnRect = activeMinion.getBoundingClientRect();
        minionPicker.style.left = (btnRect.right + 8) + 'px';
        minionPicker.style.top = btnRect.top + 'px';
      }
    });

    // Select team from picker
    minionOptions.forEach(opt => {
      opt.addEventListener('click', function (e) {
        e.stopPropagation();
        const team = this.dataset.minionTeam;

        // Update the active minion appearance
        activeMinion.classList.remove('blue-minion', 'red-minion');
        activeMinion.classList.add(team === 'blue' ? 'blue-minion' : 'red-minion');
        activeMinion.dataset.minionTeam = team;
        activeMinion.title = (team === 'blue' ? 'Blue' : 'Red') + ' Minion Wave';

        // Update selected state
        minionOptions.forEach(o => o.classList.toggle('selected', o.dataset.minionTeam === team));

        minionPicker.classList.remove('visible');
      });
    });

    // Close picker when clicking elsewhere
    document.addEventListener('click', function (e) {
      if (!minionPicker.contains(e.target) && e.target !== activeMinion && !activeMinion.contains(e.target)) {
        minionPicker.classList.remove('visible');
      }
    });

    // Drag the active minion
    activeMinion.addEventListener('dragstart', function (e) {
      draggedMinionTeam = this.dataset.minionTeam;
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', 'minion');
      minionPicker.classList.remove('visible');
    });

    activeMinion.addEventListener('dragend', function () {
      draggedMinionTeam = null;
    });

    const canvasContainer = canvasEl.parentElement;

    canvasContainer.addEventListener('dragover', function (e) {
      if (draggedMinionTeam) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });

    canvasContainer.addEventListener('drop', function (e) {
      if (!draggedMinionTeam) return;

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

      hideColorPicker();
      setMode('select');
      
      // Sync to Firebase
      syncCanvasToFirebase();
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Tower System
  // ─────────────────────────────────────────────────────────────

  function createTowerMarker(x, y, team, bgScale, towerIndex) {
    const imgPath = 'image/Turretico.png';
    const baseTowerSize = 32; // Base size at scale 1
    const towerSize = baseTowerSize; // Keep internal calculations at base size
    const scale = bgScale || 1; // Fallback to 1 if not provided
    
    // Team colors
    const teamColors = {
      blue: '#3b82f6',
      red: '#ef4444'
    };
    const borderColor = teamColors[team] || '#9ca3af';

    const imgEl = new Image();
    imgEl.onload = function() {
      const hiResSize = 64;
      
      const patternCanvas = document.createElement('canvas');
      patternCanvas.width = hiResSize;
      patternCanvas.height = hiResSize;
      const ctx = patternCanvas.getContext('2d');
      
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      
      ctx.drawImage(imgEl, 0, 0, hiResSize, hiResSize);
      
      fabric.Image.fromURL(patternCanvas.toDataURL('image/png'), function(towerImg) {
        const imgScale = towerSize / hiResSize;
        towerImg.set({
          originX: 'center',
          originY: 'center',
          scaleX: imgScale,
          scaleY: imgScale,
        });
        
        // Create border with team color
        const border = new fabric.Rect({
          width: towerSize + 2,
          height: towerSize + 2,
          fill: 'transparent',
          stroke: borderColor,
          strokeWidth: 3,
          originX: 'center',
          originY: 'center',
          rx: 4,
          ry: 4,
        });

        // Create red X (initially hidden)
        const xSize = towerSize * 0.7;
        const xLine1 = new fabric.Line([-xSize/2, -xSize/2, xSize/2, xSize/2], {
          stroke: '#ef4444',
          strokeWidth: 4,
          originX: 'center',
          originY: 'center',
          strokeLineCap: 'round',
        });
        const xLine2 = new fabric.Line([xSize/2, -xSize/2, -xSize/2, xSize/2], {
          stroke: '#ef4444',
          strokeWidth: 4,
          originX: 'center',
          originY: 'center',
          strokeLineCap: 'round',
        });
        
        // Group the X lines
        const redX = new fabric.Group([xLine1, xLine2], {
          originX: 'center',
          originY: 'center',
          visible: false,
        });

        // Group image, border and red X
        const group = new fabric.Group([towerImg, border, redX], {
          left: x,
          top: y,
          originX: 'center',
          originY: 'center',
          scaleX: scale,
          scaleY: scale,
          selectable: false,
          evented: true,
          hasControls: false,
          hasBorders: false,
          lockMovementX: true,
          lockMovementY: true,
          lockScalingX: true,
          lockScalingY: true,
          lockRotation: true,
        });

        group.isTower = true;
        group.isDestroyed = false;
        group.redXElement = redX;
        group.towerTeam = team;
        group.towerIndex = towerIndex;

        canvas.add(group);
        canvas.renderAll();
      });
    };
    imgEl.onerror = function() {
      console.error('Failed to load tower image:', imgPath);
    };
    imgEl.src = imgPath;
  }

  function setupTowerClickToggle() {
    canvas.on('mouse:down', function(opt) {
      // Don't toggle in erase mode
      if (currentMode === 'erase') return;
      
      const target = opt.target;
      
      // Handle tower toggle
      if (target && target.isTower) {
        // Toggle destroyed state
        target.isDestroyed = !target.isDestroyed;
        
        // Get the red X element from the group
        const objects = target.getObjects();
        const redX = objects[2]; // The red X is the third element in the group
        
        if (redX) {
          redX.set('visible', target.isDestroyed);
        }
        
        canvas.renderAll();
        
        // Sync tower state to Firebase
        syncTowerState(target.towerIndex, target.towerTeam, target.isDestroyed);
      }
      
      // Handle objective toggle (Baron, Elder)
      if (target && target.isObjective) {
        // Toggle destroyed state
        target.isDestroyed = !target.isDestroyed;
        
        // Get the red X element from the group
        const objects = target.getObjects();
        const redX = objects[2]; // The red X is the third element in the group
        
        if (redX) {
          redX.set('visible', target.isDestroyed);
        }
        
        canvas.renderAll();
        
        // Sync objective state to Firebase
        syncObjectiveState(target.objectiveType, target.isDestroyed);
      }
    });
  }

  function toggleTowersVisibility() {
    towersVisible = !towersVisible;
    
    // Update button state
    if (toggleTowersBtn) {
      toggleTowersBtn.classList.toggle('active', towersVisible);
    }
    
    // Toggle visibility of all tower objects
    const objects = canvas.getObjects();
    objects.forEach(obj => {
      if (obj.isTower) {
        obj.set('visible', towersVisible);
      }
    });
    
    canvas.renderAll();
  }

  function setupTowerVisibilityToggle() {
    // Button click handler
    if (toggleTowersBtn) {
      toggleTowersBtn.addEventListener('click', toggleTowersVisibility);
    }
  }

  function toggleMonstersVisibility() {
    monstersVisible = !monstersVisible;
    
    // Update button state
    if (toggleMonstersBtn) {
      toggleMonstersBtn.classList.toggle('active', monstersVisible);
    }
    
    // Toggle visibility of all objective objects (Baron, Elder Dragon)
    const objects = canvas.getObjects();
    objects.forEach(obj => {
      if (obj.isObjective) {
        obj.set('visible', monstersVisible);
      }
    });
    
    canvas.renderAll();
  }

  function setupMonstersVisibilityToggle() {
    // Button click handler
    if (toggleMonstersBtn) {
      toggleMonstersBtn.addEventListener('click', toggleMonstersVisibility);
    }
  }

  // Convert reference coordinates to current background position
  function getScaledTowerPosition(refX, refY) {
    if (!bgImage) return { x: refX, y: refY, scale: 1 };
    
    const bgLeft = bgImage.left;
    const bgTop = bgImage.top;
    const bgScale = bgImage.scaleX;
    
    // The reference coordinates are relative to the background at scale 1
    // We need to scale them and offset by the background position
    const x = bgLeft + (refX * bgScale);
    const y = bgTop + (refY * bgScale);
    
    return { x, y, scale: bgScale };
  }

  // Create static towers at predefined positions
  function createStaticTowers() {
    const bgScale = bgImage ? bgImage.scaleX : 1;
    
    // Blue team towers (11 total)
    BLUE_TOWERS.forEach((pos, index) => {
      const scaled = getScaledTowerPosition(pos.x, pos.y);
      createTowerMarker(scaled.x, scaled.y, 'blue', bgScale, index);
    });
    
    // Red team towers (11 total)
    RED_TOWERS.forEach((pos, index) => {
      const scaled = getScaledTowerPosition(pos.x, pos.y);
      createTowerMarker(scaled.x, scaled.y, 'red', bgScale, index);
    });
  }

  // Create objective marker (Baron, Elder Dragon)
  function createObjectiveMarker(x, y, imgPath, bgScale, objectiveType) {
    const objectiveSize = 40; // Base size
    const scale = bgScale || 1;
    
    // Objective colors
    const objectiveColors = {
      baron: '#a855f7',  // Purple
      elder: '#06b6d4',  // Cyan
      gromp: '#22c55e',  // Green
      blue: '#3b82f6',   // Blue
      wolf: '#6b7280',   // Gray
      raptor: '#f97316', // Orange
      red: '#ef4444',    // Red
      krug: '#a16207'    // Brown
    };
    const borderColor = objectiveColors[objectiveType] || '#fbbf24';

    const imgEl = new Image();
    imgEl.onload = function() {
      const hiResSize = 64;
      
      const patternCanvas = document.createElement('canvas');
      patternCanvas.width = hiResSize;
      patternCanvas.height = hiResSize;
      const ctx = patternCanvas.getContext('2d');
      
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      
      ctx.drawImage(imgEl, 0, 0, hiResSize, hiResSize);
      
      fabric.Image.fromURL(patternCanvas.toDataURL('image/png'), function(objectiveImg) {
        const imgScale = objectiveSize / hiResSize;
        objectiveImg.set({
          originX: 'center',
          originY: 'center',
          scaleX: imgScale,
          scaleY: imgScale,
        });
        
        // Create square border
        const border = new fabric.Rect({
          width: objectiveSize + 2,
          height: objectiveSize + 2,
          fill: 'transparent',
          stroke: borderColor,
          strokeWidth: 3,
          originX: 'center',
          originY: 'center',
          rx: 4,
          ry: 4,
        });

        // Create red X (initially hidden)
        const xSize = objectiveSize * 0.7;
        const xLine1 = new fabric.Line([-xSize/2, -xSize/2, xSize/2, xSize/2], {
          stroke: '#ef4444',
          strokeWidth: 4,
          originX: 'center',
          originY: 'center',
          strokeLineCap: 'round',
        });
        const xLine2 = new fabric.Line([xSize/2, -xSize/2, -xSize/2, xSize/2], {
          stroke: '#ef4444',
          strokeWidth: 4,
          originX: 'center',
          originY: 'center',
          strokeLineCap: 'round',
        });
        
        // Group the X lines
        const redX = new fabric.Group([xLine1, xLine2], {
          originX: 'center',
          originY: 'center',
          visible: false,
        });

        // Group image, border and red X
        const group = new fabric.Group([objectiveImg, border, redX], {
          left: x,
          top: y,
          originX: 'center',
          originY: 'center',
          scaleX: scale,
          scaleY: scale,
          selectable: false,
          evented: true,
          hasControls: false,
          hasBorders: false,
          lockMovementX: true,
          lockMovementY: true,
          lockScalingX: true,
          lockScalingY: true,
          lockRotation: true,
        });

        group.isObjective = true;
        group.objectiveType = objectiveType;
        group.isDestroyed = false;

        canvas.add(group);
        canvas.renderAll();
      });
    };
    imgEl.onerror = function() {
      console.error('Failed to load objective image:', imgPath);
    };
    imgEl.src = imgPath;
  }

  // Create objective markers (Baron Nashor, Elder Dragon)
  function createObjectiveMarkers() {
    const bgScale = bgImage ? bgImage.scaleX : 1;
    
    // Baron Nashor
    const baronPos = getScaledTowerPosition(OBJECTIVES.baron.x, OBJECTIVES.baron.y);
    createObjectiveMarker(baronPos.x, baronPos.y, OBJECTIVES.baron.image, bgScale, 'baron');
    
    // Elder Dragon
    const elderPos = getScaledTowerPosition(OBJECTIVES.elder.x, OBJECTIVES.elder.y);
    createObjectiveMarker(elderPos.x, elderPos.y, OBJECTIVES.elder.image, bgScale, 'elder');
    
    // Jungle Camps
    JUNGLE_CAMPS.forEach(camp => {
      const campPos = getScaledTowerPosition(camp.x, camp.y);
      createObjectiveMarker(campPos.x, campPos.y, camp.image, bgScale, camp.name);
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

      hideColorPicker();
      setMode('select');
      
      // Sync to Firebase
      syncCanvasToFirebase();
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

