import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const canvas = document.querySelector("#earthCanvas");
const clockLabel = document.querySelector("#earthClock");
const seasonText = document.querySelector("#seasonText");
const statusList = document.querySelector("#dataStatus");

const speedSlider = document.querySelector("#speedSlider");
const speedLabel = document.querySelector("#speedLabel");
const resetTimeButton = document.querySelector("#resetTime");
const pauseTimeButton = document.querySelector("#pauseTime");

const layerInputs = {
  clouds: document.querySelector("#layerClouds"),
  precip: document.querySelector("#layerPrecip"),
  sst: document.querySelector("#layerSst"),
  currents: document.querySelector("#layerCurrents"),
  human: document.querySelector("#layerHuman"),
  orbit: document.querySelector("#layerOrbit")
};

const NASA_WMS_ENDPOINT = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";

const SPEEDS = [
  { label: "Paused", value: 0 },
  { label: "1×", value: 1 },
  { label: "60×", value: 60 },
  { label: "600×", value: 600 },
  { label: "1 hour / sec", value: 3600 },
  { label: "6 hours / sec", value: 21600 },
  { label: "1 day / sec", value: 86400 },
  { label: "1 week / sec", value: 604800 }
];

let speedIndex = Number(speedSlider.value);
let previousNonZeroSpeedIndex = speedIndex;
let simulatedSeconds = 0;
let startEpoch = Date.now();

const statusState = new Map();

function setStatus(key, message, warning = false) {
  statusState.set(key, { message, warning });
  statusList.innerHTML = "";
  for (const item of statusState.values()) {
    const li = document.createElement("li");
    li.textContent = item.message;
    li.classList.toggle("warning", item.warning);
    statusList.appendChild(li);
  }
}

function isoDateOffset(daysAgo) {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return d.toISOString().slice(0, 10);
}

function isoDateTimeOffset(hoursAgo) {
  const d = new Date(Date.now() - hoursAgo * 3600000);
  d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 30) * 30, 0, 0);
  return d.toISOString().replace(".000Z", "Z");
}

function makeGibsWmsTextureUrl({
  layer,
  format = "image/png",
  width = 4096,
  height = 2048,
  time = null,
  transparent = true
}) {
  const params = new URLSearchParams({
    SERVICE: "WMS",
    REQUEST: "GetMap",
    VERSION: "1.1.1",
    LAYERS: layer,
    STYLES: "",
    FORMAT: format,
    SRS: "EPSG:4326",
    BBOX: "-180,-90,180,90",
    WIDTH: String(width),
    HEIGHT: String(height),
    TRANSPARENT: transparent ? "TRUE" : "FALSE"
  });

  if (time) params.set("TIME", time);
  return `${NASA_WMS_ENDPOINT}?${params.toString()}`;
}

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x020712, 0.024);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(0, 0.42, 4.35);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enablePan = false;
controls.minDistance = 2.85;
controls.maxDistance = 7.0;
controls.rotateSpeed = 0.38;

const root = new THREE.Group();
scene.add(root);

const earthGroup = new THREE.Group();
root.add(earthGroup);

const sunLight = new THREE.DirectionalLight(0xffffff, 2.4);
scene.add(sunLight);

const rimLight = new THREE.DirectionalLight(0x6df5ff, 1.0);
rimLight.position.set(3.4, -1.8, -3.0);
scene.add(rimLight);

const ambient = new THREE.AmbientLight(0x557c99, 0.23);
scene.add(ambient);

