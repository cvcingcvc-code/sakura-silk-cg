import * as THREE from 'three';

/**
 * Deterministic PRNG so every hair strand & fold is 100% reproducible across frames
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds a single flattened-elliptical 3D hair strand buffer data (flattened ribbon-tube
 * cross-section gives authentic anime hair clump volume + crisp specular highlights)
 */
function createHairStrandBuffers(curve, segs, widthRoot, thicknessRoot, seed, windWeight) {
  const radialSegs = 6;
  const frames = curve.computeFrenetFrames(segs, false);
  const vCount = (segs + 1) * (radialSegs + 1);

  const positions = new Float32Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const uvs = new Float32Array(vCount * 2);
  const tangents = new Float32Array(vCount * 3);
  const strandParams = new Float32Array(vCount);
  const strandSeeds = new Float32Array(vCount);
  const windWeights = new Float32Array(vCount);

  let k = 0;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const pt = curve.getPointAt(t);
    const T = frames.tangents[i];
    const N = frames.normals[i];
    const B = frames.binormals[i];

    // Non-zero root radius prevents degenerate 0-area triangles / NaN normals at crown whorl!
    const rootEase = 0.28 + 0.72 * Math.sin(Math.min(1.0, t * 6.0) * Math.PI * 0.5);
    const tipTaper = Math.pow(1.0 - t, 0.78);
    const w = Math.max(0.0015, widthRoot * rootEase * (0.08 + 0.92 * tipTaper));
    const th = Math.max(0.0010, thicknessRoot * rootEase * (0.08 + 0.92 * tipTaper));

    for (let j = 0; j <= radialSegs; j++) {
      const ang = (j / radialSegs) * Math.PI * 2.0;
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);

      const ox = cos * w * B.x + sin * th * N.x;
      const oy = cos * w * B.y + sin * th * N.y;
      const oz = cos * w * B.z + sin * th * N.z;

      const nx = cos * th * B.x + sin * w * N.x;
      const ny = cos * th * B.y + sin * w * N.y;
      const nz = cos * th * B.z + sin * w * N.z;
      const nLen = Math.hypot(nx, ny, nz) || 1.0;

      positions[k * 3] = pt.x + ox;
      positions[k * 3 + 1] = pt.y + oy;
      positions[k * 3 + 2] = pt.z + oz;

      normals[k * 3] = nx / nLen;
      normals[k * 3 + 1] = ny / nLen;
      normals[k * 3 + 2] = nz / nLen;

      tangents[k * 3] = T.x;
      tangents[k * 3 + 1] = T.y;
      tangents[k * 3 + 2] = T.z;

      uvs[k * 2] = t;
      uvs[k * 2 + 1] = j / radialSegs;

      strandParams[k] = t;
      strandSeeds[k] = seed;
      windWeights[k] = windWeight;
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

  return { positions, normals, uvs, tangents, strandParams, strandSeeds, windWeights, indices, vCount };
}

/**
 * Merges an array of strand buffer objects into a single high-performance BufferGeometry
 */
