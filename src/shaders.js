import * as THREE from 'three';

/**
 * Shared lighting uniforms tuned for ACESFilmic + sRGB OutputPass in Three.js r187
 * (all colors & intensities calibrated in linear space so renders have rich, luminous
 * pastel depth, silky shadows, and zero white blowout!)
 */
export function createSharedLightUniforms() {
  return {
    uTime: { value: 0.0 },
    uWindStrength: { value: 0.35 },
    uBacklightBoost: { value: 0.45 },
    uKeyLightDir: { value: new THREE.Vector3(-0.52, 0.48, 0.71).normalize() },
    uRimLightDir: { value: new THREE.Vector3(0.55, 0.42, -0.72).normalize() },
    uBounceLightDir: { value: new THREE.Vector3(-0.35, -0.75, 0.56).normalize() },
    uKeyColor: { value: new THREE.Color(0xfff6fa) },
    uRimColor: { value: new THREE.Color(0xeef3ff) },
    uBounceColor: { value: new THREE.Color(0xf5cfe0) },
    uAmbientColor: { value: new THREE.Color(0xe4d5e3) },
  };
}

/**
 * 1. Anime CG Subsurface Scattering (SSS) Skin Shader
 * Calibrated linear-space porcelain skin with warm rose-peach subsurface scatter,
 * soft cheek/ear/fingertip blush, delicate lip tint, and satin rim glow.
 */
