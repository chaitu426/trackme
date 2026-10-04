import Image from "next/image";

/**
 * Premium SVG country flag via flagcdn.com — 4:3 aspect ratio.
 * Falls back to emoji flag on error.
 */
export function FlagImage({
  code,
  size = 20,
  className = "",
}: {
  code: string;
  /** Width in px — height is auto-calculated at 3:4 ratio */
  size?: number;
  className?: string;
}) {
  const lower = code.toLowerCase();
  const height = Math.round(size * 0.75);

  return (
    <span
      className={`inline-flex shrink-0 overflow-hidden rounded-[2px] shadow-[0_0_0_1px_rgba(255,255,255,0.12)] ${className}`}
      style={{ width: size, height }}
    >
      <Image
        src={`https://flagcdn.com/${lower}.svg`}
        alt={code}
        width={size}
        height={height}
        className="h-full w-full object-cover"
        unoptimized
      />
    </span>
  );
}
