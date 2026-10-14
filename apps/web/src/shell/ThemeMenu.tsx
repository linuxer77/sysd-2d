import { useEffect, useRef, useState } from "react";
import { applyTheme, useTheme } from "../theme/theme";
import { THEMES } from "../theme/themes";
import { Icon } from "../icons/Icon";

/** The theme switcher: it recolours the whole site and the game board, live. */
export function ThemeMenu() {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent): void => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent): void => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="theme-menu" ref={ref}>
      <button className="theme-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={`Colour theme: ${theme.name}. Change it.`} onClick={() => setOpen((o) => !o)}>
        <i className="dot" style={{ background: `linear-gradient(135deg, ${theme.swatch}, var(--violet))` }} /><span className="theme-name">{theme.name}</span>
        <Icon name="CHEVRON" size={14} />
      </button>
      {open ? (
        <div className="theme-pop" role="listbox" aria-label="Colour themes">
          {THEMES.map((t) => (
            <button key={t.id} role="option" aria-selected={t.id === theme.id} className={t.id === theme.id ? "on" : ""} onClick={() => { applyTheme(t.id); setOpen(false); }}>
              <i className="dot" style={{ background: t.swatch }} />{t.name}{t.id === theme.id ? <Icon name="CHECK" size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
