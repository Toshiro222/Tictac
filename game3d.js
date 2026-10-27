/* ==========================================================================
   game3d.js — the playable 3D board (vanilla Three.js r128)
   Public API (used by client.js):
     Board3D.sync(boardArray, winLine)  → draws/animates pieces from server state
     Board3D.setPlayer('X' | 'O')       → which ghost preview to show on hover
     Board3D.setInteractive(bool)       → true only when it's your turn
     Board3D.setMode('lobby' | 'game')  → moves the board between layouts
     Board3D.reset()                    → removes every piece
     Board3D.onCellClick = (i) => {}    → fired when an empty cell is clicked
   ========================================================================== */
const Board3D = (() => {
  'use strict';
  const C = { gold: 0xd4af37, ceramic: 0xf3f1ec, pitch: 1.25, tile: 1.1, baseH: 0.24, tileH: 0.06 };
  const CAM = new THREE.Vector3(0, 6.4, 7.4);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ----- Geometry helpers ----- */
  function roundedRect(w, h, r) {
    const x = -w / 2, y = -h / 2, s = new THREE.Shape();
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);     s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h);     s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r);         s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  function slab(w, d, h, r, b) { // rounded, bevelled slab lying flat, centred on origin
    const g = new THREE.ExtrudeGeometry(roundedRect(w - 2 * b, d - 2 * b, Math.max(r - b, 0.001)),
      { depth: h - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 5, curveSegments: 14 });
    g.rotateX(-Math.PI / 2); g.center();
    return g;
  }
  const easeOutBounce = (t) => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  };

  /* ----- Studio environment (softbox panels → PMREM) for reflections ----- */
  function createEnvironment(renderer) {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x080808);
    const panel = (w, h, x, y, z, k, color = 0xffffff) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m);
    };
    panel(14, 5, 0, 10, 0, 6); panel(3, 10, -9, 3, 4, 5, 0xfff0d8);
    panel(3, 10, 9, 3, -4, 3, 0xcfdcff); panel(12, 2, 0, 2, -10, 2.5);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const tex = pmrem.fromScene(env, 0.04).texture;
    pmrem.dispose();
    return tex;
  }

  /* ----- Tokens ----- */
  function makePiece(type, ghost = false) {
    const g = new THREE.Group(), mats = [];
    const mat = (opts) => {
      const m = new THREE.MeshStandardMaterial(ghost ? { ...opts, transparent: true, opacity: 0.35, depthWrite: false } : opts);
      mats.push(m); return m;
    };
    if (type === 'X') {
      const m = mat({ color: C.gold, metalness: 1, roughness: 0.34, envMapIntensity: 1.2 }); // polished champagne gold
      const geo = slab(0.86, 0.2, 0.14, 0.1, 0.03);
      [Math.PI / 4, -Math.PI / 4].forEach((a) => {
        const bar = new THREE.Mesh(geo, m);
        bar.rotation.y = a; bar.castShadow = !ghost; bar.receiveShadow = !ghost; g.add(bar);
      });
      g.userData.h = 0.14; g.userData.glow = 0x6b5210;
    } else {
      const m = mat({ color: C.ceramic, metalness: 0.35, roughness: 0.2, emissive: 0x1d1d1b, envMapIntensity: 1.1 }); // glowing ceramic
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.1, 40, 96), m);
      ring.rotation.x = Math.PI / 2; ring.scale.z = 0.85; ring.castShadow = !ghost; ring.receiveShadow = !ghost; g.add(ring);
      g.userData.h = 0.17; g.userData.glow = 0xb8b4a8;
    }
    g.userData.mats = mats;
    return g;
  }

  /* ----- Scene ----- */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;       // cinematic tone curve
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;          // soft, high-quality shadows
  renderer.domElement.id = 'scene';
  document.body.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.environment = createEnvironment(renderer);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.copy(CAM);

  scene.add(new THREE.AmbientLight(0xffffff, 0.3));          // soft fill
  const key = new THREE.DirectionalLight(0xfff1d6, 2.2);     // sharp studio key light
  key.position.set(-4, 9, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 2, far: 25 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfd0ff, 0.4); rim.position.set(5, 3, -6); scene.add(rim);

  /* ----- Board: obsidian slab + 9 inset tiles ----- */
  const board = new THREE.Group(); scene.add(board);
  const cellPos = (i) => new THREE.Vector3(((i % 3) - 1) * C.pitch, 0, (Math.floor(i / 3) - 1) * C.pitch);

  const base = new THREE.Mesh(slab(4.3, 4.3, C.baseH, 0.26, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x0e0e10, roughness: 0.15, metalness: 0.1, envMapIntensity: 0.9 }));
  base.position.y = -C.baseH / 2; base.castShadow = base.receiveShadow = true; board.add(base);

  const tileGeo = slab(C.tile, C.tile, C.tileH, 0.12, 0.012);
  const tiles = [];
  for (let i = 0; i < 9; i++) {
    const t = new THREE.Mesh(tileGeo, new THREE.MeshStandardMaterial({ color: 0x1b1b1e, roughness: 0.35, metalness: 0.1, emissive: 0x000000 }));
    t.position.copy(cellPos(i)).setY(C.tileH / 2); t.receiveShadow = true; t.userData.cell = i;
    board.add(t); tiles.push(t);
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.5 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -C.baseH - 0.001; ground.receiveShadow = true; board.add(ground);

  /* ----- State ----- */
  const pieces = new Array(9).fill(null);
  const ghosts = { X: makePiece('X', true), O: makePiece('O', true) };
  Object.values(ghosts).forEach((gh) => { gh.visible = false; board.add(gh); });
  const tweens = [];
  const clock = new THREE.Clock();
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
  let mode = 'lobby', player = 'X', interactive = false, hovered = -1, winLine = null;
  const view = { x: 0, z: 0, s: 1 };   // smoothed board layout

  /* ----- Layout: lobby = board on the right, game = centred ----- */
  function layoutTarget() {
    const vh = 2 * CAM.length() * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), vw = vh * camera.aspect;
    const fit = Math.min(vw * 0.86, vh * 0.8) / 4.6, wide = camera.aspect > 1.15;
    if (mode === 'game') return { x: 0, z: 0, s: fit };
    return wide ? { x: vw * 0.22, z: 0, s: fit * 0.9 } : { x: 0, z: -vh * 0.18, s: fit * 0.6 };
  }
  function onResize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  }

  /* ----- Raycaster: hover glow + ghost preview, click to place ----- */
  function setHover(cell) {
    if (hovered === cell) return;
    if (hovered >= 0) tiles[hovered].material.emissive.setHex(0x000000);
    hovered = cell;
    Object.values(ghosts).forEach((gh) => (gh.visible = false));
    renderer.domElement.style.cursor = cell >= 0 ? 'pointer' : 'default';
    if (cell < 0) return;
    tiles[cell].material.emissive.setHex(0x2b2210);
    const gh = ghosts[player];
    gh.position.copy(cellPos(cell)).setY(C.tileH + gh.userData.h / 2);
    gh.visible = true;
  }
  // Which empty cell is under the pointer? (-1 = none)
  function cellAt(e) {
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(tiles, false)[0];
    return hit && !pieces[hit.object.userData.cell] ? hit.object.userData.cell : -1;
  }
  function updateHover(e) {
    mouse.x = (e.clientX / innerWidth) * 2 - 1; mouse.y = (e.clientY / innerHeight) * 2 - 1;
    if (!interactive) return setHover(-1);
    setHover(cellAt(e));
  }
  const el = renderer.domElement;
  el.addEventListener('pointermove', updateHover);
  el.addEventListener('pointerdown', updateHover);               // touch: preview the tapped cell
  el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') setHover(-1); });
  el.addEventListener('pointercancel', () => setHover(-1));
  // Place on release. A phone fires pointerleave BEFORE click, which used to wipe the hovered
  // cell and cancel the move, so we raycast again right here instead of relying on hover state.
  el.addEventListener('pointerup', (e) => {
    if (!interactive || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const cell = cellAt(e);
    setHover(-1);
    if (cell >= 0 && api.onCellClick) api.onCellClick(cell);
  });

  /* ----- Placing / removing pieces ----- */
  function place(i, type) {
    const p = makePiece(type), y = C.tileH + p.userData.h / 2;
    p.position.copy(cellPos(i)).setY(y);
    pieces[i] = p; board.add(p);
    if (!reduceMotion) {   // fall from a short height with a bounce
      const t0 = clock.elapsedTime;
      tweens.push({ t0, dur: 0.9, run: (k) => { p.position.y = y + (1 - easeOutBounce(k)) * 1.5; p.scale.setScalar(0.85 + 0.15 * Math.min(1, k * 4)); } });
    }
  }
  function remove(i) {
    const p = pieces[i]; board.remove(p);
    p.traverse((o) => { if (o.material) o.material.dispose(); });
    pieces[i] = null;
  }
  function applyWin() {
    pieces.forEach((p, i) => {
      if (!p) return;
      const win = !!winLine && winLine.includes(i);
      p.userData.win = win;
      p.userData.mats.forEach((m) => { m.emissive.setHex(win ? p.userData.glow : (p.userData.glow && p.children[0].geometry.type === 'TorusGeometry' ? 0x1d1d1b : 0x000000)); m.emissiveIntensity = 1; });
    });
  }

  /* ----- Public API ----- */
  const api = {
    onCellClick: null,
    sync(boardArr, line) {
      for (let i = 0; i < 9; i++) {
        if (boardArr[i] && !pieces[i]) place(i, boardArr[i]);
        else if (!boardArr[i] && pieces[i]) remove(i);
      }
      winLine = line || null; applyWin();
      if (hovered >= 0 && pieces[hovered]) setHover(-1);
    },
    reset() { for (let i = 0; i < 9; i++) if (pieces[i]) remove(i); winLine = null; setHover(-1); },
    setPlayer(s) { player = s; },
    setInteractive(on) { interactive = !!on; if (!on) setHover(-1); },
    setMode(m) { mode = m; },
  };

  /* ----- Render loop ----- */
  function tick() {
    requestAnimationFrame(tick);
    clock.getDelta(); const t = clock.elapsedTime;

    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i], k = Math.min((t - tw.t0) / tw.dur, 1);
      tw.run(k); if (k >= 1) tweens.splice(i, 1);
    }
    const target = layoutTarget(), lerp = reduceMotion ? 1 : 0.06;
    view.x += (target.x - view.x) * lerp; view.z += (target.z - view.z) * lerp; view.s += (target.s - view.s) * lerp;
    board.position.set(view.x, 0, view.z); board.scale.setScalar(view.s);

    if (!reduceMotion) {
      mouse.sx += (mouse.x - mouse.sx) * 0.04; mouse.sy += (mouse.y - mouse.sy) * 0.04;
      board.rotation.y = -0.35 + Math.sin(t * 0.18) * 0.1 + mouse.sx * 0.18;
      camera.position.y = CAM.y - mouse.sy * 0.4; camera.lookAt(0, 0, 0);
      pieces.forEach((p) => p && p.userData.win && p.userData.mats.forEach((m) => (m.emissiveIntensity = 0.7 + 0.5 * Math.sin(t * 4))));
    } else board.rotation.y = -0.35;

    renderer.render(scene, camera);
  }
  addEventListener('resize', onResize);
  onResize(); tick();
  return api;
})();