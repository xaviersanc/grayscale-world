const MODULE_ID = "grayscale-world";

/* -------------------------------------------- */
/*  Textes (intégrés : le module ne déclare aucun fichier de langue,
    pour ne jamais interférer avec la traduction du système/des modules) */
/* -------------------------------------------- */

const STR = {
  fr: {
    enabled: "Activer le noir et blanc",
    enabledHint: "Désactivé par défaut : activer le module ne change rien tant que cette case n'est pas cochée.",
    saturation: "Saturation minimale (%)",
    saturationHint: "0 = noir et blanc total (nuances de gris). 100 = couleurs normales. Valeur par défaut pour tous.",
    canvas: "Appliquer à la carte et aux tokens",
    canvasHint: "Filtre sur la scène (carte, tokens, tuiles).",
    ui: "Appliquer à l'interface (menus, fenêtres, images)",
    uiHint: "Option expérimentale. Si un HUD ou un menu disparaît, décochez-la.",
    walls: "Zones de lumière : suivre les murs",
    wallsHint: "La zone en couleur reprend la forme réelle de la lumière (bloquée par les murs). Sinon : simple cercle.",
    override: "Utiliser ma propre saturation",
    overrideHint: "Remplace la valeur du MJ, pour vous uniquement.",
    userSaturation: "Ma saturation (%)",
    userSaturationHint: "Utilisée seulement si « Utiliser ma propre saturation » est cochée.",
    keepLight: "Zone de couleur",
    keepLightHint: "La zone éclairée par cette lumière (murs inclus) reste en couleur.",
    keepToken: "Token en couleur",
    keepTokenHint: "Ce token reste en couleur malgré le noir et blanc.",
    colorRadius: "Rayon de couleur autour du token",
    colorRadiusHint: "En unités de distance de la scène. 0 = le token seulement."
  },
  en: {
    enabled: "Enable black and white",
    enabledHint: "Off by default: enabling the module changes nothing until this box is checked.",
    saturation: "Minimum saturation (%)",
    saturationHint: "0 = full grayscale. 100 = normal colors. Default for everyone.",
    canvas: "Apply to map and tokens",
    canvasHint: "Filter on the scene (map, tokens, tiles).",
    ui: "Apply to interface (menus, windows, images)",
    uiHint: "Experimental. If a HUD or menu disappears, uncheck it.",
    walls: "Light zones: follow walls",
    wallsHint: "The colored zone uses the real light shape (blocked by walls). Otherwise: a simple circle.",
    override: "Use my own saturation",
    overrideHint: "Overrides the GM value, for you only.",
    userSaturation: "My saturation (%)",
    userSaturationHint: "Only used if \"Use my own saturation\" is checked.",
    keepLight: "Color zone",
    keepLightHint: "The area lit by this light (walls included) stays in color.",
    keepToken: "Token in color",
    keepTokenHint: "This token stays in color despite the grayscale.",
    colorRadius: "Color radius around token",
    colorRadiusHint: "In scene distance units. 0 = the token only."
  }
};
const t = key => (STR[game.i18n?.lang] ?? STR.en)[key] ?? key;

/** Exécute fn sans jamais laisser une erreur casser Foundry ou les autres modules. */
function safe(label, fn) {
  return (...args) => {
    try {
      return fn(...args);
    } catch (err) {
      console.error(`${MODULE_ID} | ${label}`, err);
    }
  };
}

/* -------------------------------------------- */
/*  Réglages                                     */
/* -------------------------------------------- */

Hooks.once("init", safe("init", () => {
  const refresh = safe("refresh", () => {
    applyCSS();
    if (canvas?.ready) setupCanvas();
  });

  const reg = (key, opts) => game.settings.register(MODULE_ID, key, {
    name: t(key),
    hint: t(key + "Hint"),
    config: true,
    onChange: refresh,
    ...opts
  });

  reg("enabled", { scope: "world", restricted: true, type: Boolean, default: false });
  reg("saturation", { scope: "world", restricted: true, type: Number, default: 0, range: { min: 0, max: 100, step: 1 } });
  reg("canvas", { scope: "world", restricted: true, type: Boolean, default: true });
  reg("ui", { scope: "world", restricted: true, type: Boolean, default: false });
  reg("walls", { scope: "world", restricted: true, type: Boolean, default: true });
  reg("override", { scope: "client", type: Boolean, default: false });
  reg("userSaturation", { scope: "client", type: Number, default: 0, range: { min: 0, max: 100, step: 1 } });
}));

