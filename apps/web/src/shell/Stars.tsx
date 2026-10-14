import { useEffect, useState } from "react";

const API = "https://api.github.com/repos/linuxer77/sysd-2d";

/**
 * The repository's real star count from GitHub's public API. It is cached for the visit, and a failure
 * (offline, rate limited) just means no number is shown. The game never depends on it.
 */
export function useStars(): number | null {
  const [n, setN] = useState<number | null>(() => {
    try { const v = sessionStorage.getItem("siege.stars"); return v ? Number(v) : null; } catch { return null; }
  });
  useEffect(() => {
    if (n !== null || typeof fetch === "undefined" || location.protocol === "file:") return;
    let live = true;
    fetch(API, { headers: { accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(4000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { stargazers_count?: number } | null) => {
        if (!live || !j || typeof j.stargazers_count !== "number") return;
        setN(j.stargazers_count);
        try { sessionStorage.setItem("siege.stars", String(j.stargazers_count)); } catch { /* ignore */ }
      })
      .catch(() => { /* offline: show no number */ });
    return () => { live = false; };
  }, [n]);
  return n;
}
