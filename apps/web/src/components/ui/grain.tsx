/**
 * Film grain for coloured SVG shapes (bars, lines, ribbons). Put <GrainFilter id> in the
 * svg's <defs> and apply `filter={`url(#${id})`}` to the shapes. The region is given in
 * the svg's own units, not the shape's bounding box, so a perfectly flat line is not clipped away.
 * For plain HTML bars use the `.grain` class instead.
 */
export function GrainFilter({
  id,
  width,
  height,
  pad = 4,
}: {
  id: string;
  width: number;
  height: number;
  pad?: number;
}) {
  return (
    <filter
      id={id}
      filterUnits="userSpaceOnUse"
      x={-pad}
      y={-pad}
      width={width + pad * 2}
      height={height + pad * 2}
      colorInterpolationFilters="sRGB"
    >
      <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="11" stitchTiles="stitch" result="noise" />
      <feColorMatrix in="noise" type="saturate" values="0" result="mono" />
      <feComponentTransfer in="mono" result="contrast">
        <feFuncR type="linear" slope="1.15" intercept="-0.07" />
        <feFuncG type="linear" slope="1.15" intercept="-0.07" />
        <feFuncB type="linear" slope="1.15" intercept="-0.07" />
      </feComponentTransfer>
      <feBlend in="SourceGraphic" in2="contrast" mode="soft-light" result="grained" />
      {/* Half grain, half original: texture without dulling the colour. */}
      <feComposite in="grained" in2="SourceGraphic" operator="arithmetic" k1="0" k2="0.55" k3="0.45" k4="0" result="mixed" />
      <feComposite in="mixed" in2="SourceGraphic" operator="in" />
    </filter>
  );
}
