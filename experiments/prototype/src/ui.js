const themeKey = 'smg-theme';
const themeToggle = document.getElementById('theme-toggle');
const inspectorToggle = document.getElementById('inspector-toggle');

function setTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  themeToggle.textContent = dark ? '☀ 明亮模式' : '☾ 夜间模式';
  themeToggle.setAttribute('aria-label', dark ? '切换到明亮模式' : '切换到夜间模式');
  themeToggle.setAttribute('aria-pressed', String(dark));
  try { localStorage.setItem(themeKey, dark ? 'dark' : 'light'); } catch { /* Theme switching also works without browser storage. */ }
  document.dispatchEvent(new CustomEvent('smg:theme-change', { detail: { theme: dark ? 'dark' : 'light' } }));
}

function setInspectorExpanded(inspectorExpanded) {
  document.body.classList.toggle('inspector-expanded', inspectorExpanded);
  inspectorToggle.setAttribute('aria-expanded', String(inspectorExpanded));
  inspectorToggle.setAttribute('aria-label', inspectorExpanded ? '恢复原文阅读区宽度' : '展开原文阅读区');
  inspectorToggle.textContent = inspectorExpanded ? '恢复宽度 ↔' : '展开阅读 ↔';
}

let savedTheme = 'light';
try { savedTheme = localStorage.getItem(themeKey) || 'light'; } catch { /* Default to light when browser storage is unavailable. */ }
setTheme(savedTheme);
themeToggle.addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
inspectorToggle.addEventListener('click', () => setInspectorExpanded(!document.body.classList.contains('inspector-expanded')));
window.addEventListener('storage', event => { if (event.key === themeKey) setTheme(event.newValue || 'light'); });
