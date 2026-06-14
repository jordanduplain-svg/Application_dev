import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuthStore } from '@/constants/authStore';
import EventSource from 'react-native-sse';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { statsService } from '@/services/stats.service';
import { api } from '@/lib/api';
import { DashboardSkeleton } from '@/components/Skeleton';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';

import { Platform } from 'react-native';

const API_URL = Constants.expoConfig?.extra?.apiUrl ||
  (Platform.OS === 'android' ? 'http://10.0.2.2:3000/api' : 'http://127.0.0.1:3000/api');

/**
 * Écran Tableau de bord (onglet principal).
 * Charge les statistiques via React Query, puis les met à jour en temps réel
 * grâce à un flux SSE (`/stats/stream`).
 */
export default function DashboardScreen() {
  const accessToken = useAuthStore(state => state.accessToken);
  const user = useAuthStore(state => state.user);
  const queryClient = useQueryClient();
  const router = useRouter();

  const { data: stats, isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: ['stats'],
    queryFn: statsService.getStats,
    enabled: !!accessToken,
    // Filet de sécurité si le flux SSE tombe (token expiré, coupure réseau) :
    // ce polling passe par l'intercepteur axios, qui rafraîchit le token au
    // besoin — la mise à jour du token relance alors l'effet SSE ci-dessous.
    refetchInterval: 60000,
  });

  // Profil : sert à la checklist d'onboarding (CV importé ? SMTP configuré ?).
  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: async () => (await api.get('/me')).data,
    enabled: !!accessToken,
  });

  const cvDone = !!profile?.cvUrl;
  const smtpDone = !!profile?.emailSender;
  const setupComplete = cvDone && smtpDone;

  // Compteur de reconnexion SSE : son incrément force la recréation de la
  // connexion (cf. l'effet plus bas).
  const [sseEpoch, setSseEpoch] = useState(0);

  // Flux temps réel : on ouvre une connexion SSE et on injecte chaque mise à
  // jour reçue directement dans le cache React Query.
  // `useFocusEffect` (et non `useEffect`) : la connexion SSE n'est ouverte que
  // lorsque l'onglet Dashboard est affiché, et fermée dès qu'on en sort — les
  // onglets restant montés, un `useEffect` laisserait le flux tourner en
  // arrière-plan (#6). Le polling React Query (refetchInterval) garde les
  // données fraîches lorsqu'on revient sur l'onglet.
  useFocusEffect(
    useCallback(() => {
      if (!accessToken) return;

      // `accessToken` est relu à chaque exécution : après un refresh de token,
      // la reconnexion utilise le token frais.
      const es = new EventSource(`${API_URL}/stats/stream`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

      es.addEventListener('stats_updated' as any, (event: any) => {
        if (event.data) {
          // Met à jour le cache de la requête ['stats'] avec les données reçues.
          queryClient.setQueryData(['stats'], JSON.parse(event.data));
        }
      });

      // En cas d'erreur SSE (token expiré, coupure réseau), on ferme la
      // connexion puis on programme une reconnexion : incrémenter `sseEpoch`
      // recrée la connexion (M-D).
      es.addEventListener('error' as any, () => {
        es.close();
        reconnectTimer = setTimeout(() => setSseEpoch((e) => e + 1), 5000);
      });

      // Perte de focus de l'onglet / reconnexion : on ferme la connexion et on
      // annule un éventuel timer de reconnexion en attente.
      return () => {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        es.close();
      };
    }, [accessToken, queryClient, sseEpoch])
  );

  const onRefresh = async () => {
    await refetch();
  };

  if (isLoading) return <DashboardSkeleton />;

  if (isError) {
    return (
      <View className="flex-1 bg-gray-50 items-center justify-center px-10">
        <Ionicons name="alert-circle-outline" size={60} color="#EF4444" />
        <Text className="text-gray-900 text-xl font-bold mt-4">Oups !</Text>
        <Text className="text-gray-500 text-center mt-2">Impossible de charger les statistiques.</Text>
        <TouchableOpacity 
          onPress={() => refetch()}
          className="mt-6 bg-blue-600 px-8 py-3 rounded-2xl"
        >
          <Text className="text-white font-bold">Réessayer</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView 
      className="flex-1 bg-gray-50"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} />}
    >
      <View className="px-6 py-8">
        <Text className="text-3xl font-extrabold text-gray-900 tracking-tight">Bonjour, {user?.firstName} 👋</Text>
        <Text className="text-gray-500 mt-2 text-base font-medium">Voici l'état de vos campagnes en temps réel.</Text>

        {/* Stats Grid */}
        <View className="flex-row flex-wrap justify-between mt-10">
          <StatCard title="Campagnes" value={stats?.campaignsCount || 0} color="bg-blue-50" borderColor="border-blue-100" textColor="text-blue-700" iconColor="#1D4ED8" icon="megaphone" />
          <StatCard title="Candidatures" value={stats?.applicationsStats?.total || 0} color="bg-purple-50" borderColor="border-purple-100" textColor="text-purple-700" iconColor="#7E22CE" icon="send" />
          <StatCard title="Envoyées" value={stats?.applicationsStats?.sent || 0} color="bg-green-50" borderColor="border-green-100" textColor="text-green-700" iconColor="#15803D" icon="checkmark-circle" />
          <StatCard title="En attente" value={stats?.applicationsStats?.pending || 0} color="bg-amber-50" borderColor="border-amber-100" textColor="text-amber-700" iconColor="#B45309" icon="time" />
          <StatCard title="Réponses" value={stats?.applicationsStats?.replied || 0} color="bg-indigo-50" borderColor="border-indigo-100" textColor="text-indigo-700" iconColor="#4338CA" icon="chatbox" />
          <StatCard title="Échecs" value={stats?.applicationsStats?.failed || 0} color="bg-red-50" borderColor="border-red-100" textColor="text-red-700" iconColor="#B91C1C" icon="close-circle" />
        </View>

        {/* Checklist d'onboarding (U2) : visible tant que les prérequis pour
            lancer une campagne ne sont pas remplis. */}
        {profile && !setupComplete && (
          <View className="mt-10">
            <Text className="text-xl font-extrabold text-gray-900 mb-1">
              Finalisez votre configuration
            </Text>
            <Text className="text-gray-500 mb-5 font-medium">
              Deux étapes avant de lancer votre première campagne.
            </Text>
            <View className="bg-white rounded-3xl border border-gray-100 overflow-hidden">
              <ChecklistRow
                done={cvDone}
                title="Importer votre CV"
                subtitle="Analysé par l'IA pour personnaliser vos emails"
                onPress={() => router.push('/(tabs)/profile')}
              />
              <ChecklistRow
                done={smtpDone}
                title="Configurer l'envoi d'emails"
                subtitle="Compte utilisé pour expédier vos candidatures"
                onPress={() => router.push('/settings/smtp')}
                last
              />
            </View>
          </View>
        )}

        {/* Actions rapides */}
        <View className="mt-10 mb-8">
          <Text className="text-xl font-extrabold text-gray-900 mb-5">Actions rapides</Text>
          <TouchableOpacity
            onPress={() => router.push('/campaign/wizard')}
            className="bg-white p-6 rounded-3xl border border-gray-100 mb-4 active:scale-95 transition-all"
          >
            <View className="flex-row items-center">
              <View className="w-12 h-12 bg-blue-600 rounded-2xl items-center justify-center mr-4">
                <Ionicons name="add" size={28} color="white" />
              </View>
              <View className="flex-1">
                <Text className="text-lg font-bold text-gray-900">Nouvelle campagne</Text>
                <Text className="text-gray-500 font-medium">Recherchez des recruteurs par IA.</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#D1D5DB" />
            </View>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

// Ligne de la checklist d'onboarding : pastille (cochée/à faire) + libellé.
function ChecklistRow({
  done,
  title,
  subtitle,
  onPress,
  last,
}: {
  done: boolean;
  title: string;
  subtitle: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className={`flex-row items-center p-5 ${last ? '' : 'border-b border-gray-50'} active:bg-gray-50`}
    >
      <View
        className={`w-9 h-9 rounded-full items-center justify-center mr-4 ${
          done ? 'bg-green-100' : 'bg-amber-100'
        }`}
      >
        <Ionicons
          name={done ? 'checkmark' : 'ellipse-outline'}
          size={done ? 20 : 16}
          color={done ? '#16A34A' : '#D97706'}
        />
      </View>
      <View className="flex-1">
        <Text className={`font-bold ${done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
          {title}
        </Text>
        <Text className="text-gray-400 text-xs font-medium">{subtitle}</Text>
      </View>
      {!done && <Ionicons name="chevron-forward" size={18} color="#D1D5DB" />}
    </TouchableOpacity>
  );
}

// Carte d'affichage d'une statistique (titre + valeur + icône colorée).
function StatCard({ title, value, color, borderColor, textColor, icon, iconColor }: any) {
  return (
    <View className={`w-[48%] ${color} p-6 rounded-[32px] mb-4 border ${borderColor}`}>
      <View className="flex-row justify-between items-start mb-3">
         <Ionicons name={icon} size={20} color={iconColor} />
      </View>
      <Text className={`text-sm font-bold ${textColor} opacity-60 uppercase tracking-wider`}>{title}</Text>
      <Text className={`text-3xl font-extrabold ${textColor} mt-1`}>{value}</Text>
    </View>
  );
}
