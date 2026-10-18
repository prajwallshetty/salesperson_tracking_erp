import Image from 'next/image';

export const BRAND_NAME = 'Bharath Interior Decor';

/** The official Bharath Interior Decor monogram (public/brand/logo-512.png), unaltered. The artwork has its own black
 *  background, so it is shown as a rounded black tile that reads the same on light and dark surfaces. */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <Image
      src="/brand/logo-512.png"
      alt={`${BRAND_NAME} logo`}
      width={size}
      height={size}
      priority
      className="rounded-lg bg-black shrink-0 object-contain"
      style={{ width: size, height: size }}
    />
  );
}
