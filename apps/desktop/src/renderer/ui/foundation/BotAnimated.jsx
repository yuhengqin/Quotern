import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  BOT_DEFAULT_SHAPE,
  BOT_PAPER,
  botSceneForPetState,
  resolveBotColor,
} from "../../lib/bot-appearance.js";
import { NOTIF_BLUE } from "../../lib/bot/decor";
import { BotEngine } from "../../lib/bot/engine";
import { EXPRESSION_BY_ID } from "../../lib/bot/expressions";
import { REST_GAZE } from "../../lib/bot/face";
import { STATE_BY_ID } from "../../lib/bot/states";
import { DEMI_VIEWBOX, RAYON } from "../../lib/bot/repere";
import { COLOR_BY_ID, SHAPE_BY_ID, mixHex } from "../../lib/bot/skins";

const VB = DEMI_VIEWBOX;

/**
 * 30fps rather than a raw rAF loop: the desktop pet window is always on screen,
 * and the engine's morphs are exponential ease-outs that read the same at 30 as
 * at 60 — halving the React re-renders is free.
 */
const FRAME_MS = 1000 / 30;

/**
 * How far the eyes swing toward the cursor, in degrees of yaw. Sits just past the
 * engine's resting gaze (28.5deg) so a lean reads as looking rather than drifting.
 */
const LOOK_MAX_YAW = 34;

/**
 * Follows the `dark` class ThemeProvider puts on <html>, without going through
 * useTheme(): the Windows floating pet (pet.jsx) renders outside ThemeProvider,
 * where that hook throws.
 */
