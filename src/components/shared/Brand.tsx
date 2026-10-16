/** SalesGrid mark: a grid square with a lime "active cell". */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <div className="rounded-lg bg-[#081224] flex items-center justify-center shrink-0" style={{ width: size, height: size }} aria-hidden="true">
      <div className="grid grid-cols-2 gap-[2px]" style={{ width: size * 0.5, height: size * 0.5 }}>
        <span className="bg-white/90 rounded-[1px]" />
        <span className="bg-white/90 rounded-[1px]" />
        <span className="bg-white/90 rounded-[1px]" />
        <span className="bg-[#B4E39C] rounded-[1px]" />
      </div>
    </div>
  );
}
