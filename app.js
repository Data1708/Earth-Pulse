import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const canvas = document.querySelector("#earthCanvas");
const clockLabel = document.querySelector("#earthClock");
const seasonText = document.querySelector("#seasonText");
const dataStatus = document.querySelector("#dataStatus");
const rhythmTitle = document.querySelector("#rhythmTitle");
const rhythmDescription = document.querySelector("#rhythmDescription");
const buttons = Array.from(document.querySelectorAll(".control"));

const NASA_WMS_ENDPOINT = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";

// Global 2:1 equirectangular WMS image. This is ideal for wrapping around a Three.js sphere.
function makeGibsWmsTextureUrl({ layer, format = "image/jpeg", width = 4096, height = 2048, time = null }) {
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
    TRANSPARENT: "FALSE"
  });

  if (time) params.set("TIME", time);
  return `${NASA_WMS_ENDPOINT}?${params.toString()}`;
}

const NASA_TEXTURES = {
  day: makeGibsWmsTextureUrl({
    layer: "BlueMarble_NextGeneration",
    format: "image/jpeg"
  }),
  night: makeGibsWmsTextureUrl({
    layer: "VIIRS_Black_Marble",
    format: "image/png",
    // The classic VIIRS Black Marble layer is a composite snapshot available in Worldview/GIBS.
    time: "2016-01-01"
  })
};

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x020712, 0.025);

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
sunLight.position.set(-3.3, 1.2, 3.0);
scene.add(sunLight);

const rimLight = new THREE.DirectionalLight(0x6df5ff, 1.0);
rimLight.position.set(3.4, -1.8, -3.0);
scene.add(rimLight);

const ambient = new THREE.AmbientLight(0x557c99, 0.2);
scene.add(ambient);

function makeSolidTexture(r, g, b) {
  const data = new Uint8Array([r, g, b, 255]);
  const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

const fallbackDayTexture = makeSolidTexture(18, 68, 104);
const fallbackNightTexture = makeSolidTexture(3, 8, 22);

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
  uniform float uTextureReady;

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

    // The NASA WMS image already arrives in a lon/lat projection. Three.js sphere UVs wrap it around the globe.
    vec2 uv = vUv;

    vec3 dayColor = texture2D(uDayMap, uv).rgb;
    vec3 blackMarble = texture2D(uNightMap, uv).rgb;

    // Boost the Black Marble signal so city lights remain visible on the globe.
    vec3 nightColor = pow(max(blackMarble, vec3(0.0)), vec3(1.35)) * 1.65;
    nightColor += vec3(0.004, 0.010, 0.030);

    vec3 textureColor = mix(nightColor, dayColor, day);
    textureColor += twilight * vec3(0.33, 0.16, 0.045);

    vec3 fallbackColor = proceduralFallback(uv, nrm, sun);
    vec3 color = mix(fallbackColor, textureColor, uTextureReady);

    float fresnel = pow(1.0 - max(dot(nrm, viewDirection), 0.0), 2.45);
    color += fresnel * vec3(0.04, 0.30, 0.48);

    float oceanHint = 1.0 - smoothstep(0.18, 0.40, length(dayColor - vec3(0.04, 0.15, 0.22)));
    float specular = pow(max(dot(reflect(-normalize(uSunDirection), nrm), viewDirection), 0.0), 42.0);
    color += specular * day * oceanHint * vec3(0.32, 0.58, 0.76);

    gl_FragColor = vec4(color, 1.0);
  }
