import { HomeGkWelcome } from '~/(marketing)/_components/home-gk-welcome';
import { HomeInsuranceResources } from '~/(marketing)/_components/home-insurance-resources';
import { HomeMemberJoinSplit } from '~/(marketing)/_components/home-member-join-split';
import { HomeStatsBar } from '~/(marketing)/_components/home-stats-bar';

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
