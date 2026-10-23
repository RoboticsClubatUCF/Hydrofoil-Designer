import katex from 'katex';
import { useMemo } from 'react';

/** KaTeX render of trusted, app-generated LaTeX (formulas built from our own templates). */
export function Tex({ tex, block = false }: { tex: string; block?: boolean }) {
  const html = useMemo(
    () =>
      katex.renderToString(tex, {
        displayMode: block,
        throwOnError: false,
        strict: 'ignore',
        output: 'html',
      }),
    [tex, block],
  );
  return (
    <span
      className={block ? 'tex-block' : undefined}
      style={block ? { display: 'block' } : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
