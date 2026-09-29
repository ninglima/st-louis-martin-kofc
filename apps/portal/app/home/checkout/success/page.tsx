import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { PageBody, PageHeader } from '@kit/ui/page';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { CheckCircle, Clock } from 'lucide-react';

import { checkoutOutcome } from '@kit/payments/lib/checkout-outcome';

export const generateMetadata = async () => {
  const t = await getTranslations();
  return { title: t('payments.paymentSuccess') };
};

/**
 * Where Stripe (`return_url`) and the Square form send a member after
 * paying. A card payment has succeeded by now; a bank (ACH) payment is still
 * clearing, so it gets its own wording; a failed one goes to the error page.
 */
async function CheckoutSuccessPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const outcome = checkoutOutcome((await props.searchParams).redirect_status);

  if (outcome === 'failed') {
    redirect('/home/checkout/error');
  }

  const processing = outcome === 'processing';

  return (
    <>
      <PageHeader description={<AppBreadcrumbs />} />
      <PageBody>
        <div className="flex w-full flex-1 flex-col items-center justify-center lg:max-w-2xl">
          <Card className="w-full text-center">
            <CardHeader>
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-950">
                {processing ? (
                  <Clock className="h-8 w-8 text-green-600 dark:text-green-400" />
                ) : (
                  <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
                )}
              </div>
              <CardTitle data-test="checkout-outcome">
                {processing ? 'Payment received' : 'Payment Successful'}
              </CardTitle>
              <CardDescription>
                {processing
                  ? 'Bank payments take up to 4 business days to clear. Your dues will show as paid once it clears.'
                  : 'Your payment has been processed successfully. Thank you!'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex justify-center gap-x-3">
                <Link href="/home/payments">
                  <Button variant="outline">View Payment History</Button>
                </Link>
                <Link href="/home">
                  <Button>Back to Home</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  );
}

export default CheckoutSuccessPage;
