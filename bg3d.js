/* ==========================================================================
   bg3d.js — Luxury 3D Tic-Tac-Toe background (vanilla Three.js r128)
   Obsidian board, champagne-gold X, platinum O, studio lighting, soft shadows.
   Public API:  TicTacToeBackground.placePiece(cell, 'X' | 'O')
                TicTacToeBackground.clear()
                TicTacToeBackground.setInteractive(true)
                TicTacToeBackground.onCellClick = (cellIndex) => {}
                TicTacToeBackground.dispose()
   ========================================================================== */
(() => {
  'use strict';
  if (typeof THREE === 'undefined') return console.warn('bg3d: Three.js failed to load.');

  /* ---------- Config ---------- */
  const CFG = {
    colors: { base: 0x0d0d0d, tile: 0x1b1b1b, gold: 0xd4af37, platinum: 0xe9e7e2 },
    pitch: 1.25,          // distance between cell centres
    tileSize: 1.1,
    maxPixelRatio: 2,
    shadowMapSize: 2048,
    demo: { 0: 'X', 1: 'O', 4: 'X', 8: 'O', 6: 'X' }, // decorative starting position
  };
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Page integration (CSS) ---------- */
  function injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
      html { background: radial-gradient(ellipse at 70% 40%, #2a2a2a 0%, #111111 60%, #0a0a0a 100%) !important; }
      body, body.home { background: transparent !important; }
      body::before, body::after, #bg { display: none !important; }
      #bg3d { position: fixed; inset: 0; width: 100%; height: 100%; z-index: -1; pointer-events: none; }`;
    document.head.appendChild(s);
  }

  /* ---------- Geometry helpers ---------- */
  function roundedRectShape(w, h, r) {
    const x = -w / 2, y = -h / 2, s = new THREE.Shape();
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);     s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h);     s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r);         s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  // Rounded, bevelled slab lying flat (width × depth footprint, given total height), centred on origin.
  function roundedSlab(width, depth, height, radius, bevel) {
    const g = new THREE.ExtrudeGeometry(
      roundedRectShape(width - 2 * bevel, depth - 2 * bevel, Math.max(radius - bevel, 0.001)),
      { depth: height - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 14 }
    );
    g.rotateX(-Math.PI / 2);
    g.center();
    return g;
  }

  /* ---------- Renderer, camera, lights, environment ---------- */
  function createRenderer() {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio, CFG.maxPixelRatio));
    r.outputEncoding = THREE.sRGBEncoding;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.15;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.domElement.id = 'bg3d';
    document.body.prepend(r.domElement);
    return r;
  }

  // Procedural studio: a few bright "softbox" panels baked into a PMREM environment map for reflections.
  function createEnvironment(renderer) {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x080808);
    const panel = (w, h, x, y, z, intensity, color = 0xffffff) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide })
      );
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    panel(14, 5, 0, 10, 0, 6);                 // overhead softbox
    panel(3, 10, -9, 3, 4, 5, 0xfff0d8);       // warm key strip
    panel(3, 10, 9, 3, -4, 3, 0xcfdcff);       // cool kicker
    panel(12, 2, 0, 2, -10, 2.5);              // back strip
    const pmrem = new THREE.PMREMGenerator(renderer);
    const tex = pmrem.fromScene(env, 0.04).texture;
    pmrem.dispose();
    return tex;
  }

  function createLights(scene, target) {
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));

    const key = new THREE.SpotLight(0xfff1d6, 1.8, 40, 0.42, 0.9, 1);
    key.position.set(-4, 9, 5);
    key.target = target;
    key.castShadow = true;
    key.shadow.mapSize.set(CFG.shadowMapSize, CFG.shadowMapSize);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.camera.near = 4;
    key.shadow.camera.far = 25;
    scene.add(key, key.target);

    const rim = new THREE.DirectionalLight(0xbfd0ff, 0.35); // faint cool rim, no shadow
    rim.position.set(5, 3, -6);
    scene.add(rim);
  }

  /* ---------- Board ---------- */
  const cellPosition = (i) => new THREE.Vector3(((i % 3) - 1) * CFG.pitch, 0, (Math.floor(i / 3) - 1) * CFG.pitch);
  const BASE_H = 0.2, TILE_H = 0.06;

  function buildBoard() {
    const group = new THREE.Group();
    const tiles = [];

    const base = new THREE.Mesh(
      roundedSlab(4.3, 4.3, BASE_H, 0.24, 0.03),
      new THREE.MeshStandardMaterial({ color: CFG.colors.base, roughness: 0.85, metalness: 0.05 })
    );
    base.position.y = -BASE_H / 2;
    base.castShadow = base.receiveShadow = true;
    group.add(base);

    const tileGeo = roundedSlab(CFG.tileSize, CFG.tileSize, TILE_H, 0.12, 0.012);
    for (let i = 0; i < 9; i++) {
      const tile = new THREE.Mesh(
        tileGeo,
        new THREE.MeshStandardMaterial({ color: CFG.colors.tile, roughness: 0.5, metalness: 0.2, emissive: 0x000000 })
      );
      tile.position.copy(cellPosition(i)).setY(TILE_H / 2);
      tile.receiveShadow = true;
      tile.userData.cell = i;
      group.add(tile);
      tiles.push(tile);
    }

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.5 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -BASE_H - 0.001;
    ground.receiveShadow = true;
    group.add(ground);

    return { group, tiles };
  }

  /* ---------- Pieces ---------- */
  const goldMat = () => new THREE.MeshStandardMaterial({ color: CFG.colors.gold, metalness: 1, roughness: 0.3, envMapIntensity: 1.2 });
  const platMat = () => new THREE.MeshStandardMaterial({ color: CFG.colors.platinum, metalness: 1, roughness: 0.24, envMapIntensity: 1.2 });

  function createPieceX() {
    const g = new THREE.Group(), mat = goldMat();
    const geo = roundedSlab(0.86, 0.2, 0.14, 0.1, 0.03);
    [Math.PI / 4, -Math.PI / 4].forEach((angle) => {
      const bar = new THREE.Mesh(geo, mat);
      bar.rotation.y = angle;
      bar.castShadow = bar.receiveShadow = true;
      g.add(bar);
    });
    g.userData.height = 0.14;
    return g;
  }

  function createPieceO() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.1, 40, 96), platMat());
    ring.rotation.x = Math.PI / 2;
    ring.scale.z = 0.85;
    ring.castShadow = ring.receiveShadow = true;
    g.add(ring);
    g.userData.height = 0.17;
    return g;
  }

  /* ---------- App ---------- */
  function init() {
    injectStyles();
    const renderer = createRenderer();
    const scene = new THREE.Scene();
    scene.environment = createEnvironment(renderer);

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 6.2, 7.6);
    camera.lookAt(0, 0, 0);

    const { group: board, tiles } = buildBoard();
    scene.add(board);
    createLights(scene, board);

    const pieces = new Array(9).fill(null);
    const tweens = [];
    const clock = new THREE.Clock();
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const mouse = { x: 0, y: 0, sx: 0, sy: 0 }; // target + smoothed
    let hovered = null, interactive = false, raf = 0;

    const easeOutBack = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);

    const api = {
      onCellClick: null,
      placePiece(cell, type, delay = 0) {
        if (cell < 0 || cell > 8 || pieces[cell]) return false;
        const piece = type === 'X' ? createPieceX() : createPieceO();
        piece.position.copy(cellPosition(cell)).setY(TILE_H + piece.userData.height / 2);
        pieces[cell] = piece;
        board.add(piece);
        if (reduceMotion) piece.scale.setScalar(1);
        else {
          piece.scale.setScalar(0.001);
          tweens.push({ piece, start: clock.elapsedTime + delay, dur: 0.7 });
        }
        return true;
      },
      clear() {
        pieces.forEach((p, i) => { if (p) { board.remove(p); disposeTree(p); pieces[i] = null; } });
      },
      setInteractive(on) { interactive = !!on; if (!on) setHover(null); },
      dispose() {
        cancelAnimationFrame(raf);
        removeEventListener('resize', onResize);
        removeEventListener('pointermove', onPointerMove);
        removeEventListener('click', onClick);
        disposeTree(scene);
        renderer.dispose();
        renderer.domElement.remove();
      },
    };

    function disposeTree(root) {
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) [].concat(o.material).forEach((m) => m.dispose());
      });
    }

    /* Layout: board sits to the right on wide screens, centred + dimmed on narrow ones. */
    function onResize() {
      const w = innerWidth, h = innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      const visibleH = 2 * camera.position.length() * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const wide = camera.aspect > 1.15;
      const fit = Math.min(1, (visibleH * camera.aspect * (wide ? 0.5 : 0.9)) / 4.6);
      board.scale.setScalar(fit);
      board.position.set(wide ? visibleH * camera.aspect * 0.24 : 0, 0, wide ? 0 : -0.5);
      renderer.domElement.style.opacity = wide ? '1' : '0.5';
    }

    /* Raycaster foundation: hover + click on cells (only when interactive). */
    const ignoreTarget = (e) => e.target.closest && e.target.closest('main, button, input, a');
    function setHover(tile) {
      if (hovered === tile) return;
      if (hovered) hovered.material.emissive.setHex(0x000000);
      hovered = tile;
      if (hovered) hovered.material.emissive.setHex(0x2b2210);
    }
    function onPointerMove(e) {
      mouse.x = (e.clientX / innerWidth) * 2 - 1;
      mouse.y = (e.clientY / innerHeight) * 2 - 1;
      if (!interactive || ignoreTarget(e)) return setHover(null);
      ndc.set(mouse.x, -mouse.y);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(tiles, false)[0];
      setHover(hit ? hit.object : null);
    }
    function onClick(e) {
      if (!interactive || ignoreTarget(e) || !hovered) return;
      if (typeof api.onCellClick === 'function') api.onCellClick(hovered.userData.cell);
    }

    function tick() {
      raf = requestAnimationFrame(tick);
      clock.getDelta(); // advances clock.elapsedTime
      const t = clock.elapsedTime;

      for (let i = tweens.length - 1; i >= 0; i--) {
        const tw = tweens[i];
        const k = Math.min(Math.max((t - tw.start) / tw.dur, 0), 1);
        tw.piece.scale.setScalar(Math.max(easeOutBack(k), 0.001));
        if (k >= 1) tweens.splice(i, 1);
      }

      if (!reduceMotion) {
        mouse.sx += (mouse.x - mouse.sx) * 0.04;
        mouse.sy += (mouse.y - mouse.sy) * 0.04;
        board.rotation.y = -0.4 + Math.sin(t * 0.18) * 0.12 + mouse.sx * 0.22;
        camera.position.y = 6.2 - mouse.sy * 0.5;
        camera.lookAt(0, 0, 0);
      } else board.rotation.y = -0.4;

      renderer.render(scene, camera);
    }

    addEventListener('resize', onResize);
    addEventListener('pointermove', onPointerMove, { passive: true });
    addEventListener('click', onClick);
    onResize();

    Object.entries(CFG.demo).forEach(([cell, type], n) => api.placePiece(+cell, type, 0.4 + n * 0.18));
    tick();
    return api;
  }

  window.TicTacToeBackground = init();
})();
