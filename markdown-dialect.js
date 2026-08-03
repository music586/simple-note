function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function configureMarkdownDialect({ marked, hljs, katex }) {
  marked.setOptions({
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    },
    breaks: true,
    gfm: true
  });

  marked.use({
    extensions: [{
      name: 'highlight',
      level: 'inline',
      start(source) {
        return source.indexOf('==');
      },
      tokenizer(source) {
        const match = source.match(/^==([^=\n]+)==/);
        if (!match) return undefined;
        return {
          type: 'highlight',
          raw: match[0],
          tokens: this.lexer.inlineTokens(match[1])
        };
      },
      renderer(token) {
        return `<mark>${this.parser.parseInline(token.tokens)}</mark>`;
      }
    }, {
      name: 'inlineMath',
      level: 'inline',
      start(source) {
        return source.indexOf('$');
      },
      tokenizer(source) {
        const match = source.match(/^\$(?!\s|\$)([^$\n]+?)(?<!\s)\$/);
        if (!match) return undefined;
        return { type: 'inlineMath', raw: match[0], source: match[1] };
      },
      renderer(token) {
        try {
          return katex.renderToString(token.source, {
            displayMode: false,
            throwOnError: true,
            strict: 'ignore',
            trust: false
          });
        } catch (error) {
          return `<code class="math-error">${escapeHtml(token.raw)}</code>`;
        }
      }
    }, {
      name: 'blockMath',
      level: 'block',
      start(source) {
        return source.indexOf('$$');
      },
      tokenizer(source) {
        const match = source.match(/^\$\$\s*\n?([\s\S]+?)\n?\$\$(?:\n|$)/);
        if (!match) return undefined;
        return {
          type: 'blockMath',
          raw: match[0],
          source: match[1].replace(/\\\n/g, '\n').trim()
        };
      },
      renderer(token) {
        try {
          return `<div class="preview-math-block">${katex.renderToString(token.source, {
            displayMode: true,
            throwOnError: true,
            strict: 'ignore',
            trust: false
          })}</div>`;
        } catch (error) {
          return `<pre class="math-error">${escapeHtml(token.raw)}</pre>`;
        }
      }
    }, {
      name: 'wikiLink',
      level: 'inline',
      start(source) {
        return source.indexOf('[[');
      },
      tokenizer(source) {
        const match = source.match(/^(!)?\[\[([^\]|#]+)(#[^\]|]+)?(?:\|([^\]]+))?\]\]/);
        if (!match) return undefined;
        return {
          type: 'wikiLink',
          raw: match[0],
          embedded: Boolean(match[1]),
          target: match[2].trim(),
          anchor: match[3] || '',
          label: (match[4] || match[2]).trim()
        };
      },
      renderer(token) {
        const target = token.target.endsWith('.md') ? token.target : `${token.target}.md`;
        const label = token.embedded ? `嵌入 · ${token.label}` : token.label;
        const className = token.embedded ? 'wiki-link wiki-embed' : 'wiki-link';
        return `<a class="${className}" href="${escapeHtml(`${target}${token.anchor}`)}">`
          + `${escapeHtml(label)}</a>`;
      }
    }, {
      name: 'callout',
      level: 'block',
      start(source) {
        return source.search(/^\s*>\s*\[!/m);
      },
      tokenizer(source) {
        const match = source.match(
          /^(\s*>\s*\[!([A-Za-z]+)\]([+-])?\s*(.*?)(?:\\)?\n(?:\s*>.*(?:\n|$))*)/
        );
        if (!match) return undefined;
        const body = match[1].split('\n').slice(1).map(line => {
          return line.replace(/^\s*>\s?/, '').replace(/\\$/, '');
        }).join('\n').trim();
        return {
          type: 'callout',
          raw: match[1],
          calloutType: match[2].toLowerCase(),
          folded: match[3] === '-',
          title: match[4].replace(/\\$/, '').trim(),
          body
        };
      },
      renderer(token) {
        const names = {
          note: '备注', info: '信息', tip: '提示', success: '成功',
          warning: '警告', caution: '注意', faq: '问题'
        };
        const title = token.title || names[token.calloutType] || token.calloutType.toUpperCase();
        const body = token.body && !token.folded
          ? `<div class="callout-body">${marked.parse(token.body)}</div>`
          : '';
        return `<aside class="callout is-${escapeHtml(token.calloutType)}">`
          + `<strong>${escapeHtml(title)}</strong>${body}</aside>`;
      }
    }, {
      name: 'frontMatter',
      level: 'block',
      tokenizer(source) {
        const match = source.match(/^---\s*\n([\s\S]*?\n)---(?:\n|$)/);
        if (!match || !/^[-\w]+\s*:/m.test(match[1])) return undefined;
        return { type: 'frontMatter', raw: match[0], source: match[1].trim() };
      },
      renderer(token) {
        const fields = token.source.split('\n')
          .filter(line => /^[-\w]+\s*:/.test(line.trim()))
          .slice(0, 6)
          .map(line => `<span>${escapeHtml(line)}</span>`)
          .join('');
        return `<section class="preview-frontmatter"><strong>文档属性</strong>${fields}</section>`;
      }
    }]
  });
}

module.exports = { configureMarkdownDialect };
