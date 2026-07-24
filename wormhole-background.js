(() => {
  const canvas = document.querySelector("#wormhole-background");
  if (!canvas) return;

  const context = canvas.getContext("2d", {
    alpha: false,
    desynchronized: true,
  });
  if (!context) return;

  const TAU = Math.PI * 2;
  const RING_SPACING = 0.34;
  const NEAR_DEPTH = 1.55;
  const FAR_DEPTH = 34;
  const TUBE_RADIUS = 2.85;
  const SPEED = 2.35;
  const TILE_SIZE = 64;
  const ATLAS_COLUMNS = 8;
  const FAR_GLYPHS = "....::::····";
  const MID_GLYPHS = "01+-=<>[]{}()";
  const NEAR_GLYPHS = "@#%&8WM*[]{}<>/\\\\|?!^~";
  const STRUCTURE_GLYPHS = "01<>[]{}+/\\\\|";
  const PARTICLE_GLYPHS = ".·:+0";
  const REDUCED_MOTION = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const STATIC_MODE = canvas.dataset.static === "true";

  const characters = [
    ...new Set(
      [
        FAR_GLYPHS,
        MID_GLYPHS,
        NEAR_GLYPHS,
        STRUCTURE_GLYPHS,
        PARTICLE_GLYPHS,
      ].join(""),
    ),
  ];
  const glyphIndices = new Map(
    characters.map((glyph, index) => [glyph, index]),
  );
  const viewport = {
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: 1,
  };
  const circleCache = new Map();
  const atlases = {
    wall: createAtlas("rgb(92, 158, 116)", 400),
    bright: createAtlas("rgb(188, 226, 199)", 600),
    particle: createAtlas("rgb(82, 132, 99)", 400),
  };
  const particles = Array.from({ length: 44 }, (_, index) => ({
    phase: hash(index * 4.17 + 0.3),
    angle: hash(index * 8.31 + 4.9) * TAU,
    radial: 0.1 + hash(index * 2.63 + 8.4) * 0.72,
    speed: 0.72 + hash(index * 7.91 + 2.1) * 0.38,
    glyph:
      PARTICLE_GLYPHS[
        Math.floor(hash(index * 5.33 + 1.2) * PARTICLE_GLYPHS.length)
      ],
  }));

  let active = false;
  let travel = 7.8;
  let elapsed = 0;
  let lastFrame = performance.now();
  let frameRequest = 0;

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function positiveModulo(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
  }

  function hash(value) {
    const sine = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
    return sine - Math.floor(sine);
  }

  function createAtlas(color, weight) {
    const rows = Math.ceil(characters.length / ATLAS_COLUMNS);
    const atlas = document.createElement("canvas");
    atlas.width = ATLAS_COLUMNS * TILE_SIZE;
    atlas.height = rows * TILE_SIZE;
    const atlasContext = atlas.getContext("2d");

    atlasContext.fillStyle = color;
    atlasContext.font = `${weight} 50px "SFMono-Regular", "Cascadia Code", "Roboto Mono", monospace`;
    atlasContext.textAlign = "center";
    atlasContext.textBaseline = "middle";

    characters.forEach((glyph, index) => {
      const column = index % ATLAS_COLUMNS;
      const row = Math.floor(index / ATLAS_COLUMNS);
      atlasContext.fillText(
        glyph,
        column * TILE_SIZE + TILE_SIZE / 2,
        row * TILE_SIZE + TILE_SIZE / 2 + 1,
      );
    });

    return atlas;
  }

  function getCirclePoints(count) {
    if (circleCache.has(count)) return circleCache.get(count);

    const points = new Float32Array(count * 2);
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * TAU;
      points[index * 2] = Math.cos(angle);
      points[index * 2 + 1] = Math.sin(angle);
    }
    circleCache.set(count, points);
    return points;
  }

  function drawGlyph(glyph, x, y, size, alpha, atlas) {
    const index = glyphIndices.get(glyph) ?? 0;
    const column = index % ATLAS_COLUMNS;
    const row = Math.floor(index / ATLAS_COLUMNS);
    const drawSize = Math.max(3, size * 1.34);

    context.globalAlpha = clamp(alpha, 0, 1);
    context.drawImage(
      atlas,
      column * TILE_SIZE,
      row * TILE_SIZE,
      TILE_SIZE,
      TILE_SIZE,
      x - drawSize / 2,
      y - drawSize / 2,
      drawSize,
      drawSize,
    );
  }

  function focalPoint() {
    const compact = viewport.width < 760;
    return {
      x: viewport.width * (compact ? 0.58 : 0.71),
      y: viewport.height * (compact ? 0.34 : 0.5),
    };
  }

  function glyphPool(depth, structural) {
    if (structural) return STRUCTURE_GLYPHS;
    if (depth > 0.72) return FAR_GLYPHS;
    if (depth > 0.28) return MID_GLYPHS;
    return NEAR_GLYPHS;
  }

  function drawParticles(focalLength, focal) {
    const range = FAR_DEPTH - NEAR_DEPTH;
    for (const particle of particles) {
      const z =
        NEAR_DEPTH +
        positiveModulo(
          particle.phase * range - travel * particle.speed,
          range,
        );
      const depth = (z - NEAR_DEPTH) / range;
      const projection = focalLength / z;
      const radialDistance = particle.radial * projection;
      const farFade = clamp((FAR_DEPTH - z) / 5, 0, 1);
      const nearFade = clamp((z - NEAR_DEPTH) / 1.4, 0, 1);
      const alpha =
        (0.06 + Math.pow(1 - depth, 0.8) * 0.3) *
        farFade *
        nearFade;

      drawGlyph(
        particle.glyph,
        focal.x + Math.cos(particle.angle) * radialDistance,
        focal.y + Math.sin(particle.angle) * radialDistance,
        clamp(2.5 + projection * 0.018, 3, 10),
        alpha,
        atlases.particle,
      );
    }
  }

  function render() {
    const { width, height } = viewport;
    const smallestSide = Math.min(width, height);
    const focalLength = smallestSide * 1.01;
    const focal = focalPoint();
    const ringCount =
      Math.ceil((FAR_DEPTH - NEAR_DEPTH) / RING_SPACING) + 2;
    const baseRing = Math.floor(travel / RING_SPACING);
    const phase = travel - baseRing * RING_SPACING;
    const densityScale = clamp(smallestSide / 720, 0.86, 1.18);

    context.globalAlpha = 1;
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, height);
    drawParticles(focalLength, focal);

    for (let layer = ringCount; layer >= 0; layer -= 1) {
      const z = NEAR_DEPTH + layer * RING_SPACING - phase;
      if (z < NEAR_DEPTH || z > FAR_DEPTH) continue;

      const ringId = baseRing + layer;
      const depth = (z - NEAR_DEPTH) / (FAR_DEPTH - NEAR_DEPTH);
      const projection = focalLength / z;
      const radius = TUBE_RADIUS * projection;
      const gate = positiveModulo(ringId, 43) === 0;
      const structural = gate || positiveModulo(ringId, 7) === 0;
      const rawCount = gate
        ? (88 + (1 - depth) * 28) * densityScale
        : (44 + (1 - depth) * 38) * densityScale;
      const characterCount = Math.round(rawCount / 2) * 2;
      const fontSize =
        clamp(radius * 0.033 + 3.3, 4.5, 25) * (gate ? 1.08 : 1);
      const alpha = clamp(
        (0.05 + Math.pow(1 - depth, 0.72) * 0.54) *
          clamp((FAR_DEPTH - z) / 2.4, 0.2, 1) *
          (gate ? 1.42 : structural ? 1.08 : 1),
        0,
        0.9,
      );
      const twist =
        ringId * 0.137 +
        elapsed * 0.026 +
        Math.sin(ringId * 0.23) * 0.08;
      const twistCosine = Math.cos(twist);
      const twistSine = Math.sin(twist);
      const circlePoints = getCirclePoints(characterCount);
      const pool = glyphPool(depth, structural);
      const atlas = structural ? atlases.bright : atlases.wall;

      for (let point = 0; point < characterCount; point += 1) {
        const seed = ringId * 97.13 + point * 13.71;
        if (!structural && hash(seed + 3.4) < 0.035) continue;

        const baseCosine = circlePoints[point * 2];
        const baseSine = circlePoints[point * 2 + 1];
        const cosine =
          baseCosine * twistCosine - baseSine * twistSine;
        const sine =
          baseSine * twistCosine + baseCosine * twistSine;
        const jitter = (hash(seed + 8.1) - 0.5) * fontSize * 0.74;
        const localRadius = radius + jitter;
        const x = focal.x + cosine * localRadius;
        const y = focal.y + sine * localRadius;

        if (
          x < -fontSize * 2 ||
          x > width + fontSize * 2 ||
          y < -fontSize * 2 ||
          y > height + fontSize * 2
        ) {
          continue;
        }

        const glyph =
          pool[Math.floor(hash(seed + 2.7) * pool.length)];
        drawGlyph(glyph, x, y, fontSize, alpha, atlas);

        if (gate && point % 3 === 0) {
          drawGlyph(
            glyph,
            x - cosine * fontSize * 0.34,
            y - sine * fontSize * 0.34,
            fontSize,
            alpha,
            atlas,
          );
        }
      }
    }

    context.globalAlpha = 1;
  }

  function resize() {
    viewport.width = window.innerWidth;
    viewport.height = window.innerHeight;
    viewport.dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    canvas.width = Math.round(viewport.width * viewport.dpr);
    canvas.height = Math.round(viewport.height * viewport.dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    context.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    if (active) render();
  }

  function animate(now) {
    if (!active) return;

    const delta = Math.min((now - lastFrame) / 1000, 1 / 30);
    lastFrame = now;
    elapsed += delta;
    travel += delta * SPEED;
    render();
    frameRequest = window.requestAnimationFrame(animate);
  }

  function start() {
    window.cancelAnimationFrame(frameRequest);
    lastFrame = performance.now();
    if (REDUCED_MOTION || STATIC_MODE) {
      render();
      return;
    }
    frameRequest = window.requestAnimationFrame(animate);
  }

  function setActive(nextActive) {
    active = Boolean(nextActive);
    if (active && !document.hidden) {
      start();
    } else {
      window.cancelAnimationFrame(frameRequest);
      frameRequest = 0;
    }
  }

  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      window.cancelAnimationFrame(frameRequest);
      frameRequest = 0;
    } else if (active) {
      start();
    }
  });

  resize();
  window.vireWormhole = { setActive };
})();
