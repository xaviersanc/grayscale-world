const MODULE_ID = "grayscale-world";

/* -------------------------------------------- */
/*  Réglages                                     */
/* -------------------------------------------- */

Hooks.once("init", () => {
  const refresh = () => {
    applyCSS();
    if (canvas?.ready) setupCanvas();
  };

  game.settings.register(MODULE_ID, "enabled", {
    name: "GRAYSCALE.Enabled",
    hint: "GRAYSCALE.EnabledHint",
    scope: "world",
    config: true,
    restricted: true,
    type: Boolean,
    default: true,
    onChange: refresh
  });

  game.settings.register(MODULE_ID, "saturation", {
    name: "GRAYSCALE.Saturation",
    hint: "GRAYSCALE.SaturationHint",
    scope: "world",
    config: true,
    restricted: true,
    type: Number,
    default: 0,
    range: { min: 0, max: 100, step: 1 },
    onChange: refresh
  });

  game.settings.register(MODULE_ID, "override", {
    name: "GRAYSCALE.Override",
    hint: "GRAYSCALE.OverrideHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: refresh
  });

  game.settings.register(MODULE_ID, "userSaturation", {
    name: "GRAYSCALE.UserSaturation",
    hint: "GRAYSCALE.UserSaturationHint",
    scope: "client",
    config: true,
    type: Number,
    default: 0,
    range: { min: 0, max: 100, step: 1 },
    onChange: refresh
  });
});

Hooks.once("ready", applyCSS);

/** Saturation effective (0..1) pour l'utilisateur courant. */
function effectiveSaturation() {
  const useOwn = game.settings.get(MODULE_ID, "override");
  const pct = useOwn
    ? game.settings.get(MODULE_ID, "userSaturation")
    : game.settings.get(MODULE_ID, "saturation");
  return Math.min(1, Math.max(0, Number(pct) / 100));
}

const isEnabled = () => game.settings.get(MODULE_ID, "enabled");

/* -------------------------------------------- */
/*  Interface HTML (CSS)                         */
/* -------------------------------------------- */

function applyCSS() {
  document.body.classList.toggle("gw-on", isEnabled());
  document.documentElement.style.setProperty("--gw-sat", String(effectiveSaturation()));
}

/* -------------------------------------------- */
/*  Carte (filtre PIXI + masque de zones)        */
/* -------------------------------------------- */

const FRAGMENT = `
precision mediump float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform sampler2D uMask;
uniform vec4 inputSize;
uniform vec4 outputFrame;
uniform float uSat;
uniform float uHasMask;

void main() {
  vec4 c = texture2D(uSampler, vTextureCoord);
  // Coordonnées 0..1 dans la zone filtrée (= écran), identiques à celles de la texture du masque
  vec2 uv = vTextureCoord * inputSize.xy / outputFrame.zw;
  float m = uHasMask > 0.5 ? texture2D(uMask, uv).a : 0.0;
  float s = mix(uSat, 1.0, m);
  float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(mix(vec3(l), c.rgb, s), c.a);
}`;

const state = {
  filter: null,
  fallback: false,
  maskRT: null,
  maskSize: [0, 0, 0],
  container: null,
  sprites: [],
  gradient: null,
  tick: null
};

function gradientTexture() {
  if (state.gradient) return state.gradient;
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.7, "rgba(255,255,255,1)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  state.gradient = PIXI.Texture.from(c);
  return state.gradient;
}

function setupCanvas() {
  teardownCanvas();
  if (!isEnabled()) return;

  const stage = canvas.stage;
  try {
    state.filter = new PIXI.Filter(undefined, FRAGMENT, { uSat: 0, uHasMask: 0, uMask: PIXI.Texture.EMPTY });
    state.container = new PIXI.Container();
  } catch (err) {
    // Repli : désaturation simple, sans zones de couleur
    console.warn(`${MODULE_ID} | shader indisponible, repli sans zones de couleur`, err);
    state.filter = new PIXI.ColorMatrixFilter();
    state.fallback = true;
  }

  stage.filterArea = canvas.app.screen;
  stage.filters = [...(stage.filters ?? []), state.filter];

  state.tick = () => updateFilter();
  canvas.app.ticker.add(state.tick);
  updateFilter();
}

function teardownCanvas() {
  if (state.tick) canvas.app?.ticker?.remove(state.tick);
  if (state.filter && canvas.stage) {
    canvas.stage.filters = (canvas.stage.filters ?? []).filter(f => f !== state.filter);
    if (!canvas.stage.filters.length) canvas.stage.filters = null;
  }
  state.maskRT?.destroy(true);
  state.container?.destroy({ children: true });
  Object.assign(state, { filter: null, fallback: false, maskRT: null, maskSize: [0, 0, 0], container: null, sprites: [], tick: null });
}

Hooks.on("canvasReady", setupCanvas);
Hooks.on("canvasTearDown", teardownCanvas);

