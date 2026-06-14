import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Ionicons } from '@expo/vector-icons';

/**
 * Écran de détail d'une campagne (U1).
 * Affiche les informations de la campagne, l'éventuel remboursement, et la
 * liste des candidatures avec leur statut. Le détail d'une candidature (email
 * généré) s'ouvre dans une modale.
 */

interface Application {
  id: string;
  companyName: string;
  companyWebsite: string | null;
  contactEmail: string;
  contactName: string | null;
  contactRole: string | null;
  subject: string;
  body: string;
  status: string;
  sentAt: string | null;
  repliedAt: string | null;
  replyContent: string | null;
  errorMessage: string | null;
}

interface Campaign {
  id: string;
  name: string;
  jobTitle: string;
  location: string;
  status: string;
  applicationQuota: number;
  budget: number;
  refundedAt: string | null;
  refundAmount: number | null;
  createdAt: string;
  applications: Application[];
  // Compteurs agrégés sur TOUTES les candidatures (le tableau `applications`
  // est borné à 50 par l'API).
  applicationStats: { total: number; sent: number; pending: number; failed: number };
}

// Couleurs (fond + texte) associées à un statut de candidature.
function appStatusColor(status: string): string {
  switch (status) {
    case 'SENT':
      return 'bg-green-100 text-green-700';
    case 'OPENED':
      return 'bg-indigo-100 text-indigo-700';
    case 'REPLIED':
      return 'bg-purple-100 text-purple-700';
    case 'SENDING':
      return 'bg-blue-100 text-blue-700';
    case 'PENDING':
      return 'bg-amber-100 text-amber-700';
    case 'BOUNCED':
      return 'bg-orange-100 text-orange-700';
    case 'FAILED':
      return 'bg-red-100 text-red-700';
    // Statuts de campagne (la fonction sert aussi au badge de la campagne).
    case 'RUNNING':
      return 'bg-green-100 text-green-700';
    case 'PAID':
      return 'bg-blue-100 text-blue-700';
    case 'COMPLETED':
      return 'bg-purple-100 text-purple-700';
    case 'PAUSED':
      return 'bg-gray-100 text-gray-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

export default function CampaignDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [selected, setSelected] = useState<Application | null>(null);

  const { data: campaign, isLoading, isError, isRefetching, refetch } = useQuery<Campaign>({
    queryKey: ['campaign', id],
    queryFn: async () => {
      const res = await api.get(`/campaigns/${id}`);
      return res.data;
    },
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <View className="flex-1 bg-gray-50 items-center justify-center">
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  if (isError || !campaign) {
    return (
      <View className="flex-1 bg-gray-50 items-center justify-center px-10">
        <Ionicons name="alert-circle-outline" size={60} color="#EF4444" />
        <Text className="text-gray-900 text-xl font-bold mt-4">Campagne introuvable</Text>
        <TouchableOpacity
          onPress={() => router.back()}
          className="mt-6 bg-blue-600 px-8 py-3 rounded-2xl"
        >
          <Text className="text-white font-bold">Retour</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const apps = campaign.applications || [];
  // Compteurs issus de l'agrégation serveur (exacts), pas du tableau tronqué.
  const stats = campaign.applicationStats ?? { total: 0, sent: 0, pending: 0, failed: 0 };

  return (
    <View className="flex-1 bg-gray-50">
      {/* Header */}
      <View className="px-6 pt-14 pb-6 bg-white border-b border-gray-100 flex-row items-center">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <Ionicons name="arrow-back" size={24} color="#111827" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-2xl font-black text-gray-900" numberOfLines={1}>
            {campaign.name}
          </Text>
          <Text className="text-gray-500 font-medium text-sm">{campaign.jobTitle}</Text>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 20 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      >
        {/* Carte récapitulative */}
        <View className="bg-white p-6 rounded-3xl border border-gray-100">
          <View className="flex-row justify-between items-center mb-4">
            <View
              className={`px-3 py-1 rounded-full ${appStatusColor(campaign.status).split(' ')[0]}`}
            >
              <Text
                className={`text-xs font-black uppercase ${
                  appStatusColor(campaign.status).split(' ')[1]
                }`}
              >
                {campaign.status}
              </Text>
            </View>
            <Text className="text-gray-400 text-xs">
              {new Date(campaign.createdAt).toLocaleDateString()}
            </Text>
          </View>
          <DetailRow icon="location-outline" label="Lieu" value={campaign.location} />
          <DetailRow
            icon="people-outline"
            label="Candidatures"
            value={`${stats.sent} envoyée(s) / ${campaign.applicationQuota}`}
          />
          <DetailRow
            icon="card-outline"
            label="Budget"
            value={`${campaign.budget.toFixed(2)} €`}
          />
        </View>

        {/* Bandeau remboursement (A3) */}
        {campaign.refundedAt && (
          <View className="bg-green-50 p-5 rounded-3xl border border-green-100 mt-4 flex-row items-center">
            <Ionicons name="cash-outline" size={24} color="#16A34A" />
            <Text className="text-green-800 text-sm font-medium ml-3 flex-1">
              Un avoir de {(campaign.refundAmount ?? 0).toFixed(2)} € a été émis pour les
              candidatures non livrées.
            </Text>
          </View>
        )}

        {/* Liste des candidatures */}
        <Text className="text-lg font-extrabold text-gray-900 mt-8 mb-1">
          Candidatures ({stats.total})
        </Text>
        {apps.length < stats.total && (
          <Text className="text-gray-400 text-xs mb-3">
            Affichage des {apps.length} plus récentes.
          </Text>
        )}
        {apps.length >= stats.total && <View className="mb-3" />}

        {apps.length === 0 ? (
          <View className="bg-white p-8 rounded-3xl border border-gray-100 items-center">
            <Ionicons name="hourglass-outline" size={40} color="#9CA3AF" />
            <Text className="text-gray-500 text-center mt-3 font-medium">
              Aucune candidature pour le moment. La recherche d'entreprises est en cours.
            </Text>
          </View>
        ) : (
          apps.map((app) => (
            <TouchableOpacity
              key={app.id}
              onPress={() => setSelected(app)}
              className="bg-white p-5 rounded-3xl mb-3 border border-gray-100"
            >
              <View className="flex-row justify-between items-start">
                <View className="flex-1 pr-3">
                  <Text className="text-base font-black text-gray-900">{app.companyName}</Text>
                  <Text className="text-gray-500 text-sm">
                    {app.contactName || 'Contact'}
                    {app.contactRole ? ` · ${app.contactRole}` : ''}
                  </Text>
                </View>
                <View className={`px-3 py-1 rounded-full ${appStatusColor(app.status).split(' ')[0]}`}>
                  <Text
                    className={`text-[10px] font-black uppercase ${
                      appStatusColor(app.status).split(' ')[1]
                    }`}
                  >
                    {app.status}
                  </Text>
                </View>
              </View>
              {app.errorMessage && (
                <Text className="text-red-500 text-xs mt-2" numberOfLines={1}>
                  ⚠ {app.errorMessage}
                </Text>
              )}
            </TouchableOpacity>
          ))
        )}
        <View className="h-6" />
      </ScrollView>

      {/* Modale détail candidature : email généré */}
      <Modal
        visible={!!selected}
        animationType="slide"
        transparent
        onRequestClose={() => setSelected(null)}
      >
        <View className="flex-1 justify-end bg-black/40">
          <View className="bg-white rounded-t-[40px] p-8 h-[75%]">
            <View className="w-12 h-1.5 bg-gray-200 rounded-full self-center mb-6" />
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text className="text-blue-600 font-black uppercase text-xs tracking-widest mb-1">
                {selected?.status}
              </Text>
              <Text className="text-2xl font-black text-gray-900 mb-1">
                {selected?.companyName}
              </Text>
              <Text className="text-gray-500 mb-6">{selected?.contactEmail}</Text>

              {selected?.errorMessage && (
                <View className="bg-red-50 p-4 rounded-2xl border border-red-100 mb-4">
                  <Text className="text-red-600 text-sm font-medium">
                    Erreur : {selected.errorMessage}
                  </Text>
                </View>
              )}

              <Text className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">
                Objet
              </Text>
              <Text className="text-gray-900 font-bold text-base mb-5">
                {selected?.subject || '(non encore généré)'}
              </Text>

              <Text className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">
                Message
              </Text>
              <View className="bg-gray-50 p-5 rounded-2xl border border-gray-100">
                <Text className="text-gray-800 leading-relaxed">
                  {selected?.body || '(en attente de génération par l\'IA)'}
                </Text>
              </View>

              {selected?.replyContent && (
                <>
                  <Text className="text-xs font-black text-green-500 uppercase tracking-widest mb-2 mt-6">
                    Réponse du recruteur
                  </Text>
                  <View className="bg-green-50 p-5 rounded-2xl border border-green-100">
                    <Text className="text-gray-800 leading-relaxed italic">
                      {selected.replyContent}
                    </Text>
                  </View>
                </>
              )}
            </ScrollView>
            <TouchableOpacity
              onPress={() => setSelected(null)}
              className="bg-gray-100 h-14 rounded-2xl items-center justify-center mt-6"
            >
              <Text className="text-gray-700 font-bold">Fermer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// Ligne « icône + libellé + valeur » de la carte récapitulative.
function DetailRow({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View className="flex-row items-center py-2">
      <Ionicons name={icon} size={18} color="#6B7280" />
      <Text className="text-gray-500 ml-2 flex-1">{label}</Text>
      <Text className="text-gray-900 font-bold">{value}</Text>
    </View>
  );
}
