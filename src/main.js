import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  loadCharacterAssets,
  buildCinematic3DCharacter,
  buildForegroundVolumetrics,
} from './cinematic3dCharacter.js';

function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function smootherstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

const params = new URLSearchParams(window.location.search);
const renderJob = params.get('job'); // 'preview' | 'video' | null
const resParam = parseInt(params.get('res') || '1080', 10);

const container = document.getElementById('canvas-container');
const width = renderJob ? resParam : container.clientWidth || 900;
const height = renderJob ? resParam : container.clientHeight || 900;

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: true,
});
renderer.setSize(width, height);
renderer.setPixelRatio(renderJob ? 1 : Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0xfdfcfe, 1.0);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const keyLight = new THREE.DirectionalLight(0xfffbfd, 1.8);
keyLight.position.set(-3.0, 4.0, 5.0);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0xeef4ff, 2.2);
rimLight.position.set(3.0, 3.5, -4.0);
scene.add(rimLight);

// 85mm Portrait Lens (23.5 deg vertical FOV)
const camera = new THREE.PerspectiveCamera(23.5, width / height, 0.1, 60);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.62;
controls.minPolarAngle = Math.PI * 0.38;
controls.minAzimuthAngle = -0.45;
controls.maxAzimuthAngle = 0.45;
controls.enabled = !renderJob;

