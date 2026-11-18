import * as THREE from 'three';

/**
 * Builds floating 3D faceted crystal shards, weightless feathers,
 * translucent flowing light ribbons, and dreamy 3D bokeh light particles.
 */
export function buildAtmosphere() {
  const group = new THREE.Group();

  // 1. Refractive Faceted 3D Crystal Shards (reflecting pale blue-violet & pearl pink!)
  const crystalMat = new THREE.MeshPhysicalMaterial({
    color: 0xf4f6ff,
    emissive: 0xd5dcff,
    emissiveIntensity: 0.14,
    roughness: 0.04,
    metalness: 0.08,
    transmission: 0.94,
    ior: 1.56,
    thickness: 0.35,
    iridescence: 0.72,
    iridescenceIOR: 1.35,
    clearcoat: 1.0,
    transparent: true,
    opacity: 0.92,
  });

  const crystalConfigs = [
    { pos: [-1.45, 0.92, 0.45], scale: [0.09, 0.24, 0.08], rot: [0.4, 0.7, -0.35], speed: 0.55 },
    { pos: [-1.72, -0.48, 0.62], scale: [0.06, 0.15, 0.06], rot: [-0.3, 1.1, 0.5], speed: 0.72 },
    { pos: [-1.18, -1.78, 0.85], scale: [0.10, 0.22, 0.09], rot: [0.6, -0.4, 0.8], speed: 0.48 },
    { pos: [1.18, -1.62, 0.72], scale: [0.08, 0.20, 0.07], rot: [-0.5, 0.8, -0.4], speed: 0.64 },
    { pos: [-0.95, 1.12, -0.35], scale: [0.05, 0.13, 0.05], rot: [0.2, 0.4, 0.6], speed: 0.80 },
    { pos: [1.32, 0.52, 0.25], scale: [0.055, 0.14, 0.055], rot: [0.7, -0.2, 0.3], speed: 0.60 },
  ];

  const crystals = crystalConfigs.map((cfg, idx) => {
    const geo = new THREE.OctahedronGeometry(1.0, 0);
    // Slightly bevel/elongate into realistic quartz crystal prism
    const mesh = new THREE.Mesh(geo, crystalMat);
    mesh.position.set(...cfg.pos);
    mesh.scale.set(...cfg.scale);
    mesh.rotation.set(...cfg.rot);
    group.add(mesh);
    return { mesh, basePos: new THREE.Vector3(...cfg.pos), baseRot: cfg.rot, speed: cfg.speed, seed: idx * 1.7 };
  });

  // 2. Weightless Curved 3D White Feathers (procedural barbule alpha shader)
  const featherMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0xffffff) },
      uShadow: { value: new THREE.Color(0xede7f4) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uShadow;
      varying vec2 vUv;
      void main() {
        // vUv.x in [0,1] from quill to tip, vUv.y in [0,1] across vane width
        float x = vUv.x;
        float y = (vUv.y - 0.5) * 2.0; // -1 .. +1
        float absY = abs(y);

        // Tear-drop feather silhouette envelope
        float env = sin(pow(clamp(x, 0.0, 1.0), 0.65) * 3.14159);
        if (absY > env) discard;

        // Central rachis stem + delicate Diagonal barbule fibers
        float stem = exp(-pow(absY / 0.045, 2.0)) * smoothstep(1.0, 0.1, x);
        float barbs = sin((x * 85.0 - absY * 28.0)) * 0.5 + 0.5;
        float notch = step(0.15, fract(x * 11.0 + absY * 2.0)) * 0.15 + 0.85;

        float edgeFade = (1.0 - smoothstep(env * 0.55, env, absY)) * notch;
        float alpha = clamp(edgeFade * (0.68 + 0.32 * barbs) + stem * 0.6, 0.0, 0.94);
        if (alpha < 0.06) discard;

        vec3 col = mix(uShadow, uColor, 0.65 + 0.35 * stem + 0.15 * barbs);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });

  const featherSpecs = [
    { pos: [1.18, 1.18, 0.32], rot: [0.3, -0.4, -0.55], scale: 0.42 },
    { pos: [1.02, -0.68, 0.65], rot: [-0.25, 0.3, 0.42], scale: 0.38 },
    { pos: [1.12, -1.32, 0.78], rot: [0.18, -0.2, 0.15], scale: 0.36 },
    { pos: [-1.42, -1.12, 0.52], rot: [0.22, 0.45, -0.38], scale: 0.40 },
  ];

  const feathers = featherSpecs.map((spec, idx) => {
    const fGeo = new THREE.PlaneGeometry(1.0, 0.36, 24, 10);
    const pos = fGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i) + 0.5; // 0..1
      const py = pos.getY(i);
      // Graceful 3D arch along feather spine
      pos.setZ(i, Math.sin(px * Math.PI) * 0.11 - Math.abs(py) * 0.06);
      pos.setY(i, py + Math.sin(px * 2.2) * 0.04);
    }
    fGeo.computeVertexNormals();
    const mesh = new THREE.Mesh(fGeo, featherMat);
    mesh.position.set(...spec.pos);
    mesh.rotation.set(...spec.rot);
    mesh.scale.setScalar(spec.scale);
    mesh.renderOrder = 3;
    group.add(mesh);
    return { mesh, basePos: new THREE.Vector3(...spec.pos), baseRot: spec.rot, seed: idx * 2.3 };
  });

  // 3. Faint Flowing Translucent Light Ribbons (subtle lavender-pearl silk light trails)
  const ribbonMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color(0xffffff) },
      uColorB: { value: new THREE.Color(0xe6dff8) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      varying vec2 vUv;
      void main() {
        float edge = sin(vUv.y * 3.14159);
        float ends = sin(vUv.x * 3.14159);
        float flow = sin(vUv.x * 10.0 - uTime * 1.6) * 0.25 + 0.75;
        vec3 col = mix(uColorB, uColorA, edge * 0.7);
        float alpha = pow(edge, 1.6) * ends * flow * 0.28;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const ribbonCurves = [
    [
      new THREE.Vector3(-2.5, -1.25, -0.6),
      new THREE.Vector3(-1.15, -1.65, 0.45),
      new THREE.Vector3(0.25, -2.05, 0.85),
      new THREE.Vector3(1.75, -1.15, 0.65),
    ],
    [
      new THREE.Vector3(-2.3, 0.95, -1.2),
      new THREE.Vector3(-0.95, 0.65, -0.9),
      new THREE.Vector3(0.65, 0.85, -0.8),
      new THREE.Vector3(2.0, 1.25, -0.6),
    ],
  ];

  ribbonCurves.forEach((pts) => {
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, 64, 0.085, 8, false);
    tube.scale(1.0, 0.14, 1.0);
    const mesh = new THREE.Mesh(tube, ribbonMat);
    mesh.renderOrder = 4;
    group.add(mesh);
  });

  // 4. Dreamy Floating 3D Bokeh Light Particles
  const pCount = 130;
  const pPositions = new Float32Array(pCount * 3);
  const pScales = new Float32Array(pCount);
  const pSeeds = new Float32Array(pCount);

  for (let i = 0; i < pCount; i++) {
    const s1 = Math.sin(i * 12.9898) * 43758.5453;
    const s2 = Math.sin(i * 78.233) * 24634.6345;
    const s3 = Math.sin(i * 39.425) * 19283.4721;
    const r1 = s1 - Math.floor(s1);
    const r2 = s2 - Math.floor(s2);
    const r3 = s3 - Math.floor(s3);

    pPositions[i * 3] = (r1 - 0.5) * 4.4;
    pPositions[i * 3 + 1] = (r2 - 0.5) * 4.2 - 0.4;
    pPositions[i * 3 + 2] = (r3 - 0.35) * 2.6;
    pScales[i] = 10.0 + r1 * 26.0;
    pSeeds[i] = r2 * 6.2831;
  }

  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
  particleGeo.setAttribute('aScale', new THREE.BufferAttribute(pScales, 1));
  particleGeo.setAttribute('aSeed', new THREE.BufferAttribute(pSeeds, 1));

  const particleMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      attribute float aScale;
      attribute float aSeed;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vAlpha;
      varying float vTint;

      void main() {
        vec3 pos = position;
        // Slow dreamy orbital drift
        float ang = uTime * 0.22 + aSeed;
        pos.x += sin(ang) * 0.14;
        pos.y += cos(ang * 0.85) * 0.16 + mod(uTime * 0.06, 0.6) * 0.1;
        pos.z += cos(ang * 1.1) * 0.12;

        vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = aScale * uPixelRatio * (3.2 / max(0.8, -mvPos.z));
        vAlpha = 0.42 + 0.38 * sin(uTime * 2.1 + aSeed * 3.0);
        vTint = fract(aSeed);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      varying float vTint;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r = length(d) * 2.0;
        if (r > 1.0) discard;
        // Soft creamy bokeh disc + bright center sparkle
        float glow = exp(-r * r * 3.2) * 0.75 + smoothstep(1.0, 0.72, r) * 0.25;
        vec3 col = mix(vec3(1.0, 0.96, 0.99), vec3(0.90, 0.92, 1.0), vTint);
        gl_FragColor = vec4(col, glow * vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
  });

  const particles = new THREE.Points(particleGeo, particleMat);
  particles.renderOrder = 5;
  group.add(particles);

  function updateAtmosphere(t, crystalGlowBoost = 0) {
    ribbonMat.uniforms.uTime.value = t;
    particleMat.uniforms.uTime.value = t;
    crystalMat.emissiveIntensity = 0.14 + crystalGlowBoost * 0.38;

    for (const c of crystals) {
      c.mesh.position.y = c.basePos.y + Math.sin(t * c.speed + c.seed) * 0.065;
      c.mesh.position.x = c.basePos.x + Math.cos(t * c.speed * 0.8 + c.seed) * 0.04;
      c.mesh.rotation.y = c.baseRot[1] + t * 0.38 * c.speed;
      c.mesh.rotation.z = c.baseRot[2] + Math.sin(t * 0.9 + c.seed) * 0.12;
    }

    for (const f of feathers) {
      f.mesh.position.y = f.basePos.y + Math.sin(t * 0.75 + f.seed) * 0.08;
      f.mesh.position.x = f.basePos.x - Math.sin(t * 0.55 + f.seed) * 0.06;
      f.mesh.rotation.z = f.baseRot[2] + Math.sin(t * 1.1 + f.seed) * 0.14;
    }
  }

  return { atmosphereGroup: group, particleMat, updateAtmosphere };
}