function makeSolidTexture(r, g, b, a = 255) {
  const data = new Uint8Array([r, g, b, a]);
  const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

const fallbackDayTexture = makeSolidTexture(18, 68, 104);
const fallbackNightTexture = makeSolidTexture(3, 8, 22);
const transparentTexture = makeSolidTexture(0, 0, 0, 0);

const vertexShader = `
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vPosW = worldPosition.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const earthFragmentShader = `
  precision highp float;

  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;

  uniform float uTime;
  uniform vec3 uSunDirection;
  uniform sampler2D uDayMap;
  uniform sampler2D uNightMap;
  uniform sampler2D uCloudMap;
  uniform sampler2D uPrecipMap;
  uniform sampler2D uSstMap;

  uniform float uBaseReady;
  uniform float uNightReady;
  uniform float uCloudReady;
  uniform float uPrecipReady;
  uniform float uSstReady;

  uniform float uCloudVisible;
  uniform float uPrecipVisible;
  uniform float uSstVisible;
  uniform float uHumanVisible;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 6; i++) {
      v += a * noise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }

  vec3 proceduralFallback(vec2 uv, vec3 nrm, float sun) {
    float lat = asin(clamp(nrm.y, -1.0, 1.0)) / 1.57079632679;
    float continent =
      fbm(uv * vec2(5.2, 2.7) + vec2(0.08, 0.0)) * 0.62 +
      fbm(uv * vec2(13.0, 6.8) + vec2(4.7, 1.3)) * 0.28;
    float landMask = smoothstep(0.52, 0.60, continent);
    vec3 ocean = mix(vec3(0.015, 0.10, 0.22), vec3(0.03, 0.28, 0.48), fbm(uv * vec2(18.0, 8.0)));
    vec3 land = mix(vec3(0.16, 0.34, 0.15), vec3(0.55, 0.46, 0.28), smoothstep(0.55, 0.88, continent));
    land = mix(land, vec3(0.86, 0.92, 0.92), smoothstep(0.72, 0.9, abs(lat)));
    vec3 dayColor = mix(ocean, land, landMask);
    vec3 nightColor = vec3(0.006, 0.018, 0.052);
    float day = smoothstep(-0.10, 0.16, sun);
    return mix(nightColor, dayColor, day);
  }

  void main() {
    vec3 nrm = normalize(vNormalW);
    vec3 viewDirection = normalize(cameraPosition - vPosW);
    float sun = dot(nrm, normalize(uSunDirection));
    float day = smoothstep(-0.10, 0.18, sun);
    float night = 1.0 - smoothstep(-0.02, 0.20, sun);
    float twilight = smoothstep(-0.18, 0.05, sun) * (1.0 - smoothstep(0.06, 0.28, sun));

    vec2 uv = vUv;

    vec3 dayMap = texture2D(uDayMap, uv).rgb;
    vec3 blackMarble = texture2D(uNightMap, uv).rgb;
    vec3 cloudMap = texture2D(uCloudMap, uv).rgb;
    vec4 precipMap = texture2D(uPrecipMap, uv);
    vec4 sstMap = texture2D(uSstMap, uv);

    vec3 dayColor = mix(proceduralFallback(uv, nrm, 1.0), dayMap, uBaseReady);

    vec3 nightColor = vec3(0.004, 0.011, 0.032);
    vec3 city = pow(max(blackMarble, vec3(0.0)), vec3(1.25)) * 1.8;
    nightColor += city * uNightReady * uHumanVisible;

    vec3 color = mix(nightColor, dayColor, day);
    color += twilight * vec3(0.33, 0.16, 0.045);

    float oceanScore = smoothstep(0.02, 0.25, dayColor.b - max(dayColor.r, dayColor.g) * 0.45);

    float sstAlpha = sstMap.a;
    float sstVisible = uSstVisible * uSstReady * day * oceanScore * max(sstAlpha, 0.22);
    color = mix(color, sstMap.rgb, clamp(sstVisible * 0.42, 0.0, 0.42));

    float cloudBright = dot(cloudMap, vec3(0.333));
    float cloudMax = max(max(cloudMap.r, cloudMap.g), cloudMap.b);
    float cloudMin = min(min(cloudMap.r, cloudMap.g), cloudMap.b);
    float cloudChroma = cloudMax - cloudMin;
    float cloudSignal = smoothstep(0.54, 0.84, cloudBright) * (1.0 - smoothstep(0.12, 0.42, cloudChroma));
    cloudSignal *= 1.0 - smoothstep(0.78, 0.95, abs(nrm.y));
    vec3 cloudColor = mix(vec3(0.60, 0.72, 0.80), vec3(1.0), day);
    color = mix(color, cloudColor, cloudSignal * uCloudReady * uCloudVisible * (0.22 + 0.58 * day));

    float precipAlpha = max(precipMap.a, smoothstep(0.08, 0.42, length(precipMap.rgb)));
    vec3 precipColor = mix(vec3(0.20, 0.85, 1.0), precipMap.rgb * 1.45, 0.7);
    color = mix(color, precipColor, clamp(precipAlpha * uPrecipReady * uPrecipVisible * 0.58, 0.0, 0.58));

    float fresnel = pow(1.0 - max(dot(nrm, viewDirection), 0.0), 2.45);
    color += fresnel * vec3(0.04, 0.30, 0.48);

    float specular = pow(max(dot(reflect(-normalize(uSunDirection), nrm), viewDirection), 0.0), 42.0);
    color += specular * day * oceanScore * vec3(0.30, 0.55, 0.72);

    gl_FragColor = vec4(color, 1.0);
  }
