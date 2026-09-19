import { COLORS, FONTS, PRESETS, clone, contrastWarnings, PRESET_NAMES, MAX_CUSTOMS, sameTheme, themeName } from './theme.js';
const invoke = (name, ...args) => window.electronAPI.invoke(`plugin:fictionlab-themes:${name}`, ...args);
const uiCSS = `
.fl-themes {max-width:960px;margin:0 auto;padding:8px 0 32px;color:var(--color-text-primary);font:inherit;}
.fl-themes *{box-sizing:border-box}.fl-themes h1{font-size:2rem;margin:0 0 8px;letter-spacing:-.035em}
.fl-themes .applied-theme{padding:12px 16px;border-left:3px solid var(--color-accent);background:var(--color-bg-secondary);font-weight:650;margin-top:18px}.fl-themes .manage-theme{margin:12px 0}.fl-themes .manage-theme label{margin-bottom:10px}.fl-themes .manage-theme button{margin-right:8px}.fl-themes .save-limit{font-size:.85rem;margin-top:8px}.fl-themes [hidden]{display:none!important}.fl-themes .preset-badge{font-weight:400;font-size:.8rem;display:block;margin-top:6px}
.fl-themes p{color:var(--color-text-secondary);line-height:1.55;margin:0 0 24px}
.fl-themes .theme-presets{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:24px 0}
.fl-themes button,.fl-themes select,.fl-themes input{font:inherit}
.fl-themes button{cursor:pointer;border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:10px 16px;background:var(--color-bg-secondary);color:var(--color-text-primary)}
.fl-themes button:disabled{opacity:.55;cursor:wait}.fl-themes .preset{padding:0;text-align:left;overflow:hidden;outline-offset:4px}
.fl-themes .preset[aria-pressed=true]{outline:2px solid var(--color-accent)}
.fl-themes .preset-art{display:flex;height:94px;align-items:stretch;pointer-events:none}
.fl-themes .preset-chrome{width:22%;border-right:1px solid #8884;padding:16px 10px;display:grid;gap:8px;align-content:start}
.fl-themes .preset-chrome i{display:block;height:4px;background:currentColor;opacity:.6}
.fl-themes .preset-paper{flex:1;padding:15px 20px;display:grid;align-content:center;gap:8px}
.fl-themes .preset-paper b{font-size:20px;letter-spacing:-.03em}.fl-themes .preset-paper i{height:5px;width:65%;background:currentColor;opacity:.2}
.fl-themes .preset-label{display:block;padding:14px 18px;font-weight:650}.fl-themes .preset-label small{display:block;font-size:.85rem;font-weight:400;color:var(--color-text-secondary);margin-top:4px}
.fl-themes .theme-tools,.fl-themes .theme-actions,.fl-themes .theme-save{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.fl-themes .theme-tools{justify-content:flex-start;align-items:end;margin-bottom:24px}.fl-themes [data-original]{margin-left:auto}.fl-themes label{display:grid;gap:7px;font-size:.9rem;min-width:0}
.fl-themes select,.fl-themes input[type=text],.fl-themes input[type=number]{border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:9px 10px;max-width:100%;min-width:0;background:var(--color-bg-secondary);color:var(--color-text-primary)}
.fl-themes details{border-top:1px solid var(--color-border);border-bottom:1px solid var(--color-border);padding:18px 0;margin-bottom:22px}
.fl-themes summary{cursor:pointer;font-weight:650}.fl-themes .custom-body{padding-top:22px}
.fl-themes h2{font-size:1rem;margin:0 0 14px}.fl-themes .colors{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-bottom:24px}
.fl-themes .color-pair{display:flex;gap:7px;align-items:center}.fl-themes input[type=color]{flex:none;width:38px;height:36px;border:1px solid var(--color-border);padding:2px;border-radius:var(--radius-sm);background:none;cursor:pointer}.fl-themes .color-pair input[type=text]{width:100%;font-family:ui-monospace,monospace}
.fl-themes .fonts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.fl-themes .size-field{margin-top:16px;max-width:140px}
.fl-themes .theme-save{margin-top:24px;align-items:end}.fl-themes .theme-save label{flex:1;min-width:160px}
.fl-themes .theme-actions{padding-top:4px}.fl-themes .apply{background:var(--color-accent);color:var(--fl-theme-on-accent,var(--color-bg-secondary));font-weight:650}
.fl-themes .theme-status{font-size:.88rem;color:var(--color-text-secondary);margin-left:auto}.fl-themes .contrast{font-size:.85rem;line-height:1.5;margin:16px 0;color:var(--color-text-secondary)}
.fl-themes .theme-error{color:var(--status-error);margin:12px 0;min-height:1.5em}.fl-themes .theme-note{font-size:.82rem;margin-top:22px}
@media(max-width:850px){.fl-themes .colors,.fl-themes .fonts{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:600px){.fl-themes .theme-presets,.fl-themes .colors,.fl-themes .fonts{grid-template-columns:1fr}.fl-themes .theme-status{margin-left:0}}
`;
export default class ThemesView {
  async mount(container) {
    this.root = document.createElement('section'); this.root.className = 'fl-themes';
    this.root.textContent = 'Loading themes…'; container.replaceChildren(this.root);
    this.abort = new AbortController(); this.mounted = true; this.dirty = false; this.busy = false;
    try {
      this.state = await invoke('get');
      if (!this.mounted) return;
      this.restoreDraft(); this.render();
    } catch (error) { if (this.mounted) this.root.textContent = `Unable to load themes: ${error.message}`; }
  }
  render() {
    const open = this.root.querySelector('details')?.open || false;
    this.root.innerHTML = `<style>${uiCSS}</style>
      <h1>Make room for your style.</h1><p>Choose a starting point. Adjust the details when you want to.</p>
      <div class="applied-theme" role="status"></div>
      <div class="theme-presets"></div>
      <div class="theme-tools"><label><span class="saved-count"></span><select data-saved aria-label="Saved themes"><option value="">Choose a saved theme…</option></select></label><button type="button" data-rename>Rename</button><button type="button" data-delete>Delete</button><button type="button" data-original>Original FictionLab</button></div>
      <div class="manage-theme" hidden></div>
      <details><summary>Customize colors & fonts</summary><div class="custom-body">
        <h2>Colors</h2><div class="colors"></div><h2>Typography</h2><div class="fonts"></div>
        <label class="size-field">Interface size<input data-size type="number" min="12" max="20" step="1" aria-label="Interface size"></label>
        <div class="theme-save"><label>Name your theme<input data-name type="text" maxlength="60" placeholder="My writing room"></label><button type="button" data-save>Save as new theme</button></div><div class="save-limit"></div>
      </div></details>
      <div class="contrast" aria-live="polite"></div><div class="theme-error" role="alert"></div>
      <div class="theme-actions"><button type="button" class="apply" data-apply>Apply theme</button><button type="button" data-cancel>Cancel preview</button><button type="button" data-reset>Reset to preset</button><span class="theme-status" role="status"></span></div>
      <p class="theme-note">Changes preview across FictionLab. Apply keeps them; leaving this screen cancels an unapplied preview. Custom font choices use bundled fonts or system fallbacks.</p>`;
    this.root.querySelector('details').open = open;
    for (const [id, label, note] of [['monochrome', PRESET_NAMES.monochrome, 'Quiet neutrals. Clear contrast.'], ['electric', PRESET_NAMES.electric, 'Indigo structure. Ember energy.'], ['dark', PRESET_NAMES.dark, 'A quieter room after dark.']]) {
      const preset = PRESETS[id], c = preset.colors, button = document.createElement('button');
      button.type = 'button'; button.className = 'preset'; button.dataset.preset = id;
      button.setAttribute('aria-label', `${label} preset`);
      button.innerHTML = `<span class="preset-art"><span class="preset-chrome" style="background:${c.chrome};color:${c.chromeText}"><i></i><i></i><i></i></span><span class="preset-paper" style="background:${c.background};color:${c.text}"><b>${id === 'electric' ? 'Create something.' : 'Space to think.'}</b><i></i><i style="width:42%;background:${c.accent};opacity:1"></i></span></span><span class="preset-label">${label}<small>${note}</small><span class="preset-badge"></span></span>`;
      this.root.querySelector('.theme-presets').append(button);
    }
    for (const item of this.state.customs) {
      const option = document.createElement('option'); option.value = item.id; option.textContent = item.name;
      this.root.querySelector('[data-saved]').append(option);
    }
    for (const [key, name] of Object.entries(COLORS)) {
      const label = document.createElement('label'); label.textContent = name;
      const pair = document.createElement('span'); pair.className = 'color-pair';
      const picker = document.createElement('input'); picker.type = 'color'; picker.dataset.color = key; picker.setAttribute('aria-label', `${name} color`);
      const hex = document.createElement('input'); hex.type = 'text'; hex.dataset.hex = key; hex.maxLength = 7; hex.setAttribute('aria-label', `${name} hex`); hex.spellcheck = false;
      pair.append(picker, hex); label.append(pair); this.root.querySelector('.colors').append(label);
    }
    for (const [key, text] of [['body', 'Interface & body'], ['heading', 'Headings'], ['mono', 'Code & technical text']]) {
      const label = document.createElement('label'); label.textContent = text;
      const select = document.createElement('select'); select.dataset.font = key; select.setAttribute('aria-label', `${text} font`);
      for (const [id, font] of Object.entries(FONTS)) {
        const option = document.createElement('option'); option.value = id; option.textContent = font.label; option.style.fontFamily = font.css; select.append(option);
      }
      label.append(select); this.root.querySelector('.fonts').append(label);
    }
    this.sync();
    // Replace delegated listeners when rendering saved-state updates.
    this.abort.abort(); this.abort = new AbortController();
    this.root.addEventListener('click', event => this.click(event), { signal: this.abort.signal });
    this.root.addEventListener('input', event => this.input(event), { signal: this.abort.signal });
    this.root.addEventListener('change', event => this.change(event), { signal: this.abort.signal });
  }
  restoreDraft() {
    this.draft = clone(this.state.applied); this.draftRef = this.state.appliedRef;
    this.selectedId = this.draftRef?.startsWith('custom:') ? this.draftRef.slice(7) : '';
  }
  sync() {
    const theme = this.draft || PRESETS.monochrome;
    for (const input of this.root.querySelectorAll('[data-color],[data-hex]')) {
      input.value = theme.colors[input.dataset.color || input.dataset.hex]; input.disabled = !this.draft; input.setCustomValidity('');
    }
    for (const select of this.root.querySelectorAll('[data-font]')) { select.value = theme.fonts[select.dataset.font]; select.disabled = !this.draft; }
    this.root.querySelector('[data-size]').value = theme.fontSize;
    this.root.querySelector('[data-size]').disabled = !this.draft;
    this.root.querySelector('[data-save]').disabled = !this.draft || this.state.customs.length >= MAX_CUSTOMS;
    this.root.querySelector('.saved-count').textContent = `Saved themes: ${this.state.customs.length}/${MAX_CUSTOMS}`;
    this.root.querySelector('.save-limit').textContent = this.state.customs.length >= MAX_CUSTOMS ? 'Five custom themes can be saved. Delete one to make room; existing themes remain available.' : '';
    this.root.querySelector('[data-saved]').value = this.selectedId || '';
    for (const action of ['rename','delete']) this.root.querySelector(`[data-${action}]`).disabled = !this.state.customs.some(x => x.id === this.selectedId);
    this.root.querySelector('[data-reset]').disabled = !this.draft;
    this.updateStatus();
  }
  updateStatus(message) {
    this.dirty = !sameTheme(this.draft, this.state.applied) || this.draftRef !== this.state.appliedRef;
    const appliedName = themeName(this.state.applied, this.state.appliedRef, this.state.customs);
    this.root.querySelector('.applied-theme').textContent = `Applied theme: ${appliedName}`;
    for (const button of this.root.querySelectorAll('[data-preset]')) {
      const ref = `preset:${button.dataset.preset}`;
      button.setAttribute('aria-pressed', String(this.draftRef === ref));
      button.querySelector('.preset-badge').textContent = this.state.appliedRef === ref ? 'Applied' : this.draftRef === ref && this.dirty ? 'Preview' : '';
    }
    this.root.querySelector('.theme-status').textContent = message || (this.dirty ? `Previewing: ${themeName(this.draft, this.draftRef, this.state.customs)} — not applied` : 'Applied');
    const warnings = contrastWarnings(this.draft);
    this.root.querySelector('.contrast').textContent = warnings.length ? `Contrast check: ${warnings.join(' · ')}` : '';
  }
  preview() {
    this.updateStatus(); clearTimeout(this.timer);
    const draft = clone(this.draft);
    this.timer = setTimeout(() => {
      invoke('preview', draft).catch(error => this.error(error));
    }, 80);
  }
  error(error) { if (this.mounted) this.root.querySelector('.theme-error').textContent = error.message; }
  async operation(fn, preserveDraft = false) {
    if (this.busy) return;
    clearTimeout(this.timer); this.busy = true;
    this.root.querySelector('.theme-error').textContent = '';
    for (const control of this.root.querySelectorAll('input,select,button')) control.disabled = true;
    try {
      if (preserveDraft) await invoke('preview', this.draft);
      const state = await fn();
      if (!this.mounted) return;
      this.state = state;
      if (!preserveDraft) this.restoreDraft();
      else {
        if (!state.customs.some(x => x.id === this.selectedId)) this.selectedId = '';
        if (this.draftRef?.startsWith('custom:') && !state.customs.some(x => `custom:${x.id}` === this.draftRef)) this.draftRef = null;
      }
      this.render();
    } catch (error) { this.error(error); }
    finally {
      this.busy = false;
      if (this.mounted) {
        for (const control of this.root.querySelectorAll('input,select,button')) control.disabled = false;
        this.sync();
      }
    }
  }
  click(event) {
    const button = event.target.closest('button'); if (!button || this.busy) return;
    if (button.hasAttribute('data-apply') || button.hasAttribute('data-save')) {
      for (const field of this.root.querySelectorAll('input')) if (!field.reportValidity()) return;
    }
    if (button.dataset.preset) { this.draft = clone(PRESETS[button.dataset.preset]); this.draftRef = `preset:${button.dataset.preset}`; this.selectedId = ''; this.closeManager(); this.sync(); this.preview(); }
    else if (button.hasAttribute('data-original')) { this.draft = null; this.draftRef = null; this.selectedId = ''; this.closeManager(); this.sync(); this.preview(); }
    else if (button.hasAttribute('data-reset') && this.draft) { this.draftRef = `preset:${this.draft.base}`; this.draft = clone(PRESETS[this.draft.base]); this.selectedId = ''; this.closeManager(); this.sync(); this.preview(); }
    else if (button.hasAttribute('data-apply')) this.operation(() => invoke('apply', this.draft, this.draftRef));
    else if (button.hasAttribute('data-cancel')) this.operation(() => invoke('cancel'));
    else if (button.hasAttribute('data-rename')) this.openManager('rename');
    else if (button.hasAttribute('data-delete')) this.openManager('delete');
    else if (button.hasAttribute('data-manage-cancel')) this.closeManager();
    else if (button.hasAttribute('data-rename-save')) {
      const name = this.root.querySelector('[data-rename-name]').value;
      this.operation(() => invoke('rename-custom', this.selectedId, name), true);
    }
    else if (button.hasAttribute('data-delete-confirm')) this.operation(() => invoke('delete-custom', this.selectedId), true);
    else if (button.hasAttribute('data-save')) {
      const name = this.root.querySelector('[data-name]').value;
      this.operation(() => invoke('save-custom', name, this.draft));
    }
  }
  closeManager() {
    const box = this.root.querySelector('.manage-theme'); box.hidden = true; box.replaceChildren();
  }
  openManager(mode) {
    const item = this.state.customs.find(x => x.id === this.selectedId); if (!item) return;
    const box = this.root.querySelector('.manage-theme'); box.replaceChildren(); box.hidden = false;
    const label = document.createElement('label');
    label.textContent = mode === 'rename' ? 'Rename custom theme' : `Delete “${item.name}”? The applied appearance will be kept.`;
    if (mode === 'rename') {
      const input = document.createElement('input'); input.type = 'text'; input.maxLength = 60; input.value = item.name;
      input.dataset.renameName = ''; label.append(input);
    }
    const confirm = document.createElement('button'); confirm.type = 'button';
    confirm.textContent = mode === 'rename' ? 'Save name' : 'Delete theme';
    confirm.dataset[mode === 'rename' ? 'renameSave' : 'deleteConfirm'] = '';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.dataset.manageCancel = '';
    box.append(label, confirm, cancel); (box.querySelector('input') || cancel).focus();
  }
  input(event) {
    if (!this.draft || this.busy) return;
    const target = event.target, key = target.dataset.color || target.dataset.hex;
    if (key) {
      if (!/^#[a-f\d]{6}$/i.test(target.value)) { target.setCustomValidity('Use six hex digits, for example #202020.'); return; }
      target.setCustomValidity(''); this.draftRef = null; this.draft.colors[key] = target.value.toLowerCase();
      this.root.querySelector(`[data-color="${key}"]`).value = target.value;
      this.root.querySelector(`[data-hex="${key}"]`).value = target.value;
      this.root.querySelector(`[data-hex="${key}"]`).setCustomValidity('');
      this.preview();
    }
  }
  change(event) {
    if (this.busy) return;
    const target = event.target;
    if (target.hasAttribute('data-saved')) {
      const saved = this.state.customs.find(x => x.id === target.value);
      if (saved) { this.draft = clone(saved.theme); this.draftRef = `custom:${saved.id}`; this.selectedId = saved.id; this.closeManager(); this.sync(); this.preview(); }
      else { this.selectedId = ''; this.closeManager(); this.sync(); }
    } else if (this.draft && target.dataset.font) {
      this.draftRef = null; this.draft.fonts[target.dataset.font] = target.value; this.preview();
    } else if (this.draft && target.hasAttribute('data-size')) {
      const size = Number(target.value);
      if (!Number.isInteger(size) || size < 12 || size > 20) { target.value = this.draft.fontSize; return; }
      this.draftRef = null; this.draft.fontSize = size; this.preview();
    }
  }
  async unmount() {
    this.mounted = false; clearTimeout(this.timer); this.abort?.abort();
    // Cancel even if the final preview IPC is still in flight; backend queues it.
    try { await invoke('cancel'); } catch { /* Plugin may have been deactivated. */ }
    this.root?.remove();
  }
  getTopBarConfig() { return { title: 'Themes', actions: [], global: { projectSelector: false, environmentIndicator: false } }; }
}
