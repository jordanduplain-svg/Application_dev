import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Écran de confirmation affiché après un paiement réussi.
 */
export default function PaymentSuccessScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Invalide le cache des stats pour que le Dashboard reflète la nouvelle campagne.
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ['stats'] });
  }, []);

  return (
    <View className="flex-1 bg-white items-center justify-center px-10">
      <View className="w-24 h-24 bg-green-100 rounded-full items-center justify-center mb-8">
        <Ionicons name="checkmark-circle" size={64} color="#10B981" />
      </View>
      
      <Text className="text-3xl font-black text-gray-900 text-center">Paiement Réussi !</Text>
      <Text className="text-gray-500 text-center mt-4 text-lg font-medium">
        Votre campagne est maintenant active. Notre IA commence à rechercher les meilleurs recruteurs pour vous.
      </Text>

      <TouchableOpacity 
        onPress={() => router.replace('/(tabs)')}
        className="mt-12 bg-blue-600 w-full h-16 rounded-2xl items-center justify-center"
      >
        <Text className="text-white text-lg font-bold">Aller au Tableau de Bord</Text>
      </TouchableOpacity>
    </View>
  );
}
