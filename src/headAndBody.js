import * as THREE from 'three';

/**
 * Gaussian helper for smooth organic 3D sculpting brushes
 */
function gauss(x, mu, sigma) {
  const d = (x - mu) / sigma;
  return Math.exp(-0.5 * d * d);
}

function gauss2D(x, y, mux, muy, sx, sy) {
  const dx = (x - mux) / sx;
  const dy = (y - muy) / sy;
  return Math.exp(-0.5 * (dx * dx + dy * dy));
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Evaluates the exact sculpted 3D Japanese Anime head surface in local head space:
 * +Z = front of face, +Y = up (crown), +X = character's left (viewer's right in front view).
 * u in [-PI, PI] (0 = front center +Z, +PI/2 = left ear +X, +-PI = back skull -Z)
 * v in [0, 1] (0 = top crown pole, 1 = neck junction under jaw)
 */
export function evalHeadSurface(u, v, smileAmount = 0) {
  // Latitude angle from top pole (0) to bottom pole (PI)
  const phi = v * Math.PI;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);

  const sinU = Math.sin(u);
  const cosU = Math.cos(u);
  const absU = Math.abs(u);

  // Base anime cranium proportions (petite, youthful rounded cranium)
  let rx = 0.86 * sinPhi;
  let y = 1.02 * cosPhi;
  let rz = (cosU >= 0 ? 0.86 : 0.94) * sinPhi;

  // 1. Gently flatten front face plane so she has delicate anime contours instead of a sphere
  const frontMask = Math.max(0, cosU);
  const lowerFaceMask = smoothstep(0.32, 0.78, v) * (1.0 - smoothstep(0.86, 0.99, v));

  // Taper width (rx) smoothly into a soft, petite rounded anime jawline & chin (no pinch!)
  const jawTaper = smoothstep(0.46, 0.86, v);
  const chinSharpness = 1.0 - jawTaper * (0.38 + 0.14 * Math.pow(frontMask, 1.2));
  rx *= chinSharpness;

  let x = rx * sinU;
  let z = rz * cosU;

  // Lift back occipital skull base so jawline slopes cleanly up toward ears
  const backMask = Math.max(0, -cosU);
  y += backMask * smoothstep(0.58, 0.92, v) * 0.28;

  // Bring lower front face & delicate V-chin forward so side/3-4 profile is unmistakably anime!
  const chinForward = Math.pow(frontMask, 1.35) * smoothstep(0.44, 0.82, v) * (1.0 - smoothstep(0.84, 0.98, v));
  z += chinForward * 0.34;
  y += chinForward * 0.12;

  // 2. Soft Puffy 3/4 Anime Cheeks ("puni-cheeks" signature silhouette)
  const cheekPush =
    gauss2D(absU, v, 0.56, 0.62, 0.28, 0.10) * 0.072 +
    gauss2D(absU, v, 0.32, 0.60, 0.22, 0.085) * 0.038;
  x += Math.sign(u || 1) * cheekPush * 0.58;
  z += cheekPush * 0.82;
  y -= cheekPush * 0.12;

  // 3. Smooth Eye Socket Recesses (at u = +-0.325, v = 0.525) so 3D eyeballs sit flush inside
  const eyeSocketL = gauss2D(u, v, 0.325, 0.525, 0.155, 0.060);
  const eyeSocketR = gauss2D(u, v, -0.325, 0.525, 0.155, 0.060);
  const eyeSocket = eyeSocketL + eyeSocketR;
  z -= eyeSocket * 0.068;

  // Subtle brow ridge softness above eyes
  const browSoft = gauss2D(absU, v, 0.31, 0.435, 0.22, 0.042);
  z += browSoft * 0.018;

  // 4. Delicate Petite Anime Nose (crisp narrow bridge + tiny pointed tip, zero bulbous shadow!)
  const noseTip = gauss2D(u, v, 0.0, 0.612, 0.038, 0.030);
  const noseBridge = gauss2D(u, v, 0.0, 0.565, 0.032, 0.042);
  z += noseTip * 0.068 + noseBridge * 0.024;
  y -= noseTip * 0.010;

  // 5. Delicate Tiny Shy Anime Mouth & Lips (around u = 0, v = 0.712)
  const upperLip = gauss2D(u, v, 0.0, 0.698, 0.072, 0.014);
  const mouthPart = gauss2D(u, v, 0.0, 0.710, 0.062, 0.008);
  const lowerLip = gauss2D(u, v, 0.0, 0.724, 0.065, 0.014);
  z += upperLip * 0.016 - mouthPart * 0.018 + lowerLip * 0.014;

  // 6. Delicate Chin Tip Cushion (v = 0.80)
  const chinTip = gauss2D(u, v, 0.0, 0.80, 0.14, 0.042);
  z += chinTip * 0.042;
  y -= chinTip * 0.025;

  // 7. Smooth Neck Transition near v -> 1.0
  const neckBlend = smoothstep(0.84, 1.0, v);
  if (neckBlend > 0) {
    const neckRadius = 0.265;
    const nx = neckRadius * sinU;
    const nz = -0.11 + neckRadius * cosU;
    const ny = -0.76 - (v - 0.84) * 0.95;
    x = THREE.MathUtils.lerp(x, nx, neckBlend);
    y = THREE.MathUtils.lerp(y, ny, neckBlend);
    z = THREE.MathUtils.lerp(z, nz, neckBlend);
  }

  // 8. Optional Smile Morph (lifts mouth corners & softly plumps upper cheeks)
  if (smileAmount !== 0) {
    const cornerMask = gauss2D(absU, v, 0.115, 0.704, 0.055, 0.024);
    const smileCheek = gauss2D(absU, v, 0.42, 0.59, 0.16, 0.055);
    y += (cornerMask * 0.026 + smileCheek * 0.012) * smileAmount;
    x += Math.sign(u || 1) * cornerMask * 0.012 * smileAmount;
    z += smileCheek * 0.014 * smileAmount - cornerMask * 0.006 * smileAmount;
  }

  return new THREE.Vector3(x, y, z);
}