export function createSkinSSSMaterial(sharedUniforms, options = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uBaseSkin: { value: new THREE.Color(options.baseColor || 0xfbe6ec) },
      uShadowSkin: { value: new THREE.Color(options.shadowColor || 0xcf9eb2) },
      uSSSColor: { value: new THREE.Color(options.sssColor || 0xf0829d) },
      uBlushColor: { value: new THREE.Color(options.blushColor || 0xf07896) },
      uLipColor: { value: new THREE.Color(options.lipColor || 0xe2728e) },
      uSmile: { value: 0.0 },
      uEnableHeadMorph: { value: options.isHead ? 1.0 : 0.0 },
    },
    vertexShader: /* glsl */ `
      attribute float aBlush;
      attribute float aLipMask;
      attribute vec3 aSmileDelta;

      uniform float uSmile;
      uniform float uEnableHeadMorph;

      varying vec3 vNormalW;
      varying vec3 vPosW;
      varying vec3 vViewDir;
      varying float vBlush;
      varying float vLipMask;
      varying vec3 vLocalPos;

      void main() {
        vec3 pos = position;
        if (uEnableHeadMorph > 0.5) {
          pos += aSmileDelta * uSmile;
        }
        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
        vPosW = worldPos.xyz;
        vLocalPos = pos;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - worldPos.xyz);
        vBlush = aBlush;
        vLipMask = aLipMask;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBaseSkin;
      uniform vec3 uShadowSkin;
      uniform vec3 uSSSColor;
      uniform vec3 uBlushColor;
      uniform vec3 uLipColor;
      uniform vec3 uKeyLightDir;
      uniform vec3 uRimLightDir;
      uniform vec3 uBounceLightDir;
      uniform vec3 uRimColor;
      uniform vec3 uBounceColor;

      varying vec3 vNormalW;
      varying vec3 vPosW;
      varying vec3 vViewDir;
      varying float vBlush;
      varying float vLipMask;
      varying vec3 vLocalPos;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      void main() {
        vec3 N = normalize(vNormalW);
        vec3 V = normalize(vViewDir);
        vec3 L = normalize(uKeyLightDir);
        vec3 R = normalize(uRimLightDir);
        vec3 B = normalize(uBounceLightDir);

        // Soft anime CG wrap diffuse + warm subsurface scatter band at shadow terminator
        float NdotL = dot(N, L);
        float wrapDiff = smoothstep(-0.38, 0.65, NdotL);
        float sssBand = smoothstep(-0.52, 0.12, NdotL) * (1.0 - smoothstep(0.05, 0.58, NdotL));

        // Base skin albedo with delicate pale-pink cheek blush & tiny rosebud lip tint
        vec3 litAlbedo = mix(uBaseSkin, uBlushColor, clamp(vBlush, 0.0, 1.0) * 0.42);
        litAlbedo = mix(litAlbedo, uLipColor, clamp(vLipMask, 0.0, 1.0) * 0.52);

        vec3 shdAlbedo = mix(uShadowSkin, uBlushColor * 0.82, clamp(vBlush, 0.0, 1.0) * 0.35);
        shdAlbedo = mix(shdAlbedo, uLipColor * 0.80, clamp(vLipMask, 0.0, 1.0) * 0.45);

        vec3 col = mix(shdAlbedo, litAlbedo, wrapDiff * 0.86 + 0.14);

        // Subsurface glow in terminator
        col += uSSSColor * sssBand * 0.09;

        // Soft silvery-pink bounce from ruffled organza dress below
        float bounce = smoothstep(-0.1, 0.85, dot(N, B));
        col += uBounceColor * bounce * 0.045;

        // Micro-pore satin specular (natural dewy skin, never plastic)
        vec3 H = normalize(L + V);
        float grain = (hash(vLocalPos.xy * 210.0) - 0.5) * 0.01;
        float spec = pow(max(dot(N, H), 0.0), 32.0) * (0.045 + grain);
        col += vec3(1.0, 0.96, 0.98) * spec;

        // Subtle cool-white rim contour on jaw, nose tip & bare shoulder
        float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.8);
        float rimMask = smoothstep(-0.25, 0.75, dot(N, R));
        col += uRimColor * fresnel * (0.08 + 0.16 * rimMask);

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * 2. Multi-Layer Greyish-Purple Anime Iris Shader
 * Deep velvety violet-grey upper shadow, crystalline iris fibers, dark pupil,
 * luminous lavender lower crescent caustic, and studio glass catchlights.
 */
export function createIrisMaterial(sharedUniforms) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uUpperIris: { value: new THREE.Color(0x2d263d) },
      uMidIris: { value: new THREE.Color(0x6d638c) },
      uLowerCaustic: { value: new THREE.Color(0xd5ccf0) },
      uPupilColor: { value: new THREE.Color(0x120e1c) },
      uUpperLidCut: { value: 0.42 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewDir;

      void main() {
        vUv = uv;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uUpperIris;
      uniform vec3 uMidIris;
      uniform vec3 uLowerCaustic;
      uniform vec3 uPupilColor;
      uniform float uUpperLidCut;

      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewDir;

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        if (r > 1.0) discard;
        // Cleanly clip top of iris right along the arched upper eyelash line & blink curve!
        float lidArch = uUpperLidCut - 0.28 * p.x * p.x;
        if (p.y > lidArch) discard;

        vec3 V = normalize(vViewDir);
        vec2 refractedP = p - V.xy * 0.06 * (1.0 - r * r);
        float rr = length(refractedP);
        float angle = atan(refractedP.y, refractedP.x);

        // Rich anime upper-eyelid shadow -> luminous greyish-purple lower iris
        float verticalGrad = smoothstep(0.55, -0.60, refractedP.y);
        vec3 baseCol = mix(uUpperIris, uMidIris, verticalGrad);

        // Fine radial iris fibers
        float fibers1 = sin(angle * 52.0 + sin(rr * 14.0) * 0.4) * 0.5 + 0.5;
        float fibers2 = sin(angle * 96.0 - 1.1) * 0.5 + 0.5;
        float fiberMask = smoothstep(0.24, 0.42, rr) * (1.0 - smoothstep(0.80, 0.96, rr));
        baseCol += vec3(0.10, 0.09, 0.15) * (fibers1 * 0.65 + fibers2 * 0.35) * fiberMask;

        // Soft lavender-pink ring framing the pupil
        float innerHalo = exp(-pow((rr - 0.34) / 0.08, 2.0));
        baseCol = mix(baseCol, vec3(0.68, 0.56, 0.78), innerHalo * 0.52);

        // Luminous lower crescent caustic bounce
        float crescent = smoothstep(-0.02, -0.62, refractedP.y) *
                         exp(-pow((rr - 0.62) / 0.18, 2.0));
        baseCol = mix(baseCol, uLowerCaustic, crescent * 0.82);

        // Crisp dark greyish-violet limbal ring
        float limbal = smoothstep(0.74, 0.95, rr);
        baseCol = mix(baseCol, uUpperIris * 0.55, limbal * 0.92);

        // Deep vertically-oval anime pupil
        vec2 pupilP = vec2(refractedP.x * 1.22, refractedP.y * 0.92);
        float pr = length(pupilP);
        float pupilMask = 1.0 - smoothstep(0.22, 0.28, pr);
        baseCol = mix(baseCol, uPupilColor, pupilMask);

        // Glassy studio catchlights (large upper-left softbox + small lower-right gem sparkle)
        float catchMain = 1.0 - smoothstep(0.12, 0.155, length(p - vec2(-0.28, 0.28)));
        float catchSub  = 1.0 - smoothstep(0.06, 0.085, length(p - vec2(0.30, -0.28)));
        float catchSpark = 1.0 - smoothstep(0.038, 0.058, length(p - vec2(-0.10, 0.44)));
        baseCol = mix(baseCol, vec3(1.0), catchMain * 0.96);
        baseCol = mix(baseCol, vec3(0.95, 0.94, 1.0), catchSub * 0.88);
        baseCol += vec3(0.95) * catchSpark;

        float edgeAlpha = 1.0 - smoothstep(0.93, 1.0, r);
        gl_FragColor = vec4(baseCol, edgeAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: true,
  });
}

/**
 * 3. Ultra-High-Density 3D Hair Groom Shader (Silvery Pastel Pink + Pearl Anisotropy)
 * Rich strand-to-strand separation so every 3D hair lock reads clearly against the bright background!
 */
export function createHairGroomMaterial(sharedUniforms) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uRootColor: { value: new THREE.Color(0xe5acc6) },
      uMidColor: { value: new THREE.Color(0xf2cade) },
      uTipColor: { value: new THREE.Color(0xfcebf3) },
      uShadowColor: { value: new THREE.Color(0xb07e9a) },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aTangent;
      attribute float aStrandParam;
      attribute float aStrandSeed;
      attribute float aWindWeight;

      uniform float uTime;
      uniform float uWindStrength;

      varying vec3 vNormalW;
      varying vec3 vTangentW;
      varying vec3 vViewDir;
      varying float vStrandParam;
      varying float vStrandSeed;
      varying vec2 vUv;

      void main() {
        vUv = uv;
        vStrandParam = aStrandParam;
        vStrandSeed = aStrandSeed;

        float flex = pow(aStrandParam, 1.65) * aWindWeight;
        float phase = uTime * 2.35 + aStrandSeed * 6.2831 - aStrandParam * 3.1;
        float gust = sin(uTime * 1.15 + aStrandSeed * 2.1) * 0.35 + 0.65;

        vec3 windDisp = vec3(
          (-0.12 - 0.15 * sin(phase)) * uWindStrength * gust,
          (0.038 * cos(phase * 1.3)) * uWindStrength,
          (0.055 * sin(phase * 0.85 + 1.1)) * uWindStrength
        ) * flex;

        vec3 displaced = position + windDisp;
        vec4 worldPos = modelMatrix * vec4(displaced, 1.0);

        vNormalW = normalize(mat3(modelMatrix) * normal);
        vTangentW = normalize(mat3(modelMatrix) * aTangent);
        vViewDir = normalize(cameraPosition - worldPos.xyz);

        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uRootColor;
      uniform vec3 uMidColor;
      uniform vec3 uTipColor;
      uniform vec3 uShadowColor;
      uniform vec3 uKeyLightDir;
      uniform vec3 uRimLightDir;
      uniform vec3 uRimColor;
      uniform float uBacklightBoost;

      varying vec3 vNormalW;
      varying vec3 vTangentW;
      varying vec3 vViewDir;
      varying float vStrandParam;
      varying float vStrandSeed;
      varying vec2 vUv;

      float strandSpec(vec3 T, vec3 V, vec3 L, float exponent) {
        vec3 H = normalize(L + V);
        float dotTH = dot(T, H);
        float sinTH = sqrt(max(0.0, 1.0 - dotTH * dotTH));
        float dirAtten = smoothstep(-1.0, 0.0, dotTH);
        return dirAtten * pow(sinTH, exponent);
      }

      void main() {
        vec3 N = normalize(gl_FrontFacing ? vNormalW : -vNormalW);
        vec3 T = normalize(vTangentW);
        vec3 V = normalize(vViewDir);
        vec3 L = normalize(uKeyLightDir);
        vec3 R = normalize(uRimLightDir);

        // Silvery-pink root -> pastel rose-pearl mid -> luminous pearl-white tip
        vec3 gradCol = mix(uRootColor, uMidColor, smoothstep(0.0, 0.55, vStrandParam));
        gradCol = mix(gradCol, uTipColor, smoothstep(0.55, 1.0, vStrandParam));

        // Individual hair fiber striations & strand-to-strand depth variation!
        float fiberGroove = sin(vUv.y * 34.0 + vStrandSeed * 30.0) * 0.5 + 0.5;
        float strandEdgeAO = sin(vUv.y * 3.14159); // cylindrical strand self-contour!
        gradCol *= (0.88 + 0.12 * strandEdgeAO) * (0.95 + 0.07 * fiberGroove);
        gradCol = mix(gradCol, vec3(0.92, 0.72, 0.83), (vStrandSeed - 0.5) * 0.22);

        // Soft 3D diffuse shading so overlapping strands cast clear 3D volume
        float diff = smoothstep(-0.45, 0.78, dot(N, L));
        vec3 col = mix(uShadowColor * (0.85 + 0.15 * vStrandSeed), gradCol, diff * 0.82 + 0.18);

        // Dual Kajiya-Kay anisotropic angel-ring highlights
        vec3 T1 = normalize(T + N * (0.16 + (vStrandSeed - 0.5) * 0.08));
        vec3 T2 = normalize(T - N * 0.10);
        float specPrimary = strandSpec(T1, V, L, 84.0);
        float specSecondary = strandSpec(T2, V, L, 28.0);
        float crownMask = smoothstep(0.03, 0.24, vStrandParam) * (1.0 - smoothstep(0.62, 0.96, vStrandParam));

        col += vec3(1.0, 0.98, 1.0) * specPrimary * 0.26 * (0.4 + 0.6 * crownMask);
        col += vec3(0.98, 0.80, 0.90) * specSecondary * 0.10;

        // Soft cool-white rim & backlit translucency on strand edges
        float fresnel = pow(1.0 - abs(dot(N, V)), 2.8);
        float backScatter = pow(clamp(dot(-R, V), 0.0, 1.0), 2.0) * 0.5 + 0.5;
        col += uRimColor * fresnel * backScatter * (0.12 + 0.22 * uBacklightBoost) * (0.35 + 0.65 * vStrandParam);

        float tipAlpha = 1.0 - smoothstep(0.91, 1.0, vStrandParam) * 0.42;
        gl_FragColor = vec4(col, tipAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: true,
  });
}

/**
 * 4. Woven White Silk Ribbon Shader
 * Crisp pearl-white silk with soft lavender-silver fold shadows so the bow pops in 3D!
 */
export function createSilkRibbonMaterial(sharedUniforms) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uSilkBase: { value: new THREE.Color(0xfcfafe) },
      uSilkShadow: { value: new THREE.Color(0xb6abc8) },
    },
    vertexShader: /* glsl */ `
      attribute float aFlutterWeight;
      uniform float uTime;
      uniform float uWindStrength;

      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewDir;

      void main() {
        vUv = uv;
        vec3 pos = position;
        float flutter = pow(aFlutterWeight, 1.4) * uWindStrength;
        pos.x -= sin(uTime * 3.1 + pos.y * 4.0) * 0.08 * flutter;
        pos.z += cos(uTime * 2.6 + pos.y * 3.5) * 0.07 * flutter;

        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSilkBase;
      uniform vec3 uSilkShadow;
      uniform vec3 uKeyLightDir;

      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewDir;

      void main() {
        vec3 N = normalize(gl_FrontFacing ? vNormalW : -vNormalW);
        vec3 V = normalize(vViewDir);
        vec3 L = normalize(uKeyLightDir);

        float warp = sin(vUv.x * 240.0) * 0.5 + 0.5;
        float weft = sin(vUv.y * 240.0) * 0.5 + 0.5;
        float weave = (warp * 0.5 + weft * 0.5 - 0.5) * 0.032;

        float diff = smoothstep(-0.35, 0.80, dot(N, L));
        vec3 col = mix(uSilkShadow, uSilkBase, diff * 0.86 + 0.14) + weave;

        vec3 H = normalize(L + V);
        float sheen = pow(max(dot(N, H), 0.0), 20.0) * 0.16;
        float rim = pow(1.0 - max(dot(N, V), 0.0), 3.2) * 0.14;
        col += vec3(1.0, 0.99, 1.0) * (sheen + rim);

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.DoubleSide,
  });
}

