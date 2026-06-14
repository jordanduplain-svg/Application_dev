import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/lib/api';
import { Ionicons } from '@expo/vector-icons';

// Forme d'une campagne telle qu'affichée dans la liste.
interface Campaign {
  id: string;
  name: string;
  jobTitle: string;
  status: 'PENDING' | 'PAID' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED';
  createdAt: string;
  applicationQuota: number;
}

/**
 * Écran Campagnes (onglet « two »).
 * Liste les campagnes de l'utilisateur, permet de lancer le paiement d'une
 * campagne en attente et d'en créer une nouvelle.
 */
export default function CampaignsScreen() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const router = useRouter();

  // Charge la liste des campagnes. L'API renvoie un objet paginé { data, meta }.
  const fetchCampaigns = async () => {
    try {
      const response = await api.get('/campaigns');
      setCampaigns(response.data.data);
      setError(false);
    } catch (err) {
      // En cas d'échec, on lève un drapeau d'erreur : sans lui, l'écran
      // afficherait l'état vide « Aucune campagne » et tromperait un
      // utilisateur qui possède pourtant des campagnes (M5).
      console.error('Error fetching campaigns:', err);
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Lance le paiement (mocké) d'une campagne. Le serveur marque la campagne
  // PAID directement ; on rafraîchit donc la liste puis on affiche l'écran
  // de succès (pas d'ouverture de navigateur en mode démo).
  const handlePay = async (campaignId: string) => {
    try {
      await api.post(`/stripe/checkout/${campaignId}`);
      await fetchCampaigns();
      router.push('/campaign/payment-success');
    } catch (error: any) {
      // Retour utilisateur explicite en cas d'échec (au lieu d'un échec muet).
      Alert.alert('Paiement impossible', error?.message || 'Une erreur est survenue.');
    }
  };

  // Rechargement à CHAQUE fois que l'onglet reçoit le focus (et pas seulement
  // au montage) : la liste reflète ainsi une campagne tout juste créée via le
  // wizard, ou un changement de statut après paiement.
  useFocusEffect(
    useCallback(() => {
      fetchCampaigns();
    }, [])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchCampaigns();
  };

  // Renvoie les classes Tailwind (fond + texte) associées à un statut de campagne.
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'RUNNING': return 'bg-green-100 text-green-700';
      case 'PAID': return 'bg-blue-100 text-blue-700';
      case 'PENDING': return 'bg-amber-100 text-amber-700';
      case 'PAUSED': return 'bg-gray-100 text-gray-700';
      case 'COMPLETED': return 'bg-purple-100 text-purple-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const renderItem = ({ item }: { item: Campaign }) => (
    <TouchableOpacity
      className="bg-white p-5 rounded-2xl mb-4 border border-gray-100"
      onPress={() => router.push(`/campaign/${item.id}`)}
    >
      <View className="flex-row justify-between items-start">
        <View className="flex-1">
          <Text className="text-lg font-bold text-gray-900">{item.name}</Text>
          <Text className="text-gray-500 mt-1">{item.jobTitle}</Text>
        </View>
        <View className={`px-3 py-1 rounded-full ${getStatusColor(item.status).split(' ')[0]}`}>
           <Text className={`text-xs font-bold ${getStatusColor(item.status).split(' ')[1]}`}>{item.status}</Text>
        </View>
      </View>
      
      <View className="flex-row justify-between items-center mt-4 pt-4 border-t border-gray-50">
        <View className="flex-row items-center">
          <Ionicons name="people-outline" size={16} color="#6B7280" />
          <Text className="text-gray-500 text-sm ml-1">{item.applicationQuota} cibles</Text>
        </View>
        <Text className="text-gray-400 text-xs">
          {new Date(item.createdAt).toLocaleDateString()}
        </Text>
      </View>

      {item.status === 'PENDING' && (
        <TouchableOpacity 
          className="mt-4 bg-blue-600 py-3 rounded-xl items-center flex-row justify-center"
          onPress={() => handlePay(item.id)}
        >
          <Ionicons name="card-outline" size={18} color="white" />
          <Text className="text-white font-bold ml-2">Payer ma campagne</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );

  return (
    <View className="flex-1 bg-gray-50">
      {loading ? (
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#2563EB" />
        </View>
      ) : error ? (
        <View className="flex-1 justify-center items-center px-10">
          <Ionicons name="cloud-offline-outline" size={60} color="#EF4444" />
          <Text className="text-gray-900 text-xl font-bold mt-4">Chargement impossible</Text>
          <Text className="text-gray-500 text-center mt-2">
            Impossible de récupérer vos campagnes pour le moment.
          </Text>
          <TouchableOpacity
            onPress={() => {
              setLoading(true);
              fetchCampaigns();
            }}
            className="mt-6 bg-blue-600 px-8 py-3 rounded-2xl"
          >
            <Text className="text-white font-bold">Réessayer</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={campaigns}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 20 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View className="py-20 items-center">
              <Text className="text-gray-400">Aucune campagne pour le moment.</Text>
              <TouchableOpacity 
                className="mt-4 bg-blue-600 px-6 py-3 rounded-xl"
                onPress={() => router.push('/campaign/wizard')}
              >
                <Text className="text-white font-bold">Créer ma première campagne</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}

      {/* Floating Action Button */}
      {!loading && !error && campaigns.length > 0 && (
        <TouchableOpacity 
          className="absolute bottom-8 right-8 w-16 h-16 bg-blue-600 rounded-full justify-center items-center"
          onPress={() => router.push('/campaign/wizard')}
        >
          <Ionicons name="add" size={32} color="white" />
        </TouchableOpacity>
      )}
    </View>
  );
}
