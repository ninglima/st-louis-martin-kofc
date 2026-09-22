import { useQuery } from '@tanstack/react-query';
import { useSupabase } from '@kit/supabase/hooks/use-supabase';

import type { Payment } from '../types/payment.types';

export function usePaymentHistory() {
  const supabase = useSupabase();

  return useQuery({
    queryKey: ['payment-history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as Payment[];
    },
  });
}
