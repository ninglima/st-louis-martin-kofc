import Image from 'next/image';

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

const EMBLEM_SRC_LIGHT = '/images/brand/kofc_r_hz_rgb_pos.png';
const EMBLEM_SRC_DARK = '/images/brand/kofc_r_hz_rgb_rev.png';
const EMBLEM_ALT = 'Knights of Columbus';

/**
 * The council publishes no photograph of the Grand Knight, so the emblem
 * carries the identity block on its own. The positive mark is drawn in dark
 * ink and the reversed mark in white, so each theme gets the variant that
 * actually reads against its background.
 */
function CouncilEmblem() {
  const shared = 'h-auto w-full max-w-[18rem]';

  return (
    <>
      <Image
        priority
        src={EMBLEM_SRC_LIGHT}
        alt={EMBLEM_ALT}
        width={1160}
        height={540}
        className={`${shared} dark:hidden`}
      />

      <Image
        src={EMBLEM_SRC_DARK}
        alt={EMBLEM_ALT}
        width={1160}
        height={540}
        className={`${shared} hidden dark:block`}
      />
    </>
  );
}

export function HomeGkWelcome() {
  return (
    <section className="border-b py-12 lg:py-16">
      <div className="container grid items-start gap-10 lg:grid-cols-[20rem_minmax(0,1fr)] lg:gap-16">
        <div className="flex flex-col items-center gap-6 text-center lg:items-start lg:text-left">
          <CouncilEmblem />

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

        <div className="flex flex-col">
          <h2 className="text-foreground mb-4 text-2xl font-semibold tracking-tight">
            A Message from Our Grand Knight
          </h2>

          {GK_MESSAGE.map((paragraph) => (
            <p key={paragraph} className="text-muted-foreground mb-4 leading-7">
              {paragraph}
            </p>
          ))}

          <p className="text-foreground font-semibold">{GK_SIGNATURE}</p>
        </div>
      </div>
    </section>
  );
}