`;

const cloudFragmentShader = `
  precision highp float;

  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;

  uniform float uTime;
  uniform vec3 uSunDirection;

  float hash(vec2 p) {
    p = fract(p * vec2(234.12, 871.42));
    p += dot(p, p + 23.45);
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
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p *= 2.1;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 nrm = normalize(vNormalW);
    vec3 local = normalize(vPosW);
    float lat = asin(clamp(local.y, -1.0, 1.0)) / 1.57079632679;
    float lon = atan(local.z, local.x) / 6.28318530718;

    vec2 map = vec2(lon + 0.5, lat * 0.5 + 0.5);
    map.x += uTime * 0.006;
    map.y += sin(uTime * 0.04 + map.x * 6.28318) * 0.018;

    float bands = sin((lat + 0.15 * sin(map.x * 9.0)) * 13.0) * 0.08;
    float cloud = fbm(map * vec2(9.0, 4.6) + bands);
    cloud += 0.35 * fbm(map * vec2(22.0, 10.0) + vec2(uTime * 0.012, 0.0));
    cloud = smoothstep(0.59, 0.84, cloud);

    float equatorGap = 1.0 - smoothstep(0.02, 0.28, abs(lat));
    cloud += equatorGap * smoothstep(0.62, 0.86, fbm(map * vec2(18.0, 6.0) + 4.0)) * 0.26;

    float sun = dot(nrm, normalize(uSunDirection));
    float light = 0.25 + 0.75 * smoothstep(-0.10, 0.40, sun);

    float edge = pow(1.0 - max(dot(nrm, normalize(cameraPosition - vPosW)), 0.0), 2.0);
    float alpha = cloud * 0.24 + edge * 0.045;

    vec3 color = mix(vec3(0.55, 0.72, 0.82), vec3(1.0), light);
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.38));
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
  uTextureReady: { value: 0.0 }
};

const cloudUniforms = {
  uTime: { value: 0 },
  uSunDirection: earthUniforms.uSunDirection
};

const atmosphereUniforms = {
  uSunDirection: earthUniforms.uSunDirection
};

const earthGeometry = new THREE.SphereGeometry(1, 224, 112);

const earthMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: earthFragmentShader,
  uniforms: earthUniforms
});

const earth = new THREE.Mesh(earthGeometry, earthMaterial);
earthGroup.add(earth);

const cloudMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: cloudFragmentShader,
  uniforms: cloudUniforms,
  transparent: true,
  depthWrite: false
});

const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.018, 180, 90), cloudMaterial);
earthGroup.add(clouds);

const atmosphereMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: atmosphereFragmentShader,
  uniforms: atmosphereUniforms,
  transparent: true,
  blending: THREE.AdditiveBlending,
  side: THREE.BackSide,
  depthWrite: false
});

const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.12, 180, 90), atmosphereMaterial);
earthGroup.add(atmosphere);

const orbitRing = createOrbitRing();
root.add(orbitRing);

const stars = createStars();
scene.add(stars);

loadNasaTextures();

let mode = "realtime";
let simulatedSeconds = 0;
const startDate = new Date();
const startEpoch = startDate.getTime();

const modeCopy = {
  realtime: {
    title: "Real-time rotation",
    description: "Earth rotates gently while the sunlight line reveals morning, dusk and night.",
    speed: 1
  },
  day: {
    title: "Fast day cycle",
    description: "Time accelerates so the day-night heartbeat becomes visible within seconds.",
    speed: 900
  },
  season: {
    title: "Seasonal breathing",
    description: "The planet leans through a year, showing the slow annual rhythm caused by axial tilt.",
    speed: 86400 * 3
  },
  calm: {
    title: "Calm drift",
    description: "A meditative slow mode that keeps the globe gently turning like a living lantern.",
    speed: 0.18
  }
};

buttons.forEach((button) => {
  button.addEventListener("click", () => {
    mode = button.dataset.mode;
    buttons.forEach((b) => b.classList.toggle("active", b === button));
    rhythmTitle.textContent = modeCopy[mode].title;
    rhythmDescription.textContent = modeCopy[mode].description;
  });
});

