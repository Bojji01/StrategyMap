/**
 * Draft Pick/Ban System
 * Supports Normal Draft and Fearless Draft modes.
 * Collaboration: 3 links — Blue Team, Red Team, Spectator.
 */
(function () {
  'use strict';

  // Data Dragon
  const DDRAGON_VERSION = '16.6.1';
  const DDRAGON_BASE = `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}`;

  // Firebase configuration (same as strategy map)
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

  // Draft order: standard LoL competitive draft
  const DRAFT_ORDER = [
    // Ban Phase 1
    { phase: 'ban', team: 'blue', index: 0 },
    { phase: 'ban', team: 'red', index: 0 },
    { phase: 'ban', team: 'blue', index: 1 },
    { phase: 'ban', team: 'red', index: 1 },
    { phase: 'ban', team: 'blue', index: 2 },
    { phase: 'ban', team: 'red', index: 2 },
    // Pick Phase 1
    { phase: 'pick', team: 'blue', index: 0 },
    { phase: 'pick', team: 'red', index: 0 },
    { phase: 'pick', team: 'red', index: 1 },
    { phase: 'pick', team: 'blue', index: 1 },
    { phase: 'pick', team: 'blue', index: 2 },
    { phase: 'pick', team: 'red', index: 2 },
    // Ban Phase 2
    { phase: 'ban', team: 'red', index: 3 },
    { phase: 'ban', team: 'blue', index: 3 },
    { phase: 'ban', team: 'red', index: 4 },
    { phase: 'ban', team: 'blue', index: 4 },
    // Pick Phase 2
    { phase: 'pick', team: 'red', index: 3 },
    { phase: 'pick', team: 'blue', index: 3 },
    { phase: 'pick', team: 'blue', index: 4 },
    { phase: 'pick', team: 'red', index: 4 },
  ];

  // ============================================
  // State
  // ============================================
  let draftMode = null; // 'normal' or 'fearless'
  let currentStep = 0;
  let selectedChampion = null;
  let champions = [];
  let timerInterval = null;
  let timerValue = 30;
  let gameNumber = 1;

  let currentGameUsed = new Set();
  let currentGamePicked = new Set();
  let fearlessLockedOut = new Set();

  // Collaboration state
  let myRole = null; // 'blue', 'red', 'spectator', or null (host before sharing)
  let roomId = null;
  let roomRef = null;
  let database = null;
  let isRemoteUpdate = false;
  let isHost = false; // The host is the one who created the room
  let draftStarted = false;

  // ============================================
  // DOM refs
  // ============================================
  const modeModal = document.getElementById('modeModal');
  const draftContainer = document.querySelector('.draft-container');
  const modeBadge = document.getElementById('modeBadge');
  const gameLabel = document.getElementById('gameLabel');
  const phaseLabel = document.getElementById('phaseLabel');
  const draftTimer = document.getElementById('draftTimer');
  const champSearch = document.getElementById('draftChampSearch');
  const champGrid = document.getElementById('draftChampGrid');
  const lockInBtn = document.getElementById('lockIn');
  const nextGameBtn = document.getElementById('nextGame');
  const fearlessHistory = document.getElementById('fearlessHistory');
  const fearlessChampList = document.getElementById('fearlessChampList');
  const roleFilters = document.querySelectorAll('.role-filter');
  const blueScore = document.getElementById('blueScore');
  const redScore = document.getElementById('redScore');
  const shareDraftModal = document.getElementById('shareDraftModal');
  const blueLinkInput = document.getElementById('blueLinkInput');
  const redLinkInput = document.getElementById('redLinkInput');
  const specLinkInput = document.getElementById('specLinkInput');
  const startDraftBtn = document.getElementById('startDraftBtn');
  const roleBanner = document.getElementById('roleBanner');
  const readyScreen = document.getElementById('readyScreen');
  const readyBtn = document.getElementById('readyBtn');
  const blueReadyBox = document.getElementById('blueReadyBox');
  const redReadyBox = document.getElementById('redReadyBox');
  const blueReadyStatus = document.getElementById('blueReadyStatus');
  const redReadyStatus = document.getElementById('redReadyStatus');
  const readyWaitMsg = document.getElementById('readyWaitMsg');
  const readyModeBadge = document.getElementById('readyModeBadge');
  const readyGameLabel = document.getElementById('readyGameLabel');
  const readyDesc = document.getElementById('readyDesc');

  let activeRoleFilter = 'all';

  // ============================================
  // Firebase Initialization
  // ============================================
  function initFirebase() {
    if (typeof firebase === 'undefined') {
      console.warn('Firebase SDK not loaded — running in local mode');
      return false;
    }
    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(FIREBASE_CONFIG);
      }
      database = firebase.database();
      return true;
    } catch (e) {
      console.error('Firebase init failed', e);
      return false;
    }
  }

  // ============================================
  // Room ID Generation
  // ============================================
  function generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let result = '';
    if (window.crypto && window.crypto.getRandomValues) {
      const arr = new Uint32Array(10);
      window.crypto.getRandomValues(arr);
      for (let i = 0; i < 10; i++) result += chars.charAt(arr[i] % chars.length);
    } else {
      for (let i = 0; i < 10; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  function buildLink(rId, role) {
    const base = window.location.origin + window.location.pathname;
    return `${base}?room=${encodeURIComponent(rId)}&role=${encodeURIComponent(role)}`;
  }

  // ============================================
  // URL Params
  // ============================================
  function getUrlParams() {
    const p = new URLSearchParams(window.location.search);
    return {
      room: p.get('room'),
      role: p.get('role'), // 'blue', 'red', 'spectator'
    };
  }

  // ============================================
  // Entry Point: decide flow based on URL
  // ============================================
  function boot() {
    const firebaseOk = initFirebase();
    loadChampions();

    const params = getUrlParams();
    const validRole = r => ['blue', 'red', 'spectator'].includes(r);
    const validRoom = r => r && /^[A-Za-z0-9]{6,20}$/.test(r);

    if (validRoom(params.room) && validRole(params.role)) {
      // Joining an existing room with a role — hide mode selection immediately
      modeModal.style.display = 'none';
      myRole = params.role;
      roomId = params.room;
      showRoleBanner();

      if (firebaseOk) {
        joinRoom();
      }
    } else {
      // Fresh visit — show mode selection, then generate links
      showModeSelection();
    }
  }

  // ============================================
  // Mode Selection (host flow)
  // ============================================
  function showModeSelection() {
    modeModal.style.display = 'flex';
  }

  document.querySelectorAll('.mode-option').forEach(btn => {
    btn.addEventListener('click', () => {
      draftMode = btn.dataset.mode;
      modeModal.style.display = 'none';

      modeBadge.textContent = draftMode === 'fearless' ? 'FEARLESS' : 'NORMAL';
      if (draftMode === 'fearless') {
        modeBadge.style.background = 'rgba(234, 179, 8, 0.15)';
        modeBadge.style.color = '#eab308';
      }

      // Generate room and show share links
      roomId = generateRoomId();
      isHost = true;
      myRole = 'blue'; // Host defaults to blue team but can use any link

      showShareLinksModal();
    });
  });

  // ============================================
  // Share Links Modal
  // ============================================
  function showShareLinksModal() {
    blueLinkInput.value = buildLink(roomId, 'blue');
    redLinkInput.value = buildLink(roomId, 'red');
    specLinkInput.value = buildLink(roomId, 'spectator');
    shareDraftModal.style.display = 'flex';

    // Copy buttons
    shareDraftModal.querySelectorAll('.copy-link-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        if (input) {
          navigator.clipboard.writeText(input.value).then(() => {
            btn.textContent = 'Copied!';
            btn.classList.add('copied');
            setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
          });
        }
      });
    });
  }

  startDraftBtn.addEventListener('click', () => {
    shareDraftModal.style.display = 'none';

    // Update browser URL to include room + host role (so refresh works)
    const newUrl = buildLink(roomId, myRole);
    window.history.replaceState(null, '', newUrl);
    showRoleBanner();

    if (database) {
      createRoom();
    } else {
      // Local-only mode
      draftContainer.style.display = 'flex';
      initDraft();
    }
  });

  // ============================================
  // Firebase Room: Create (host)
  // ============================================
  function createRoom() {
    roomRef = database.ref('draftRooms/' + roomId);
    const initialState = {
      mode: draftMode,
      gameNumber: 1,
      currentStep: 0,
      started: false,
      ready: { blue: false, red: false },
      actions: {},
      fearlessLocked: [],
      blueScore: 0,
      redScore: 0,
      createdAt: firebase.database.ServerValue.TIMESTAMP,
    };

    roomRef.set(initialState).then(() => {
      showReadyScreen(false);
      listenForReady();
    });
  }

  // ============================================
  // Ready Check System
  // ============================================
  function showReadyScreen(waitingForRoom) {
    readyScreen.style.display = 'flex';

    // Set mode badge
    if (draftMode) {
      readyModeBadge.textContent = draftMode === 'fearless' ? 'FEARLESS' : 'NORMAL';
      if (draftMode === 'fearless') {
        readyModeBadge.style.background = 'rgba(234, 179, 8, 0.15)';
        readyModeBadge.style.color = '#eab308';
      } else {
        readyModeBadge.style.background = '';
        readyModeBadge.style.color = '';
      }
    } else {
      readyModeBadge.textContent = '...';
      readyModeBadge.style.background = '';
      readyModeBadge.style.color = '';
    }
    readyGameLabel.textContent = `Game ${gameNumber}`;

    // Reset visual state
    blueReadyBox.classList.remove('is-ready');
    redReadyBox.classList.remove('is-ready');
    blueReadyStatus.textContent = 'Not Ready';
    redReadyStatus.textContent = 'Not Ready';
    readyBtn.textContent = 'Ready';

    if (waitingForRoom) {
      // Room doesn't exist yet — show ready screen with disabled button
      readyBtn.style.display = '';
      readyBtn.disabled = true;
      readyDesc.textContent = 'Waiting for host to start the session...';
      readyWaitMsg.style.display = '';
      readyWaitMsg.textContent = 'The host hasn\'t created the room yet';
    } else if (myRole === 'blue' || myRole === 'red') {
      readyBtn.style.display = '';
      readyBtn.disabled = false;
      readyWaitMsg.style.display = 'none';
      readyDesc.textContent = 'Both teams must be ready to start the draft';
    } else {
      // Spectator — no button
      readyBtn.style.display = 'none';
      readyWaitMsg.style.display = '';
      readyWaitMsg.textContent = 'Waiting for both teams to ready up...';
      readyDesc.textContent = 'Spectating — waiting for players';
    }
  }

  function onReadyClick() {
    if (!roomRef || !myRole || myRole === 'spectator') return;
    readyBtn.disabled = true;
    roomRef.child('ready/' + myRole).set(true);
  }

  readyBtn.addEventListener('click', onReadyClick);

  function listenForReady() {
    if (!roomRef) return;

    roomRef.child('ready').on('value', snap => {
      const ready = snap.val();
      if (!ready) return;

      // Update blue status
      if (ready.blue) {
        blueReadyBox.classList.add('is-ready');
        blueReadyStatus.textContent = 'Ready!';
      } else {
        blueReadyBox.classList.remove('is-ready');
        blueReadyStatus.textContent = 'Not Ready';
      }

      // Update red status
      if (ready.red) {
        redReadyBox.classList.add('is-ready');
        redReadyStatus.textContent = 'Ready!';
      } else {
        redReadyBox.classList.remove('is-ready');
        redReadyStatus.textContent = 'Not Ready';
      }

      // If I already clicked ready, show wait message
      if (myRole !== 'spectator' && ready[myRole]) {
        readyBtn.disabled = true;
        readyBtn.textContent = 'Ready ✓';
        if (!ready.blue || !ready.red) {
          readyWaitMsg.style.display = '';
          readyWaitMsg.textContent = 'Waiting for opponent...';
        }
      }

      // Both ready — begin draft
      if (ready.blue && ready.red) {
        roomRef.child('ready').off('value');
        beginDraft();
      }
    });
  }

  function beginDraft() {
    readyScreen.style.display = 'none';
    readyBtn.textContent = 'Ready';
    readyBtn.disabled = false;
    readyWaitMsg.style.display = 'none';

    // Mark room as started
    if (roomRef && isHost) {
      roomRef.child('started').set(true);
    }

    draftContainer.style.display = 'flex';
    draftStarted = true;
    initDraft();
    listenForRemoteActions();
  }

  // ============================================
  // Firebase Room: Join (participant)
  // ============================================
  function joinRoom() {
    roomRef = database.ref('draftRooms/' + roomId);

    roomRef.once('value').then(snap => {
      const data = snap.val();

      if (!data) {
        // Room not created yet — show ready screen in waiting state
        showReadyScreen(true);
        listenForRoomCreation();
        return;
      }

      if (!data.started) {
        // Room exists but draft not started — show active ready screen
        applyModeFromData(data);
        showReadyScreen(false);
        listenForReady();
        return;
      }

      // Draft already in progress — join directly
      applyRoomState(data);
    });
  }

  function applyModeFromData(data) {
    draftMode = data.mode;
    gameNumber = data.gameNumber || 1;
    modeBadge.textContent = draftMode === 'fearless' ? 'FEARLESS' : 'NORMAL';
    if (draftMode === 'fearless') {
      modeBadge.style.background = 'rgba(234, 179, 8, 0.15)';
      modeBadge.style.color = '#eab308';
    }
    gameLabel.textContent = `Game ${gameNumber}`;
  }

  function listenForRoomCreation() {
    roomRef.on('value', function onRoom(snap) {
      const data = snap.val();
      if (!data) return; // Still waiting for host

      roomRef.off('value', onRoom);

      if (!data.started) {
        applyModeFromData(data);
        showReadyScreen(false); // Transition from waiting → active ready
        listenForReady();
      } else {
        readyScreen.style.display = 'none';
        applyRoomState(data);
      }
    });
  }

  function applyRoomState(data) {
    draftMode = data.mode;
    gameNumber = data.gameNumber || 1;

    modeBadge.textContent = draftMode === 'fearless' ? 'FEARLESS' : 'NORMAL';
    if (draftMode === 'fearless') {
      modeBadge.style.background = 'rgba(234, 179, 8, 0.15)';
      modeBadge.style.color = '#eab308';
    }
    gameLabel.textContent = `Game ${gameNumber}`;

    // Restore fearless lockout
    fearlessLockedOut = new Set(data.fearlessLocked || []);

    modeModal.style.display = 'none';
    draftContainer.style.display = 'flex';
    draftStarted = true;

    // Replay all actions to rebuild the board
    currentStep = 0;
    currentGameUsed = new Set();
    currentGamePicked = new Set();

    // Clear slots
    clearAllSlots();

    const actions = data.actions ? Object.values(data.actions).sort((a, b) => a.order - b.order) : [];
    isRemoteUpdate = true;
    actions.forEach(action => {
      applyAction(action.champId, action.phase, action.team, action.index);
    });
    isRemoteUpdate = false;

    updatePhaseDisplay();
    highlightActiveSlot();
    renderChampionGrid();
    renderFearlessHistory();
    updateControlsForRole();

    if (currentStep < DRAFT_ORDER.length) {
      startTimer();
    }

    listenForRemoteActions();
  }

  // ============================================
  // Firebase: Listen for new actions
  // ============================================
  function listenForRemoteActions() {
    if (!roomRef) return;

    const actionsRef = roomRef.child('actions');

    actionsRef.on('child_added', snap => {
      const action = snap.val();
      if (!action) return;
      // Skip actions we've already applied locally
      if (action.order < currentStep) return;
      // Skip if we're in the middle of pushing our own action
      if (isRemoteUpdate) return;

      if (action.order === currentStep) {
        // New remote action
        isRemoteUpdate = true;
        applyAction(action.champId, action.phase, action.team, action.index);
        isRemoteUpdate = false;

        selectedChampion = null;
        lockInBtn.disabled = true;
        document.querySelectorAll('.draft-champ-cell').forEach(c => c.classList.remove('selected'));

        updatePhaseDisplay();
        highlightActiveSlot();
        renderChampionGrid();
        updateControlsForRole();

        if (currentStep >= DRAFT_ORDER.length) {
          onDraftComplete();
        } else {
          resetTimer();
        }
      }
    });

    // Listen for game changes (fearless next game)
    roomRef.child('gameNumber').on('value', snap => {
      const g = snap.val();
      if (g && g !== gameNumber && !isHost) {
        // Host advanced to next game — check if we need ready screen
        roomRef.once('value').then(s => {
          const data = s.val();
          if (!data) return;
          if (!data.started) {
            // Next game not started yet — show ready screen
            applyModeFromData(data);
            fearlessLockedOut = new Set(data.fearlessLocked || []);
            const overlay = document.querySelector('.draft-complete-overlay');
            if (overlay) overlay.remove();
            draftContainer.style.display = 'none';
            draftStarted = false;
            showReadyScreen(false);
            listenForReady();
          } else {
            applyRoomState(data);
          }
        });
      }
    });
  }

  // ============================================
  // Apply a single draft action (shared logic)
  // ============================================
  function applyAction(champId, phase, team, index) {
    const champ = champId ? champions.find(c => c.id === champId) : null;

    if (champId) {
      currentGameUsed.add(champId);
      if (phase === 'pick') currentGamePicked.add(champId);
    }

    if (phase === 'ban') {
      const slot = document.querySelector(`.ban-slot[data-team="${team}"][data-index="${index}"]`);
      if (slot) {
        if (champ) {
          slot.innerHTML = `<img src="${getChampImgUrl(champId)}" alt="${champ.name}">`;
        } else {
          slot.innerHTML = '<span style="font-size:18px;color:#ef4444;">✕</span>';
        }
        slot.classList.add('filled');
        slot.classList.remove('active');
      }
    } else {
      const slot = document.querySelector(`.pick-slot[data-team="${team}"][data-index="${index}"]`);
      if (slot) {
        slot.innerHTML = '';
        if (champ) {
          const img = document.createElement('img');
          img.className = 'pick-champ-img';
          img.src = getChampImgUrl(champId);
          img.alt = champ.name;
          slot.appendChild(img);
          const nameEl = document.createElement('span');
          nameEl.className = 'pick-champ-name';
          nameEl.textContent = champ.name;
          slot.appendChild(nameEl);
        }
        slot.classList.add('filled');
        slot.classList.remove('active');
      }
    }

    currentStep++;
  }

  // ============================================
  // Role Banner
  // ============================================
  function showRoleBanner() {
    if (!myRole) return;
    roleBanner.style.display = 'block';
    if (myRole === 'blue') {
      roleBanner.textContent = 'BLUE TEAM';
      roleBanner.className = 'role-banner blue-role';
    } else if (myRole === 'red') {
      roleBanner.textContent = 'RED TEAM';
      roleBanner.className = 'role-banner red-role';
    } else {
      roleBanner.textContent = 'SPECTATOR (View Only)';
      roleBanner.className = 'role-banner spectator-role';
    }
  }

  // ============================================
  // Role-Based UI Locking
  // ============================================
  function isMyTurn() {
    if (myRole === 'spectator') return false;
    const step = getCurrentStep();
    if (!step) return false;
    return step.team === myRole;
  }

  function updateControlsForRole() {
    const controls = document.querySelector('.draft-controls');
    const step = getCurrentStep();

    if (myRole === 'spectator') {
      // Spectators can never interact
      controls.classList.add('locked');
      champGrid.classList.add('locked-grid');
      lockInBtn.disabled = true;
      return;
    }

    if (!step || currentStep >= DRAFT_ORDER.length) {
      controls.classList.remove('locked');
      champGrid.classList.remove('locked-grid');
      return;
    }

    if (!isMyTurn()) {
      // Not this role's turn
      controls.classList.add('locked');
      champGrid.classList.add('locked-grid');
      lockInBtn.disabled = true;
    } else {
      controls.classList.remove('locked');
      champGrid.classList.remove('locked-grid');
    }
  }

  // ============================================
  // Load Champions
  // ============================================
  async function loadChampions() {
    try {
      const res = await fetch(`${DDRAGON_BASE}/data/en_US/champion.json`);
      const data = await res.json();
      champions = Object.values(data.data).sort((a, b) => a.name.localeCompare(b.name));
      renderChampionGrid();

      // Preload all champion images into browser cache
      champions.forEach(champ => {
        const img = new Image();
        img.src = getChampImgUrl(champ.id);
      });
    } catch (e) {
      console.error('Failed to load champions', e);
    }
  }

  function getChampImgUrl(championId) {
    return `${DDRAGON_BASE}/img/champion/${championId}.png`;
  }

  // ============================================
  // Champion Grid
  // ============================================
  function renderChampionGrid() {
    champGrid.innerHTML = '';
    const searchVal = champSearch.value.toLowerCase().trim();

    champions.forEach(champ => {
      if (searchVal && !champ.name.toLowerCase().includes(searchVal)) return;

      if (activeRoleFilter !== 'all') {
        const roleMap = {
          top: ['Fighter', 'Tank'],
          jungle: ['Fighter', 'Assassin', 'Tank'],
          mid: ['Mage', 'Assassin'],
          bot: ['Marksman'],
          support: ['Support', 'Tank', 'Mage'],
        };
        const tags = roleMap[activeRoleFilter] || [];
        if (!champ.tags.some(t => tags.includes(t))) return;
      }

      const cell = document.createElement('div');
      cell.className = 'draft-champ-cell';
      cell.dataset.champId = champ.id;

      const step = getCurrentStep();
      const isPickPhase = step && step.phase === 'pick';
      const usedThisGame = currentGameUsed.has(champ.id);
      const fearlessLocked = fearlessLockedOut.has(champ.id);

      if (usedThisGame) {
        cell.classList.add('disabled');
      } else if (fearlessLocked && isPickPhase) {
        cell.classList.add('disabled');
        cell.classList.add('banned-out');
      } else if (fearlessLocked) {
        cell.classList.add('banned-out');
      }

      const img = document.createElement('img');
      img.src = getChampImgUrl(champ.id);
      img.alt = champ.name;
      cell.appendChild(img);

      const nameEl = document.createElement('div');
      nameEl.className = 'champ-name-tooltip';
      nameEl.textContent = champ.name;
      cell.appendChild(nameEl);

      cell.addEventListener('click', () => selectChampion(champ.id));

      champGrid.appendChild(cell);
    });
  }

  champSearch.addEventListener('input', renderChampionGrid);

  roleFilters.forEach(btn => {
    btn.addEventListener('click', () => {
      roleFilters.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeRoleFilter = btn.dataset.role;
      renderChampionGrid();
    });
  });

  // ============================================
  // Draft Logic
  // ============================================
  function clearAllSlots() {
    document.querySelectorAll('.ban-slot').forEach(slot => {
      slot.classList.remove('filled', 'active');
      slot.innerHTML = '';
    });
    document.querySelectorAll('.pick-slot').forEach(slot => {
      slot.classList.remove('filled', 'active');
      slot.innerHTML = '';
      const r = document.createElement('span');
      r.className = 'pick-role';
      const team = slot.dataset.team === 'blue' ? 'B' : 'R';
      r.textContent = team + (parseInt(slot.dataset.index) + 1);
      slot.appendChild(r);
    });
  }

  function initDraft() {
    currentStep = 0;
    selectedChampion = null;
    currentGameUsed = new Set();
    currentGamePicked = new Set();
    timerValue = 30;

    clearAllSlots();

    nextGameBtn.style.display = 'none';
    lockInBtn.disabled = true;
    updatePhaseDisplay();
    highlightActiveSlot();
    renderChampionGrid();
    renderFearlessHistory();
    updateControlsForRole();
    startTimer();
  }

  function getCurrentStep() {
    if (currentStep >= DRAFT_ORDER.length) return null;
    return DRAFT_ORDER[currentStep];
  }

  function selectChampion(champId) {
    if (currentStep >= DRAFT_ORDER.length) return;
    if (currentGameUsed.has(champId)) return;
    if (myRole === 'spectator') return;
    if (!isMyTurn()) return;

    const step = getCurrentStep();
    if (fearlessLockedOut.has(champId) && step && step.phase === 'pick') return;

    selectedChampion = champId;
    lockInBtn.disabled = false;

    document.querySelectorAll('.draft-champ-cell').forEach(cell => {
      cell.classList.toggle('selected', cell.dataset.champId === champId);
    });

    previewInSlot(champId);
  }

  function previewInSlot(champId) {
    const step = getCurrentStep();
    if (!step) return;
    const champ = champions.find(c => c.id === champId);
    if (!champ) return;

    if (step.phase === 'ban') {
      const slot = document.querySelector(`.ban-slot[data-team="${step.team}"][data-index="${step.index}"]`);
      if (slot && !slot.classList.contains('filled')) {
        slot.innerHTML = `<img src="${getChampImgUrl(champId)}" alt="${champ.name}" style="opacity:0.5">`;
      }
    } else {
      const slot = document.querySelector(`.pick-slot[data-team="${step.team}"][data-index="${step.index}"]`);
      if (slot && !slot.classList.contains('filled')) {
        const role = slot.querySelector('.pick-role');
        slot.innerHTML = '';
        const img = document.createElement('img');
        img.className = 'pick-champ-img';
        img.src = getChampImgUrl(champId);
        img.alt = champ.name;
        img.style.opacity = '0.5';
        slot.appendChild(img);
        const nameEl = document.createElement('span');
        nameEl.className = 'pick-champ-name';
        nameEl.textContent = champ.name;
        nameEl.style.opacity = '0.5';
        slot.appendChild(nameEl);
        if (role) { role.style.display = 'none'; slot.appendChild(role); }
      }
    }
  }

  function lockIn() {
    if (!selectedChampion || currentStep >= DRAFT_ORDER.length) return;
    if (myRole === 'spectator') return;
    if (!isMyTurn()) return;

    const step = getCurrentStep();
    const champId = selectedChampion;
    const champ = champions.find(c => c.id === champId);
    if (!champ) return;

    // Push action to Firebase
    if (roomRef) {
      isRemoteUpdate = true;
      const actionData = {
        order: currentStep,
        champId,
        phase: step.phase,
        team: step.team,
        index: step.index,
      };
      roomRef.child('actions').push(actionData);
      roomRef.child('currentStep').set(currentStep + 1);
    }

    // Apply locally
    applyAction(champId, step.phase, step.team, step.index);
    isRemoteUpdate = false;

    selectedChampion = null;
    lockInBtn.disabled = true;
    document.querySelectorAll('.draft-champ-cell').forEach(c => c.classList.remove('selected'));

    if (currentStep >= DRAFT_ORDER.length) {
      onDraftComplete();
    } else {
      updatePhaseDisplay();
      highlightActiveSlot();
      renderChampionGrid();
      updateControlsForRole();
      resetTimer();
    }
  }

  lockInBtn.addEventListener('click', lockIn);

  // ============================================
  // Timer
  // ============================================
  function startTimer() {
    clearInterval(timerInterval);
    timerValue = 30;
    draftTimer.textContent = timerValue;
    draftTimer.classList.remove('urgent');

    timerInterval = setInterval(() => {
      timerValue--;
      draftTimer.textContent = Math.max(0, timerValue);
      if (timerValue <= 5) draftTimer.classList.add('urgent');
      if (timerValue <= 0) {
        clearInterval(timerInterval);
        timerExpired();
      }
    }, 1000);
  }

  function timerExpired() {
    if (!isMyTurn()) return;
    const step = getCurrentStep();
    if (!step) return;

    if (selectedChampion) {
      // Auto lock-in the selected champion
      lockIn();
    } else if (step.phase === 'pick') {
      // Pick a random available champion
      const available = champions.filter(c => {
        if (currentGameUsed.has(c.id)) return false;
        if (fearlessLockedOut.has(c.id)) return false;
        return true;
      });
      if (available.length > 0) {
        const randomIdx = Math.floor(Math.random() * available.length);
        selectedChampion = available[randomIdx].id;
        lockIn();
      }
    } else {
      // Ban phase, no champion selected — skip the ban
      autoSkipBan(step);
    }
  }

  function autoSkipBan(step) {
    // Push skipped ban to Firebase
    if (roomRef) {
      isRemoteUpdate = true;
      const actionData = {
        order: currentStep,
        champId: null,
        phase: step.phase,
        team: step.team,
        index: step.index,
      };
      roomRef.child('actions').push(actionData);
      roomRef.child('currentStep').set(currentStep + 1);
    }

    // Apply locally
    applyAction(null, step.phase, step.team, step.index);
    isRemoteUpdate = false;

    selectedChampion = null;
    lockInBtn.disabled = true;
    document.querySelectorAll('.draft-champ-cell').forEach(c => c.classList.remove('selected'));

    if (currentStep >= DRAFT_ORDER.length) {
      onDraftComplete();
    } else {
      updatePhaseDisplay();
      highlightActiveSlot();
      renderChampionGrid();
      updateControlsForRole();
      resetTimer();
    }
  }

  function resetTimer() {
    startTimer();
  }

  // ============================================
  // UI Updates
  // ============================================
  function updatePhaseDisplay() {
    const step = getCurrentStep();
    if (!step) {
      phaseLabel.textContent = 'Draft Complete';
      clearInterval(timerInterval);
      draftTimer.textContent = '--';
      return;
    }

    const stepIdx = currentStep;
    let phaseName;
    if (stepIdx < 6) phaseName = 'Ban Phase 1';
    else if (stepIdx < 12) phaseName = 'Pick Phase 1';
    else if (stepIdx < 16) phaseName = 'Ban Phase 2';
    else phaseName = 'Pick Phase 2';

    const teamName = step.team === 'blue' ? 'Blue' : 'Red';
    const action = step.phase === 'ban' ? 'Ban' : 'Pick';
    phaseLabel.textContent = `${phaseName} — ${teamName} ${action}`;
  }

  function highlightActiveSlot() {
    document.querySelectorAll('.ban-slot.active, .pick-slot.active').forEach(s => s.classList.remove('active'));
    const step = getCurrentStep();
    if (!step) return;
    const selector = step.phase === 'ban'
      ? `.ban-slot[data-team="${step.team}"][data-index="${step.index}"]`
      : `.pick-slot[data-team="${step.team}"][data-index="${step.index}"]`;
    const slot = document.querySelector(selector);
    if (slot) slot.classList.add('active');
  }

  // ============================================
  // Draft Complete
  // ============================================
  function onDraftComplete() {
    clearInterval(timerInterval);
    draftTimer.textContent = '--';
    phaseLabel.textContent = 'Draft Complete';

    if (draftMode === 'fearless') {
      currentGamePicked.forEach(id => fearlessLockedOut.add(id));
      nextGameBtn.style.display = '';
      renderFearlessHistory();

      // Sync fearless lockout
      if (roomRef) {
        roomRef.child('fearlessLocked').set(Array.from(fearlessLockedOut));
      }
    }

    const overlay = document.createElement('div');
    overlay.className = 'draft-complete-overlay';
    const isSpectator = myRole === 'spectator';
    overlay.innerHTML = `
      <div class="draft-complete-content">
        <h2>Draft Complete!</h2>
        <p>${draftMode === 'fearless' && !isSpectator ? 'Click "Next Game" to start the next fearless draft.' : isSpectator ? 'Waiting for host to proceed.' : 'The draft has been completed.'}</p>
        <div class="draft-complete-actions">
          ${draftMode === 'fearless' && !isSpectator ? '<button class="draft-ctrl-btn next-game-btn" id="overlayNextGame">Next Game</button>' : ''}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    if (draftMode === 'fearless' && !isSpectator) {
      document.getElementById('overlayNextGame').addEventListener('click', () => {
        overlay.remove();
        startNextGame();
      });
    }
  }

  // ============================================
  // Fearless: Next Game
  // ============================================
  nextGameBtn.addEventListener('click', startNextGame);

  function startNextGame() {
    if (myRole === 'spectator') return;
    gameNumber++;
    gameLabel.textContent = `Game ${gameNumber}`;
    nextGameBtn.style.display = 'none';

    const overlay = document.querySelector('.draft-complete-overlay');
    if (overlay) overlay.remove();

    // Sync to Firebase with ready reset
    if (roomRef) {
      roomRef.update({
        gameNumber,
        currentStep: 0,
        started: false,
        ready: { blue: false, red: false },
        actions: null,
        fearlessLocked: Array.from(fearlessLockedOut),
      });
      draftContainer.style.display = 'none';
      draftStarted = false;
      showReadyScreen(false);
      listenForReady();
    } else {
      initDraft();
    }
  }

  function renderFearlessHistory() {
    if (draftMode !== 'fearless') {
      fearlessHistory.style.display = 'none';
      return;
    }
    if (fearlessLockedOut.size === 0) {
      fearlessHistory.style.display = 'none';
      return;
    }
    fearlessHistory.style.display = '';
    fearlessChampList.innerHTML = '';
    fearlessLockedOut.forEach(champId => {
      const div = document.createElement('div');
      div.className = 'fearless-champ';
      div.innerHTML = `<img src="${getChampImgUrl(champId)}" alt="${champId}">`;
      fearlessChampList.appendChild(div);
    });
  }

  // ============================================
  // Keyboard shortcuts
  // ============================================
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !lockInBtn.disabled) {
      lockIn();
    }
    if (e.key === 'Escape') {
      selectedChampion = null;
      lockInBtn.disabled = true;
      document.querySelectorAll('.draft-champ-cell').forEach(c => c.classList.remove('selected'));
      const step = getCurrentStep();
      if (step) {
        if (step.phase === 'ban') {
          const slot = document.querySelector(`.ban-slot[data-team="${step.team}"][data-index="${step.index}"]`);
          if (slot && !slot.classList.contains('filled')) slot.innerHTML = '';
        } else {
          const slot = document.querySelector(`.pick-slot[data-team="${step.team}"][data-index="${step.index}"]`);
          if (slot && !slot.classList.contains('filled')) {
            slot.innerHTML = '';
            const r = document.createElement('span');
            r.className = 'pick-role';
            const teamLetter = step.team === 'blue' ? 'B' : 'R';
            r.textContent = teamLetter + (step.index + 1);
            slot.appendChild(r);
          }
        }
      }
    }
  });

  // ============================================
  // Boot
  // ============================================
  boot();
})();