async function init() {
  const assets = await loadCharacterAssets();
  const { characterMesh, uniforms } = buildCinematic3DCharacter(assets);
  scene.add(characterMesh);

  // Subtle sparse wireframe overlay mesh for 3D Relief Topology inspection mode
  const wireGeo = new THREE.PlaneGeometry(4.2, 4.2, 96, 96);
  const wireMat = new THREE.ShaderMaterial({
    uniforms: {
      uDepthMap: uniforms.uDepthMap,
      uDepthScale: uniforms.uDepthScale,
    },
    vertexShader: /* glsl */ `
      uniform sampler2D uDepthMap;
      uniform float uDepthScale;
      void main() {
        vec4 dSample = texture2D(uDepthMap, uv);
        float depth16 = (dSample.r * 255.0 * 256.0 + dSample.g * 255.0) / 65535.0;
        vec3 pos = position;
        pos.z += depth16 * uDepthScale + 0.015;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      void main() {
        gl_FragColor = vec4(0.48, 0.38, 0.58, 0.24);
      }
    `,
    wireframe: true,
    transparent: true,
  });
  const wireMesh = new THREE.Mesh(wireGeo, wireMat);
  wireMesh.visible = false;
  scene.add(wireMesh);

  const { volumetricGroup, pMat, updateVolumetrics } = buildForegroundVolumetrics();
  scene.add(volumetricGroup);
  pMat.uniforms.uPixelRatio.value = renderer.getPixelRatio() * (width / 900);

  function setRenderMode(mode) {
    if (mode === 'clay_wire') {
      uniforms.uClayMode.value = 1.0;
      wireMesh.visible = true;
    } else {
      uniforms.uClayMode.value = 0.0;
      wireMesh.visible = false;
    }
  }

  /**
   * Choreographs the exact 8-second, 24fps cinematic short film at time t in [0, 8.0]:
   * - 0-2s: Slow push-in from front-side angle, gentle breeze ripples 3D hair, bokeh floats.
   * - 2-4s: Smooth 3D camera parallax orbit to right, eyes lift to lens, eyelashes flutter, tender smile.
   * - 4-6s: Breeze strengthens, silk bow & organza dress sway, backlit hair glows, crystals glint blue-violet.
   * - 6-8s: Intimate facial close-up settle, soft natural blink, foreground hair wisp glides past cheek.
   */
  function applyTimelineState(t, driveCamera = true) {
    uniforms.uTime.value = t;

    const p0_2 = smootherstep(0.0, 2.0, t);
    const p2_4 = smootherstep(2.0, 4.0, t);
    const windPeak = smoothstep(3.6, 4.8, t) * (1.0 - smoothstep(5.8, 7.5, t) * 0.45);
    const p6_8 = smootherstep(5.8, 7.75, t);

    // Wind & backlit translucency
    uniforms.uWindStrength.value = 0.38 + windPeak * 0.72;
    uniforms.uBacklightBoost.value = 0.22 + windPeak * 0.88;

    // Gaze lift & gentle natural smile (appearing 2-4s)
    uniforms.uGazeLift.value = p2_4;
    uniforms.uSmile.value = p2_4 * 0.92;

    // Subtle eyelash flutter at 2.3-3.6s
    const flutter =
      smoothstep(2.2, 2.6, t) * (1.0 - smoothstep(3.3, 3.7, t)) * Math.sin(t * 22.0);
    uniforms.uLashFlutter.value = flutter;

    // Natural soft anime blink at 6.25-6.95s
    let blink = 0.0;
    if (t >= 6.25 && t <= 6.95) {
      const bt = (t - 6.25) / 0.70;
      blink = bt < 0.42 ? smootherstep(0.0, 0.42, bt) : 1.0 - smootherstep(0.42, 1.0, bt);
    }
    uniforms.uBlink.value = blink;

    // 3D parallax orbit angle (smoothly shifts perspective to character's right at 2-4s)
    const orbitAzim = THREE.MathUtils.lerp(0.04, -0.145, p2_4) - p6_8 * 0.025;
    uniforms.uOrbitAngle.value = orbitAzim;

    updateVolumetrics(t, windPeak, p6_8);

    if (driveCamera) {
      // 85mm camera push-in + 3D parallax orbit + intimate close-up on face (+0.22, +0.46, +0.45)
      let dist = 9.35;
      dist = THREE.MathUtils.lerp(dist, 8.65, p0_2);
      dist = THREE.MathUtils.lerp(dist, 8.15, p2_4);
      dist = THREE.MathUtils.lerp(dist, 5.55, p6_8);

      const elev = THREE.MathUtils.lerp(0.015, 0.045, p2_4) + p6_8 * 0.015;

      const targetX = THREE.MathUtils.lerp(0.0, 0.21, p6_8) + p2_4 * 0.04;
      const targetY = THREE.MathUtils.lerp(-0.02, 0.45, p6_8);
      const targetZ = THREE.MathUtils.lerp(0.35, 0.48, p6_8);

      controls.target.set(targetX, targetY, targetZ);
      camera.position.set(
        targetX + dist * Math.sin(orbitAzim) * Math.cos(elev),
        targetY + dist * Math.sin(elev),
        targetZ + dist * Math.cos(orbitAzim) * Math.cos(elev)
      );
      camera.lookAt(controls.target);
    }
  }

  // Interactive UI controls
  const timelineSlider = document.getElementById('timeline');
  const timeLabel = document.getElementById('time-label');
  const btnPlay = document.getElementById('btn-play');
  const btnCameraLock = document.getElementById('btn-cam');
  const btnMode = document.getElementById('btn-mode');
  const statsLabel = document.getElementById('stats-label');

  if (statsLabel) {
    statsLabel.textContent = `460,800 Tris 3D Relief | 16-bit Depth + Normal SSS | 85mm 24fps`;
  }

  let isPlaying = !renderJob;
  let cinematicCameraLocked = true;
  let animTime = 0.0;
  let lastPerf = performance.now();

  if (btnPlay) {
    btnPlay.addEventListener('click', () => {
      isPlaying = !isPlaying;
      btnPlay.textContent = isPlaying ? '暂停短片' : '播放 8s 短片';
    });
  }
  if (btnCameraLock) {
    btnCameraLock.addEventListener('click', () => {
      cinematicCameraLocked = !cinematicCameraLocked;
      controls.enabled = !cinematicCameraLocked;
      btnCameraLock.textContent = cinematicCameraLocked ? '切换自由 3D 视差视角' : '恢复电影运镜';
    });
  }
  if (btnMode) {
    let currentMode = 'beauty';
    btnMode.addEventListener('click', () => {
      currentMode = currentMode === 'beauty' ? 'clay_wire' : 'beauty';
      setRenderMode(currentMode);
      btnMode.textContent = currentMode === 'beauty' ? '查看 3D 浮雕白模/线框' : '返回电影 CG 渲染';
    });
  }
  if (timelineSlider) {
    timelineSlider.addEventListener('input', (e) => {
      isPlaying = false;
      if (btnPlay) btnPlay.textContent = '播放 8s 短片';
      animTime = parseFloat(e.target.value);
    });
  }

  window.addEventListener('resize', () => {
    if (renderJob) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  function renderSingleFrame() {
    renderer.render(scene, camera);
  }

  async function sendFrameToServer(filename, mimeType = 'image/png', quality = 0.97) {
    const dataUrl = renderer.domElement.toDataURL(mimeType, quality);
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    await fetch(`/save-frame?name=${encodeURIComponent(filename)}`, {
      method: 'POST',
      body: bytes,
    });
  }

  if (!renderJob) {
    function loop(now) {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - lastPerf) / 1000);
      lastPerf = now;
      if (isPlaying) {
        animTime = (animTime + dt) % 8.0;
        if (timelineSlider) timelineSlider.value = animTime.toFixed(3);
      }
      if (timeLabel) timeLabel.textContent = `${animTime.toFixed(2)}s / 8.00s`;
      applyTimelineState(animTime, cinematicCameraLocked);
      if (!cinematicCameraLocked) controls.update();
      renderSingleFrame();
    }
    requestAnimationFrame(loop);
  } else {
    const uiBar = document.getElementById('ui-bar');
    if (uiBar) uiBar.style.display = 'none';

    // Warm-up GPU
    setRenderMode('beauty');
    applyTimelineState(0.2, true);
    renderSingleFrame();
    await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    renderSingleFrame();

    if (renderJob === 'preview') {
      // 1. Hero 1:1 Reference Pose CG Render (t = 0.4s)
      setRenderMode('beauty');
      applyTimelineState(0.4, true);
      renderSingleFrame();
      await sendFrameToServer('hero_beauty.png', 'image/png');

      // 2. 3D Sculpted Clay + Contour + Wireframe Relief Proof (slightly angled to show 3D depth!)
      setRenderMode('clay_wire');
      applyTimelineState(0.4, true);
      camera.position.x -= 1.4;
      camera.lookAt(controls.target);
      renderSingleFrame();
      await sendFrameToServer('hero_wireframe.png', 'image/png');

      // 3. 2-4s Gaze Lifted + Gentle Smile + 3D Orbit Parallax (t = 3.8s)
      setRenderMode('beauty');
      applyTimelineState(3.8, true);
      renderSingleFrame();
      await sendFrameToServer('mid_smile_orbit.png', 'image/png');

      // 4. Mid-Blink Quality Verification Frame (t = 6.55s)
      setRenderMode('beauty');
      applyTimelineState(6.55, true);
      renderSingleFrame();
      await sendFrameToServer('blink_check.png', 'image/png');

      // 5. Final Intimate Facial Close-up (t = 7.6s)
      setRenderMode('beauty');
      applyTimelineState(7.6, true);
      renderSingleFrame();
      await sendFrameToServer('closeup_final.png', 'image/png');

      await fetch('/job-complete?job=preview', { method: 'POST' });
    } else if (renderJob === 'video') {
      setRenderMode('beauty');
      const startFrame = parseInt(params.get('start') || '0', 10);
      const totalFrames = 192;
      for (let f = startFrame; f < totalFrames; f++) {
        const t = f / 24.0;
        applyTimelineState(t, true);
        renderSingleFrame();
        const fname = `frame_${String(f).padStart(4, '0')}.jpg`;
        await sendFrameToServer(fname, 'image/jpeg', 0.98);
      }
      await fetch('/job-complete?job=video', { method: 'POST' });
    }
  }
}

init();
