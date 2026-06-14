import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

/**
 * Écran affiché lorsqu'un paiement a été annulé par l'utilisateur.
 */
export default function PaymentCancelScreen() {
  const router = useRouter();

  return (
    <View className="flex-1 bg-white items-center justify-center px-10">
      <View className="w-24 h-24 bg-red-100 rounded-full items-center justify-center mb-8">
        <Ionicons name="close-circle" size={64} color="#EF4444" />
      </View>
      
      <Text className="text-3xl font-black text-gray-900 text-center">Paiement Annulé</Text>
      <Text className="text-gray-500 text-center mt-4 text-lg font-medium">
        Votre paiement n'a pas été finalisé. Vous pouvez retrouver votre campagne en attente dans la liste des campagnes.
      </Text>

      <TouchableOpacity 
        onPress={() => router.replace('/(tabs)/campaigns')}
        className="mt-12 bg-gray-900 w-full h-16 rounded-2xl items-center justify-center"
      >
        <Text className="text-white text-lg font-bold">Retour aux Campagnes</Text>
      </TouchableOpacity>

      <TouchableOpacity 
        onPress={() => router.back()}
        className="mt-4"
      >
        <Text className="text-blue-600 font-bold">Réessayer le paiement</Text>
      </TouchableOpacity>
    </View>
  );
}
