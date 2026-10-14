import { ICON_D, type IconName } from "./paths";

/** DOM renderer. Uses currentColor so CSS drives the colour. */
export function Icon({ name, size = 18, color, title }: { name: IconName; size?: number; color?: string | undefined; title?: string | undefined }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color ?? "currentColor"} strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title ? <title>{title}</title> : null}
      <path d={ICON_D[name]} />
    </svg>
  );
}