/** Liste des zones de couleur (centre + rayon en pixels de scène). */
function collectZones() {
  const zones = [];
  const dp = canvas.dimensions.distancePixels;

  for (const light of canvas.lighting?.placeables ?? []) {
    const d = light.document;
    if (d.hidden || !d.getFlag(MODULE_ID, "keepColor")) continue;
    const r = Math.max(d.config.dim ?? 0, d.config.bright ?? 0) * dp;
    if (r > 0) zones.push({ x: d.x, y: d.y, r: r / 0.85 });
  }

  for (const token of canvas.tokens?.placeables ?? []) {
    const d = token.document;
    if (!token.visible || !d.getFlag(MODULE_ID, "keepColor")) continue;
    const extra = (Number(d.getFlag(MODULE_ID, "colorRadius")) || 0) * dp;
    const c = token.center;
    zones.push({ x: c.x, y: c.y, r: Math.max(token.w, token.h) / 2 / 0.7 + extra });
  }
  return zones;
}

function ensureMask() {
  const { width, height } = canvas.app.screen;
  const res = canvas.app.renderer.resolution;
  const [w, h, r] = state.maskSize;
  if (state.maskRT && w === width && h === height && r === res) return;
  state.maskRT?.destroy(true);
  state.maskRT = PIXI.RenderTexture.create({ width, height, resolution: res });
  state.maskSize = [width, height, res];
}

function updateFilter() {
  const filter = state.filter;
  if (!filter || !canvas.ready) return;
  const sat = effectiveSaturation();

  if (state.fallback) {
    filter.reset();
    filter.saturate(sat - 1, true); // ColorMatrixFilter.saturate(amount) : 0 = inchangé, -1 = gris
    return;
  }

  filter.uniforms.uSat = sat;
  const zones = sat >= 1 ? [] : collectZones();
  if (!zones.length) {
    filter.uniforms.uHasMask = 0;
    return;
  }

  ensureMask();
  const tex = gradientTexture();
  zones.forEach((z, i) => {
    let s = state.sprites[i];
    if (!s) {
      s = new PIXI.Sprite(tex);
      s.anchor.set(0.5);
      state.container.addChild(s);
      state.sprites[i] = s;
    }
    s.visible = true;
    s.position.set(z.x, z.y);
    s.width = s.height = z.r * 2;
  });
  for (let i = zones.length; i < state.sprites.length; i++) state.sprites[i].visible = false;

  // Matrice de la scène à jour (évite un décalage d'une frame pendant le déplacement de la caméra)
  const stage = canvas.stage;
  stage.transform.updateLocalTransform();
  canvas.app.renderer.render(state.container, {
    renderTexture: state.maskRT,
    clear: true,
    transform: stage.transform.localTransform
  });

  filter.uniforms.uMask = state.maskRT;
  filter.uniforms.uHasMask = 1;
}

/* -------------------------------------------- */
/*  Cases à cocher dans les fenêtres de config   */
/* -------------------------------------------- */

function injectField(app, html, tabName, fieldsHtml) {
  const root = html instanceof HTMLElement ? html : html[0];
  const host = root.querySelector(`.tab[data-tab="${tabName}"]`) ?? root.querySelector("form") ?? root;
  host.insertAdjacentHTML("beforeend", fieldsHtml);
}

function checkbox(name, label, hint, checked) {
  return `<div class="form-group gw-zone-field">
    <label>${game.i18n.localize(label)}</label>
    <div class="form-fields"><input type="checkbox" name="flags.${MODULE_ID}.${name}" ${checked ? "checked" : ""}></div>
    <p class="hint">${game.i18n.localize(hint)}</p>
  </div>`;
}

Hooks.on("renderAmbientLightConfig", (app, html) => {
  const checked = !!app.document.getFlag(MODULE_ID, "keepColor");
  injectField(app, html, "basic", checkbox("keepColor", "GRAYSCALE.KeepColorLight", "GRAYSCALE.KeepColorLightHint", checked));
});

function renderTokenFields(app, html) {
  const doc = app.token ?? app.document;
  const checked = !!doc.getFlag?.(MODULE_ID, "keepColor");
  const radius = Number(doc.getFlag?.(MODULE_ID, "colorRadius")) || 0;
  const fields =
    checkbox("keepColor", "GRAYSCALE.KeepColorToken", "GRAYSCALE.KeepColorTokenHint", checked) +
    `<div class="form-group gw-zone-field">
      <label>${game.i18n.localize("GRAYSCALE.ColorRadius")}</label>
      <div class="form-fields"><input type="number" min="0" step="any" name="flags.${MODULE_ID}.colorRadius" value="${radius}"></div>
      <p class="hint">${game.i18n.localize("GRAYSCALE.ColorRadiusHint")}</p>
    </div>`;
  injectField(app, html, "appearance", fields);
}

Hooks.on("renderTokenConfig", renderTokenFields);
Hooks.on("renderPrototypeTokenConfig", renderTokenFields);
