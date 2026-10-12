export function configureTerminal(input, form, clear, print) {
  const history = [];
  let position = 0;
  let draft = '';
  form.addEventListener('submit', () => {
    const command = input.value.trim();
    if (command && history.at(-1) !== command) history.push(command);
    if (history.length > 100) history.shift();
    position = history.length;
    draft = '';
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      if (position === history.length) draft = input.value;
      position = Math.max(0, Math.min(history.length, position + (event.key === 'ArrowUp' ? -1 : 1)));
      input.value = history[position] ?? draft;
      input.setSelectionRange(input.value.length, input.value.length);
    } else if (event.ctrlKey && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      clear();
    } else if (event.ctrlKey && event.key.toLowerCase() === 'u') {
      event.preventDefault();
      input.value = input.value.slice(input.selectionStart);
      input.setSelectionRange(0, 0);
    } else if (event.ctrlKey && event.key.toLowerCase() === 'c' && !getSelection()?.toString() && form.querySelector('span').textContent === 'wasmbolt %') {
      event.preventDefault();
      print(`wasmbolt % ${input.value}^C`);
      input.value = '';
    }
  });
}
