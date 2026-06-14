import React, { useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, RefreshControl, TouchableOpacity, Modal, Linking, ScrollView } from 'react-native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Ionicons } from '@expo/vector-icons';
import { Skeleton } from '@/components/Skeleton';

/**
 * Écran Réponses.
 * Liste paginée (scroll infini) des candidatures ayant reçu une réponse de
 * recruteur. Le détail s'ouvre dans une modale, avec une action « répondre
 * par mail » qui ouvre le client mail natif.
 */
export default function ResponsesScreen() {
  // Réponse actuellement ouverte dans la modale de détail (null = fermée).
  const [selectedReply, setSelectedReply] = useState<any>(null);

  // Requête paginée : on charge une page à la fois, page suivante au scroll.
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isRefetching,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['replies'],
    queryFn: async ({ pageParam = 1 }) => {
      const res = await api.get(`/stats/replies?page=${pageParam}&limit=10`);
      return res.data;
    },
    // S'il reste une page pleine (10 éléments), on demande la suivante.
    getNextPageParam: (lastPage, allPages) => {
      return lastPage.length === 10 ? allPages.length + 1 : undefined;
    },
    initialPageParam: 1,
  });

  // Aplatit les pages en une seule liste pour la FlatList.
  const replies = data?.pages.flat() || [];

  // Ouvre le client mail natif pré-rempli avec l'adresse du contact.
  const handleReplyEmail = (email: string) => {
    Linking.openURL(`mailto:${email}`);
  };

  // Rendu d'une carte de réponse dans la liste.
  const renderItem = ({ item }: { item: any }) => (
    <TouchableOpacity 
      onPress={() => setSelectedReply(item)}
      className="bg-white p-6 rounded-3xl mb-4 border border-gray-100 active:scale-98"
    >
      <View className="flex-row justify-between items-start mb-3">
        <View className="flex-1">
          <Text className="text-lg font-black text-gray-900">{item.companyName}</Text>
          <Text className="text-blue-600 text-xs font-bold uppercase tracking-widest">{item.campaign.jobTitle}</Text>
        </View>
        <View className="bg-green-50 px-3 py-1 rounded-full border border-green-100">
           <Text className="text-green-600 text-[10px] font-black uppercase">Réponse</Text>
        </View>
      </View>
      
      <Text className="text-gray-500 text-sm italic mb-4 line-clamp-2" numberOfLines={2}>
        "{item.replyContent || "Aucun contenu disponible."}"
      </Text>

      <View className="flex-row items-center justify-between pt-4 border-t border-gray-50">
        <View className="flex-row items-center">
          <Ionicons name="time-outline" size={14} color="#9CA3AF" />
          <Text className="text-gray-400 text-xs ml-1">{new Date(item.repliedAt).toLocaleDateString()}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
      </View>
    </TouchableOpacity>
  );

  return (
    <View className="flex-1 bg-gray-50">
      <View className="px-6 py-8 bg-white border-b border-gray-100">
        <Text className="text-3xl font-black text-gray-900 tracking-tight">Réponses</Text>
        <Text className="text-gray-500 font-medium mt-1">Gérez vos opportunités entrantes.</Text>
      </View>

      {isLoading ? (
        <View className="p-6">
           {[1, 2, 3].map(i => <Skeleton key={i} height={160} className="mb-4" borderRadius={24} />)}
        </View>
      ) : (
        <FlatList
          data={replies}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 20 }}
          onEndReached={() => hasNextPage && fetchNextPage()}
          onEndReachedThreshold={0.5}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
          ListFooterComponent={isFetchingNextPage ? <ActivityIndicator className="my-4" /> : null}
          ListEmptyComponent={
            <View className="py-20 items-center px-10">
              <View className="w-24 h-24 bg-gray-100 rounded-full items-center justify-center mb-6">
                 <Ionicons name="chatbubbles-outline" size={48} color="#9CA3AF" />
              </View>
              <Text className="text-gray-900 text-xl font-bold text-center">Rien pour l'instant</Text>
              <Text className="text-gray-500 text-center mt-2 leading-relaxed">
                Dès qu'un recruteur répondra à vos candidatures automatisées, le message apparaîtra ici.
              </Text>
            </View>
          }
        />
      )}

      {/* Modal Détail */}
      <Modal
        visible={!!selectedReply}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSelectedReply(null)}
      >
        <View className="flex-1 justify-end bg-black/40">
          <View className="bg-white rounded-t-[40px] p-8 h-[70%]">
            <View className="w-12 h-1.5 bg-gray-200 rounded-full self-center mb-8" />
            
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text className="text-blue-600 font-black uppercase text-xs tracking-widest mb-2">{selectedReply?.campaign.name}</Text>
              <Text className="text-3xl font-black text-gray-900 mb-6">{selectedReply?.companyName}</Text>
              
              <View className="bg-gray-50 p-6 rounded-3xl border border-gray-100 mb-8">
                <Text className="text-gray-800 leading-relaxed text-lg italic">
                  "{selectedReply?.replyContent}"
                </Text>
              </View>

              <View className="space-y-4">
                 <View className="flex-row items-center bg-gray-50 p-4 rounded-2xl border border-gray-100">
                    <Ionicons name="mail-outline" size={20} color="#6B7280" />
                    <Text className="text-gray-700 font-bold ml-3 flex-1">{selectedReply?.contactEmail}</Text>
                 </View>
                 <View className="flex-row items-center bg-gray-50 p-4 rounded-2xl border border-gray-100">
                    <Ionicons name="calendar-outline" size={20} color="#6B7280" />
                    <Text className="text-gray-700 font-bold ml-3">{new Date(selectedReply?.repliedAt).toLocaleString()}</Text>
                 </View>
              </View>
            </ScrollView>

            <View className="flex-row space-x-4 mt-8">
              <TouchableOpacity 
                onPress={() => setSelectedReply(null)}
                className="flex-1 bg-gray-100 h-16 rounded-2xl items-center justify-center"
              >
                <Text className="text-gray-600 font-bold">Fermer</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={() => handleReplyEmail(selectedReply?.contactEmail)}
                className="flex-[2] bg-blue-600 h-16 rounded-2xl items-center justify-center flex-row"
              >
                <Ionicons name="open-outline" size={20} color="white" />
                <Text className="text-white font-bold ml-2">Répondre par Mail</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
