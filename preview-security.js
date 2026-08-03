const createDOMPurify = require('dompurify');

function createPreviewSanitizer(window) {
  const domPurify = createDOMPurify(window);
  domPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName !== 'style') return;
    if (!node.closest?.('.katex')) data.keepAttr = false;
  });
  return html => domPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form']
  });
}

module.exports = { createPreviewSanitizer };
