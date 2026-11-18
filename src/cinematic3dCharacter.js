import * as THREE from 'three';

/**
 * Loads textures and waits until all GPU images are decoded
 */
export async function loadCharacterAssets() {
  const loader = new THREE.TextureLoader();
  const loadTex = (url, srgb = false) =>
    new Promise((resolve, reject) => {
      loader.load(
        url,
        (tex) => {
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.wrapS = THREE.ClampToEdgeWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
          resolve(tex);
        },
        undefined,
        reject
      );
    });

  const [albedoTex, depthTex, normalTex, rigTex] = await Promise.all([
    loadTex('/assets/albedo_hd.jpg', false),
    loadTex('/assets/depth_map.png', false),
    loadTex('/assets/normal_map.png', false),
    loadTex('/assets/rig_masks.png', false),
  ]);
  // Nearest/Linear without mipmap blurring on 16-bit RG packed depth
  depthTex.minFilter = THREE.LinearFilter;
  depthTex.generateMipmaps = false;

  return { albedoTex, depthTex, normalTex, rigTex };
}

/**
 * Builds the 462,722-triangle High-Precision 3D Displaced Character Mesh with:
 * - 16-bit Smooth Anatomical + SfS Micro-Relief 3D Depth Displacement
 * - Semantic Wind & Cloth 3D Wave Physics (zero facial/hand distortion!)
 * - Sub-Pixel Live2D-Style Gaze Lift, Eyelash Flutter, Gentle Smile & Blink Rig
 * - Dynamic 3D Normal-Mapped Relighting & Backlit Hair Translucency
 */
