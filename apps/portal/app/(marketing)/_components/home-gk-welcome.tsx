import { AppLogo } from '~/components/app-logo';

/**
 * The Grand Knight's welcome message.
 *
 * The body is a named person's signed statement, copied verbatim from the
 * council's published message. It lives here as string data rather than inline
 * JSX so the typographic punctuation (curly apostrophes, curly quotes, em
 * dashes) survives editing untouched. Do not paraphrase or re-wrap the prose.
 */
const GK_MESSAGE = [
  'Brothers and friends,',
  'Welcome to the St. Louis Martin Council of the Knights of Columbus, where over 350 Brother Knights are united by the guiding principles of charity, unity, fraternity, and patriotism. Each year, our Council delivers more than 25 tons of food to the local food pantry, raises thousands of dollars for KOVAR to support Virginians with intellectual disabilities, and hosts pancake breakfasts to fund local charities. Whether it’s lending a hand to a neighbor in need, supporting expectant mothers, or raising funds for vital causes, our mission is simple: to serve others as Christ taught us, through humble, faithful action.',
  'We believe that living out our faith doesn’t require grand gestures; rather, it’s the “little way” of consistent, loving service that transforms lives, our own and others. Just an hour or two a month can make a huge impact, and every Brother Knight has something unique to offer, no matter his background or season of life. Answer the call to serve today — walk with us on this path of holiness and service, growing closer to God and building up our community one act of charity at a time.',
  'Vivat Jesus!',
] as const;

const GK_SIGNATURE = '— Steve Shields, Grand Knight';

export function HomeGkWelcome() {
  return (
    <section className="border-b py-12 lg:py-16">
      <div className="container grid items-start gap-10 lg:grid-cols-[20rem_minmax(0,1fr)] lg:gap-16">
        <div className="flex flex-col items-center gap-6 text-center lg:items-start lg:text-left">
          {/*
           * The council publishes no photograph of the Grand Knight, so the
           * mark carries the identity block on its own. This used to be a
           * local `CouncilEmblem` that re-implemented `AppLogo`'s dual-theme
           * rendering over *the same two PNGs*, under `EMBLEM_SRC_*` names
           * that described the square emblem rather than the horizontal
           * lockup these files actually are. One component now, so an
           * improvement to the mark cannot land on 23 routes and miss the
           * busiest one.
           *
           * `href={null}` keeps it unlinked: the `h1` immediately below names
           * the council in text, and `AppLogo` renders `alt=""` on both
           * variants, so a link here would announce the brand twice.
           *
           * `eager` because this mark is the homepage's LCP element and sits
           * above the fold. Doing that was only safe once the mark moved onto
           * `AppLogo`: React 19 emits a `<link rel="preload" as="image">` for
           * every non-lazy `<img>`, which on two theme variants preloads the
           * one that can never paint, at preload priority, against the one
           * that does. `ThemedMark` suppresses that by wrapping each variant
           * in `<picture className="contents">` -- see the comment on it in
           * `components/app-logo.tsx`. Measured on `/`: 0
           * `rel="preload" as="image"` links before this change and 0 after,
           * with the mark going from `loading="lazy"` to `loading="eager"`.
           */}
          <AppLogo
            href={null}
            className="w-full max-w-[18rem]"
            sizes="288px"
            eager
          />

          <h1 className="text-foreground text-3xl font-bold tracking-tight lg:text-4xl">
            <span className="text-muted-foreground block text-base font-medium tracking-normal">
              Knights of Columbus
            </span>
            St. Louis Martin Council (#15256)
            <span className="text-muted-foreground block text-base font-medium tracking-normal">
              Ashburn, Virginia
            </span>
          </h1>
        </div>

        <div className="flex max-w-3xl flex-col">
          <h2 className="text-foreground mb-4 text-2xl font-semibold tracking-tight">
            A Message from Our Grand Knight
          </h2>

          {GK_MESSAGE.map((paragraph, index) => (
            <p key={index} className="text-muted-foreground mb-4 leading-7">
              {paragraph}
            </p>
          ))}

          <p className="text-foreground font-semibold">{GK_SIGNATURE}</p>
        </div>
      </div>
    </section>
  );
}