function useDarkRoot() {
  const [dark, setDark] = useState(() => {
    if (typeof document === "undefined") return false;
    return document.documentElement.classList.contains("dark");
  });
  useEffect(() => {
    if (typeof MutationObserver !== "function") return undefined;
    const root = document.documentElement;
    const observer = new MutationObserver(() => setDark(root.classList.contains("dark")));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

function usePageVisible() {
  const [visible, setVisible] = useState(() => {
    if (typeof document === "undefined") return true;
    return document.visibilityState !== "hidden";
  });
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onChange = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * The `bot` pet character: a single filled silhouette morphing between states,
 * with the eyes punched out as holes so they clip against the body on their own.
 *
 * Driven by the vendored engine in lib/bot/ — `sample(t)` is a pure function of
 * time, so this component owns the clock and nothing else.
 */
export function BotAnimated({
  state = "idle-living",
  dragState = null,
  size = 48,
  className = "",
  leanX = 0,
  shape = BOT_DEFAULT_SHAPE,
  color = "auto",
  paper = null,
}) {
  const scene = botSceneForPetState(
    dragState === "running-left" || dragState === "running-right" ? dragState : state,
  );
  const reducedMotion = useReducedMotion();
  const pageVisible = usePageVisible();
  const dark = useDarkRoot();
  const resolvedPaper = paper || (dark ? BOT_PAPER.dark : BOT_PAPER.light);
  const ink = COLOR_BY_ID.get(resolveBotColor(color, dark)).hex;

  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);
  const maskId = `bot-mask-${uid}`;

  const engineRef = useRef(null);
  if (engineRef.current === null) {
    engineRef.current = new BotEngine(
      RAYON,
      scene.state,
      SHAPE_BY_ID.get(shape)?.radii ?? null,
      EXPRESSION_BY_ID.get(scene.expression) ?? null,
    );
  }
  const engine = engineRef.current;
  const clockRef = useRef(0);
  const [frame, setFrame] = useState(() => engine.sample(0));

  // The customizer knobs slide instead of snapping, so they go through the engine.
  useEffect(() => {
    engine.setShape(SHAPE_BY_ID.get(shape)?.radii ?? null, clockRef.current);
  }, [engine, shape]);

  useEffect(() => {
    engine.setExpression(EXPRESSION_BY_ID.get(scene.expression) ?? null, clockRef.current);
  }, [engine, scene.expression]);

  useEffect(() => {
    if (engine.state === scene.state) return;
    engine.setState(scene.state, clockRef.current);
    // Repaint immediately so a state change still lands while the clock is parked.
    setFrame(engine.sample(clockRef.current));
  }, [engine, scene.state]);

  // Eye tracking. The engine turns the head on a sphere, so this is one absolute
  // direction rather than a pixel offset — and it must be absolute on BOTH axes:
  // a relative pitch would make the eyes drop the first time the expression changes
  // (see the Look docs in bot/engine.ts). Only states with a replaceable face take
  // it; on the others the gaze IS the animation.
  useEffect(() => {
    const magnitude = Math.min(1, Math.abs(leanX));
    if (magnitude <= 0 || !STATE_BY_ID.get(scene.state)?.baseFace) {
      engine.setLook(null, clockRef.current);
      return;
    }
    engine.setLook(
      {
        yaw: leanX * LOOK_MAX_YAW,
        pitch: REST_GAZE.pitch,
        mix: magnitude,
        spin: 0,
        // Automatic drift fades out as the cursor takes over, otherwise the bot
        // looks like it is hunting for the cursor without ever holding it.
        wander: 1 - magnitude,
      },
      clockRef.current,
    );
  }, [engine, leanX, scene.state]);

  useEffect(() => {
    if (reducedMotion || !pageVisible) return undefined;
    let raf = 0;
    let last = 0;
    let carry = 0;
    const tick = (ms) => {
      raf = requestAnimationFrame(tick);
      // Cap dt so a backgrounded tab does not fast-forward the animation on return.
      const dt = last ? Math.min((ms - last) / 1000, 0.064) : 0;
      last = ms;
      clockRef.current += dt;
      carry += dt * 1000;
      if (carry < FRAME_MS) return;
      carry = 0;
      setFrame(engine.sample(clockRef.current));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine, reducedMotion, pageVisible]);

  const dotAttrs = (dot) => {
    const fill =
      dot.color ?? (dot.depth === undefined ? ink : mixHex(resolvedPaper, ink, dot.depth));
    const common = { fill, opacity: dot.opacity };
    return dot.d
      ? {
          ...common,
          d: dot.d,
          transform: `translate(${dot.x} ${dot.y}) rotate(${dot.rot ?? 0}) scale(${RAYON})`,
        }
      : { ...common, cx: dot.x, cy: dot.y, r: dot.r };
  };

  const particles = frame.dots.map((dot, i) => {
    const attrs = dotAttrs(dot);
    return dot.d ? <path key={i} {...attrs} /> : <circle key={i} {...attrs} />;
  });

  return (
    <svg
      aria-hidden="true"
      className={`bot-animated ${className}`}
      width={size}
      height={size}
      viewBox={`${-VB} ${-VB} ${VB * 2} ${VB * 2}`}
    >
      <defs>
        {/*
          The eyes are real holes punched in the body, not white shapes laid on
          top — so they stay clipped by the silhouette when they slide to the edge.
        */}
        <mask id={maskId} maskUnits="userSpaceOnUse" x={-VB} y={-VB} width={VB * 2} height={VB * 2}>
          <path d={frame.bodyPath} fill="#fff" />
          {frame.eyes.map((eye, i) => (
            <path key={i} d={eye.d} transform={eye.matrix} opacity={eye.alpha} fill="#000" />
          ))}
          {frame.notch ? (
            <circle cx={frame.notch.x} cy={frame.notch.y} r={frame.notch.r} fill="#000" />
          ) : null}
        </mask>
        {frame.arcs.map((arc) => (
          <linearGradient
            key={arc.id}
            id={`${uid}-${arc.id}`}
            gradientUnits="userSpaceOnUse"
            x1={arc.grad.x1}
            y1={arc.grad.y1}
            x2={arc.grad.x2}
            y2={arc.grad.y2}
          >
            {arc.grad.stops.map((stop, i) => (
              <stop key={i} offset={i / (arc.grad.stops.length - 1)} stopColor={stop} />
            ))}
          </linearGradient>
        ))}
      </defs>

      {/* Back half of the orbit rings: drawn before the body, so the body occludes it. */}
      <g fill="none" strokeLinecap="round">
        {frame.arcs.map((arc) => (
          <path
            key={arc.id}
            d={arc.back}
            stroke={`url(#${uid}-${arc.id})`}
            strokeWidth={arc.width}
            opacity={arc.opacity}
          />
        ))}
      </g>

      {frame.dotsBehind ? <g>{particles}</g> : null}

      <g opacity={frame.bodyAlpha}>
        {/*
          Opaque backing in the exact shape of the body, underneath the body itself.
          The eyes are holes, and a hole reveals whatever is drawn behind it — which
          is precisely where the back half of the rings and the burst particles live.
          Without this, a ring passing behind the ball reappears INSIDE the eyes.
        */}
        <path d={frame.bodyPath} fill={resolvedPaper} />
        <g mask={`url(#${maskId})`}>
          <rect x={-VB} y={-VB} width={VB * 2} height={VB * 2} fill={ink} />
        </g>
      </g>

      {frame.dotsBehind ? null : <g>{particles}</g>}

      {frame.notif ? (
        <circle cx={frame.notif.x} cy={frame.notif.y} r={frame.notif.r} fill={NOTIF_BLUE} />
      ) : null}

      {/* Front half of the orbit rings. */}
      <g fill="none" strokeLinecap="round">
        {frame.arcs.map((arc) => (
          <path
            key={`f${arc.id}`}
            d={arc.front}
            stroke={`url(#${uid}-${arc.id})`}
            strokeWidth={arc.width}
            opacity={arc.opacity}
          />
        ))}
      </g>
    </svg>
  );
}