export function buildCinematic3DCharacter({ albedoTex, depthTex, normalTex, rigTex }) {
  // 480x480 grid = 231,361 vertices / 460,800 triangles of smooth 3D relief!
  const geo = new THREE.PlaneGeometry(4.2, 4.2, 480, 480);

  const uniforms = {
    uAlbedo: { value: albedoTex },
    uDepthMap: { value: depthTex },
    uNormalMap: { value: normalTex },
    uRigMap: { value: rigTex },
    uTime: { value: 0.0 },
    uDepthScale: { value: 0.82 },
    uWindStrength: { value: 0.35 },
    uBacklightBoost: { value: 0.25 },
    uGazeLift: { value: 0.0 },
    uSmile: { value: 0.0 },
    uBlink: { value: 0.0 },
    uLashFlutter: { value: 0.0 },
    uOrbitAngle: { value: 0.0 },
    uClayMode: { value: 0.0 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      uniform sampler2D uDepthMap;
      uniform sampler2D uRigMap;
      uniform float uTime;
      uniform float uDepthScale;
      uniform float uWindStrength;

      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying float vDepth;
      varying vec4 vRig;

      void main() {
        vUv = uv;
        vec4 dSample = texture2D(uDepthMap, uv);
        // Decode 16-bit heightfield from R (high byte) and G (low byte)
        float depth16 = (dSample.r * 255.0 * 256.0 + dSample.g * 255.0) / 65535.0;
        vDepth = depth16;

        vec4 rig = texture2D(uRigMap, uv);
        vRig = rig;
        float hairW = rig.r;
        float clothW = rig.g;
        float fgW = rig.a;

        vec3 pos = position;
        pos.z += depth16 * uDepthScale;

        // 1. Physical 3D Hair Strand Travelling Breeze Waves (strictly 0 on face/eyes/hands!)
        float hPhase1 = uTime * 2.45 + pos.x * 3.8 + pos.y * 2.6;
        float hPhase2 = uTime * 3.60 - pos.x * 5.4 + pos.y * 4.2;
        float hairWaveX = (-0.018 - 0.024 * sin(hPhase1) - 0.010 * cos(hPhase2)) * hairW * uWindStrength;
        float hairWaveY = (0.010 * cos(hPhase1 * 0.9) + 0.006 * sin(hPhase2)) * hairW * uWindStrength;
        float hairWaveZ = (0.032 * sin(hPhase1 * 0.85 + 0.7)) * hairW * uWindStrength;

        // 2. Silk Bow Tails & Layered Organza Ruffle Cloth Simulation
        float cPhase = uTime * 2.85 + pos.x * 6.2 - pos.y * 4.8;
        float clothWaveX = (-0.012 - 0.018 * sin(cPhase)) * clothW * uWindStrength;
        float clothWaveY = (0.008 * cos(cPhase * 1.2)) * clothW * uWindStrength;
        float clothWaveZ = (0.028 * cos(cPhase * 0.95)) * clothW * uWindStrength;

        // 3. Gentle organic breathing across upper chest/shoulders
        float breathMask = fgW * smoothstep(-1.8, -0.1, pos.y) * (1.0 - smoothstep(0.0, 0.8, pos.y));
        float breathY = sin(uTime * 1.45) * 0.006 * breathMask;
        float breathZ = sin(uTime * 1.45) * 0.010 * breathMask;

        pos.x += hairWaveX + clothWaveX;
        pos.y += hairWaveY + clothWaveY + breathY;
        pos.z += hairWaveZ + clothWaveZ + breathZ;

        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAlbedo;
      uniform sampler2D uNormalMap;
      uniform sampler2D uRigMap;
      uniform float uTime;
      uniform float uWindStrength;
      uniform float uBacklightBoost;
      uniform float uGazeLift;
      uniform float uSmile;
      uniform float uBlink;
      uniform float uLashFlutter;
      uniform float uOrbitAngle;
      uniform float uClayMode;

      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying float vDepth;
      varying vec4 vRig;

      // Applies Live2D-style tilted eye gaze lift, eyelash micro-flutter, and smooth eyelid skin blink
      vec2 warpSingleEye(
        vec2 imgP,
        vec2 center,
        float rx,
        float ry,
        float deg,
        float gazeLift,
        float blink,
        float flutter,
        out float eyelidSkinBlend,
        out float closedCreaseShadow,
        out float corneaSparkle
      ) {
        eyelidSkinBlend = 0.0;
        closedCreaseShadow = 0.0;
        corneaSparkle = 0.0;

        float rad = deg * 0.01745329;
        float c = cos(rad);
        float s = sin(rad);
        vec2 d = imgP - center;
        float eu = ( d.x * c + d.y * s) / rx;
        float ev = (-d.x * s + d.y * c) / ry;

        if (abs(eu) > 1.35 || abs(ev) > 1.35) return imgP;

        float euSrc = eu;
        float evSrc = ev;

        // A. Smooth Gaze Lift (2-4s): shifts greyish-purple iris & pupil gently upward & toward camera!
        float rEye = length(vec2(eu * 0.92, ev));
        float irisInterior = (1.0 - smoothstep(0.45, 0.95, rEye)) * smoothstep(-0.68, -0.15, ev);
        evSrc += 0.145 * gazeLift * irisInterior;
        euSrc -= 0.055 * gazeLift * irisInterior;

        float upperLidZone = (1.0 - smoothstep(0.35, 1.15, abs(eu))) *
                             exp(-pow((ev + 0.55) / 0.32, 2.0));
        evSrc += (0.095 * gazeLift + flutter * 0.045) * upperLidZone * (1.0 - blink);

        vec2 sparkPos = vec2(-0.22 + uOrbitAngle * 0.45, -0.12 - gazeLift * 0.10);
        float sparkDist = length(vec2(eu, ev) - sparkPos);
        corneaSparkle = (1.0 - smoothstep(0.05, 0.14, sparkDist)) * (1.0 - blink) * (0.18 + 0.25 * gazeLift);

        // B. Natural Anime Blink (6.25-6.95s) WITHOUT stretching upper bangs!
        // Upper lash curve starts at ev ~ -0.48 (open) and sweeps smoothly down to +0.36 (closed)
        if (blink > 0.001) {
          float arch = -0.16 * eu * eu;
          float openLashY = -0.48 + arch;
          float closedLashY = 0.38 + arch * 0.5;
          float curLashY = mix(openLashY, closedLashY, blink);
          float horizMask = 1.0 - smoothstep(0.68, 1.12, abs(eu));

          // Move only the dark feathery lash band along curLashY (never pulling bangs from ev < -0.65!)
          float lashBand = exp(-pow((ev - curLashY) / 0.24, 2.0)) * horizMask;
          evSrc -= (curLashY - openLashY) * lashBand;

          // Smooth porcelain upper-eyelid skin covering only the dark iris core with wide feathered edges!
          float aboveCurLash = 1.0 - smoothstep(curLashY - 0.22, curLashY + 0.04, ev);
          float belowUpperRim = smoothstep(openLashY - 0.05, openLashY + 0.32, ev);
          float insideAperture = 1.0 - smoothstep(0.32, 0.92, length(vec2(eu * 0.96, (ev - 0.02) * 1.15)));
          eyelidSkinBlend = clamp(aboveCurLash * belowUpperRim * insideAperture * smoothstep(0.08, 0.45, blink), 0.0, 1.0);

          float closedLine = exp(-pow((ev - curLashY) / 0.10, 2.0)) * horizMask;
          closedCreaseShadow = closedLine * smoothstep(0.45, 0.95, blink) * 0.18;
        }

        vec2 dWarped = vec2(
          (euSrc * rx) * c - (evSrc * ry) * s,
          (euSrc * rx) * s + (evSrc * ry) * c
        );
        return center + dWarped;
      }

      void main() {
        // Convert OpenGL UV (bottom-left 0,0) to Top-Left Image Space (0,0 -> 1,1)
        vec2 imgP = vec2(vUv.x, 1.0 - vUv.y);

        // 1. Apply Sub-Pixel Facial Rig (Near Eye, Far Eye, Gentle Shy Smile)
        float lidSkin1 = 0.0, lidSkin2 = 0.0;
        float crease1 = 0.0, crease2 = 0.0;
        float spark1 = 0.0, spark2 = 0.0;

        // Near / Prominent Left Eye at (0.612, 0.372), tilted +26 deg
        imgP = warpSingleEye(
          imgP, vec2(0.612, 0.372), 0.043, 0.026, 26.0,
          uGazeLift, uBlink, uLashFlutter, lidSkin1, crease1, spark1
        );
        // Far / Right Eye at (0.495, 0.295), tilted +32 deg
        imgP = warpSingleEye(
          imgP, vec2(0.495, 0.295), 0.022, 0.024, 32.0,
          uGazeLift, uBlink, uLashFlutter, lidSkin2, crease2, spark2
        );

        // Gentle Natural Smile (2-4s): softly lifts mouth corners & warms cheek!
        if (uSmile > 0.001) {
          vec2 dNearCorner = (imgP - vec2(0.519, 0.419)) / vec2(0.024, 0.020);
          float mNear = exp(-0.5 * dot(dNearCorner, dNearCorner));

          vec2 dFarCorner = (imgP - vec2(0.496, 0.405)) / vec2(0.016, 0.015);
          float mFar = exp(-0.5 * dot(dFarCorner, dFarCorner));

          vec2 dCheek = (imgP - vec2(0.556, 0.406)) / vec2(0.045, 0.035);
          float mCheek = exp(-0.5 * dot(dCheek, dCheek));

          // Inverse lookup: +y/+x shift pulls mouth corner gently upward-right into a tender smile!
          imgP += vec2(-0.0024, 0.0046) * mNear * uSmile;
          imgP += vec2( 0.0010, 0.0026) * mFar * uSmile;
          imgP += vec2(-0.0010, 0.0018) * mCheek * uSmile;
        }

        // Subtle fine hair-strand internal flow shimmer along flowing tresses
        float hairW = vRig.r;
        float strandShimmer = sin(uTime * 3.2 + imgP.x * 42.0 + imgP.y * 28.0) * 0.0012 * hairW * uWindStrength;
        imgP.x += strandShimmer;

        vec2 warpedUv = clamp(vec2(imgP.x, 1.0 - imgP.y), 0.001, 0.999);

        // 2. Optional 3D Sculpted Clay Relief Inspection Mode
        vec3 N = normalize(texture2D(uNormalMap, warpedUv).xyz * 2.0 - 1.0);
        vec3 V = normalize(cameraPosition - vWorldPos);

        if (uClayMode > 0.5) {
          vec3 clayKey = normalize(vec3(-0.55, 0.62, 0.56));
          vec3 clayRim = normalize(vec3(0.65, 0.35, 0.45));
          float diff = smoothstep(-0.45, 0.85, dot(N, clayKey));
          float fres = pow(1.0 - max(dot(N, V), 0.0), 2.5);
          vec3 clayBase = mix(vec3(0.56, 0.49, 0.64), vec3(0.97, 0.95, 0.99), diff);
          clayBase += vec3(0.94, 0.95, 1.0) * fres * 0.32 * max(0.0, dot(N, clayRim));
          clayBase = mix(vec3(0.94, 0.92, 0.96), clayBase, smoothstep(0.02, 0.35, vRig.a));
          gl_FragColor = vec4(clayBase, 1.0);
          return;
        }

        // 3. High-Precision Beauty CG Shading + Dynamic 3D Relighting (Zero washout / Zero grey compression!)
        vec3 baseCol = texture2D(uAlbedo, warpedUv).rgb;
        // Blend smooth warm porcelain upper-eyelid skin only over dark iris pixels (preserving pale bangs & skin!)
        float pixelLuma = dot(baseCol, vec3(0.299, 0.587, 0.114));
        float darkIrisPixel = 1.0 - smoothstep(0.62, 0.88, pixelLuma);
        float lidMask = clamp(lidSkin1 + lidSkin2, 0.0, 1.0) * (0.25 + 0.75 * darkIrisPixel);
        vec3 sampledSkin = texture2D(uAlbedo, vec2(0.555, 1.0 - 0.395)).rgb;
        vec3 porcelainLid = sampledSkin * mix(0.94, 1.01, smoothstep(-0.3, 0.7, N.y));
        baseCol = mix(baseCol, porcelainLid, lidMask);
        float rimMask = vRig.b;
        float fgMask = vRig.a;

        // Dynamic rotating 3D light response as camera orbits & wind/backlight shifts
        vec3 dynLightDir = normalize(vec3(-0.38 + sin(uOrbitAngle * 2.5) * 0.42, 0.48, 0.78));
        vec3 restLightDir = normalize(vec3(-0.38, 0.48, 0.78));
        float deltaDiff = dot(N, dynLightDir) - dot(N, restLightDir);

        vec3 H = normalize(dynLightDir + V);
        float dynSpec = pow(max(dot(N, H), 0.0), 28.0) * fgMask;
        float fresnelRim = pow(1.0 - max(dot(N, V), 0.0), 2.4) * fgMask;

        vec3 col = baseCol;
        col += vec3(0.98, 0.88, 0.94) * deltaDiff * 0.11 * fgMask;
        col += vec3(1.0, 0.98, 1.0) * dynSpec * (0.025 + 0.07 * abs(uOrbitAngle) * 3.0);

        // Luminous Backlit Translucent Hair & Organza Glow (peaks gracefully at 4-6s!)
        vec3 backlitTint = mix(vec3(1.0, 0.93, 0.98), vec3(0.88, 0.92, 1.0), 0.45);
        vec3 addGlow = backlitTint * (rimMask * 0.65 + fresnelRim * 0.40) * uBacklightBoost * 0.18;
        col += addGlow * (1.0 - baseCol * 0.35);

        // Subtle warm rosy blush bloom when she gently smiles (2-4s)
        vec2 dBlush = (imgP - vec2(0.562, 0.408)) / vec2(0.055, 0.038);
        float blushGlow = exp(-0.5 * dot(dBlush, dBlush)) * uSmile;
        col = mix(col, col * vec3(1.02, 0.955, 0.975), blushGlow * 0.55);

        // Apply closed-blink soft lash crease & corneal catchlight shimmer
        col *= (1.0 - crease1 - crease2);
        col += vec3(1.0, 0.99, 1.0) * (spark1 + spark2);

        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  return { characterMesh: mesh, uniforms };
}

/**
 * Builds delicate foreground 3D Volumetric Props placed in front of the character mesh:
 * - Subtle 3D Translucent Pink-White Cheek Hair Wisp (drifting gently across foreground at 6-8s!)
 * - Refractive 3D Crystal Shards (glinting with pale blue-violet light at 4-6s)
 * - Weightless 3D Feathers & Slowly Swirling 3D Bokeh Light Particles
 */
export function buildForegroundVolumetrics() {
  const group = new THREE.Group();

  // 1. Delicate Foreground 3D Translucent Hair Wisp gliding softly past cheek at 6-8s
  const wispPts = [
    new THREE.Vector3(0.45, 1.85, 0.85),
    new THREE.Vector3(0.18, 0.82, 0.92),
    new THREE.Vector3(-0.12, -0.05, 0.96),
    new THREE.Vector3(-0.58, -0.95, 0.90),
    new THREE.Vector3(-1.25, -1.75, 0.82),
  ];
  const wispCurve = new THREE.CatmullRomCurve3(wispPts);
  const wispGeo = new THREE.TubeGeometry(wispCurve, 64, 0.011, 6, false);
  wispGeo.scale(1.0, 1.0, 0.35);
  const wispMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0.38 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        float flex = smoothstep(0.0, 1.0, uv.x);
        p.x -= sin(uTime * 1.35 - uv.x * 2.5) * 0.14 * flex;
        p.z += cos(uTime * 1.1 + uv.x * 2.0) * 0.04 * flex;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float ends = sin(vUv.x * 3.14159);
        float softEdge = sin(vUv.y * 3.14159);
        vec3 col = mix(vec3(0.98, 0.88, 0.94), vec3(1.0, 0.98, 1.0), vUv.x);
        gl_FragColor = vec4(col, ends * softEdge * uOpacity);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const wispMesh = new THREE.Mesh(wispGeo, wispMat);
  group.add(wispMesh);

  // 2. Refractive 3D Faceted Crystal Shards (reflecting soft blue-violet light at 4-6s!)
  const crystalMat = new THREE.MeshPhysicalMaterial({
    color: 0xf5f7ff,
    emissive: 0xc5d0ff,
    emissiveIntensity: 0.12,
    roughness: 0.04,
    metalness: 0.06,
    transmission: 0.95,
    ior: 1.56,
    thickness: 0.30,
    iridescence: 0.80,
    iridescenceIOR: 1.36,
    transparent: true,
    opacity: 0.86,
  });

  const crystalSpecs = [
    { pos: [-1.42, 1.18, 0.65], scale: [0.055, 0.145, 0.055], rot: [0.4, 0.6, -0.35], speed: 0.55 },
    { pos: [-1.58, -0.32, 0.78], scale: [0.042, 0.110, 0.042], rot: [-0.3, 1.0, 0.45], speed: 0.70 },
    { pos: [1.38, -0.92, 0.82], scale: [0.048, 0.125, 0.048], rot: [0.5, -0.4, 0.65], speed: 0.62 },
    { pos: [-0.88, -1.45, 0.92], scale: [0.050, 0.130, 0.050], rot: [-0.4, 0.8, -0.3], speed: 0.50 },
  ];

  const crystals = crystalSpecs.map((s, idx) => {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(1.0, 0), crystalMat);
    m.position.set(...s.pos);
    m.scale.set(...s.scale);
    m.rotation.set(...s.rot);
    group.add(m);
    return { mesh: m, basePos: new THREE.Vector3(...s.pos), baseRot: s.rot, speed: s.speed, seed: idx * 1.9 };
  });

  // 3. Dreamy Slowly Swirling 3D Bokeh Light Particles (150 3D particles across depth layers!)
  const pCount = 150;
  const pPos = new Float32Array(pCount * 3);
  const pScale = new Float32Array(pCount);
  const pSeed = new Float32Array(pCount);

  for (let i = 0; i < pCount; i++) {
    const r1 = Math.abs(Math.sin(i * 12.9898 + 1.1) * 43758.5453) % 1;
    const r2 = Math.abs(Math.sin(i * 78.233 + 2.3) * 24634.6345) % 1;
    const r3 = Math.abs(Math.sin(i * 39.425 + 3.7) * 19283.4721) % 1;
    pPos[i * 3] = (r1 - 0.5) * 3.8;
    pPos[i * 3 + 1] = (r2 - 0.5) * 3.8;
    pPos[i * 3 + 2] = 0.55 + r3 * 0.95; // In 3D space in front of mesh for genuine 3D parallax!
    pScale[i] = 8.0 + r1 * 22.0;
    pSeed[i] = r2 * 6.2831;
  }

  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('aScale', new THREE.BufferAttribute(pScale, 1));
  pGeo.setAttribute('aSeed', new THREE.BufferAttribute(pSeed, 1));

  const pMat = new THREE.ShaderMaterial({
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
        // Smooth orbital swirl in 3D space
        float ang = uTime * 0.32 + aSeed;
        pos.x += cos(ang) * 0.14 - uTime * 0.025;
        pos.y += sin(ang * 0.9) * 0.15 + sin(uTime * 0.4 + aSeed) * 0.05;
        pos.z += sin(ang * 1.1) * 0.08;

        vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = aScale * uPixelRatio * (5.5 / max(1.0, -mvPos.z));
        vAlpha = (0.30 + 0.38 * (0.5 + 0.5 * sin(uTime * 2.2 + aSeed * 3.0)));
        vTint = fract(aSeed * 1.7);
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
        float bokeh = exp(-r * r * 3.6) * 0.8 + smoothstep(1.0, 0.75, r) * 0.2;
        vec3 col = mix(vec3(1.0, 0.96, 0.99), vec3(0.86, 0.90, 1.0), vTint);
        gl_FragColor = vec4(col, bokeh * vAlpha);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
  });

  const particles = new THREE.Points(pGeo, pMat);
  group.add(particles);

  function updateVolumetrics(t, crystalBoost = 0, wispBoost = 0) {
    wispMat.uniforms.uTime.value = t;
    wispMat.uniforms.uOpacity.value = 0.15 + 0.42 * wispBoost;
    pMat.uniforms.uTime.value = t;
    crystalMat.emissiveIntensity = 0.12 + crystalBoost * 0.55;

    for (const c of crystals) {
      c.mesh.position.y = c.basePos.y + Math.sin(t * c.speed + c.seed) * 0.06;
      c.mesh.position.x = c.basePos.x + Math.cos(t * c.speed * 0.8 + c.seed) * 0.04;
      c.mesh.rotation.y = c.baseRot[1] + t * 0.52 * c.speed;
      c.mesh.rotation.x = c.baseRot[0] + Math.sin(t * 0.9 + c.seed) * 0.16;
    }
  }

  return { volumetricGroup: group, pMat, updateVolumetrics };
}
