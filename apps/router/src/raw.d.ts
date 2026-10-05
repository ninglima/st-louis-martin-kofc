/** Vite's `?raw` import, used by the tests to read `wrangler.jsonc` as text. */
declare module '*?raw' {
  const content: string;
  export default content;
}
