import { PRESET_COUNT } from '@/lib/upload/urls';

/**
 * Generated portraits, drawn as printer's marks.
 *
 * ## Why these shapes
 *
 * A stock avatar is a picture of a person nobody has. The alternative most apps
 * reach for — a coloured disc with initials — is wrong here for a reason the
 * design system already states: `--radius: 0`, and a soft disc "reads as an
 * import from a different application". So these are the marks that actually
 * appear on a press sheet: registration targets, colour bars, overprint
 * squares, halftone fields, quoins, slugs. Things that belong on the furniture
 * around a printed page rather than in a social profile.
 *
 * ## Why they are not coloured pictures
 *
 * Every fill is a palette ROLE — `--border` is the ink, `--primary` the first
 * ink, `--accent-alt` the second, `--overprint` where the two lie over each
 * other. Nothing here names a colour. That is not decoration: it means a mark
 * chosen under Newsprint is the same mark re-inked under Neon, exactly as the
 * rest of the design behaves, and it holds automatically for palettes that do
 * not exist yet.
 *
 * These live in a .tsx file rather than in press.css because press.css forbids
 * colour literals AND is parsed by `verify:structure`; SVG geometry is not CSS
 * and belongs with the component that draws it.
 *
 * ## No directive
 *
 * Deliberately not `'use client'`. It is a pure function of its props with no
 * state, no effect and no browser API, and it is rendered from the app shell —
 * a Server Component. Marking it would make its export a client reference and
 * reproduce the crash that took production down.
 */

/** Ink roles, in the order the marks reach for them. */
const INK = 'var(--border)';
const FIRST = 'var(--primary)';
const SECOND = 'var(--accent-alt, var(--primary))';
const OVER = 'var(--overprint, var(--border))';
const PAPER = 'var(--background)';

/**
 * Eight marks, indexed. The index comes from a hash of the user id, so a person
 * keeps the same one forever without anything being stored.
 *
 * Drawn on a 0–32 grid so the geometry is legible at 22px, which is the size
 * the masthead and tab rail actually use.
 */
function markPaths(index: number) {
  switch (index) {
    // ── 0 · Overprint. Two squares and the denser patch where they meet. ──
    case 0:
      return (
        <>
          <rect x={5} y={5} width={15} height={15} fill={FIRST} />
          <rect x={12} y={12} width={15} height={15} fill={SECOND} />
          <rect x={12} y={12} width={8} height={8} fill={OVER} />
        </>
      );

    // ── 1 · Registration. The target a pressman lines the plates up on. ──
    case 1:
      return (
        <>
          <rect x={15} y={2} width={2} height={28} fill={INK} />
          <rect x={2} y={15} width={28} height={2} fill={INK} />
          <rect x={8} y={8} width={16} height={16} fill="none" stroke={FIRST} strokeWidth={2} />
          <rect x={14} y={14} width={4} height={4} fill={SECOND} />
        </>
      );

    // ── 2 · Colour bar. The strip of solids printed off the trim edge. ──
    case 2:
      return (
        <>
          <rect x={4} y={4} width={24} height={5} fill={FIRST} />
          <rect x={4} y={11} width={24} height={5} fill={SECOND} />
          <rect x={4} y={18} width={24} height={5} fill={OVER} />
          <rect x={4} y={25} width={24} height={3} fill={INK} />
        </>
      );

    // ── 3 · Halftone. A field of dots, growing across the tint ramp. ──
    case 3:
      return (
        <>
          {[0, 1, 2, 3].map((row) =>
            [0, 1, 2, 3].map((col) => (
              <rect
                key={`${row}-${col}`}
                x={5 + col * 7}
                y={5 + row * 7}
                width={1.5 + (row + col) * 0.7}
                height={1.5 + (row + col) * 0.7}
                fill={row + col > 3 ? FIRST : INK}
              />
            )),
          )}
        </>
      );

    // ── 4 · Quoin. The wedge that locks a forme into the chase. ──
    case 4:
      return (
        <>
          <rect x={4} y={4} width={24} height={24} fill="none" stroke={INK} strokeWidth={2} />
          <path d="M4 28 L28 4 L28 16 L16 28 Z" fill={FIRST} />
          <rect x={4} y={4} width={7} height={7} fill={SECOND} />
        </>
      );

    // ── 5 · Slug. Cast rules, set solid, with one line leaded apart. ──
    case 5:
      return (
        <>
          <rect x={4} y={5} width={24} height={3} fill={INK} />
          <rect x={4} y={11} width={17} height={3} fill={FIRST} />
          <rect x={4} y={17} width={24} height={3} fill={INK} />
          <rect x={4} y={23} width={10} height={3} fill={SECOND} />
        </>
      );

    // ── 6 · Crop marks. The corners that say where the page is cut. ──
    case 6:
      return (
        <>
          {[
            [4, 4, 1, 1],
            [28, 4, -1, 1],
            [4, 28, 1, -1],
            [28, 28, -1, -1],
          ].map(([x, y, dx, dy], i) => (
            <g key={i} fill={i % 2 === 0 ? INK : FIRST}>
              <rect x={dx > 0 ? x : x - 9} y={y - 1} width={9} height={2} />
              <rect x={x - 1} y={dy > 0 ? y : y - 9} width={2} height={9} />
            </g>
          ))}
          <rect x={13} y={13} width={6} height={6} fill={SECOND} />
        </>
      );

    // ── 7 · Chase. Nested formes, locked one inside the next. ──
    case 7:
      return (
        <>
          <rect x={3} y={3} width={26} height={26} fill="none" stroke={INK} strokeWidth={2} />
          <rect x={8} y={8} width={16} height={16} fill="none" stroke={FIRST} strokeWidth={2} />
          <rect x={13} y={13} width={6} height={6} fill={SECOND} />
        </>
      );

    default:
      return <rect x={8} y={8} width={16} height={16} fill={FIRST} />;
  }
}

export function PressMark({
  index,
  size = 22,
  title,
}: {
  index: number;
  size?: number;
  /** Omitted for decorative use; the frame that holds it carries the label. */
  title?: string;
}) {
  const safe = ((index % PRESET_COUNT) + PRESET_COUNT) % PRESET_COUNT;

  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      /*
       * Which mark this is, readable from outside.
       *
       * Without it a test can only assert "some SVG rendered", which would pass
       * just as happily if every reader got mark 0 — and "everyone is
       * distinctive in the same way" is precisely the bug this feature could
       * ship with. Cheap, and it makes the assertion exact.
       */
      data-mark={safe}
      // shapeRendering keeps 2px rules crisp at 22px. Anti-aliased hairlines
      // are precisely the "rendering artefact" look the design forbids.
      shapeRendering="crispEdges"
      style={{ display: 'block' }}
    >
      <rect x={0} y={0} width={32} height={32} fill={PAPER} />
      {markPaths(safe)}
    </svg>
  );
}

/** Human-readable names, for the gallery's labels and for a screen reader. */
export const PRESET_NAMES = [
  'Overprint',
  'Registration',
  'Colour bar',
  'Halftone',
  'Quoin',
  'Slug',
  'Crop marks',
  'Chase',
] as const;