Hooks.once("ready", safe("ready", () => applyCSS()));

const getSetting = key => game.settings.get(MODULE_ID, key);
const isEnabled = () => getSetting("enabled");

/** Saturation effective (0..1) pour l'utilisateur courant. */
function effectiveSaturation() {
  const pct = getSetting("override") ? getSetting("userSaturation") : getSetting("saturation");
  return Math.min(1, Math.max(0, Number(pct) / 100));
}

/* -------------------------------------------- */
/*  Interface HTML (CSS, optionnel)              */
/* -------------------------------------------- */

function applyCSS() {
  document.body.classList.toggle("gw-ui", isEnabled() && getSetting("ui"));
  document.documentElement.style.setProperty("--gw-sat", String(effectiveSaturation()));
}

/* -------------------------------------------- */
/*  Carte (filtre PIXI + masque de zones)        */
/* -------------------------------------------- */

const FRAGMENT = `
precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform sampler2D uMask;
uniform vec4 inputSize;
uniform vec4 outputFrame;
uniform float uSat;
uniform float uHasMask;

void main() {
  vec4 c = texture2D(uSampler, vTextureCoord);
  vec2 uv = vTextureCoord * inputSize.xy / outputFrame.zw;
  float m = uHasMask > 0.5 ? texture2D(uMask, uv).a : 0.0;
  float s = mix(uSat, 1.0, m);
  float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(mix(vec3(l), c.rgb, s), c.a);
}`;

/**
 * Vérifie que le shader se compile et se lie avec le vertex shader de PIXI AVANT de l'utiliser.
 * (Un shader invalide ne lève aucune erreur à la création : la carte devient simplement invisible.)
 */
function shaderLinks() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    if (!gl) return false;
    let vsrc = PIXI.Filter.defaultVertexSrc;
    if (!/^\s*precision/.test(vsrc)) vsrc = "precision highp float;\n" + vsrc;

    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn(`${MODULE_ID} | compilation shader`, gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const v = compile(gl.VERTEX_SHADER, vsrc);
    const f = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    if (!v || !f) return false;

    const p = gl.createProgram();
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    const ok = gl.getProgramParameter(p, gl.LINK_STATUS);
    if (!ok) console.warn(`${MODULE_ID} | liaison shader`, gl.getProgramInfoLog(p));
    return ok;
  } catch (err) {
    console.warn(`${MODULE_ID} | vérification shader`, err);
    return false;
  }
}

const state = {
  filter: null,
  fallback: false,
  maskRT: null,
  maskSize: [0, 0, 0],
  container: null,
  graphics: null,
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
  if (!isEnabled() || !getSetting("canvas")) return;

  const stage = canvas.stage;
  try {
    if (!shaderLinks()) throw new Error("le shader ne se lie pas");
    state.filter = new PIXI.Filter(undefined, FRAGMENT, { uSat: 0, uHasMask: 0, uMask: PIXI.Texture.EMPTY });
    state.container = new PIXI.Container();
    state.graphics = new PIXI.Graphics();
    state.container.addChild(state.graphics);
  } catch (err) {
    console.warn(`${MODULE_ID} | shader indisponible, repli sans zones de couleur`, err);
    state.filter = new PIXI.ColorMatrixFilter();
    state.fallback = true;
  }

  stage.filterArea = canvas.app.screen;
  stage.filters = [...(stage.filters ?? []), state.filter];

  state.tick = safe("tick", updateFilter);
  canvas.app.ticker.add(state.tick);
  updateFilter();
}

