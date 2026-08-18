/**
 * Turns raw SVG text into a data URI safe to hand to an `<img src>`. An
 * `<img>` never executes a `<script>` embedded in an SVG the way an inline
 * `<svg>`/`dangerouslySetInnerHTML` render can — this is why every diagram
 * in this workspace (plan 7.12 step 4-5) goes through an `<img>`, never
 * inline markup, even though the illustrator pool is trusted.
 *
 * `encodeURIComponent` rather than `btoa`: `btoa` only handles Latin-1 and
 * throws on a non-Latin-1 character (e.g. a µ in an alt text or a label
 * inside the SVG), which a base64 data URI would otherwise need a
 * UTF-8-safe wrapper for anyway.
 */
export function svgToImageSrc(svgMarkup: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svgMarkup)}`;
}
