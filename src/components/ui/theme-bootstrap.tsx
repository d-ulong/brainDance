const THEME_STORAGE_KEY = "braindance-theme";

/** Runs before paint so stored theme applies without waiting for client components. */
export function ThemeBootstrapScript() {
  const script = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var v=localStorage.getItem(k);document.documentElement.dataset.theme=v==='candy'?'candy':'space';}catch(e){document.documentElement.dataset.theme='space';}})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
