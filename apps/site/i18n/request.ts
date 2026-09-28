import { getRequestConfig } from 'next-intl/server';

import { loadMessages } from '@kit/brand/i18n';
import { routing } from '@kit/i18n/routing';

/** Static locale, as in the portal: nothing here reads the request. */
export default getRequestConfig(async () => {
  const locale = routing.defaultLocale;

  return {
    locale,
    messages: await loadMessages(locale),
    timeZone: 'UTC',
    getMessageFallback(info) {
      return info.key;
    },
  };
});