/**
 * 5. Sheer Translucent Organza & Lace Ruffled Dress Shader
 * Sculpted soft lavender-pearl pleat shadows + sheer warm skin-through translucency.
 */
export function createOrganzaClothMaterial(sharedUniforms, options = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uClothColor: { value: new THREE.Color(options.color || 0xfcfafd) },
      uFoldShadow: { value: new THREE.Color(0xbcb0ce) },
      uWarmSubsurface: { value: new THREE.Color(0xf0c6d8) },
      uOpacity: { value: options.opacity ?? 0.88 },
    },
    vertexShader: /* glsl */ `
      attribute float aClothFlex;
      uniform float uTime;
      uniform float uWindStrength;

      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying float vClothFlex;

      void main() {
        vUv = uv;
        vClothFlex = aClothFlex;

        vec3 pos = position;
        float wave1 = sin(uTime * 2.4 + pos.x * 5.2 + pos.z * 4.1);
        float wave2 = cos(uTime * 3.3 - pos.y * 4.5 + pos.x * 8.0);
        float amp = pow(aClothFlex, 1.35) * uWindStrength;
        pos.x -= (0.045 + 0.05 * wave1) * amp;
        pos.z += 0.038 * wave2 * amp;
        pos.y += 0.018 * wave1 * amp;

        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uClothColor;
      uniform vec3 uFoldShadow;
      uniform vec3 uWarmSubsurface;
      uniform vec3 uKeyLightDir;
      uniform float uOpacity;

      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying float vClothFlex;

      void main() {
        vec3 N = normalize(gl_FrontFacing ? vNormalW : -vNormalW);
        vec3 V = normalize(vViewDir);
        vec3 L = normalize(uKeyLightDir);

        float fiberX = sin(vUv.x * 360.0) * 0.5 + 0.5;
        float fiberY = sin(vUv.y * 360.0) * 0.5 + 0.5;
        float organzaTexture = (fiberX * fiberY - 0.25) * 0.038;

        float scallop = sin(vUv.x * 96.0) * 0.014;
        if (vUv.y > 0.985 + scallop) discard;

        float lacePattern = smoothstep(0.86, 0.98, vUv.y) *
                            (sin(vUv.x * 192.0) * cos(vUv.y * 160.0) * 0.5 + 0.5);

        float diff = smoothstep(-0.35, 0.82, dot(N, L));
        vec3 col = mix(uFoldShadow, uClothColor, diff * 0.84 + 0.16);
        col = mix(col, uWarmSubsurface, (1.0 - vClothFlex) * 0.25);
        col += organzaTexture + lacePattern * 0.04;

        float fresnel = pow(1.0 - abs(dot(N, V)), 2.2);
        col += vec3(0.98, 0.97, 1.0) * fresnel * 0.16;

        float alpha = clamp(uOpacity * (0.68 + 0.42 * fresnel + lacePattern * 0.20), 0.48, 0.96);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });
}
