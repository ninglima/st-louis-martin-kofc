import { getTranslations } from 'next-intl/server';

import { SitePageHeader } from '~/(marketing)/_components/site-page-header';

export const generateMetadata = async () => {
  const t = await getTranslations();

  return {
    title: t('marketing.faq'),
  };
};

const H3_CLASS = 'text-foreground mt-8 mb-3 text-xl font-semibold';
const P_CLASS = 'text-muted-foreground mb-4 leading-7';
const UL_CLASS = 'text-muted-foreground mb-4 list-disc space-y-2 pl-6';
const LI_CLASS = 'leading-7';
const STRONG_CLASS = 'text-foreground font-semibold';
const A_CLASS = 'text-primary font-medium underline underline-offset-4';

interface FaqItem {
  question: string;
  answerText: string;
  body: React.ReactNode;
}

const faqItems: FaqItem[] = [
  {
    question: '1. Who Are the Knights of Columbus and What Do They Do?',
    answerText:
      'Founded in 1882, the Knights of Columbus comprises nearly 2 million Catholic men and their families organized into 15,900+ councils globally. The organization focuses on Community, Family, Youth, Church, and Council programs. Members donated more than $185 million to charities and volunteered more than 75 million hours in a single recent year. Core principles include charity, unity, fraternity, and patriotism.',
    body: (
      <p className={P_CLASS}>
        Founded in 1882, the Knights of Columbus comprises nearly 2 million
        Catholic men and their families organized into 15,900+ councils
        globally. The organization focuses on Community, Family, Youth,
        Church, and Council programs. Members donated more than $185 million
        to charities and volunteered more than 75 million hours in a single
        recent year. Core principles include charity, unity, fraternity, and
        patriotism.
      </p>
    ),
  },
  {
    question: '2. How Do I Become a Knight?',
    answerText:
      'Eligibility requires being a practicing Catholic man age 18 or older. Visit kofc.org, click "Join," and designate Council #15256 at St. Theresa’s parish. Your application is approved at a monthly business meeting, after which you attend a degree exemplification ceremony to complete membership. Contact kofc15256@googlegroups.com with questions.',
    body: (
      <p className={P_CLASS}>
        Eligibility requires being a practicing Catholic man age 18 or older.
        Visit{' '}
        <a
          href="https://www.kofc.org/en/join/"
          className={A_CLASS}
          target="_blank"
          rel="noopener noreferrer"
        >
          kofc.org
        </a>
        , click “Join,” and designate Council #15256 at St. Theresa’s parish.
        Your application is approved at a monthly business meeting, after
        which you attend a degree exemplification ceremony to complete
        membership. Contact{' '}
        <a href="mailto:kofc15256@googlegroups.com" className={A_CLASS}>
          kofc15256@googlegroups.com
        </a>{' '}
        with questions.
      </p>
    ),
  },
  {
    question: '3. What Are Degrees and Why Are They Important?',
    answerText:
      'As of 2020, the first three degrees are combined into one ceremony — the Exemplification of Charity, Unity and Fraternity — open to the whole family. The Fourth Degree focuses on patriotism and is required before a Knight can join an Assembly or participate in the Color Corps.',
    body: (
      <p className={P_CLASS}>
        As of 2020, the first three degrees are combined into one ceremony —
        the <em>Exemplification of Charity, Unity and Fraternity</em> — open
        to the whole family. The Fourth Degree focuses on patriotism and is
        required before a Knight can join an Assembly or participate in the
        Color Corps.
      </p>
    ),
  },
  {
    question: '4. Who Are the Leaders?',
    answerText:
      'Local Council: Grand Knight Steve Shields. District: District Deputy Jay Hallam (District 18). State: State Deputy Brian Ripple (Virginia). Supreme: Supreme Knight Patrick E. Kelly.',
    body: (
      <ul className={UL_CLASS}>
        <li className={LI_CLASS}>
          <strong className={STRONG_CLASS}>Local Council:</strong> Grand
          Knight Steve Shields
        </li>
        <li className={LI_CLASS}>
          <strong className={STRONG_CLASS}>District:</strong> District
          Deputy Jay Hallam (District 18)
        </li>
        <li className={LI_CLASS}>
          <strong className={STRONG_CLASS}>State:</strong> State Deputy
          Brian Ripple (Virginia)
        </li>
        <li className={LI_CLASS}>
          <strong className={STRONG_CLASS}>Supreme:</strong> Supreme Knight
          Patrick E. Kelly
        </li>
      </ul>
    ),
  },
  {
    question: '5. Emblems and Colors',
    answerText:
      'The Third Degree emblem features a knight’s shield mounted on a formée Cross. The Fourth Degree emblem displays the Dove, the Cross, and the Globe.',
    body: (
      <p className={P_CLASS}>
        The Third Degree emblem features a knight’s shield mounted on a
        formée Cross. The Fourth Degree emblem displays the Dove, the Cross,
        and the Globe.
      </p>
    ),
  },
  {
    question: '6. Founding History',
    answerText:
      'Founded in 1882 by Blessed Michael J. McGivney at St. Mary’s Church in New Haven, Connecticut, where Supreme headquarters remains today. Father McGivney was beatified on October 31, 2020.',
    body: (
      <p className={P_CLASS}>
        Founded in 1882 by Blessed Michael J. McGivney at St. Mary’s Church
        in New Haven, Connecticut, where Supreme headquarters remains today.
        Father McGivney was beatified on October 31, 2020.
      </p>
    ),
  },
  {
    question: '7. Activity Requirements After Joining',
    answerText:
      'There are no set requirements for participation. Members choose the projects they join and volunteer only the time they have available, balancing membership with family obligations.',
    body: (
      <p className={P_CLASS}>
        There are no set requirements for participation. Members choose the
        projects they join and volunteer only the time they have available,
        balancing membership with family obligations.
      </p>
    ),
  },
  {
    question: '8. Dues Structure',
    answerText:
      'Annual dues are $58, supporting council communication and administration costs. The council can waive dues for any brother or potential brother in financial need.',
    body: (
      <p className={P_CLASS}>
        Annual dues are $58, supporting council communication and
        administration costs. The council can waive dues for any brother or
        potential brother in financial need.
      </p>
    ),
  },
  {
    question: '9. Fraternal Benefits',
    answerText:
      'Approximately one-third of Knights purchase life insurance, annuities, or long-term care coverage through the organization. The Knights of Columbus maintains the highest ratings from A.M. Best (A++ Superior) and Standard & Poor’s (AAA Extremely Strong). Additional benefits include scholarships and orphan benefits.',
    body: (
      <p className={P_CLASS}>
        Approximately one-third of Knights purchase life insurance,
        annuities, or long-term care coverage through the organization. The
        Knights of Columbus maintains the highest ratings from A.M. Best
        (A++ Superior) and Standard & Poor’s (AAA Extremely Strong).
        Additional benefits include scholarships and orphan benefits.
      </p>
    ),
  },
  {
    question: '10. Why Join If I Already Belong to Other Organizations?',
    answerText:
      'The Knights provide community networking, parish support, and faith growth unique to a Catholic fraternal organization. The council emphasizes being involved in your community while supporting your local Catholic Church.',
    body: (
      <p className={P_CLASS}>
        The Knights provide community networking, parish support, and faith
        growth unique to a Catholic fraternal organization. The council
        emphasizes being involved in your community while supporting your
        local Catholic Church.
      </p>
    ),
  },
  {
    question: '11. Is the Knights of Columbus a Secret Organization?',
    answerText:
      'No. The principles and objectives of the Knights of Columbus are published and well known. While council meetings are members-only (standard for private organizations), all exemplification ceremonies have been open since 2020, with families encouraged to attend.',
    body: (
      <p className={P_CLASS}>
        No. The principles and objectives of the Knights of Columbus are
        published and well known. While council meetings are members-only
        (standard for private organizations), all exemplification ceremonies
        have been open since 2020, with families encouraged to attend.
      </p>
    ),
  },
  {
    question: '12. The Knights’ Respect Life Program',
    answerText:
      'The Knights champion pro-life causes from conception to natural death. Signature programs include participation in the March for Life, support for pregnancy centers, ultrasound initiatives, and Christian refugee relief efforts.',
    body: (
      <p className={P_CLASS}>
        The Knights champion pro-life causes from conception to natural
        death. Signature programs include participation in the March for
        Life, support for pregnancy centers, ultrasound initiatives, and
        Christian refugee relief efforts.
      </p>
    ),
  },
  {
    question: '13. Uniform and Beret Requirements',
    answerText:
      'Uniforms and berets are optional and apply only to Fourth Degree members. Initial membership requires no regalia, and Fourth Degree participation involves a separate exemplification ceremony.',
    body: (
      <p className={P_CLASS}>
        Uniforms and berets are optional and apply only to Fourth Degree
        members. Initial membership requires no regalia, and Fourth Degree
        participation involves a separate exemplification ceremony.
      </p>
    ),
  },
  {
    question: '14. A Word from the Bishop',
    answerText:
      "Watch the Bishop’s perspective: https://youtu.be/CdbpuSWP51M",
    body: (
      <p className={P_CLASS}>
        Watch the Bishop’s perspective:{' '}
        <a
          href="https://youtu.be/CdbpuSWP51M"
          className={A_CLASS}
          target="_blank"
          rel="noopener noreferrer"
        >
          https://youtu.be/CdbpuSWP51M
        </a>
      </p>
    ),
  },
];

async function FAQPage() {
  const t = await getTranslations();

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map((item) => {
      return {
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.answerText,
        },
      };
    }),
  };

  return (
    <>
      <script
        key={'ld:json'}
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <div className={'flex flex-col space-y-4 xl:space-y-8'}>
        <SitePageHeader
          title={t('marketing.faq')}
          subtitle={t('marketing.faqSubtitle')}
        />

        <div className={'container flex flex-col space-y-8 pb-16'}>
          <div className="flex w-full max-w-3xl flex-col">
            {faqItems.map((item, index) => {
              return (
                <div key={index}>
                  <h3 className={H3_CLASS}>{item.question}</h3>
                  {item.body}
                </div>
              );
            })}

            <p className={P_CLASS}>
              For any additional questions, contact us at{' '}
              <a href="mailto:kofc15256@googlegroups.com" className={A_CLASS}>
                kofc15256@googlegroups.com
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

export default FAQPage;