function teardownCanvas() {
  try {
    if (state.tick) canvas.app?.ticker?.remove(state.tick);
    if (state.filter && canvas.stage) {
      const rest = (canvas.stage.filters ?? []).filter(f => f !== state.filter);
      canvas.stage.filters = rest.length ? rest : null;
      canvas.stage.filterArea = null;
    }
    state.maskRT?.destroy(true);
    state.container?.destroy({ children: true });
  } catch (err) {
    console.error(`${MODULE_ID} | teardown`, err);
  }
  Object.assign(state, { filter: null, fallback: false, maskRT: null, maskSize: [0, 0, 0], container: null, graphics: null, sprites: [], tick: null });
}

Hooks.on("canvasReady", safe("canvasReady", setupCanvas));
Hooks.on("canvasTearDown", safe("canvasTearDown", teardownCanvas));

/**
 * Zones de couleur.
 *  - { points }  : polygone réel de la lumière (murs pris en compte)
 *  - { x, y, r } : cercle (repli, tokens)
 */
function collectZones() {
  const zones = [];
  const dp = canvas.dimensions.distancePixels;
  const followWalls = getSetting("walls");

  for (const light of canvas.lighting?.placeables ?? []) {
    const d = light.document;
    if (d.hidden || !d.getFlag(MODULE_ID, "keepColor")) continue;
    const src = light.source ?? light.lightSource;
    if (src && src.active === false) continue;

    const points = followWalls ? src?.shape?.points : null;
    if (points?.length >= 6) {
      zones.push({ points });
    } else {
      const r = Math.max(d.config.dim ?? 0, d.config.bright ?? 0) * dp;
      if (r > 0) zones.push({ x: d.x, y: d.y, r: r / 0.85 });
    }
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
    filter.saturate(sat - 1, true);
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

  // Polygones de lumière (forme réelle, murs inclus)
  const g = state.graphics;
  g.clear();
  g.beginFill(0xffffff, 1);
  for (const z of zones) if (z.points) g.drawPolygon(z.points);
  g.endFill();

  // Cercles adoucis (tokens / repli)
  const circles = zones.filter(z => !z.points);
  circles.forEach((z, i) => {
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
  for (let i = circles.length; i < state.sprites.length; i++) state.sprites[i].visible = false;

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

function injectField(html, tabName, fieldsHtml) {
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root) return;
  const host = root.querySelector(`.tab[data-tab="${tabName}"]`) ?? root.querySelector("form") ?? root;
  host.insertAdjacentHTML("beforeend", fieldsHtml);
}

function checkbox(name, label, hint, checked) {
  return `<div class="form-group gw-zone-field">
    <label>${t(label)}</label>
    <div class="form-fields"><input type="checkbox" name="flags.${MODULE_ID}.${name}" ${checked ? "checked" : ""}></div>
    <p class="hint">${t(hint)}</p>
  </div>`;
}

Hooks.on("renderAmbientLightConfig", safe("renderAmbientLightConfig", (app, html) => {
  const checked = !!app.document.getFlag(MODULE_ID, "keepColor");
  injectField(html, "basic", checkbox("keepColor", "keepLight", "keepLightHint", checked));
}));

const renderTokenFields = safe("renderTokenConfig", (app, html) => {
  const doc = app.token ?? app.document;
  const checked = !!doc.getFlag?.(MODULE_ID, "keepColor");
  const radius = Number(doc.getFlag?.(MODULE_ID, "colorRadius")) || 0;
  injectField(html, "appearance",
    checkbox("keepColor", "keepToken", "keepTokenHint", checked) +
    `<div class="form-group gw-zone-field">
      <label>${t("colorRadius")}</label>
      <div class="form-fields"><input type="number" min="0" step="any" name="flags.${MODULE_ID}.colorRadius" value="${radius}"></div>
      <p class="hint">${t("colorRadiusHint")}</p>
    </div>`);
});

Hooks.on("renderTokenConfig", renderTokenFields);
Hooks.on("renderPrototypeTokenConfig", renderTokenFields);