/**
 * Builds high-resolution sculpted 3D Anime Head + Petite Ears with seamless normals,
 * cheek/nose blush weights, lip mask, and smile morph attribute.
 */
export function buildAnimeHead(skinMaterial) {
  const headGroup = new THREE.Group();

  const uSegs = 168;
  const vSegs = 136;
  const vertCount = (uSegs + 1) * (vSegs + 1);

  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const blushAttr = new Float32Array(vertCount);
  const lipAttr = new Float32Array(vertCount);
  const smileDelta = new Float32Array(vertCount * 3);

  let idx = 0;
  for (let iv = 0; iv <= vSegs; iv++) {
    const v = iv / vSegs;
    for (let iu = 0; iu <= uSegs; iu++) {
      const u = (iu / uSegs - 0.5) * Math.PI * 2.0; // -PI .. +PI, 0 at front center
      const p0 = evalHeadSurface(u, v, 0.0);
      const pSmile = evalHeadSurface(u, v, 1.0);

      positions[idx * 3] = p0.x;
      positions[idx * 3 + 1] = p0.y;
      positions[idx * 3 + 2] = p0.z;

      smileDelta[idx * 3] = pSmile.x - p0.x;
      smileDelta[idx * 3 + 1] = pSmile.y - p0.y;
      smileDelta[idx * 3 + 2] = pSmile.z - p0.z;

      uvs[idx * 2] = iu / uSegs;
      uvs[idx * 2 + 1] = 1.0 - v;

      // Soft Gaussian pale-pink blush right under eyes & across cheeks (like reference!)
      const absU = Math.abs(u);
      const cheekBlush = gauss2D(absU, v, 0.40, 0.585, 0.18, 0.055);
      const noseBlush = gauss2D(u, v, 0.0, 0.60, 0.09, 0.032) * 0.42;
      const earWarmth = gauss2D(absU, v, 1.48, 0.52, 0.20, 0.08) * 0.35;
      blushAttr[idx] = Math.min(1.0, cheekBlush + noseBlush + earWarmth);

      // Delicate rosebud lip tint concentrated at center of shy anime mouth
      lipAttr[idx] = gauss2D(u, v, 0.0, 0.706, 0.072, 0.018);

      idx++;
    }
  }

  const indices = [];
  for (let iv = 0; iv < vSegs; iv++) {
    for (let iu = 0; iu < uSegs; iu++) {
      const a = iv * (uSegs + 1) + iu;
      const b = a + 1;
      const c = a + (uSegs + 1);
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const headGeo = new THREE.BufferGeometry();
  headGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  headGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  headGeo.setAttribute('aBlush', new THREE.BufferAttribute(blushAttr, 1));
  headGeo.setAttribute('aLipMask', new THREE.BufferAttribute(lipAttr, 1));
  headGeo.setAttribute('aSmileDelta', new THREE.BufferAttribute(smileDelta, 3));
  headGeo.setIndex(indices);
  headGeo.computeVertexNormals();

  // Weld normals across u = -PI / +PI seam & poles so there is zero visible seam
  const normArr = headGeo.attributes.normal.array;
  for (let iv = 0; iv <= vSegs; iv++) {
    const iStart = iv * (uSegs + 1);
    const iEnd = iStart + uSegs;
    const nx = (normArr[iStart * 3] + normArr[iEnd * 3]) * 0.5;
    const ny = (normArr[iStart * 3 + 1] + normArr[iEnd * 3 + 1]) * 0.5;
    const nz = (normArr[iStart * 3 + 2] + normArr[iEnd * 3 + 2]) * 0.5;
    const len = Math.hypot(nx, ny, nz) || 1;
    normArr[iStart * 3] = normArr[iEnd * 3] = nx / len;
    normArr[iStart * 3 + 1] = normArr[iEnd * 3 + 1] = ny / len;
    normArr[iStart * 3 + 2] = normArr[iEnd * 3 + 2] = nz / len;
  }
  headGeo.attributes.normal.needsUpdate = true;

  const headMesh = new THREE.Mesh(headGeo, skinMaterial);
  headGroup.add(headMesh);

  // Sculpted Petite Anime Ears (especially important: left ear is visible under the white silk bow!)
  for (const side of [-1, 1]) {
    const earGeo = buildSculptedEarGeometry(side);
    const earMesh = new THREE.Mesh(earGeo, skinMaterial);
    const anchor = evalHeadSurface(side * 1.46, 0.545, 0);
    earMesh.position.copy(anchor);
    earMesh.position.x -= side * 0.03;
    earMesh.rotation.y = side * 0.42;
    earMesh.rotation.z = -side * 0.16;
    earMesh.rotation.x = -0.10;
    headGroup.add(earMesh);
  }

  return { headGroup, headMesh };
}

/**
 * Builds a delicate sculpted 3D anime ear with outer helix rim, inner concha hollow, and soft earlobe
 */
function buildSculptedEarGeometry(side) {
  const segU = 32;
  const segV = 40;
  const count = (segU + 1) * (segV + 1);
  const pos = new Float32Array(count * 3);
  const blush = new Float32Array(count);
  const lip = new Float32Array(count);
  const delta = new Float32Array(count * 3);

  let k = 0;
  for (let iv = 0; iv <= segV; iv++) {
    const v = iv / segV;
    const phi = v * Math.PI;
    for (let iu = 0; iu <= segU; iu++) {
      const u = (iu / segU) * Math.PI * 2;
      const sinP = Math.sin(phi);
      const cosP = Math.cos(phi);

      // Flattened oval cup with folded outer helix & delicate lobe
      let ex = 0.115 * sinP * (0.5 + 0.5 * Math.sin(u)) * side;
      let ey = 0.185 * cosP;
      let ez = -0.095 * sinP * Math.cos(u);

      // Concha hollow on front side of ear
      const frontFace = Math.max(0, Math.cos(u - Math.PI * 0.35));
      const hollow = frontFace * Math.sin(phi) * 0.042;
      ez -= hollow;

      // Outer helix rim ridge
      const rim = Math.exp(-Math.pow((sinP - 0.92) / 0.14, 2)) * 0.022;
      ez += rim * 0.6;
      ex += side * rim * 0.4;

      pos[k * 3] = ex;
      pos[k * 3 + 1] = ey;
      pos[k * 3 + 2] = ez;
      blush[k] = 0.42 + 0.35 * hollow * 10.0; // Warm subsurface pink inside ear!
      k++;
    }
  }

  const indices = [];
  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * (segU + 1) + iu;
      const b = a + 1;
      const c = a + (segU + 1);
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aBlush', new THREE.BufferAttribute(blush, 1));
  geo.setAttribute('aLipMask', new THREE.BufferAttribute(lip, 1));
  geo.setAttribute('aSmileDelta', new THREE.BufferAttribute(delta, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds Multi-Layer 3D Anime Eyes (Sclera + Concave Greyish-Purple Iris + Convex Glass Cornea +
 * Rigged Upper/Lower Eyelids + 24 Individual Curved 3D Eyelashes per eye + Soft Eyebrows)
 */
export function buildAnimeEyes(irisMaterial, skinMaterial) {
  const eyesGroup = new THREE.Group();

  const scleraMat = new THREE.ShaderMaterial({
    uniforms: {
      uTopShadow: { value: new THREE.Color(0xded7eb) },
      uBottomWhite: { value: new THREE.Color(0xfdfbff) },
      uUpperLidCut: { value: 0.52 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vLocal;
      void main() {
        vUv = uv;
        vLocal = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTopShadow;
      uniform vec3 uBottomWhite;
      uniform float uUpperLidCut;
      varying vec2 vUv;
      varying vec3 vLocal;
      void main() {
        float lidY = uUpperLidCut * 0.13 - 1.2 * vLocal.x * vLocal.x;
        if (vLocal.y > lidY) discard;
        float t = smoothstep(0.75, 0.25, vUv.y);
        vec3 col = mix(uTopShadow, uBottomWhite, t);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  // Transparent glass outer cornea dome for real 3D specular reflections
  const corneaMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.03,
    metalness: 0.0,
    transmission: 0.94,
    ior: 1.42,
    thickness: 0.08,
    transparent: true,
    opacity: 0.36,
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,
    depthWrite: false,
  });

  // Soft smoky plum-taupe eyelash shader (matching reference delicate lashes!)
  const lashMat = new THREE.MeshStandardMaterial({
    color: 0x453543,
    roughness: 0.55,
    metalness: 0.05,
  });

  const browMat = new THREE.MeshBasicMaterial({
    color: 0xcfaab9,
    transparent: true,
    opacity: 0.45,
  });

  const eyeControllers = [];

  for (const side of [-1, 1]) {
    const eyePivot = new THREE.Group();
    const socketCenter = evalHeadSurface(side * 0.325, 0.525, 0);
    eyePivot.position.copy(socketCenter);
    eyePivot.position.z -= 0.015; // Sits cleanly in front of lower cheek contour!
    eyePivot.rotation.y = side * 0.20;

    // 1. Curved Sclera Dome (recessed behind concave iris so it NEVER occludes the pupil!)
    const scleraGeo = new THREE.SphereGeometry(0.168, 36, 28, 0, Math.PI * 2, 0, Math.PI * 0.52);
    scleraGeo.rotateX(Math.PI * 0.5);
    scleraGeo.scale(1.18, 0.96, 0.44);
    const scleraMesh = new THREE.Mesh(scleraGeo, scleraMat);
    scleraMesh.position.z = -0.026;
    eyePivot.add(scleraMesh);

    // 2. Movable Gaze Group (Iris + Convex Cornea)
    const gazeRig = new THREE.Group();
    eyePivot.add(gazeRig);

    // Concave Iris Dish
    const irisGeo = new THREE.RingGeometry(0.0, 0.122, 48, 8);
    const irisPos = irisGeo.attributes.position;
    const irisUv = irisGeo.attributes.uv;
    for (let i = 0; i < irisPos.count; i++) {
      const ix = irisPos.getX(i);
      const iy = irisPos.getY(i);
      const rNorm = Math.min(1.0, Math.hypot(ix / 0.110, iy / 0.122));
      // Concave optical cup sitting cleanly in front of sclera!
      const iz = 0.084 - (1.0 - rNorm * rNorm) * 0.018;
      irisPos.setXYZ(i, ix * 0.95, iy * 1.05, iz);
      irisUv.setXY(i, (ix / 0.122) * 0.5 + 0.5, (iy / 0.122) * 0.5 + 0.5);
    }
    irisGeo.computeVertexNormals();
    const irisMesh = new THREE.Mesh(irisGeo, irisMaterial);
    gazeRig.add(irisMesh);

    // Convex Outer Cornea Lens
    const corneaGeo = new THREE.SphereGeometry(0.116, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.42);
    corneaGeo.rotateX(Math.PI * 0.5);
    corneaGeo.scale(0.95, 1.05, 0.48);
    const corneaMesh = new THREE.Mesh(corneaGeo, corneaMat);
    corneaMesh.position.z = 0.044;
    gazeRig.add(corneaMesh);

    // 3. Upper Eyelid Skin Hood + Lash Line + 22 Curved 3D Eyelashes (Rigged for downcast/lift/blink!)
    const upperLidRig = new THREE.Group();
    upperLidRig.position.set(0, 0.015, 0.01);
    eyePivot.add(upperLidRig);

    // Upper skin eyelid hood tucked cleanly inside upper lid until blink closes!
    const hoodGeo = new THREE.SphereGeometry(0.168, 36, 20, 0, Math.PI * 2, 0, Math.PI * 0.48);
    hoodGeo.scale(1.14, 0.92, 0.48);
    const hCount = hoodGeo.attributes.position.count;
    const hBlush = new Float32Array(hCount).fill(0.24);
    const hZero1 = new Float32Array(hCount);
    const hZero3 = new Float32Array(hCount * 3);
    hoodGeo.setAttribute('aBlush', new THREE.BufferAttribute(hBlush, 1));
    hoodGeo.setAttribute('aLipMask', new THREE.BufferAttribute(hZero1, 1));
    hoodGeo.setAttribute('aSmileDelta', new THREE.BufferAttribute(hZero3, 3));
    const hoodMesh = new THREE.Mesh(hoodGeo, skinMaterial);
    hoodMesh.position.z = -0.012;
    hoodMesh.rotation.x = -0.52;
    upperLidRig.add(hoodMesh);

    // Thick arched upper lash-line ribbon (gentle downward droop at outer corner = shy expression!)
    const lashLinePts = [];
    const numLinePts = 21;
    for (let i = 0; i < numLinePts; i++) {
      const t = i / (numLinePts - 1); // 0 inner corner -> 1 outer corner
      const lx = side * THREE.MathUtils.lerp(-0.145, 0.168, t);
      const arch = Math.sin(t * Math.PI) * 0.072 - t * 0.036; // Shy outer-corner droop!
      const ly = 0.022 + arch;
      const lz = 0.088 - Math.pow((t - 0.45) * 1.4, 2) * 0.032;
      lashLinePts.push(new THREE.Vector3(lx, ly, lz));
    }
    const lashLineCurve = new THREE.CatmullRomCurve3(lashLinePts);
    const lashLineGeo = new THREE.TubeGeometry(lashLineCurve, 28, 0.0105, 8, false);
    const lashLineMesh = new THREE.Mesh(lashLineGeo, lashMat);
    upperLidRig.add(lashLineMesh);

    // 22 Individual Feathery Curved 3D Eyelashes fanning along upper lid
    const numLashes = 22;
    for (let i = 0; i < numLashes; i++) {
      const t = 0.08 + (i / (numLashes - 1)) * 0.90;
      const basePt = lashLineCurve.getPoint(t);
      const lashLen = (0.045 + Math.sin(t * Math.PI) * 0.052 + t * 0.032) * (i % 2 === 0 ? 1.08 : 0.84);
      const outDirX = side * (0.18 + t * 0.68);
      const outDirY = -0.22 + Math.sin(t * Math.PI) * 0.18;
      const p1 = basePt.clone().add(new THREE.Vector3(outDirX * lashLen * 0.5, outDirY * lashLen * 0.45, lashLen * 0.55));
      const p2 = basePt.clone().add(new THREE.Vector3(outDirX * lashLen * 1.05, (outDirY + 0.24) * lashLen, lashLen * 0.85));

      const lCurve = new THREE.CatmullRomCurve3([basePt, p1, p2]);
      const lGeo = buildTaperedTube(lCurve, 8, 0.0052, 0.0006, 5);
      upperLidRig.add(new THREE.Mesh(lGeo, lashMat));
    }

    // Subtle lower outer eyelashes (6 delicate tiny lashes)
    for (let i = 0; i < 6; i++) {
      const t = 0.52 + (i / 5) * 0.42;
      const bx = side * THREE.MathUtils.lerp(-0.12, 0.15, t);
      const by = -0.072 + (t - 0.5) * 0.015;
      const bz = 0.076 - Math.pow(t - 0.5, 2) * 0.04;
      const bp = new THREE.Vector3(bx, by, bz);
      const ep = bp.clone().add(new THREE.Vector3(side * 0.025, -0.032, 0.022));
      const mp = bp.clone().lerp(ep, 0.5).add(new THREE.Vector3(0, -0.005, 0.008));
      const lowGeo = buildTaperedTube(new THREE.CatmullRomCurve3([bp, mp, ep]), 6, 0.0032, 0.0005, 4);
      eyePivot.add(new THREE.Mesh(lowGeo, lashMat));
    }

    // Delicate double-eyelid crease line above upper lid
    const creasePts = lashLinePts.map((p, idx) =>
      p.clone().add(new THREE.Vector3(0, 0.036 + Math.sin((idx / 20) * Math.PI) * 0.012, -0.006))
    );
    const creaseGeo = buildTaperedTube(new THREE.CatmullRomCurve3(creasePts), 20, 0.0032, 0.0012, 5);
    upperLidRig.add(new THREE.Mesh(creaseGeo, browMat));

    // Soft slightly-worried/shy gentle eyebrow high on forehead (peeking softly through bangs)
    const browPts = [];
    for (let i = 0; i < 11; i++) {
      const t = i / 10;
      const uBrow = side * THREE.MathUtils.lerp(0.20, 0.56, t);
      // Slight gentle downward slope toward outer edge for tender shyness
      const vBrow = 0.405 + t * 0.022 - Math.sin(t * Math.PI) * 0.012;
      const surf = evalHeadSurface(uBrow, vBrow, 0);
      surf.z += 0.012;
      browPts.push(surf);
    }
    const browGeo = buildTaperedTube(new THREE.CatmullRomCurve3(browPts), 16, 0.0065, 0.0015, 5);
    eyesGroup.add(new THREE.Mesh(browGeo, browMat));

    eyesGroup.add(eyePivot);
    eyeControllers.push({ side, gazeRig, upperLidRig, hoodMesh });
  }

  /**
   * Updates eye gaze and eyelid blink smoothly per frame:
   * - gazeLift: 0 (downcast shy at 0s) -> 1 (gently looking up toward lens at 2-4s)
   * - gazeYaw: subtle horizontal tracking toward camera
   * - blink: 0 (open) -> 1 (gently closed during 6-7s blink)
   */
  function updateEyes({ gazeLift = 0, gazeYaw = 0, blink = 0 }) {
    // Smoothly clip iris & sclera right along the descending upper lash line!
    const openLidCut = THREE.MathUtils.lerp(0.38, 0.56, gazeLift);
    irisMaterial.uniforms.uUpperLidCut.value = THREE.MathUtils.lerp(openLidCut, -1.05, blink);
    scleraMat.uniforms.uUpperLidCut.value = THREE.MathUtils.lerp(openLidCut + 0.08, -1.05, blink);

    for (const ctrl of eyeControllers) {
      ctrl.gazeRig.rotation.x = THREE.MathUtils.lerp(0.10, 0.0, gazeLift);
      ctrl.gazeRig.rotation.y = gazeYaw;

      const openRot = THREE.MathUtils.lerp(0.30, 0.16, gazeLift);
      const closedRot = 0.72;
      ctrl.upperLidRig.rotation.x = THREE.MathUtils.lerp(openRot, closedRot, blink);
    }
  }

  return { eyesGroup, updateEyes };
}

/**
 * Helper: Builds a smoothly tapered 3D tube along a curve
 */
export function buildTaperedTube(curve, tubularSegments, rStart, rEnd, radialSegments = 6) {
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const vertCount = (tubularSegments + 1) * (radialSegments + 1);
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);

  let k = 0;
  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    const pt = curve.getPointAt(t);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    // Smooth organic root-to-tip taper
    const radius = THREE.MathUtils.lerp(rStart, rEnd, Math.pow(t, 0.85)) * Math.sin(Math.min(1, t * 8) * Math.PI * 0.5);

    for (let j = 0; j <= radialSegments; j++) {
      const v = (j / radialSegments) * Math.PI * 2;
      const sin = Math.sin(v);
      const cos = -Math.cos(v);

      const nx = cos * N.x + sin * B.x;
      const ny = cos * N.y + sin * B.y;
      const nz = cos * N.z + sin * B.z;

      positions[k * 3] = pt.x + radius * nx;
      positions[k * 3 + 1] = pt.y + radius * ny;
      positions[k * 3 + 2] = pt.z + radius * nz;

      normals[k * 3] = nx;
      normals[k * 3 + 1] = ny;
      normals[k * 3 + 2] = nz;

      uvs[k * 2] = t;
      uvs[k * 2 + 1] = j / radialSegments;
      k++;
    }
  }

  const indices = [];
  for (let i = 0; i < tubularSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * (radialSegments + 1) + j;
      const b = a + (radialSegments + 1);
      const c = b + 1;
      const d = a + 1;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * Helper: Adds skin shader attributes (`aBlush`, `aLipMask`, `aSmileDelta`) to any body mesh
 */
function attachSkinAttributes(geo, blushFn) {
  const pos = geo.attributes.position;
  const count = pos.count;
  const blush = new Float32Array(count);
  const lip = new Float32Array(count);
  const delta = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    blush[i] = blushFn ? blushFn(pos.getX(i), pos.getY(i), pos.getZ(i), i) : 0.08;
  }
  geo.setAttribute('aBlush', new THREE.BufferAttribute(blush, 1));
  geo.setAttribute('aLipMask', new THREE.BufferAttribute(lip, 1));
  geo.setAttribute('aSmileDelta', new THREE.BufferAttribute(delta, 3));
  return geo;
}

/**
 * Builds Slender Neck, Bare Off-Shoulder Torso, Delicate Collarbone, Arms &
 * Both Delicately Clasped 10-Finger Hands in front of her chest (matching reference pose!)
 */
export function buildTorsoAndClaspedHands(skinMaterial) {
  const bodyGroup = new THREE.Group();

  // In character body space: torso faces -X / +Z (angled sideways like reference!),
  // here we build symmetrical torso facing +Z first, then pose the torso & limbs cleanly!
  // 1. Slender Neck + Bare Upper Chest & Shoulders (Lathe / Parametric Sculpt)
  const uSegs = 96;
  const vSegs = 64;
  const count = (uSegs + 1) * (vSegs + 1);
  const positions = new Float32Array(count * 3);

  let idx = 0;
  for (let iv = 0; iv <= vSegs; iv++) {
    const t = iv / vSegs; // 0 at upper neck -> 1 at mid-torso (under dress)
    const y = THREE.MathUtils.lerp(-0.55, -2.55, t);

    for (let iu = 0; iu <= uSegs; iu++) {
      const u = (iu / uSegs - 0.5) * Math.PI * 2;
      const sinU = Math.sin(u);
      const cosU = Math.cos(u);

      // Smoothly flare from slender neck (r=0.25) out to petite feminine shoulders (rx=0.86, rz=0.44)
      const shoulderFlare = smoothstep(0.18, 0.46, t);
      const waistTaper = smoothstep(0.55, 1.0, t);

      let rx = THREE.MathUtils.lerp(0.255, 0.86, shoulderFlare) * (1.0 - waistTaper * 0.24);
      let rz = THREE.MathUtils.lerp(0.255, 0.44, shoulderFlare) * (1.0 - waistTaper * 0.14);

      // Rounded deltoid shoulder cap around t = 0.44, |sinU| -> 1
      const deltoid = gauss(t, 0.45, 0.11) * Math.pow(Math.abs(sinU), 2.0) * 0.10;
      rx += deltoid;

      // Delicate collarbone ridge across upper chest (t ~ 0.38, front cosU > 0.3)
      const clavicle =
        gauss(t, 0.37, 0.032) *
        Math.max(0, cosU) *
        smoothstep(0.08, 0.35, Math.abs(sinU)) *
        (1.0 - smoothstep(0.65, 0.95, Math.abs(sinU))) *
        0.036;
      const sternalHollow = gauss2D(u, t, 0.0, 0.35, 0.15, 0.045) * 0.032;

      // Subtle bust contour under ruffled dress (t ~ 0.68)
      const bust = gauss(t, 0.68, 0.12) * Math.pow(Math.max(0, cosU), 1.6) * 0.14;

      const x = rx * sinU;
      const z = -0.10 + (rz + clavicle - sternalHollow + bust) * cosU;

      positions[idx * 3] = x;
      positions[idx * 3 + 1] = y - Math.pow(Math.abs(sinU), 1.8) * shoulderFlare * 0.10;
      positions[idx * 3 + 2] = z;
      idx++;
    }
  }

  const indices = [];
  for (let iv = 0; iv < vSegs; iv++) {
    for (let iu = 0; iu < uSegs; iu++) {
      const a = iv * (uSegs + 1) + iu;
      const b = a + 1;
      const c = a + (uSegs + 1);
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const torsoGeo = new THREE.BufferGeometry();
  torsoGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  torsoGeo.setIndex(indices);
  torsoGeo.computeVertexNormals();
  attachSkinAttributes(torsoGeo, (x, y) => {
    // Gentle rosy blush on bare shoulder caps & collarbones
    const shoulderCap = gauss(Math.abs(x), 0.78, 0.18) * gauss(y, -1.42, 0.22) * 0.42;
    return 0.06 + shoulderCap;
  });
  bodyGroup.add(new THREE.Mesh(torsoGeo, skinMaterial));

  // 2. Foreground Left Arm (from left shoulder +0.76, -1.44, -0.05 down to elbow, rising up to clasped hands!)
  // & Right Arm rising to meet left hand gently in front of upper chest (+0.05..+0.25, -1.18, +0.66 in torso space)
  const leftArmPts = [
    new THREE.Vector3(0.74, -1.42, -0.06),   // Left bare shoulder (foreground!)
    new THREE.Vector3(0.64, -1.96, 0.16),    // Upper arm
    new THREE.Vector3(0.48, -2.38, 0.36),    // Elbow tucked gracefully under ruffle
    new THREE.Vector3(0.28, -1.82, 0.56),    // Slender forearm emerging upward
    new THREE.Vector3(0.11, -1.34, 0.66),    // Left wrist
  ];
  const rightArmPts = [
    new THREE.Vector3(-0.72, -1.44, -0.06),  // Right shoulder
    new THREE.Vector3(-0.58, -1.98, 0.20),
    new THREE.Vector3(-0.42, -2.32, 0.42),   // Right elbow
    new THREE.Vector3(-0.18, -1.78, 0.58),   // Right forearm rising
    new THREE.Vector3(-0.04, -1.33, 0.68),   // Right wrist
  ];

  bodyGroup.add(new THREE.Mesh(buildLimbTube(leftArmPts, 42, [0.155, 0.128, 0.112, 0.096, 0.076]), skinMaterial));
  bodyGroup.add(new THREE.Mesh(buildLimbTube(rightArmPts, 42, [0.152, 0.125, 0.110, 0.095, 0.075]), skinMaterial));

  // 3. Delicately Clasped Hands close in front of her chest (10 slender articulated 3D fingers!)
  const handsGroup = buildClaspedHandsGroup(skinMaterial);
  handsGroup.position.set(0.06, -1.12, 0.72);
  handsGroup.scale.setScalar(1.32);
  handsGroup.rotation.set(0.12, 0.35, -0.08);
  bodyGroup.add(handsGroup);

  return { bodyGroup, handsGroup };
}

/**
 * Builds a smooth anatomical arm/limb tube with custom radius profile
 */
function buildLimbTube(pts, segs, radii) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const radialSegs = 24;
  const frames = curve.computeFrenetFrames(segs, false);
  const count = (segs + 1) * (radialSegs + 1);
  const pos = new Float32Array(count * 3);

  let k = 0;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const pt = curve.getPointAt(t);
    const N = frames.normals[i];
    const B = frames.binormals[i];

    // Smoothly interpolate radius array
    const scaled = t * (radii.length - 1);
    const rIdx = Math.min(radii.length - 2, Math.floor(scaled));
    const rFrac = scaled - rIdx;
    const rad = THREE.MathUtils.lerp(radii[rIdx], radii[rIdx + 1], smoothstep(0, 1, rFrac));

    for (let j = 0; j <= radialSegs; j++) {
      const a = (j / radialSegs) * Math.PI * 2;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      // Slight oval cross-section for feminine forearm/wrist
      const rx = rad * 0.94;
      const ry = rad * 1.06;
      pos[k * 3] = pt.x + rx * cos * N.x + ry * sin * B.x;
      pos[k * 3 + 1] = pt.y + rx * cos * N.y + ry * sin * B.y;
      pos[k * 3 + 2] = pt.z + rx * cos * N.z + ry * sin * B.z;
      k++;
    }
  }

  const indices = [];
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radialSegs; j++) {
      const a = i * (radialSegs + 1) + j;
      const b = a + (radialSegs + 1);
      const c = b + 1;
      const d = a + 1;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return attachSkinAttributes(geo, () => 0.10);
}

/**
 * Builds two slender, graceful 5-fingered anime hands gently clasped together
 * (exactly matching the shy clasped-hands gesture in the reference image!)
 */
function buildClaspedHandsGroup(skinMaterial) {
  const group = new THREE.Group();

  // Slender anime palms angled gently upward toward chin (matching reference gesture!)
  for (const side of [-1, 1]) {
    const palmGeo = new THREE.SphereGeometry(0.082, 24, 20);
    palmGeo.scale(0.48, 1.32, 0.82);
    attachSkinAttributes(palmGeo, () => 0.20);
    const palm = new THREE.Mesh(palmGeo, skinMaterial);
    palm.position.set(side * 0.052, -0.10, side > 0 ? 0.01 : -0.01);
    palm.rotation.z = side * 0.18;
    palm.rotation.y = -side * 0.28;
    group.add(palm);

    // 4 long, delicate, gracefully arched anime fingers per hand softly overlapping
    const fingerConfigs = [
      { yOff: 0.01,  zOff: 0.044, len: 0.235, rad: 0.0185 },
      { yOff: 0.024, zOff: 0.014, len: 0.252, rad: 0.0185 },
      { yOff: 0.008, zOff: -0.016, len: 0.232, rad: 0.0172 },
      { yOff: -0.018, zOff: -0.044, len: 0.192, rad: 0.0152 },
    ];

    fingerConfigs.forEach((f, idx) => {
      const interlaceZ = f.zOff + (side > 0 ? 0.007 : -0.007);
      const p0 = new THREE.Vector3(side * 0.052, f.yOff - 0.02, interlaceZ);
      const p1 = new THREE.Vector3(side * 0.028, f.yOff + f.len * 0.52, interlaceZ + 0.026);
      const p2 = new THREE.Vector3(-side * 0.022, f.yOff + f.len * 0.82, interlaceZ + 0.020);
      const p3 = new THREE.Vector3(-side * 0.068, f.yOff + f.len * 0.66, interlaceZ - 0.008);

      const fGeo = buildLimbTube([p0, p1, p2, p3], 18, [f.rad, f.rad * 0.86, f.rad * 0.72, f.rad * 0.50]);
      const pos = fGeo.attributes.position;
      const blush = fGeo.attributes.aBlush.array;
      for (let v = 0; v < pos.count; v++) {
        const distTip = p3.distanceTo(new THREE.Vector3(pos.getX(v), pos.getY(v), pos.getZ(v)));
        blush[v] = 0.16 + Math.max(0, 1.0 - distTip / 0.08) * 0.55;
      }
      group.add(new THREE.Mesh(fGeo, skinMaterial));
    });

    const t0 = new THREE.Vector3(side * 0.056, -0.10, 0.048);
    const t1 = new THREE.Vector3(side * 0.038, -0.01, 0.072);
    const t2 = new THREE.Vector3(side * 0.008, 0.06, 0.064);
    const thumbGeo = buildLimbTube([t0, t1, t2], 14, [0.020, 0.017, 0.012]);
    group.add(new THREE.Mesh(thumbGeo, skinMaterial));
  }

  return group;
}
