import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const canvas = document.querySelector("#earthCanvas");
const clockLabel = document.querySelector("#earthClock");
const seasonText = document.querySelector("#seasonText");
const rhythmTitle = document.querySelector("#rhythmTitle");
const rhythmDescription = document.querySelector("#rhythmDescription");
const buttons = Array.from(document.querySelectorAll(".control"));

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

const sunLight = new THREE.DirectionalLight(0xffffff, 2.3);
sunLight.position.set(-3.3, 1.2, 3.0);
scene.add(sunLight);

const rimLight = new THREE.DirectionalLight(0x6df5ff, 1.0);
rimLight.position.set(3.4, -1.8, -3.0);
scene.add(rimLight);

const ambient = new THREE.AmbientLight(0x5e8fb4, 0.38);
scene.add(ambient);

const cityPositions = [
  [1.3521, 103.8198],
  [35.6762, 139.6503],
  [37.5665, 126.9780],
  [31.2304, 121.4737],
  [22.3193, 114.1694],
  [28.6139, 77.2090],
  [25.2048, 55.2708],
  [51.5072, -0.1276],
  [48.8566, 2.3522],
  [52.52, 13.405],
  [40.7128, -74.006],
  [34.0522, -118.2437],
  [41.8781, -87.6298],
  [19.4326, -99.1332],
  [-23.5505, -46.6333],
  [-34.6037, -58.3816],
  [-33.8688, 151.2093],
  [-37.8136, 144.9631],
  [-26.2041, 28.0473],
  [30.0444, 31.2357],
  [6.5244, 3.3792],
  [55.7558, 37.6173],
  [41.0082, 28.9784],
  [13.7563, 100.5018],
  [14.5995, 120.9842],
  [-6.2088, 106.8456],
  [1.0765, 104.0305],
  [24.7136, 46.6753],
  [43.6532, -79.3832],
  [47.6062, -122.3321],
  [39.9042, 116.4074],
  [23.1291, 113.2644]
].map(([lat, lon]) => latLonToVector3(lat, lon));

const cityUniforms = cityPositions.map((v) => v.clone());

