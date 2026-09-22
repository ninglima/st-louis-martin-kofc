import { useQuery } from '@tanstack/react-query';
import { useSupabase } from '@kit/supabase/hooks/use-supabase';

import type { PaymentConfig } from '../types/payment.types';

export function usePaymentConfig() {
  const supabase = useSupabase();

  return useQuery({
    queryKey: ['payment-config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payment_config')
        .select('*')
        .single();

      if (error) throw error;
      return data as PaymentConfig;
    },
  });
}