const frameClock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(frameClock.getDelta(), 0.05);
  const elapsed = frameClock.elapsedTime;
  const speed = modeCopy[mode].speed;
  simulatedSeconds += delta * speed;

  const simulatedDate = new Date(startEpoch + simulatedSeconds * 1000);
  updateEarthClock(simulatedDate);

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
  cloudUniforms.uTime.value = elapsed;

  const rotationBase = dayFraction * Math.PI * 2.0;
  earth.rotation.y = rotationBase + elapsed * 0.008;
  clouds.rotation.y = rotationBase * 0.9 + elapsed * 0.022;
  clouds.rotation.x = Math.sin(elapsed * 0.08) * 0.015;

  const seasonLean =
    mode === "season"
      ? Math.sin(seasonalAngle) * THREE.MathUtils.degToRad(23.44)
      : THREE.MathUtils.degToRad(8.0);

  earthGroup.rotation.z = THREE.MathUtils.lerp(earthGroup.rotation.z, seasonLean, 0.02);
  root.rotation.y = Math.sin(elapsed * 0.06) * 0.10;

  orbitRing.rotation.z = earthGroup.rotation.z;
  orbitRing.rotation.y += delta * 0.008;

  stars.rotation.y += delta * 0.0025;
  controls.update();
  resizeIfNeeded();
  renderer.render(scene, camera);
}

function loadNasaTextures() {
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");

  setStatus("Loading NASA Blue Marble and Black Marble…");

  const dayPromise = new Promise((resolve, reject) => {
    loader.load(
      NASA_TEXTURES.day,
      (texture) => {
        configureTexture(texture);
        resolve(texture);
      },
      undefined,
      reject
    );
  });

  const nightPromise = new Promise((resolve, reject) => {
    loader.load(
      NASA_TEXTURES.night,
      (texture) => {
        configureTexture(texture);
        resolve(texture);
      },
      undefined,
      reject
    );
  });

  Promise.all([dayPromise, nightPromise])
    .then(([dayTexture, nightTexture]) => {
      earthUniforms.uDayMap.value = dayTexture;
      earthUniforms.uNightMap.value = nightTexture;
      earthUniforms.uTextureReady.value = 1.0;
      setStatus("NASA imagery loaded from GIBS.");
    })
    .catch((error) => {
      console.warn("NASA texture loading failed. Falling back to procedural Earth.", error);
      earthUniforms.uTextureReady.value = 0.0;
      setStatus("NASA imagery could not load. Showing procedural fallback.", true);
    });
}

function configureTexture(texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  texture.needsUpdate = true;
}

function setStatus(message, warning = false) {
  dataStatus.textContent = message;
  dataStatus.classList.toggle("warning", warning);
}

function updateEarthClock(date) {
  const time = date.toISOString().slice(11, 19);
  clockLabel.textContent = `${time} UTC`;

  const doy = dayOfYear(date);
  const northern =
    doy < 80 || doy > 355
      ? "Northern winter"
      : doy < 172
        ? "Northern spring"
        : doy < 266
          ? "Northern summer"
          : "Northern autumn";

  seasonText.textContent = `Seasonal tilt: ${northern}`;
}

function dayOfYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const diff = date.getTime() - start;
  return Math.floor(diff / 86400000);
}

function createStars() {
  const geometry = new THREE.BufferGeometry();
  const count = 1400;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const radius = THREE.MathUtils.randFloat(12, 36);
    const theta = THREE.MathUtils.randFloat(0, Math.PI * 2);
    const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));

    positions[i * 3 + 0] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi);
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    sizes[i] = THREE.MathUtils.randFloat(0.4, 1.5);
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.018,
    transparent: true,
    opacity: 0.72,
    depthWrite: false
  });

  return new THREE.Points(geometry, material);
}

function createOrbitRing() {
  const curve = new THREE.EllipseCurve(0, 0, 1.42, 1.42, 0, Math.PI * 2, false, 0);
  const points = curve.getPoints(192);
  const geometry = new THREE.BufferGeometry().setFromPoints(
    points.map((p) => new THREE.Vector3(p.x, 0, p.y))
  );

  const material = new THREE.LineBasicMaterial({
    color: 0x6df5ff,
    transparent: true,
    opacity: 0.16
  });

  return new THREE.LineLoop(geometry, material);
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
