// Shared by server layout (inline script) and client theme helpers — no 'use client'.
export const THEME_KEY = 'msh-theme'

/** Inline script (runs before paint) — applies saved theme or system preference, no flash. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}var d=document.documentElement;d.classList.toggle('dark',t==='dark');d.style.colorScheme=t}catch(e){}})();`