function mergeStrandBuffers(list) {
  let totalVerts = 0;
  let totalIndices = 0;
  for (const s of list) {
    totalVerts += s.vCount;
    totalIndices += s.indices.length;
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const tangents = new Float32Array(totalVerts * 3);
  const strandParams = new Float32Array(totalVerts);
  const strandSeeds = new Float32Array(totalVerts);
  const windWeights = new Float32Array(totalVerts);
  const indices = new Uint32Array(totalIndices);

  let vOffset = 0;
  let iOffset = 0;
  for (const s of list) {
    positions.set(s.positions, vOffset * 3);
    normals.set(s.normals, vOffset * 3);
    uvs.set(s.uvs, vOffset * 2);
    tangents.set(s.tangents, vOffset * 3);
    strandParams.set(s.strandParams, vOffset);
    strandSeeds.set(s.strandSeeds, vOffset);
    windWeights.set(s.windWeights, vOffset);

    for (let i = 0; i < s.indices.length; i++) {
      indices[iOffset + i] = s.indices[i] + vOffset;
    }
    vOffset += s.vCount;
    iOffset += s.indices.length;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('aTangent', new THREE.BufferAttribute(tangents, 3));
  geo.setAttribute('aStrandParam', new THREE.BufferAttribute(strandParams, 1));
  geo.setAttribute('aStrandSeed', new THREE.BufferAttribute(strandSeeds, 1));
  geo.setAttribute('aWindWeight', new THREE.BufferAttribute(windWeights, 1));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

/**
 * Builds the complete Ultra-High-Density 3D Hair Groom (~310 sculpted 3D strands):
 * - Base Hair Cap (prevents any scalp gaps)
 * - Fluffy Airy Front & Side-Parted Bangs
 * - Left-Ear Gathered Strands (flowing neatly around the ear & under the white silk bow)
 * - Right-Cheek & Ultra-Long Left-Sweeping S-Curve Dynamic Tresses
 * - Voluminous Crown & Back Cascades + Wispy Backlit Halo Flyaways
 */
export function buildHairGroom(hairMaterial) {
  const rand = mulberry32(20261118);
  const headStrands = [];

  const crownOrigin = new THREE.Vector3(0.05, 1.06, -0.04);

  // 1. Inner Scalp Hair Dome Cap (covers top & back of cranium cleanly)
  const capGeo = new THREE.SphereGeometry(0.915, 48, 36, -Math.PI * 0.62, Math.PI * 1.24, 0, Math.PI * 0.68);
  capGeo.rotateY(Math.PI); // Center cap on back of skull (-Z)
  capGeo.scale(0.98, 1.04, 1.03);
  capGeo.translate(0, 0.06, -0.02);
  const capCount = capGeo.attributes.position.count;
  const capTangents = new Float32Array(capCount * 3);
  const capParam = new Float32Array(capCount);
  const capSeed = new Float32Array(capCount).fill(0.5);
  const capWind = new Float32Array(capCount).fill(0.0);
  for (let i = 0; i < capCount; i++) {
    const py = capGeo.attributes.position.getY(i);
    capTangents[i * 3] = 0;
    capTangents[i * 3 + 1] = -1;
    capTangents[i * 3 + 2] = 0;
    capParam[i] = THREE.MathUtils.clamp((1.05 - py) / 1.4, 0, 0.5);
  }
  capGeo.setAttribute('aTangent', new THREE.BufferAttribute(capTangents, 3));
  capGeo.setAttribute('aStrandParam', new THREE.BufferAttribute(capParam, 1));
  capGeo.setAttribute('aStrandSeed', new THREE.BufferAttribute(capSeed, 1));
  capGeo.setAttribute('aWindWeight', new THREE.BufferAttribute(capWind, 1));
  const capMesh = new THREE.Mesh(capGeo, hairMaterial);

  // 2. Fluffy Airy Front Bangs (72 layered crescent-curved wisps with soft natural clustering!)
  const numBangs = 72;
  for (let i = 0; i < numBangs; i++) {
    const frac = i / (numBangs - 1); // 0 (-X right cheek) -> 1 (+X left temple)
    // Subtle clumping toward 9 natural bang locks so strands group organically instead of bars
    const clumpCenter = Math.round(frac * 9) / 9;
    const baseFrac = THREE.MathUtils.lerp(frac, clumpCenter, 0.28);
    const angle = THREE.MathUtils.lerp(-0.62, 0.62, baseFrac) + (rand() - 0.5) * 0.035;
    const layer = i % 3;
    const loftZ = 0.038 + layer * 0.022 + rand() * 0.014;

    const sinA = Math.sin(angle);
    const cosA = Math.cos(angle);

    // Feathered eye-peek length variation
    const eyeGap =
      Math.exp(-Math.pow((angle - 0.32) / 0.13, 2)) * 0.09 +
      Math.exp(-Math.pow((angle + 0.32) / 0.13, 2)) * 0.09;
    const templeLonger = Math.abs(angle) > 0.46 ? -(Math.abs(angle) - 0.46) * 0.95 : 0.0;
    const tipY = -0.08 + eyeGap + templeLonger + (rand() - 0.5) * 0.055;

    // Gentle crescent C-curve sweeping softly inward/leftward like airy anime bangs
    const curveSweep = -0.065 - angle * 0.08 - layer * 0.015;

    const p0 = crownOrigin.clone().lerp(new THREE.Vector3(sinA * 0.28, 1.00, 0.22), 0.45);
    const p1 = new THREE.Vector3(sinA * 0.64, 0.77 + layer * 0.024, cosA * 0.75 + loftZ);
    const p2 = new THREE.Vector3(sinA * 0.83 + curveSweep * 0.25, 0.40, cosA * 0.90 + loftZ);
    const p3 = new THREE.Vector3(sinA * 0.86 + curveSweep * 0.65, 0.10, cosA * 0.90 + loftZ * 0.85);
    const p4 = new THREE.Vector3(sinA * 0.84 + curveSweep, tipY, cosA * 0.86 + loftZ * 0.52);

    const width = (layer === 2 ? 0.034 : 0.056) * (0.82 + rand() * 0.38);
    const thick = width * 0.36;
    headStrands.push(
      createHairStrandBuffers(
        new THREE.CatmullRomCurve3([p0, p1, p2, p3, p4]),
        22,
        width,
        thick,
        rand(),
        0.26 + layer * 0.10
      )
    );
  }

  // 3. Cheek-Framing & Long Left-Sweeping Forelocks (-X side of face -> sweeping far left!)
  const numLeftSweep = 78;
  for (let i = 0; i < numLeftSweep; i++) {
    const f = i / (numLeftSweep - 1);
    const ang = THREE.MathUtils.lerp(-0.55, -2.35, f) + (rand() - 0.5) * 0.05;
    const sinA = Math.sin(ang); // negative (-X, viewer's left!)
    const cosA = Math.cos(ang);
    const layer = i % 3;
    const rOut = 0.90 + layer * 0.045 + rand() * 0.03;

    // Dramatic graceful S-curve sweeping toward viewer's bottom-left (like reference!)
    const lenScale = 0.85 + rand() * 0.40;
    const sweepLeft = (1.15 + f * 0.85 + layer * 0.22) * lenScale;

    const p0 = crownOrigin.clone().add(new THREE.Vector3(sinA * 0.12, 0.02 * layer, cosA * 0.12));
    const p1 = new THREE.Vector3(sinA * 0.76, 0.72 + layer * 0.03, cosA * 0.78);
    const p2 = new THREE.Vector3(sinA * rOut, 0.12, cosA * rOut);
    const p3 = new THREE.Vector3(sinA * rOut - sweepLeft * 0.28, -0.68, cosA * rOut * 0.88 + 0.12);
    const p4 = new THREE.Vector3(sinA * rOut - sweepLeft * 0.72, -1.62 * lenScale, cosA * 0.65 + (rand() - 0.5) * 0.28);
    const p5 = new THREE.Vector3(sinA * rOut - sweepLeft * 1.18, -2.55 * lenScale, cosA * 0.55 + (rand() - 0.5) * 0.35);

    const isWispy = i % 5 === 0;
    const width = isWispy ? 0.022 : (0.072 + rand() * 0.045);
    headStrands.push(
      createHairStrandBuffers(
        new THREE.CatmullRomCurve3([p0, p1, p2, p3, p4, p5]),
        30,
        width,
        width * 0.36,
        rand(),
        isWispy ? 1.35 : (0.85 + layer * 0.18)
      )
    );
  }

  // 4. Delicate Left-Cheek Sidelock Wisps (6 fine strands framing cheek IN FRONT of left ear)
  for (let i = 0; i < 6; i++) {
    const f = i / 5;
    const ang = THREE.MathUtils.lerp(0.68, 1.02, f);
    const sinA = Math.sin(ang);
    const cosA = Math.cos(ang);
    const p0 = crownOrigin.clone();
    const p1 = new THREE.Vector3(sinA * 0.76, 0.72, cosA * 0.78);
    const p2 = new THREE.Vector3(sinA * 0.89, 0.12, cosA * 0.88 + 0.04);
    const p3 = new THREE.Vector3(sinA * 0.82 - 0.08, -0.46, cosA * 0.86 + 0.06);
    const p4 = new THREE.Vector3(sinA * 0.68 - 0.24, -1.05 - f * 0.25, cosA * 0.80 + 0.05);
    headStrands.push(
      createHairStrandBuffers(
        new THREE.CatmullRomCurve3([p0, p1, p2, p3, p4]),
        22,
        0.034 + rand() * 0.015,
        0.014,
        rand(),
        0.55
      )
    );
  }

  // 4a-extra. Temple-to-Bow Sweeping Locks (48 lush strands completely covering the right side cap & gathering into the Silk Bow!)
  for (let i = 0; i < 48; i++) {
    const f = i / 47;
    const ang = THREE.MathUtils.lerp(0.75, 1.62, f) + (rand() - 0.5) * 0.03;
    const sinA = Math.sin(ang);
    const cosA = Math.cos(ang);
    const layer = i % 3;

    const p0 = crownOrigin.clone();
    const p1 = new THREE.Vector3(sinA * (0.80 + layer * 0.02), 0.76 + layer * 0.02, cosA * (0.82 + layer * 0.02));
    const p2 = new THREE.Vector3(sinA * (0.93 + layer * 0.02), 0.22 - f * 0.08, cosA * 0.88 - 0.02);
    const p3 = new THREE.Vector3(0.90 + layer * 0.025, -0.05, -0.08 - f * 0.16 + cosA * 0.25);
    const p4 = new THREE.Vector3(0.95 + layer * 0.04, -1.05, -0.16 - f * 0.20);
    const p5 = new THREE.Vector3(0.90 - 0.16, -2.65 - rand() * 0.6, -0.20 - f * 0.24);

    const width = 0.082 + rand() * 0.038;
    headStrands.push(
      createHairStrandBuffers(
        new THREE.CatmullRomCurve3([p0, p1, p2, p3, p4, p5]),
        26,
        width,
        width * 0.40,
        rand(),
        0.55 + layer * 0.14
      )
    );
  }
  // 4b. Left-Ear (+X side) Gathered Tresses tucked CLEANLY BEHIND left ear & under the White Silk Bow!
  const numEarSide = 62;
  for (let i = 0; i < numEarSide; i++) {
    const f = i / (numEarSide - 1);
    const ang = THREE.MathUtils.lerp(1.52, 2.38, f) + (rand() - 0.5) * 0.04;
    const sinA = Math.sin(ang); // positive (+X, behind ear z < 0!)
    const cosA = Math.cos(ang);
    const layer = i % 3;

    const bowPinch = Math.exp(-Math.pow((ang - 1.72) / 0.28, 2));
    const len = 2.75 + rand() * 0.95;
    const p0 = crownOrigin.clone().add(new THREE.Vector3(sinA * 0.14, 0.02 * layer, cosA * 0.12));
    const p1 = new THREE.Vector3(sinA * 0.78, 0.74 + layer * 0.025, cosA * 0.82);
    const p2 = new THREE.Vector3(sinA * (0.89 + layer * 0.025) - bowPinch * 0.05, 0.05, cosA * 0.92 - 0.05);
    const p3 = new THREE.Vector3(sinA * (0.95 + layer * 0.04), -0.68, cosA * 0.90 - 0.06);
    const p4 = new THREE.Vector3(sinA * (0.98 + layer * 0.06) - 0.10, -1.68, cosA * 0.86 - 0.08);
    const p5 = new THREE.Vector3(sinA * (0.96 + layer * 0.08) - 0.24, -len, cosA * 0.84 - 0.12 + (rand() - 0.5) * 0.2);

    const width = (i % 6 === 0 ? 0.026 : 0.076) * (0.85 + rand() * 0.35);
    headStrands.push(
      createHairStrandBuffers(
        new THREE.CatmullRomCurve3([p0, p1, p2, p3, p4, p5]),
        28,
        width,
        width * 0.38,
        rand(),
        0.65 + layer * 0.15
      )
    );
  }

  // 5. Voluminous Back Cascades & Diagonal Wind-Swept Tresses (76 strands)
  const numBack = 76;
  for (let i = 0; i < numBack; i++) {
    const f = i / (numBack - 1);
    const ang = THREE.MathUtils.lerp(2.15, 4.15, f); // across entire back (-Z)
    const sinA = Math.sin(ang);
    const cosA = Math.cos(ang);
    const layer = i % 3;

    const sweep = -0.45 - f * 0.95 - layer * 0.18;
    const len = 2.85 + rand() * 0.95;

    const p0 = crownOrigin.clone();
    const p1 = new THREE.Vector3(sinA * 0.76, 0.72 + layer * 0.03, cosA * 0.84);
    const p2 = new THREE.Vector3(sinA * 0.94, 0.02, cosA * 0.96 - 0.05);
    const p3 = new THREE.Vector3(sinA * 0.98 + sweep * 0.25, -0.92, cosA * 0.96 - 0.16);
    const p4 = new THREE.Vector3(sinA * 1.02 + sweep * 0.65, -1.95, cosA * 0.92 - 0.22);
    const p5 = new THREE.Vector3(sinA * 1.04 + sweep * 1.05, -len, cosA * 0.88 - 0.20 + (rand() - 0.5) * 0.25);

    const width = 0.088 + rand() * 0.045;
    headStrands.push(
      createHairStrandBuffers(
        new THREE.CatmullRomCurve3([p0, p1, p2, p3, p4, p5]),
        26,
        width,
        width * 0.40,
        rand(),
        0.72 + layer * 0.16
      )
    );
  }

  // 6. Luminous Backlit Airy Flyaway Halo Wisps (34 ultra-fine strands floating in the breeze!)
  for (let i = 0; i < 34; i++) {
    const f = i / 33;
    const ang = THREE.MathUtils.lerp(-0.25, -2.15, f) + (rand() - 0.5) * 0.25;
    const sinA = Math.sin(ang);
    const cosA = Math.cos(ang);
    const loft = 0.08 + rand() * 0.12;

    const p0 = crownOrigin.clone();
    const p1 = new THREE.Vector3(sinA * (0.82 + loft), 0.84 + loft * 0.6, cosA * (0.82 + loft));
    const p2 = new THREE.Vector3(sinA * (1.06 + loft) - 0.38, 0.22 + rand() * 0.25, cosA * 0.95 + 0.08);
    const p3 = new THREE.Vector3(sinA * 1.25 - 0.95 - rand() * 0.5, -0.55 - rand() * 0.9, cosA * 0.80 + (rand() - 0.5) * 0.3);
    const p4 = new THREE.Vector3(sinA * 1.35 - 1.65 - rand() * 0.7, -1.45 - rand() * 1.2, cosA * 0.70 + (rand() - 0.5) * 0.4);

    headStrands.push(
      createHairStrandBuffers(
        new THREE.CatmullRomCurve3([p0, p1, p2, p3, p4]),
        24,
        0.015 + rand() * 0.010,
        0.007,
        rand(),
        1.45
      )
    );
  }

  const hairGeo = mergeStrandBuffers(headStrands);
  const hairStrandsMesh = new THREE.Mesh(hairGeo, hairMaterial);

  const groomGroup = new THREE.Group();
  groomGroup.add(capMesh);
  groomGroup.add(hairStrandsMesh);

  return { groomGroup, strandCount: headStrands.length };
}

/**
 * Builds the 3D White Woven Silk Ribbon Bow positioned behind/above her left ear
 */
export function buildSilkBow(silkMaterial) {
  const bowGroup = new THREE.Group();

  // 1. Center Pinched Silk Knot Band (facing +Z in bow local space)
  const knotGeo = new THREE.SphereGeometry(0.062, 20, 16);
  knotGeo.scale(0.82, 1.08, 0.72);
  const kCount = knotGeo.attributes.position.count;
  knotGeo.setAttribute('aFlutterWeight', new THREE.BufferAttribute(new Float32Array(kCount).fill(0.02), 1));
  bowGroup.add(new THREE.Mesh(knotGeo, silkMaterial));

  // 2. Left & Right 3D Puffed Folded Silk Ribbon Loops (spanning +-X, facing +Z!)
  for (const dir of [-1, 1]) {
    const uSeg = 36;
    const vSeg = 20;
    const cnt = (uSeg + 1) * (vSeg + 1);
    const pos = new Float32Array(cnt * 3);
    const uvs = new Float32Array(cnt * 2);
    const flutter = new Float32Array(cnt);

    let k = 0;
    for (let iv = 0; iv <= vSeg; iv++) {
      const v = iv / vSeg - 0.5;
      for (let iu = 0; iu <= uSeg; iu++) {
        const t = iu / uSeg;
        const loopArch = Math.sin(t * Math.PI);
        const reachX = dir * loopArch * 0.34;
        const widthEnv = 0.036 + 0.175 * Math.pow(loopArch, 0.70);
        const pleat = Math.sin(v * Math.PI * 3.0) * 0.022 * loopArch;
        const loopDepthZ = Math.sin((t - 0.5) * Math.PI) * 0.055 + pleat;

        pos[k * 3] = reachX;
        pos[k * 3 + 1] = v * widthEnv + Math.abs(reachX) * 0.14;
        pos[k * 3 + 2] = loopDepthZ;

        uvs[k * 2] = t;
        uvs[k * 2 + 1] = iv / vSeg;
        flutter[k] = loopArch * 0.25;
        k++;
      }
    }

    const idx = [];
    for (let iv = 0; iv < vSeg; iv++) {
      for (let iu = 0; iu < uSeg; iu++) {
        const a = iv * (uSeg + 1) + iu;
        const b = a + 1;
        const c = a + (uSeg + 1);
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }

    const loopGeo = new THREE.BufferGeometry();
    loopGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    loopGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    loopGeo.setAttribute('aFlutterWeight', new THREE.BufferAttribute(flutter, 1));
    loopGeo.setIndex(idx);
    loopGeo.computeVertexNormals();
    bowGroup.add(new THREE.Mesh(loopGeo, silkMaterial));
  }

  // 3. Two Graceful Draping Silk Ribbon Tails (spanning +-X downward, facing +Z!)
  for (const dir of [-1, 1]) {
    const uSeg = 32;
    const vSeg = 14;
    const cnt = (uSeg + 1) * (vSeg + 1);
    const pos = new Float32Array(cnt * 3);
    const uvs = new Float32Array(cnt * 2);
    const flutter = new Float32Array(cnt);

    const tailLen = dir < 0 ? 0.60 : 0.52;
    let k = 0;
    for (let iv = 0; iv <= vSeg; iv++) {
      const v = iv / vSeg - 0.5;
      for (let iu = 0; iu <= uSeg; iu++) {
        const t = iu / uSeg;
        const width = THREE.MathUtils.lerp(0.045, 0.135, Math.pow(t, 0.65));
        const hemSlant = t > 0.88 ? (v + 0.5) * 0.05 * ((t - 0.88) / 0.12) : 0;

        const xSpread = dir * (0.03 + t * 0.22) + v * width;
        const yDrop = -t * tailLen - hemSlant;
        const zOut = -0.01 + Math.sin(t * Math.PI) * 0.045 + Math.sin(v * 3.14) * 0.012;

        pos[k * 3] = xSpread;
        pos[k * 3 + 1] = yDrop;
        pos[k * 3 + 2] = zOut;

        uvs[k * 2] = t;
        uvs[k * 2 + 1] = iv / vSeg;
        flutter[k] = t;
        k++;
      }
    }

    const idx = [];
    for (let iv = 0; iv < vSeg; iv++) {
      for (let iu = 0; iu < uSeg; iu++) {
        const a = iv * (uSeg + 1) + iu;
        const b = a + 1;
        const c = a + (uSeg + 1);
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }

    const tailGeo = new THREE.BufferGeometry();
    tailGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    tailGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    tailGeo.setAttribute('aFlutterWeight', new THREE.BufferAttribute(flutter, 1));
    tailGeo.setIndex(idx);
    tailGeo.computeVertexNormals();
    bowGroup.add(new THREE.Mesh(tailGeo, silkMaterial));
  }

  return bowGroup;
}

/**
 * Builds the Off-Shoulder Layered Ruffled Organza Dress + Thin Satin Shoulder Straps
 * matching the frothy, airy white lotus-leaf ruffle silhouette in the reference image.
 */
export function buildRuffledDress(organzaMaterial, silkMaterial) {
  const dressGroup = new THREE.Group();

  // 1. Inner Soft White Silk Slip Bodice (prevents harsh transparency straight through torso)
  const slipGeo = new THREE.CylinderGeometry(0.66, 0.82, 1.45, 64, 24, false);
  slipGeo.scale(1.06, 1.0, 0.66);
  slipGeo.translate(0, -2.42, -0.06);
  const sCnt = slipGeo.attributes.position.count;
  slipGeo.setAttribute('aFlutterWeight', new THREE.BufferAttribute(new Float32Array(sCnt).fill(0.08), 1));
  dressGroup.add(new THREE.Mesh(slipGeo, silkMaterial));

  // 2. Delicate Thin White Spaghetti Shoulder Strap hugging foreground bare left shoulder skin!
  const strapPts = [
    new THREE.Vector3(0.42, -1.78, 0.22),
    new THREE.Vector3(0.50, -1.67, 0.10),
    new THREE.Vector3(0.54, -1.64, -0.04),
    new THREE.Vector3(0.50, -1.69, -0.18),
    new THREE.Vector3(0.42, -1.80, -0.26),
  ];
  const strapCurve = new THREE.CatmullRomCurve3(strapPts);
  const strapGeo = new THREE.TubeGeometry(strapCurve, 36, 0.011, 8, false);
  strapGeo.scale(1.25, 0.65, 1.0);
  const stCnt = strapGeo.attributes.position.count;
  strapGeo.setAttribute('aFlutterWeight', new THREE.BufferAttribute(new Float32Array(stCnt).fill(0.02), 1));
  dressGroup.add(new THREE.Mesh(strapGeo, silkMaterial));

  // 3. Four Cascading Tiers of 3D Translucent Ruffled Organza ("荷叶边")
  const tiers = [
    { yTop: -1.52, drop: 0.62, rxTop: 0.78, rzTop: 0.50, flare: 0.48, waveAmp: 0.165, freq1: 11, freq2: 19, phase: 0.2 },
    { yTop: -1.72, drop: 0.80, rxTop: 0.76, rzTop: 0.52, flare: 0.60, waveAmp: 0.195, freq1: 9,  freq2: 17, phase: 1.4 },
    { yTop: -2.06, drop: 0.92, rxTop: 0.76, rzTop: 0.54, flare: 0.68, waveAmp: 0.205, freq1: 10, freq2: 21, phase: 2.7 },
    { yTop: -2.42, drop: 1.10, rxTop: 0.82, rzTop: 0.58, flare: 0.78, waveAmp: 0.215, freq1: 8,  freq2: 16, phase: 0.9 },
  ];

  tiers.forEach((tier) => {
    const uSegs = 180;
    const vSegs = 28;
    const cnt = (uSegs + 1) * (vSegs + 1);
    const pos = new Float32Array(cnt * 3);
    const uvs = new Float32Array(cnt * 2);
    const flex = new Float32Array(cnt);

    let k = 0;
    for (let iv = 0; iv <= vSegs; iv++) {
      const s = iv / vSegs; // 0 gathered neckline -> 1 airy ruffled hem
      const sEase = Math.pow(s, 0.85);

      for (let iu = 0; iu <= uSegs; iu++) {
        const theta = (iu / uSegs) * Math.PI * 2.0;
        const sinT = Math.sin(theta);
        const cosT = Math.cos(theta);

        // Multi-harmonic lotus-leaf organza pleats
        const ruffleWave =
          Math.sin(theta * tier.freq1 + tier.phase) * 0.62 +
          Math.sin(theta * tier.freq2 - tier.phase * 1.3 + s * 1.4) * 0.32 +
          Math.cos(theta * 29.0 + tier.phase) * 0.12;

        const amp = tier.waveAmp * Math.pow(s, 1.15);

        // Gently dip off-the-shoulder along left/right sides (|sinT| -> 1) like reference!
        const offShoulderDip = Math.pow(Math.abs(sinT), 1.6) * 0.14;
        // Billow slightly higher/frothier in front of chest where hands clasp
        const frontFroth = Math.max(0, cosT) * 0.08;

        const rx = tier.rxTop + sEase * tier.flare + ruffleWave * amp;
        const rz = tier.rzTop + sEase * tier.flare * 0.85 + ruffleWave * amp;

        const x = rx * sinT - s * s * 0.08; // Subtle breeze drift to viewer's left
        const z = -0.05 + rz * cosT + frontFroth * (1.0 - s * 0.4);
        const y = tier.yTop - offShoulderDip + frontFroth - s * tier.drop + ruffleWave * amp * 0.42;

        pos[k * 3] = x;
        pos[k * 3 + 1] = y;
        pos[k * 3 + 2] = z;

        uvs[k * 2] = iu / uSegs;
        uvs[k * 2 + 1] = s;
        flex[k] = s;
        k++;
      }
    }

    const idx = [];
    for (let iv = 0; iv < vSegs; iv++) {
      for (let iu = 0; iu < uSegs; iu++) {
        const a = iv * (uSegs + 1) + iu;
        const b = a + 1;
        const c = a + (uSegs + 1);
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('aClothFlex', new THREE.BufferAttribute(flex, 1));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, organzaMaterial);
    mesh.renderOrder = 2;
    dressGroup.add(mesh);
  });

  return dressGroup;
}
