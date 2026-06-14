import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Switch, Alert, ActivityIndicator, Share } from 'react-native';
import { useAuthStore } from '@/constants/authStore';
import { usePreferencesStore } from '@/stores/preferences.store';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/lib/api';
import * as DocumentPicker from 'expo-document-picker';
import { useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Écran Profil.
 * Affiche les informations du compte, permet d'importer un CV (PDF),
 * d'accéder aux réglages et de se déconnecter.
 */
export default function ProfileScreen() {
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  // Préférence « Notifications Push » : persistée et lue par `useNotifications`
  // (qui enregistre ou retire le token push en conséquence).
  const notifEnabled = usePreferencesStore((s) => s.notificationsEnabled);
  const setNotifEnabled = usePreferencesStore((s) => s.setNotificationsEnabled);

  // Récupère le profil complet (plan, CV...) depuis l'API.
  // Route : /api/me (le module user est monté sous le préfixe '/api').
  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: async () => {
      const res = await api.get('/me');
      return res.data;
    }
  });

  // Déconnexion : révoque la session côté serveur, puis purge l'état local
  // (store d'auth + cache React Query) et renvoie vers l'écran de connexion.
  const handleLogout = async () => {
    Alert.alert(
      "Déconnexion",
      "Voulez-vous vraiment vous déconnecter ?",
      [
        { text: "Annuler", style: "cancel" },
        { text: "Déconnexion", onPress: async () => {
          try {
            // On transmet le refresh token dans le corps : sur mobile natif,
            // le cookie httpOnly n'est pas fiable, et sans lui le serveur ne
            // pourrait pas RÉVOQUER le token (il resterait valide en base).
            const refreshToken = useAuthStore.getState().refreshToken;
            await api.post('/auth/logout', { refreshToken });
          } catch (e) {
            // Même si l'appel échoue, on déconnecte localement.
          }
          await logout();
          queryClient.clear();
          router.replace('/(auth)/login');
        }, style: "destructive" }
      ]
    );
  };

  // Export RGPD (S3) : récupère toutes les données personnelles puis ouvre la
  // feuille de partage native (l'utilisateur peut les enregistrer ou se les
  // envoyer par email).
  const handleExportData = async () => {
    setExporting(true);
    try {
      const res = await api.get('/me/export');
      await Share.share({
        title: 'Export de mes données Candio',
        message: JSON.stringify(res.data, null, 2),
      });
    } catch (e: any) {
      Alert.alert('Erreur', e.message || "Impossible d'exporter vos données.");
    } finally {
      setExporting(false);
    }
  };

  // Suppression de compte (S3 — droit à l'effacement). Double confirmation,
  // puis purge de la session locale et retour à l'écran de connexion.
  const handleDeleteAccount = () => {
    Alert.alert(
      'Supprimer mon compte',
      'Cette action est IRRÉVERSIBLE. Vos campagnes, candidatures et données personnelles seront définitivement effacées.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer définitivement',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete('/me');
            } catch (e: any) {
              Alert.alert('Erreur', e.message || 'Suppression impossible.');
              return;
            }
            await logout();
            queryClient.clear();
            router.replace('/(auth)/login');
          },
        },
      ]
    );
  };

  // Sélection d'un CV (PDF), validation de taille, puis upload multipart vers l'API.
  const handlePickCV = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets) {
        const file = result.assets[0];
        
        // Validation taille (5MB)
        if (file.size && file.size > 5 * 1024 * 1024) {
          Alert.alert("Fichier trop volumineux", "Le CV ne doit pas dépasser 5 Mo.");
          return;
        }

        setUploading(true);
        const formData = new FormData();
        // @ts-ignore
        formData.append('cv', {
          uri: file.uri,
          name: file.name,
          type: 'application/pdf',
        });

        // Route : /api/me/cv (le module user est monté sous le préfixe '/api').
        await api.post('/me/cv', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });

        Alert.alert("Succès", "Votre CV a été mis à jour et est en cours d'analyse par l'IA.");
        queryClient.invalidateQueries({ queryKey: ['profile'] });
      }
    } catch (err) {
      console.error(err);
      Alert.alert("Erreur", "Impossible d'importer le fichier.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-gray-50">
      <View className="px-6 py-10 bg-white border-b border-gray-100 items-center justify-center">
        <View className="relative">
          <View className="w-28 h-28 bg-blue-100 rounded-full items-center justify-center border-4 border-white">
            <Text className="text-blue-600 text-4xl font-black">
              {user?.firstName?.charAt(0)}{user?.lastName?.charAt(0)}
            </Text>
          </View>
          <View className="absolute bottom-1 right-1 bg-green-500 w-6 h-6 rounded-full border-4 border-white" />
        </View>
        <Text className="text-3xl font-black text-gray-900 mt-4 tracking-tight">{user?.firstName} {user?.lastName}</Text>
        <Text className="text-gray-500 font-medium">{user?.email}</Text>
        
        <View className="bg-blue-600 px-4 py-1.5 rounded-full mt-4">
           <Text className="text-white text-xs font-black uppercase tracking-widest">{profile?.plan || 'FREE'} PLAN</Text>
        </View>
      </View>

      <View className="p-6">
        {/* CV Section */}
        <Text className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Votre Candidature</Text>
        <TouchableOpacity 
          onPress={handlePickCV}
          disabled={uploading}
          className="bg-white p-6 rounded-[32px] border border-gray-100 flex-row items-center mb-8"
        >
          <View className="w-14 h-14 bg-red-50 rounded-2xl items-center justify-center mr-4">
             <Ionicons name="document-text" size={30} color="#EF4444" />
          </View>
          <View className="flex-1">
            <Text className="text-gray-900 font-black text-lg">Mon CV (PDF)</Text>
            <Text className="text-gray-500 font-medium">
              {profile?.cvUrl ? 'Mis à jour' : 'Aucun CV importé'}
            </Text>
          </View>
          {uploading ? (
            <ActivityIndicator color="#2563EB" />
          ) : (
            <View className="bg-blue-50 px-3 py-2 rounded-xl">
              <Text className="text-blue-600 text-xs font-bold">Remplacer</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Settings Grid */}
        <Text className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Paramètres Pro</Text>
        <View className="bg-white rounded-[32px] border border-gray-100 overflow-hidden mb-8">
          <SettingItem 
            icon="mail" 
            color="text-blue-600" 
            iconColor="#2563EB"
            bg="bg-blue-50" 
            title="Configuration SMTP" 
            subtitle="Gmail, Resend, Outlook..." 
            onPress={() => router.push('/settings/smtp')}
          />
          <SettingItem
            icon="megaphone"
            color="text-amber-600"
            iconColor="#D97706"
            bg="bg-amber-50"
            title="Mes Campagnes"
            subtitle="Gérer vos envois actifs"
            onPress={() => router.push('/(tabs)/campaigns')}
          />
          <SettingItem
            icon="receipt"
            color="text-green-600"
            iconColor="#16A34A"
            bg="bg-green-50"
            title="Facturation"
            subtitle="Factures et avoirs"
            onPress={() => router.push('/settings/billing')}
          />
          <SettingItem
            icon="notifications"
            color="text-purple-600"
            iconColor="#9333EA"
            bg="bg-purple-50"
            title="Notifications Push"
            toggle
            toggleValue={notifEnabled}
            onToggle={setNotifEnabled}
          />
        </View>

        {/* Confidentialité (RGPD) : export et suppression des données (S3). */}
        <Text className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Confidentialité</Text>
        <View className="bg-white rounded-[32px] border border-gray-100 overflow-hidden mb-8">
          <TouchableOpacity
            onPress={handleExportData}
            disabled={exporting}
            className="flex-row items-center p-6 border-b border-gray-50 active:bg-gray-50"
          >
            <View className="w-12 h-12 bg-gray-100 rounded-2xl items-center justify-center mr-4">
              <Ionicons name="download-outline" size={24} color="#4B5563" />
            </View>
            <View className="flex-1">
              <Text className="text-gray-900 font-black">Exporter mes données</Text>
              <Text className="text-gray-400 text-xs font-medium">Récupérer toutes vos données (RGPD)</Text>
            </View>
            {exporting ? (
              <ActivityIndicator color="#2563EB" />
            ) : (
              <Ionicons name="chevron-forward" size={20} color="#D1D5DB" />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleDeleteAccount}
            className="flex-row items-center p-6 active:bg-red-50"
          >
            <View className="w-12 h-12 bg-red-50 rounded-2xl items-center justify-center mr-4">
              <Ionicons name="trash-outline" size={24} color="#EF4444" />
            </View>
            <View className="flex-1">
              <Text className="text-red-500 font-black">Supprimer mon compte</Text>
              <Text className="text-gray-400 text-xs font-medium">Effacement définitif et irréversible</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#FCA5A5" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={handleLogout}
          className="bg-red-50 p-6 rounded-[32px] flex-row items-center justify-center border border-red-100 active:bg-red-100"
        >
          <Ionicons name="log-out-outline" size={24} color="#EF4444" />
          <Text className="text-red-500 font-black text-lg ml-3">Déconnexion</Text>
        </TouchableOpacity>

        <Text className="text-center text-gray-300 text-[10px] uppercase font-black tracking-widest mt-10">Candio v1.2.4 — Built for Tech Talent</Text>
      </View>
    </ScrollView>
  );
}

// Ligne de réglage réutilisable : icône + titre/sous-titre + chevron ou switch.
// En mode `toggle`, l'état est contrôlé par `toggleValue` / `onToggle`.
function SettingItem({ icon, color, bg, title, subtitle, toggle, onPress, iconColor, toggleValue, onToggle }: any) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-row items-center p-6 border-b border-gray-50 active:bg-gray-50"
    >
      <View className={`w-12 h-12 ${bg} rounded-2xl items-center justify-center mr-4`}>
        <Ionicons name={icon} size={24} color={iconColor} />
      </View>
      <View className="flex-1">
        <Text className="text-gray-900 font-black">{title}</Text>
        <Text className="text-gray-400 text-xs font-medium">{subtitle}</Text>
      </View>
      {toggle ? (
        <Switch
          value={!!toggleValue}
          onValueChange={onToggle}
          trackColor={{ false: '#E5E7EB', true: '#93C5FD' }}
          thumbColor={'#2563EB'}
        />
      ) : (
        <Ionicons name="chevron-forward" size={20} color="#D1D5DB" />
      )}
    </TouchableOpacity>
  );
}