`;

const atmosphereFragmentShader = `
  precision highp float;

  varying vec3 vNormalW;
  varying vec3 vPosW;
  uniform vec3 uSunDirection;

  void main() {
    vec3 nrm = normalize(vNormalW);
    vec3 viewDirection = normalize(cameraPosition - vPosW);
    float fresnel = pow(1.0 - max(dot(nrm, viewDirection), 0.0), 2.25);
    float sun = smoothstep(-0.35, 0.5, dot(nrm, normalize(uSunDirection)));
    vec3 color = mix(vec3(0.05, 0.31, 0.65), vec3(0.25, 0.94, 1.0), sun);
    gl_FragColor = vec4(color, fresnel * 0.48);
  }
`;

const earthUniforms = {
  uTime: { value: 0 },
  uSunDirection: { value: new THREE.Vector3(-1, 0.22, 0.65).normalize() },
  uDayMap: { value: fallbackDayTexture },
  uNightMap: { value: fallbackNightTexture },
  uCloudMap: { value: transparentTexture },
  uPrecipMap: { value: transparentTexture },
  uSstMap: { value: transparentTexture },
  uBaseReady: { value: 0 },
  uNightReady: { value: 0 },
  uCloudReady: { value: 0 },
  uPrecipReady: { value: 0 },
  uSstReady: { value: 0 },
  uCloudVisible: { value: 1 },
  uPrecipVisible: { value: 1 },
  uSstVisible: { value: 1 },
  uHumanVisible: { value: 1 }
};

const atmosphereUniforms = {
  uSunDirection: earthUniforms.uSunDirection
};

const earth = new THREE.Mesh(
  new THREE.SphereGeometry(1, 224, 112),
  new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: earthFragmentShader,
    uniforms: earthUniforms
  })
);
earthGroup.add(earth);

const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(1.12, 180, 90),
  new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: atmosphereFragmentShader,
    uniforms: atmosphereUniforms,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    depthWrite: false
  })
);
earthGroup.add(atmosphere);

const stars = createStars();
scene.add(stars);

const seasonView = createSeasonView();
root.add(seasonView.group);

const oceanCurrents = createOceanParticles();
earthGroup.add(oceanCurrents.points);

const humanActivity = createHumanActivity();
earthGroup.add(humanActivity.points);

loadDataLayers();
bindControls();

const frameClock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(frameClock.getDelta(), 0.05);
  const elapsed = frameClock.elapsedTime;
  const speed = SPEEDS[speedIndex].value;
  simulatedSeconds += delta * speed;

  const simulatedDate = new Date(startEpoch + simulatedSeconds * 1000);
  updateEarthClock(simulatedDate);
  updateSceneFromDate(simulatedDate, elapsed, delta, speed);

  controls.update();
  resizeIfNeeded();
  renderer.render(scene, camera);
}

function updateSceneFromDate(simulatedDate, elapsed, delta, speed) {
  const dayFraction =
    (simulatedDate.getUTCHours() * 3600 +
      simulatedDate.getUTCMinutes() * 60 +
      simulatedDate.getUTCSeconds()) / 86400;

  const yearDay = dayOfYear(simulatedDate);
  const axialTilt = THREE.MathUtils.degToRad(23.44);
  const seasonalAngle = (yearDay / 365.2422) * Math.PI * 2.0;
  const declination = Math.sin(seasonalAngle - 1.35) * axialTilt;

  const sunLongitude = dayFraction * Math.PI * 2.0 + Math.PI;
  const sunDirection = new THREE.Vector3(
    Math.cos(sunLongitude) * Math.cos(declination),
    Math.sin(declination),
    Math.sin(sunLongitude) * Math.cos(declination)
  ).normalize();

  earthUniforms.uSunDirection.value.copy(sunDirection);
  sunLight.position.copy(sunDirection).multiplyScalar(4.0);
  earthUniforms.uTime.value = elapsed;

  const rotationBase = dayFraction * Math.PI * 2.0;
  earth.rotation.y = rotationBase + elapsed * 0.008;

  const targetLean = Math.sin(seasonalAngle) * axialTilt;
  earthGroup.rotation.z = THREE.MathUtils.lerp(earthGroup.rotation.z, targetLean, 0.02);
  root.rotation.y = Math.sin(elapsed * 0.04) * 0.08;

  updateSeasonView(sunDirection, targetLean, seasonalAngle);
  updateOceanParticles(elapsed, delta, speed);
  updateHumanActivity(elapsed);
  stars.rotation.y += delta * 0.0025;
}

function loadDataLayers() {
  const recentDays = [1, 2, 3, 4, 5];
  const imergHours = [8, 12, 18, 24, 36];

  loadFirstAvailableTexture("base", [
    makeGibsWmsTextureUrl({
      layer: "BlueMarble_NextGeneration",
      format: "image/jpeg",
      transparent: false
    })
  ], "NASA Blue Marble loaded.", "Blue Marble failed; using fallback.").then((texture) => {
    if (!texture) return;
    earthUniforms.uDayMap.value = texture;
    earthUniforms.uBaseReady.value = 1;
  });

  loadFirstAvailableTexture("human", [
    makeGibsWmsTextureUrl({
      layer: "VIIRS_Black_Marble",
      format: "image/png",
      time: "2016-01-01",
      transparent: true
    }),
    makeGibsWmsTextureUrl({
      layer: "VIIRS_Night_Lights",
      format: "image/png",
      time: "2012-01-01",
      transparent: true
    })
  ], "NASA Black Marble loaded.", "Night-lights layer failed; using dark fallback.").then((texture) => {
    if (!texture) return;
    earthUniforms.uNightMap.value = texture;
    earthUniforms.uNightReady.value = 1;
  });

  const cloudUrls = [];
  for (const days of recentDays) {
    const time = isoDateOffset(days);
    cloudUrls.push(makeGibsWmsTextureUrl({
      layer: "VIIRS_NOAA21_CorrectedReflectance_TrueColor",
      format: "image/jpeg",
      time,
      transparent: false
    }));
    cloudUrls.push(makeGibsWmsTextureUrl({
      layer: "VIIRS_SNPP_CorrectedReflectance_TrueColor",
      format: "image/jpeg",
      time,
      transparent: false
    }));
    cloudUrls.push(makeGibsWmsTextureUrl({
      layer: "MODIS_Terra_CorrectedReflectance_TrueColor",
      format: "image/jpeg",
      time,
      transparent: false
    }));
  }

  loadFirstAvailableTexture("clouds", cloudUrls, "Recent cloud/true-colour imagery loaded.", "Cloud imagery unavailable; cloud layer remains procedural/clear.").then((texture) => {
    if (!texture) return;
    earthUniforms.uCloudMap.value = texture;
    earthUniforms.uCloudReady.value = 1;
  });

  const precipUrls = imergHours.map((hours) =>
    makeGibsWmsTextureUrl({
      layer: "IMERG_Precipitation_Rate",
      format: "image/png",
      time: isoDateTimeOffset(hours),
      transparent: true
    })
  );

  loadFirstAvailableTexture("precip", precipUrls, "IMERG precipitation layer loaded.", "IMERG precipitation unavailable; layer hidden.").then((texture) => {
    if (!texture) return;
    earthUniforms.uPrecipMap.value = texture;
    earthUniforms.uPrecipReady.value = 1;
  });

  const sstUrls = recentDays.map((days) =>
    makeGibsWmsTextureUrl({
      layer: "GHRSST_L4_MUR_Sea_Surface_Temperature",
      format: "image/png",
      time: isoDateOffset(days),
      transparent: true
    })
  );

  loadFirstAvailableTexture("sst", sstUrls, "GHRSST MUR sea-surface temperature loaded.", "SST layer unavailable; ocean colour remains base imagery.").then((texture) => {
    if (!texture) return;
    earthUniforms.uSstMap.value = texture;
    earthUniforms.uSstReady.value = 1;
  });
}

function loadFirstAvailableTexture(key, urls, successMessage, failureMessage) {
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");

  setStatus(key, `Loading ${key} layer…`);

  return urls.reduce((promise, url) => {
    return promise.catch(() => new Promise((resolve, reject) => {
      loader.load(
        url,
        (texture) => {
          configureTexture(texture);
          resolve(texture);
        },
        undefined,
        reject
      );
    }));
  }, Promise.reject())
    .then((texture) => {
      setStatus(key, successMessage);
      return texture;
    })
    .catch((error) => {
      console.warn(`${key} texture failed`, error);
      setStatus(key, failureMessage, true);
      return null;
    });
}

function configureTexture(texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  texture.needsUpdate = true;
}

function bindControls() {
  function updateSpeedLabel() {
    speedIndex = Number(speedSlider.value);
    speedLabel.textContent = SPEEDS[speedIndex].label;
    if (speedIndex > 0) previousNonZeroSpeedIndex = speedIndex;
    pauseTimeButton.textContent = speedIndex === 0 ? "Resume" : "Pause";
  }

  speedSlider.addEventListener("input", updateSpeedLabel);
  updateSpeedLabel();

  pauseTimeButton.addEventListener("click", () => {
    if (speedIndex === 0) {
      speedSlider.value = String(previousNonZeroSpeedIndex || 2);
    } else {
      speedSlider.value = "0";
    }
    updateSpeedLabel();
  });

  resetTimeButton.addEventListener("click", () => {
    startEpoch = Date.now();
    simulatedSeconds = 0;
  });

  layerInputs.clouds.addEventListener("change", () => {
    earthUniforms.uCloudVisible.value = layerInputs.clouds.checked ? 1 : 0;
  });

  layerInputs.precip.addEventListener("change", () => {
    earthUniforms.uPrecipVisible.value = layerInputs.precip.checked ? 1 : 0;
  });

  layerInputs.sst.addEventListener("change", () => {
    earthUniforms.uSstVisible.value = layerInputs.sst.checked ? 1 : 0;
  });

  layerInputs.currents.addEventListener("change", () => {
    oceanCurrents.points.visible = layerInputs.currents.checked;
  });

  layerInputs.human.addEventListener("change", () => {
    earthUniforms.uHumanVisible.value = layerInputs.human.checked ? 1 : 0;
    humanActivity.points.visible = layerInputs.human.checked;
  });

  layerInputs.orbit.addEventListener("change", () => {
    seasonView.group.visible = layerInputs.orbit.checked;
  });
}

function updateEarthClock(date) {
  clockLabel.textContent = `${date.toISOString().replace("T", " ").slice(0, 19)} UTC`;

  const doy = dayOfYear(date);
  const northern =
    doy < 80 || doy > 355
      ? "Northern winter"
      : doy < 172
        ? "Northern spring"
        : doy < 266
          ? "Northern summer"
          : "Northern autumn";

  seasonText.textContent = `Seasonal geometry: ${northern} · day ${doy}`;
}

function dayOfYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const diff = date.getTime() - start;
  return Math.floor(diff / 86400000);
}

function latLonToVector3(lat, lon, radius = 1) {
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lon + 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

function interpolatePath(path, t) {
  const n = path.length - 1;
  const scaled = ((t % 1) + 1) % 1 * n;
  const i = Math.floor(scaled);
  const f = scaled - i;
  const a = path[i];
  const b = path[Math.min(i + 1, path.length - 1)];
  const lat = THREE.MathUtils.lerp(a[0], b[0], f);
  const lon = THREE.MathUtils.lerp(a[1], b[1], f);
  return [lat, lon];
}

function createOceanParticles() {
  const currentPaths = [
    [[24, -82], [31, -78], [38, -66], [45, -45], [51, -20], [56, 2]],
    [[16, 122], [24, 132], [32, 142], [38, 155], [43, 170], [44, -175]],
    [[-44, -75], [-45, -35], [-45, 15], [-45, 65], [-45, 115], [-45, 170], [-45, -130], [-44, -75]],
    [[-35, 28], [-37, 45], [-40, 63], [-42, 82], [-39, 103]],
    [[-18, -38], [-27, -42], [-36, -50], [-43, -60]],
    [[-15, 154], [-25, 153], [-34, 154], [-42, 160]],
    [[3, -160], [2, -120], [2, -80], [1, -40], [0, 5]],
    [[4, 48], [2, 75], [0, 98], [-3, 116], [-8, 135]]
  ];

  const count = 420;
  const positions = new Float32Array(count * 3);
  const particles = [];

  for (let i = 0; i < count; i++) {
    const pathIndex = i % currentPaths.length;
    particles.push({
      pathIndex,
      offset: Math.random(),
      speed: THREE.MathUtils.randFloat(0.015, 0.045)
    });

    const [lat, lon] = interpolatePath(currentPaths[pathIndex], Math.random());
    const v = latLonToVector3(lat, lon, 1.032);
    positions[i * 3] = v.x;
    positions[i * 3 + 1] = v.y;
    positions[i * 3 + 2] = v.z;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0x77e9ff,
    size: 0.018,
    transparent: true,
    opacity: 0.76,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const points = new THREE.Points(geometry, material);
  return { points, particles, currentPaths };
}

function updateOceanParticles(elapsed, delta, speed) {
  const positions = oceanCurrents.points.geometry.attributes.position.array;
  const speedFactor = 0.45 + Math.min(speed / 86400, 2.5);

  for (let i = 0; i < oceanCurrents.particles.length; i++) {
    const p = oceanCurrents.particles[i];
    const path = oceanCurrents.currentPaths[p.pathIndex];
    const t = p.offset + elapsed * p.speed * speedFactor * 0.04;
    const [lat, lon] = interpolatePath(path, t);
    const v = latLonToVector3(lat, lon, 1.034);

    positions[i * 3] = v.x;
    positions[i * 3 + 1] = v.y;
    positions[i * 3 + 2] = v.z;
  }

  oceanCurrents.points.geometry.attributes.position.needsUpdate = true;
  oceanCurrents.points.material.opacity = 0.55 + 0.25 * Math.sin(elapsed * 0.9);
}

function createHumanActivity() {
  const cities = [
    [1.3521, 103.8198], [35.6762, 139.6503], [37.5665, 126.9780],
    [31.2304, 121.4737], [22.3193, 114.1694], [28.6139, 77.2090],
    [25.2048, 55.2708], [51.5072, -0.1276], [48.8566, 2.3522],
    [52.52, 13.405], [40.7128, -74.006], [34.0522, -118.2437],
    [41.8781, -87.6298], [19.4326, -99.1332], [-23.5505, -46.6333],
    [-34.6037, -58.3816], [-33.8688, 151.2093], [-37.8136, 144.9631],
    [-26.2041, 28.0473], [30.0444, 31.2357], [6.5244, 3.3792],
    [55.7558, 37.6173], [41.0082, 28.9784], [13.7563, 100.5018],
    [14.5995, 120.9842], [-6.2088, 106.8456], [24.7136, 46.6753],
    [43.6532, -79.3832], [47.6062, -122.3321], [39.9042, 116.4074],
    [23.1291, 113.2644], [59.3293, 18.0686], [40.4168, -3.7038],
    [45.4642, 9.1900], [50.1109, 8.6821], [35.6895, 51.3890]
  ];

  const positions = new Float32Array(cities.length * 3);
  cities.forEach(([lat, lon], i) => {
    const v = latLonToVector3(lat, lon, 1.045);
    positions[i * 3] = v.x;
    positions[i * 3 + 1] = v.y;
    positions[i * 3 + 2] = v.z;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xffd38a,
    size: 0.032,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  return { points: new THREE.Points(geometry, material) };
}

function updateHumanActivity(elapsed) {
  humanActivity.points.material.opacity = 0.45 + 0.28 * (0.5 + 0.5 * Math.sin(elapsed * 2.0));
  humanActivity.points.material.size = 0.026 + 0.011 * (0.5 + 0.5 * Math.sin(elapsed * 1.7));
}

function createSeasonView() {
  const group = new THREE.Group();

  const orbitGeometry = new THREE.BufferGeometry().setFromPoints(
    new THREE.EllipseCurve(0, 0, 1.52, 1.52, 0, Math.PI * 2).getPoints(240)
      .map((p) => new THREE.Vector3(p.x, 0, p.y))
  );
  const orbit = new THREE.LineLoop(
    orbitGeometry,
    new THREE.LineBasicMaterial({ color: 0x6df5ff, transparent: true, opacity: 0.18 })
  );
  group.add(orbit);

  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(0.065, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0xffd166 })
  );
  sun.position.set(1.7, 0.2, 0);
  group.add(sun);

  const axisGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -1.25, 0),
    new THREE.Vector3(0, 1.25, 0)
  ]);
  const axis = new THREE.Line(
    axisGeometry,
    new THREE.LineBasicMaterial({ color: 0x7cffb2, transparent: true, opacity: 0.58 })
  );
  group.add(axis);

  return { group, orbit, sun, axis };
}

function updateSeasonView(sunDirection, targetLean, seasonalAngle) {
  seasonView.sun.position.copy(sunDirection).multiplyScalar(1.68);
  seasonView.axis.rotation.z = -targetLean;
  seasonView.orbit.rotation.z = targetLean * 0.5;
  seasonView.group.rotation.y = seasonalAngle * 0.02;
}

function createStars() {
  const geometry = new THREE.BufferGeometry();
  const count = 1400;
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const radius = THREE.MathUtils.randFloat(12, 36);
    const theta = THREE.MathUtils.randFloat(0, Math.PI * 2);
    const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));

    positions[i * 3 + 0] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi);
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.018,
    transparent: true,
    opacity: 0.72,
    depthWrite: false
  });

  return new THREE.Points(geometry, material);
}

function resizeIfNeeded() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const pixelRatio = renderer.getPixelRatio();
  const needResize =
    canvas.width !== Math.floor(width * pixelRatio) ||
    canvas.height !== Math.floor(height * pixelRatio);

  if (needResize) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

window.addEventListener("resize", resizeIfNeeded);
resizeIfNeeded();
animate();