function latLonToVector3(lat, lon) {
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lon + 180);
  return new THREE.Vector3(
    -Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta)
  ).normalize();
}

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
  uniform vec3 uCities[32];

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

  float ridge(vec2 p) {
    float n = fbm(p);
    return 1.0 - abs(2.0 * n - 1.0);
  }

  vec3 paletteLand(float n, float lat) {
    vec3 low = vec3(0.18, 0.35, 0.16);
    vec3 mid = vec3(0.48, 0.43, 0.24);
    vec3 high = vec3(0.72, 0.65, 0.50);

    float dry = smoothstep(0.13, 0.42, abs(lat - 0.1));
    vec3 land = mix(low, mid, dry);
    land = mix(land, high, smoothstep(0.66, 0.93, n));

    float ice = smoothstep(0.68, 0.87, abs(lat));
    land = mix(land, vec3(0.86, 0.92, 0.92), ice);
    return land;
  }

  void main() {
    vec3 nrm = normalize(vNormalW);
    vec3 local = normalize(vPosW);
    float lat = asin(clamp(local.y, -1.0, 1.0)) / 1.57079632679;
    float lon = atan(local.z, local.x) / 6.28318530718;

    vec2 map = vec2(lon + 0.5, lat * 0.5 + 0.5);

    float continent =
      fbm(map * vec2(5.2, 2.7) + vec2(0.08, 0.0)) * 0.62 +
      fbm(map * vec2(13.0, 6.8) + vec2(4.7, 1.3)) * 0.28 +
      ridge(map * vec2(28.0, 10.0)) * 0.14;

    float polarOceanShift = smoothstep(0.72, 0.92, abs(lat)) * 0.08;
    float landMask = smoothstep(0.53 + polarOceanShift, 0.59 + polarOceanShift, continent);

    float coast = smoothstep(0.49, 0.57, continent) - smoothstep(0.57, 0.64, continent);
    coast = clamp(coast, 0.0, 1.0);

    float oceanDepth = fbm(map * vec2(18.0, 8.0) + vec2(2.0, 0.4));
    vec3 ocean = mix(vec3(0.015, 0.10, 0.22), vec3(0.03, 0.28, 0.48), oceanDepth);
    ocean += coast * vec3(0.02, 0.20, 0.18);

    vec3 land = paletteLand(continent, lat);
    vec3 dayColor = mix(ocean, land, landMask);
    dayColor = mix(dayColor, vec3(0.88, 0.95, 0.98), smoothstep(0.76, 0.93, abs(lat)) * (1.0 - landMask * 0.25));

    float sun = dot(nrm, normalize(uSunDirection));
    float day = smoothstep(-0.10, 0.16, sun);
    float goldenEdge = smoothstep(-0.15, 0.07, sun) * (1.0 - smoothstep(0.08, 0.30, sun));

    vec3 nightColor = vec3(0.006, 0.018, 0.052);
    vec3 color = mix(nightColor, dayColor, day);
    color += goldenEdge * vec3(0.26, 0.14, 0.04);

    float city = 0.0;
    for (int i = 0; i < 32; i++) {
      float proximity = dot(nrm, normalize(uCities[i]));
      city += smoothstep(0.9985, 0.99996, proximity);
      city += 0.25 * smoothstep(0.9960, 0.9997, proximity);
    }
    float night = 1.0 - smoothstep(-0.02, 0.18, sun);
    float sparkle = 0.72 + 0.28 * sin(uTime * 2.4 + hash(map * 900.0) * 6.28318);
    color += city * night * sparkle * vec3(1.0, 0.72, 0.34) * (0.9 + landMask * 0.5);

    float fresnel = pow(1.0 - max(dot(nrm, normalize(cameraPosition - vPosW)), 0.0), 2.4);
    color += fresnel * vec3(0.06, 0.35, 0.55);

    float specular = pow(max(dot(reflect(-normalize(uSunDirection), nrm), normalize(cameraPosition - vPosW)), 0.0), 38.0);
    color += specular * (1.0 - landMask) * day * vec3(0.45, 0.72, 0.90);

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
    cloud = smoothstep(0.58, 0.84, cloud);

    float equatorGap = 1.0 - smoothstep(0.02, 0.28, abs(lat));
    cloud += equatorGap * smoothstep(0.60, 0.85, fbm(map * vec2(18.0, 6.0) + 4.0)) * 0.35;

    float sun = dot(nrm, normalize(uSunDirection));
    float light = 0.25 + 0.75 * smoothstep(-0.10, 0.40, sun);

    float edge = pow(1.0 - max(dot(nrm, normalize(cameraPosition - vPosW)), 0.0), 2.0);
    float alpha = cloud * 0.32 + edge * 0.045;

    vec3 color = mix(vec3(0.55, 0.72, 0.82), vec3(1.0), light);
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.46));
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
  uCities: { value: cityUniforms }
};

const cloudUniforms = {
  uTime: { value: 0 },
  uSunDirection: earthUniforms.uSunDirection
};

const atmosphereUniforms = {
  uSunDirection: earthUniforms.uSunDirection
};

const earthGeometry = new THREE.SphereGeometry(1, 192, 96);

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

const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.018, 160, 80), cloudMaterial);
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

const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.12, 160, 80), atmosphereMaterial);
earthGroup.add(atmosphere);

const orbitRing = createOrbitRing();
root.add(orbitRing);

const stars = createStars();
scene.add(stars);

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
  const needResize = canvas.width !== Math.floor(width * renderer.getPixelRatio()) ||
    canvas.height !== Math.floor(height * renderer.getPixelRatio());

  if (needResize) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

window.addEventListener("resize", resizeIfNeeded);
resizeIfNeeded();
animate();
