import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Ionicons } from '@expo/vector-icons';
import { Skeleton } from '@/components/Skeleton';

/**
 * Écran Facturation (A2).
 * Historique paginé (scroll infini) des factures d'achat (CHARGE) et des
 * avoirs de remboursement (REFUND).
 */

interface Invoice {
  id: string;
  number: string;
  type: 'CHARGE' | 'REFUND';
  amount: number;
  currency: string;
  description: string;
  status: 'PAID' | 'REFUNDED';
  issuedAt: string;
  campaign: { name: string } | null;
}

const PAGE_SIZE = 20;

export default function BillingScreen() {
  const router = useRouter();

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isRefetching, refetch } =
    useInfiniteQuery({
      queryKey: ['invoices'],
      queryFn: async ({ pageParam = 1 }) => {
        const res = await api.get(`/invoices?page=${pageParam}&limit=${PAGE_SIZE}`);
        return res.data as { data: Invoice[]; meta: { totalPages: number; page: number } };
      },
      // L'API renvoie { data, meta } : on demande la page suivante tant que la
      // page courante n'est pas la dernière.
      getNextPageParam: (lastPage) =>
        lastPage.meta.page < lastPage.meta.totalPages ? lastPage.meta.page + 1 : undefined,
      initialPageParam: 1,
    });

  const invoices = data?.pages.flatMap((p) => p.data) || [];

  const renderItem = ({ item }: { item: Invoice }) => {
    const isRefund = item.type === 'REFUND';
    return (
      <View className="bg-white p-5 rounded-3xl mb-4 border border-gray-100">
        <View className="flex-row justify-between items-start">
          <View className="flex-1 pr-3">
            <Text className="text-xs font-black text-gray-400 uppercase tracking-widest">
              {item.number}
            </Text>
            <Text className="text-gray-900 font-bold mt-1" numberOfLines={2}>
              {item.description}
            </Text>
          </View>
          <Text className={`text-lg font-black ${isRefund ? 'text-green-600' : 'text-gray-900'}`}>
            {isRefund ? '+' : '−'}
            {item.amount.toFixed(2)} €
          </Text>
        </View>
        <View className="flex-row items-center justify-between mt-4 pt-4 border-t border-gray-50">
          <View
            className={`px-3 py-1 rounded-full ${isRefund ? 'bg-green-50' : 'bg-blue-50'}`}
          >
            <Text
              className={`text-[10px] font-black uppercase ${
                isRefund ? 'text-green-600' : 'text-blue-600'
              }`}
            >
              {isRefund ? 'Avoir' : 'Facture'}
            </Text>
          </View>
          <Text className="text-gray-400 text-xs">
            {new Date(item.issuedAt).toLocaleDateString()}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View className="flex-1 bg-gray-50">
      <View className="px-6 pt-14 pb-6 bg-white border-b border-gray-100 flex-row items-center">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <Ionicons name="arrow-back" size={24} color="#111827" />
        </TouchableOpacity>
        <View>
          <Text className="text-2xl font-black text-gray-900">Facturation</Text>
          <Text className="text-gray-500 font-medium text-sm">Vos factures et avoirs</Text>
        </View>
      </View>

      {isLoading ? (
        <View className="p-5">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} height={120} className="mb-4" borderRadius={24} />
          ))}
        </View>
      ) : (
        <FlatList
          data={invoices}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 20 }}
          onEndReached={() => hasNextPage && fetchNextPage()}
          onEndReachedThreshold={0.5}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
          ListFooterComponent={isFetchingNextPage ? <ActivityIndicator className="my-4" /> : null}
          ListEmptyComponent={
            <View className="py-20 items-center px-10">
              <View className="w-24 h-24 bg-gray-100 rounded-full items-center justify-center mb-6">
                <Ionicons name="receipt-outline" size={48} color="#9CA3AF" />
              </View>
              <Text className="text-gray-900 text-xl font-bold text-center">Aucune facture</Text>
              <Text className="text-gray-500 text-center mt-2 leading-relaxed">
                Vos factures apparaîtront ici dès votre première campagne payée.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
