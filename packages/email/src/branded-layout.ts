import { escapeHtml } from './html';

const LOGO_URL =
  'https://kofc-15256.org/images/brand/kofc_r_hz_rgb_pos.png';
const COUNCIL_NAME =
  'Knights of Columbus St. Louis Martin Council #15256';

export interface BrandedEmailInput {
  title: string;
  /** Already-escaped (or trusted) HTML for paragraphs inside the card. */
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  footerHtml?: string;
  preheader?: string;
}

/**
 * HTML email shell matching the Supabase auth templates under
 * `apps/portal/supabase/templates/`: centered card, K of C logo, council
 * line, bordered body, and a full-width council-blue CTA.
 */
export function renderBrandedEmail(input: BrandedEmailInput): string {
  const title = escapeHtml(input.title);
  const ctaLabel = escapeHtml(input.ctaLabel);
  const ctaUrl = escapeHtml(input.ctaUrl);
  const footer = input.footerHtml ? escapeHtml(input.footerHtml) : '';
  const preheader = input.preheader ? escapeHtml(input.preheader) : '';

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<!doctype html>
<html dir="ltr" lang="en">
  <head>
    <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
    <meta name="x-apple-disable-message-reformatting" />
    <style>
      body {
        background-color: #fff;
        margin: auto;
        font-family: sans-serif;
        color: #484848;
      }
    </style>
  </head>
  <div
    style="
      display: none;
      overflow: hidden;
      line-height: 1px;
      opacity: 0;
      max-height: 0;
      max-width: 0;
    "
  >
    ${preheader}
  </div>
  <body>
    <table
      align="center"
      width="100%"
      border="0"
      cellpadding="0"
      cellspacing="0"
      role="presentation"
      style="
        max-width: 37.5em;
        background-color: #fff;
        margin: auto;
        font-family: sans-serif;
        color: #484848;
      "
    >
      <tbody>
        <tr style="width: 100%">
          <td>
            <table
              align="center"
              width="100%"
              border="0"
              cellpadding="0"
              cellspacing="0"
              role="presentation"
              style="
                max-width: 535px;
                background-color: #fff;
                margin: auto;
                margin-top: 36px;
                margin-bottom: 36px;
                margin-left: auto;
                margin-right: auto;
                padding-left: 1rem;
                padding-right: 1rem;
              "
            >
              <tbody>
                <tr style="width: 100%">
                  <td>
                    <table
                      align="center"
                      width="100%"
                      border="0"
                      cellpadding="0"
                      cellspacing="0"
                      role="presentation"
                      style="max-width: 37.5em; margin-bottom: 24px"
                    >
                      <tbody>
                        <tr style="width: 100%">
                          <td style="text-align: center">
                            <img
                              src="${LOGO_URL}"
                              width="180"
                              alt="Knights of Columbus"
                              style="
                                display: block;
                                margin: 0 auto 12px auto;
                                width: 180px;
                                max-width: 180px;
                                height: auto;
                                border: 0;
                              "
                            />
                            <p
                              style="
                                margin: 0;
                                font-size: 13px;
                                line-height: 20px;
                                color: #003595;
                                font-weight: 600;
                              "
                            >
                              ${COUNCIL_NAME}
                            </p>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    <table
                      align="center"
                      width="100%"
                      border="0"
                      cellpadding="0"
                      cellspacing="0"
                      role="presentation"
                      style="max-width: 37.5em"
                    >
                      <tbody>
                        <tr style="width: 100%">
                          <td>
                            <h1
                              style="
                                margin-left: 0px;
                                margin-right: 0px;
                                padding: 0px;
                                font-family:
                                  ui-sans-serif,
                                  system-ui,
                                  -apple-system,
                                  BlinkMacSystemFont,
                                  'Segoe UI',
                                  Roboto,
                                  'Helvetica Neue',
                                  Arial,
                                  'Noto Sans',
                                  sans-serif;
                                font-size: 20px;
                                font-weight: 400;
                                letter-spacing: -0.025em;
                                color: rgb(0, 0, 0);
                              "
                            >
                              ${title}
                            </h1>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    <table
                      align="center"
                      width="100%"
                      border="0"
                      cellpadding="0"
                      cellspacing="0"
                      role="presentation"
                      style="
                        max-width: 37.5em;
                        border-radius: 0.75rem;
                        margin-top: 8px;
                        margin-bottom: 8px;
                        padding-left: 24px;
                        padding-right: 24px;
                        padding-top: 12px;
                        padding-bottom: 12px;
                        margin-left: auto;
                        margin-right: auto;
                        border-width: 1px;
                        border-style: solid;
                        border-color: rgb(238, 238, 238);
                      "
                    >
                      <tbody>
                        <tr style="width: 100%">
                          <td>
                            ${input.bodyHtml}
                            <table
                              align="center"
                              width="100%"
                              border="0"
                              cellpadding="0"
                              cellspacing="0"
                              role="presentation"
                              style="
                                text-align: center;
                                margin-top: 32px;
                                margin-bottom: 32px;
                              "
                            >
                              <tbody>
                                <tr>
                                  <td>
                                    <a
                                      href="${ctaUrl}"
                                      style="
                                        line-height: 100%;
                                        text-decoration: none;
                                        display: inline-block;
                                        max-width: 100%;
                                        width: 100%;
                                        background-color: #003595;
                                        border-radius: 0.25rem;
                                        color: rgb(255, 255, 255);
                                        font-size: 14px;
                                        font-weight: 600;
                                        text-decoration-line: none;
                                        text-align: center;
                                        padding-top: 0.75rem;
                                        padding-bottom: 0.75rem;
                                        padding: 12px 0px 12px 0px;
                                      "
                                      target="_blank"
                                      >${ctaLabel}</a
                                    >
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                            ${
                              footer
                                ? `<p
                              style="
                                font-size: 12px;
                                line-height: 24px;
                                margin: 16px 0;
                                color: rgb(156, 163, 175);
                              "
                            >
                              ${footer}
                            </p>`
                                : ''
                            }
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    <table
                      align="center"
                      width="100%"
                      border="0"
                      cellpadding="0"
                      cellspacing="0"
                      role="presentation"
                      style="max-width: 37.5em"
                    >
                      <tbody>
                        <tr style="width: 100%">
                          <td>
                            <p
                              style="
                                font-size: 12px;
                                line-height: 24px;
                                margin: 16px 0;
                                color: rgb(156, 163, 175);
                                padding-left: 1rem;
                                padding-right: 1rem;
                              "
                            >
                              ${COUNCIL_NAME}
                            </p>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`;
}
