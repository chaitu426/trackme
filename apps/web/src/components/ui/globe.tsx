// @ts-nocheck -- vendored from Aceternity UI (globe); kept verbatim
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Color, Scene, Fog, PerspectiveCamera, Sphere, Vector3 } from "three";
import ThreeGlobe from "three-globe";
import { useThree, Canvas, extend } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import countries from "@/data/globe.json";
declare module "@react-three/fiber" {
  interface ThreeElements {
    threeGlobe: ThreeElements["mesh"] & {
      new (): ThreeGlobe;
    };
  }
}

extend({ ThreeGlobe: ThreeGlobe });

/** One ring of a GeoJSON polygon as [lng, lat] pairs, for point-in-polygon tests. */
type Ring = number[][];
type CountryShape = { iso: string; feature: any; bbox: [number, number, number, number]; polygons: Ring[][] };

/** ISO alpha-2 of a Natural Earth feature; France, Norway and a few others are "-99" in ISO_A2. */
function isoOf(feature: any): string {
  const p = feature.properties;
  for (const v of [p.ISO_A2, p.WB_A2, p.POSTAL]) if (v && v !== "-99") return v;
  return "";
}

const SHAPES: CountryShape[] = (countries.features as any[]).map((feature) => {
  const polygons: Ring[][] =
    feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  for (const poly of polygons) {
    for (const [x, y] of poly[0]) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { iso: isoOf(feature), feature, bbox: [minX, minY, maxX, maxY], polygons };
});

function inRing(ring: Ring, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function countryAt(lng: number, lat: number): CountryShape | null {
  for (const shape of SHAPES) {
    const [minX, minY, maxX, maxY] = shape.bbox;
    if (lng < minX || lng > maxX || lat < minY || lat > maxY) continue;
    for (const poly of shape.polygons) {
      if (inRing(poly[0], lng, lat) && !poly.slice(1).some((hole) => inRing(hole, lng, lat))) return shape;
    }
  }
  return null;
}

const GLOBE_RADIUS = 100;
const RING_PROPAGATION_SPEED = 3;
const aspect = 1.2;
const cameraZ = 300;

type Position = {
  order: number;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  arcAlt: number;
  color: string;
};

export type GlobeConfig = {
  pointSize?: number;
  globeColor?: string;
  showAtmosphere?: boolean;
  atmosphereColor?: string;
  atmosphereAltitude?: number;
  emissive?: string;
  emissiveIntensity?: number;
  shininess?: number;
  polygonColor?: string;
  ambientLight?: string;
  directionalLeftLight?: string;
  directionalTopLight?: string;
  pointLight?: string;
  arcTime?: number;
  arcLength?: number;
  rings?: number;
  maxRings?: number;
  initialPosition?: {
    lat: number;
    lng: number;
  };
  autoRotate?: boolean;
  autoRotateSpeed?: number;
};

interface WorldProps {
  globeConfig: GlobeConfig;
  data: Position[];
  /** ISO alpha-2 -> 0..1 share of the busiest country; those countries are tinted on the globe. */
  countryStats?: Record<string, number>;
  /** Country drawn highlighted, e.g. the one the viewer clicked. */
  activeCountry?: string | null;
  /** Called with the hovered country (null when off any) and the pointer position in the viewport. */
  onCountryHover?: (iso: string | null, clientX: number, clientY: number) => void;
  onCountryClick?: (iso: string) => void;
}

export function Globe({ globeConfig, data, countryStats, activeCountry, onCountryHover, onCountryClick }: WorldProps) {
  const globeRef = useRef<ThreeGlobe | null>(null);
  const groupRef = useRef<unknown>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const lastMove = useRef(0);
  const hit = useMemo(() => new Vector3(), []);
  const body = useMemo(() => new Sphere(new Vector3(), GLOBE_RADIUS), []);

  /** Country under the pointer, or null off the globe. Intersects the ray with the sphere itself so the atmosphere shell is ignored. */
  function countryUnder(e: any): CountryShape | null {
    if (!globeRef.current || !e.ray.intersectSphere(body, hit)) return null;
    const { lat, lng } = (globeRef.current as any).toGeoCoords({ x: hit.x, y: hit.y, z: hit.z });
    return countryAt(lng, lat);
  }

  function handleMove(e: any) {
    const now = performance.now();
    if (now - lastMove.current < 40) return;
    lastMove.current = now;
    const iso = countryUnder(e)?.iso || null;
    setHovered((prev) => (prev === iso ? prev : iso));
    onCountryHover?.(iso, e.nativeEvent.clientX, e.nativeEvent.clientY);
  }

  function handleLeave() {
    setHovered(null);
    onCountryHover?.(null, 0, 0);
  }

  function handleClick(e: any) {
    if (e.delta > 4) return; // a drag to rotate, not a click
    const iso = countryUnder(e)?.iso;
    if (iso) onCountryClick?.(iso);
  }

  const defaultProps = {
    pointSize: 1,
    atmosphereColor: "#ffffff",
    showAtmosphere: true,
    atmosphereAltitude: 0.1,
    polygonColor: "rgba(255,255,255,0.7)",
    globeColor: "#1d072e",
    emissive: "#000000",
    emissiveIntensity: 0.1,
    shininess: 0.9,
    arcTime: 2000,
    arcLength: 0.9,
    rings: 1,
    maxRings: 3,
    ...globeConfig,
  };

  // Initialize globe only once
  useEffect(() => {
    if (!globeRef.current && groupRef.current) {
      globeRef.current = new ThreeGlobe();
      (groupRef.current as any).add(globeRef.current);
      setIsInitialized(true);
    }
  }, []);

  // Build material when globe is initialized or when relevant props change
  useEffect(() => {
    if (!globeRef.current || !isInitialized) return;

    const globeMaterial = globeRef.current.globeMaterial() as unknown as {
      color: Color;
      emissive: Color;
      emissiveIntensity: number;
      shininess: number;
    };
    globeMaterial.color = new Color(globeConfig.globeColor);
    globeMaterial.emissive = new Color(globeConfig.emissive);
    globeMaterial.emissiveIntensity = globeConfig.emissiveIntensity || 0.1;
    globeMaterial.shininess = globeConfig.shininess || 0.9;
  }, [
    isInitialized,
    globeConfig.globeColor,
    globeConfig.emissive,
    globeConfig.emissiveIntensity,
    globeConfig.shininess,
  ]);

  // Build data when globe is initialized or when data changes
  useEffect(() => {
    if (!globeRef.current || !isInitialized || !data) return;

    const arcs = data;
    let points = [];
    for (let i = 0; i < arcs.length; i++) {
      const arc = arcs[i];
      const rgb = hexToRgb(arc.color) as { r: number; g: number; b: number };
      points.push({
        size: defaultProps.pointSize,
        order: arc.order,
        color: arc.color,
        lat: arc.startLat,
        lng: arc.startLng,
      });
      points.push({
        size: defaultProps.pointSize,
        order: arc.order,
        color: arc.color,
        lat: arc.endLat,
        lng: arc.endLng,
      });
    }

    // remove duplicates for same lat and lng
    const filteredPoints = points.filter(
      (v, i, a) =>
        a.findIndex((v2) =>
          ["lat", "lng"].every(
            (k) => v2[k as "lat" | "lng"] === v[k as "lat" | "lng"],
          ),
        ) === i,
    );

    globeRef.current
      .hexPolygonsData(countries.features)
      .hexPolygonResolution(3)
      .hexPolygonMargin(0.7)
      .showAtmosphere(defaultProps.showAtmosphere)
      .atmosphereColor(defaultProps.atmosphereColor)
      .atmosphereAltitude(defaultProps.atmosphereAltitude)
      .hexPolygonColor((f: any) => {
        const ratio = countryStats?.[isoOf(f)];
        return ratio === undefined ? defaultProps.polygonColor : `rgba(255,255,255,${0.8 + ratio * 0.2})`;
      });

    globeRef.current
      .arcsData(data)
      .arcStartLat((d) => (d as { startLat: number }).startLat * 1)
      .arcStartLng((d) => (d as { startLng: number }).startLng * 1)
      .arcEndLat((d) => (d as { endLat: number }).endLat * 1)
      .arcEndLng((d) => (d as { endLng: number }).endLng * 1)
      .arcColor((e: any) => (e as { color: string }).color)
      .arcAltitude((e) => (e as { arcAlt: number }).arcAlt * 1)
      .arcStroke(() => [0.32, 0.28, 0.3][Math.round(Math.random() * 2)])
      .arcDashLength(defaultProps.arcLength)
      .arcDashInitialGap((e) => (e as { order: number }).order * 1)
      .arcDashGap(15)
      .arcDashAnimateTime(() => defaultProps.arcTime);

    globeRef.current
      .pointsData(filteredPoints)
      .pointColor((e) => (e as { color: string }).color)
      .pointsMerge(true)
      .pointAltitude(0.0)
      .pointRadius(2);

    globeRef.current
      .ringsData([])
      .ringColor(() => defaultProps.polygonColor)
      .ringMaxRadius(defaultProps.maxRings)
      .ringPropagationSpeed(RING_PROPAGATION_SPEED)
      .ringRepeatPeriod(
        (defaultProps.arcTime * defaultProps.arcLength) / defaultProps.rings,
      );
  }, [
    isInitialized,
    data,
    defaultProps.pointSize,
    defaultProps.showAtmosphere,
    defaultProps.atmosphereColor,
    defaultProps.atmosphereAltitude,
    defaultProps.polygonColor,
    countryStats,
    defaultProps.arcLength,
    defaultProps.arcTime,
    defaultProps.rings,
    defaultProps.maxRings,
  ]);

  // Handle rings animation with cleanup
  useEffect(() => {
    if (!globeRef.current || !isInitialized || !data) return;

    const interval = setInterval(() => {
      if (!globeRef.current) return;

      const newNumbersOfRings = genRandomNumbers(
        0,
        data.length,
        Math.floor((data.length * 4) / 5),
      );

      const ringsData = data
        .filter((d, i) => newNumbersOfRings.includes(i))
        .map((d) => ({
          lat: d.startLat,
          lng: d.startLng,
          color: d.color,
        }));

      globeRef.current.ringsData(ringsData);
    }, 2000);

    return () => {
      clearInterval(interval);
    };
  }, [isInitialized, data]);

  // One smooth polygon over the hovered and the active country; far cheaper than re-colouring the hex layer.
  useEffect(() => {
    if (!globeRef.current || !isInitialized) return;
    const shown = SHAPES.filter((x) => x.iso && (x.iso === hovered || x.iso === activeCountry));
    globeRef.current
      .polygonsData(shown.map((x) => x.feature))
      .polygonCapColor((f: any) => (isoOf(f) === activeCountry ? "rgba(255,255,255,1)" : "rgba(255,255,255,0.9)"))
      .polygonSideColor(() => "rgba(255,255,255,0.25)")
      .polygonStrokeColor(() => "#ffffff")
      .polygonAltitude(0.012);
  }, [isInitialized, hovered, activeCountry]);

  return <group ref={groupRef} onPointerMove={handleMove} onPointerOut={handleLeave} onClick={handleClick} />;
}

export function WebGLRendererConfig() {
  const { gl, size } = useThree();

  useEffect(() => {
    gl.setPixelRatio(window.devicePixelRatio);
    gl.setSize(size.width, size.height);
    gl.setClearColor(0x000000, 0);
  }, []);

  return null;
}

export function World(props: WorldProps) {
  const { globeConfig } = props;
  // Built once: hover state re-renders this, and a fresh Scene or camera each time would reset the canvas.
  const [scene] = useState(() => {
    const next = new Scene();
    next.fog = new Fog(0xffffff, 400, 2000);
    return next;
  });
  const [camera] = useState(() => new PerspectiveCamera(50, aspect, 180, 1800));
  const [overCountry, setOverCountry] = useState(false);
  return (
    <Canvas scene={scene} camera={camera} style={{ cursor: overCountry ? "pointer" : "grab" }}>
      <WebGLRendererConfig />
      <ambientLight color={globeConfig.ambientLight} intensity={0.6} />
      <directionalLight
        color={globeConfig.directionalLeftLight}
        position={new Vector3(-400, 100, 400)}
      />
      <directionalLight
        color={globeConfig.directionalTopLight}
        position={new Vector3(-200, 500, 200)}
      />
      <pointLight
        color={globeConfig.pointLight}
        position={new Vector3(-200, 500, 200)}
        intensity={0.8}
      />
      <Globe
        {...props}
        onCountryHover={(iso, x, y) => {
          setOverCountry(Boolean(iso));
          props.onCountryHover?.(iso, x, y);
        }}
      />
      <OrbitControls
        enablePan={false}
        enableZoom={false}
        minDistance={cameraZ}
        maxDistance={cameraZ}
        autoRotateSpeed={1}
        autoRotate={!overCountry}
        minPolarAngle={Math.PI / 3.5}
        maxPolarAngle={Math.PI - Math.PI / 3}
      />
    </Canvas>
  );
}

export function hexToRgb(hex: string) {
  var shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  hex = hex.replace(shorthandRegex, function (m, r, g, b) {
    return r + r + g + g + b + b;
  });

  var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

export function genRandomNumbers(min: number, max: number, count: number) {
  const arr = [];
  while (arr.length < count) {
    const r = Math.floor(Math.random() * (max - min)) + min;
    if (arr.indexOf(r) === -1) arr.push(r);
  }

  return arr;
}
