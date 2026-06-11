import { h } from './components';

export function renderLogin(
  app: HTMLElement,
  opts: { error: string; onSubmit: (name: string) => void },
): void {
  // Don't rebuild while the user is typing — state broadcasts keep arriving.
  if (app.dataset.screen === 'login') {
    app.querySelector('.form-error')!.textContent = opts.error;
    return;
  }
  app.dataset.screen = 'login';
  app.replaceChildren();

  const input = h('input', {
    class: 'input',
    type: 'text',
    maxlength: '16',
    placeholder: 'Your name',
    autocomplete: 'off',
    enterkeyhint: 'go',
  }) as HTMLInputElement;

  const error = h('p', { class: 'form-error' }, opts.error);
  const form = h(
    'form',
    { class: 'login-form' },
    input,
    h('button', { class: 'btn', type: 'submit' }, 'Join the lobby'),
    error,
  );
  form.onsubmit = (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (name) opts.onSubmit(name);
  };

  app.append(
    h('div', { class: 'login-hero' }, h('div', { class: 'logo' }, '🌋'), h('h1', {}, 'Death Hike')),
    h('p', { class: 'muted center' }, 'Guide the figure across the hidden lava field — together.'),
    form,
  );
  input.focus();
}
