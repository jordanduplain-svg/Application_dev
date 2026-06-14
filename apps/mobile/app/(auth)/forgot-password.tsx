import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { Ionicons } from '@expo/vector-icons';

/**
 * Écran « Mot de passe oublié » (S1, étape 1).
 * L'utilisateur saisit son email ; l'API lui envoie un code à 6 chiffres.
 * On redirige ensuite vers l'écran de saisie du code.
 */
export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const isEmailValid = /^\S+@\S+\.\S+$/.test(email.trim());

  const onSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      // L'API répond toujours un succès générique (anti-énumération de comptes) :
      // on passe à l'étape de saisie du code quel que soit le cas.
      router.push({
        pathname: '/(auth)/reset-password',
        params: { email: email.trim() },
      });
    } catch (e: any) {
      setError(e.message || 'Une erreur est survenue');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-white"
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 }}
      >
        <TouchableOpacity onPress={() => router.back()} className="absolute top-12 left-6">
          <Ionicons name="arrow-back" size={26} color="#111827" />
        </TouchableOpacity>

        <View className="mb-10">
          <Text className="text-4xl font-extrabold text-blue-600 tracking-tight">
            Mot de passe oublié
          </Text>
          <Text className="text-lg text-gray-500 mt-3 font-medium">
            Saisissez votre email : nous vous enverrons un code de réinitialisation.
          </Text>
        </View>

        {error && (
          <View className="bg-red-50 p-4 rounded-xl mb-6 border border-red-100 flex-row items-center">
            <Ionicons name="alert-circle" size={20} color="#EF4444" />
            <Text className="text-red-500 ml-2 font-medium flex-1">{error}</Text>
          </View>
        )}

        <Text className="text-sm font-bold text-gray-700 mb-2 ml-1">Email</Text>
        <TextInput
          placeholder="votre@email.com"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          className="w-full h-14 border border-gray-200 bg-gray-50 rounded-2xl px-5 text-gray-900 text-base"
        />

        <TouchableOpacity
          onPress={onSubmit}
          disabled={loading || !isEmailValid}
          className={`w-full h-15 rounded-2xl justify-center items-center mt-10 ${
            loading || !isEmailValid ? 'bg-blue-300' : 'bg-blue-600'
          }`}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white text-lg font-bold">Envoyer le code</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.back()} className="mt-8 items-center">
          <Text className="text-gray-500 font-medium">Retour à la connexion</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
