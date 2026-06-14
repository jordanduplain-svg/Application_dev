import React from 'react';
import { View, Text, ScrollView, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

/**
 * Écran « À propos » (ouvert depuis le bouton info du tableau de bord).
 */
export default function ModalScreen() {
  return (
    <ScrollView className="flex-1 bg-white" contentContainerStyle={{ padding: 24 }}>
      <View className="items-center mb-8 mt-4">
        <View className="w-20 h-20 bg-blue-100 rounded-3xl items-center justify-center mb-4">
          <Ionicons name="briefcase" size={40} color="#2563EB" />
        </View>
        <Text className="text-2xl font-black text-blue-600">Candio</Text>
        <Text className="text-gray-400 font-medium mt-1">Version 1.2.4</Text>
      </View>

      <Text className="text-gray-700 leading-relaxed text-center text-base">
        Candio automatise vos candidatures spontanées : l'IA recherche les
        entreprises qui recrutent, rédige un email personnalisé à partir de
        votre CV et l'envoie depuis votre compte.
      </Text>

      <View className="bg-gray-50 rounded-3xl border border-gray-100 p-6 mt-8">
        <InfoRow icon="sparkles-outline" text="Emails générés par IA, personnalisés par entreprise" />
        <InfoRow icon="stats-chart-outline" text="Suivi en temps réel des envois et des réponses" />
        <InfoRow icon="shield-checkmark-outline" text="Identifiants d'envoi chiffrés (AES-256)" />
      </View>

      <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'} />
    </ScrollView>
  );
}

function InfoRow({ icon, text }: { icon: any; text: string }) {
  return (
    <View className="flex-row items-center py-2">
      <Ionicons name={icon} size={20} color="#2563EB" />
      <Text className="text-gray-600 ml-3 flex-1">{text}</Text>
    </View>
  );
}
