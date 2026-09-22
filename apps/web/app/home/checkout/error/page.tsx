import Link from 'next/link';
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
import { XCircle } from 'lucide-react';

export const generateMetadata = async () => {
  const t = await getTranslations();
  return { title: t('payments.paymentError') };
};

function CheckoutErrorPage() {
  return (
    <>
      <PageHeader description={<AppBreadcrumbs />} />
      <PageBody>
        <div className="flex w-full flex-1 flex-col items-center justify-center lg:max-w-2xl">
          <Card className="w-full text-center">
            <CardHeader>
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-950">
                <XCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
              </div>
              <CardTitle>Payment Failed</CardTitle>
              <CardDescription>
                There was an issue processing your payment. Please try again.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex justify-center gap-x-3">
                <Link href="/home/checkout">
                  <Button>Try Again</Button>
                </Link>
                <Link href="/home">
                  <Button variant="outline">Back to Home</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  );
}

export default CheckoutErrorPage;
