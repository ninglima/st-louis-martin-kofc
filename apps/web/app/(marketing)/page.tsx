import { HomeGkWelcome } from '~/(marketing)/_components/home-gk-welcome';
import { HomeInsuranceResources } from '~/(marketing)/_components/home-insurance-resources';
import { HomeMemberJoinSplit } from '~/(marketing)/_components/home-member-join-split';
import { HomeStatsBar } from '~/(marketing)/_components/home-stats-bar';
import appConfig from '~/config/app.config';
import { createPageMetadata } from '~/lib/page-metadata';

/**
 * The only marketing route that had no `metadata` export at all, so it
 * inherited the root layout's description verbatim -- which is how all 24
 * routes came to share one Open Graph card. The title stays the site title:
 * the homepage is the one route for which that is the right `<title>`.
 */
export const metadata = createPageMetadata({
  title: appConfig.title,
  description:
    'Saint Louis Martin Council 15256 of the Knights of Columbus at St. Theresa Catholic Church in Ashburn, Virginia. Over 350 Brother Knights united by charity, unity, fraternity and patriotism.',
  path: '/',
});

/**
 * The council homepage. Section order follows the live `front-page.php`. The
 * marketing layout drops children straight into a flex column with no
 * container, so each section supplies its own full-bleed background and inner
 * container rather than inheriting one here.
 *
 * The News, Newsletter and Current Initiatives rows of the WordPress original
 * are deliberately omitted: all three render empty placeholder text today and
 * the site copy spec drops them.
 */
function Home() {
  return (
    <div className="flex flex-col">
      <HomeGkWelcome />
      <HomeMemberJoinSplit />
      <HomeStatsBar />
      <HomeInsuranceResources />
    </div>
  );
}

export default Home;
