const slashCommandMenuId = 'slashCommandMenu';

function setSlashCommandAccessibility(input, activeDescendant) {
  input.setAttribute('aria-controls', slashCommandMenuId);
  input.setAttribute('aria-expanded', 'true');
  if (activeDescendant) {
    input.setAttribute('aria-activedescendant', activeDescendant);
  } else {
    input.removeAttribute('aria-activedescendant');
  }
}

function clearSlashCommandAccessibility(input) {
  input.removeAttribute('aria-controls');
  input.removeAttribute('aria-expanded');
  input.removeAttribute('aria-activedescendant');
}

function getSlashCommandMenuLayout(panel, cursor, menu, viewportHeight) {
  const maxWidth = Math.max(panel.width - 16, 1);
  const menuWidth = Math.min(menu.width, maxWidth);
  const minLeft = panel.left + 8;
  const maxLeft = Math.max(minLeft, panel.right - menuWidth - 8);
  const left = Math.min(Math.max(cursor.left, minLeft), maxLeft);
  const below = cursor.bottom + menu.height + 8 <= Math.min(panel.bottom, viewportHeight);
  const top = below
    ? cursor.bottom + 4
    : Math.max(panel.top + 8, cursor.top - menu.height - 4);

  return { maxWidth, left, top };
}

module.exports = {
  clearSlashCommandAccessibility,
  getSlashCommandMenuLayout,
  setSlashCommandAccessibility
};
