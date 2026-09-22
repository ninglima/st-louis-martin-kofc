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
import { CheckCircle } from 'lucide-react';

export const generateMetadata = async () => {
  const t = await getTranslations();
  return { title: t('payments.paymentSuccess') };
};

function CheckoutSuccessPage() {
  return (
    <>
      <PageHeader description={<AppBreadcrumbs />} />
      <PageBody>
        <div className="flex w-full flex-1 flex-col items-center justify-center lg:max-w-2xl">
          <Card className="w-full text-center">
            <CardHeader>
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-950">
                <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
              <CardTitle>Payment Successful</CardTitle>
              <CardDescription>
                Your payment has been processed successfully. Thank you!
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
