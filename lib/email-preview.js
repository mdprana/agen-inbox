import sanitizeHtml from 'sanitize-html';
export const PREVIEW_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export function emailPreview(html) {
  if (!html) return '';
  const content = sanitizeHtml(html, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'style', 'font', 'center'],
    // No resource/navigation attributes; links preserve typography but cannot navigate.
    allowedAttributes: {'*':['style','class','align','valign','width','height','bgcolor','color','face','size','colspan','rowspan','cellpadding','cellspacing','border','dir','lang']},
    allowVulnerableTags: true, // Style retained inside opaque sandbox, with all external fetches denied by CSP.
    allowedSchemes: [],
    textFilter: text => text.replace(/https?:\/\/[^\s<>"']+/gi, '[Tautan — buka melalui panel LinkUMKM]'),
    disallowedTagsMode: 'discard',
    nonTextTags: ['script','textarea','option','noscript','iframe','object','embed','template'],
  });
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><meta name="referrer" content="no-referrer"><style>body{margin:12px;font-family:Arial,sans-serif;overflow-wrap:anywhere}a{cursor:default}*{animation:none!important;transition:none!important}</style></head><body>${content}</body></html>`;
}
